// 移植元: snishi-code-medical/hospital-rounds/src/features/patient-undo.js (UI 非依存化)
//
// 患者画面の「戻す / 進む」(Undo/Redo)。
//
// 設計方針 (v1 から不変):
//   - **患者(pid)ごとに閉じる** = Ctrl-Z のドキュメント単位。全状態クローンだと「別患者へ
//     遷移後に戻すと、見ていない前患者が裏で戻る」事故が起きるため、患者ごとに閉じる。
//   - **フィールドスコープ**: Undo は対象フィールド (formatValues) だけを in-place で
//     入れ替える。患者オブジェクトを丸ごと差し替えると、Undo 対象外の患者識別情報
//     (氏名 / 部屋 / ステータス / タグ / セット) まで巻き戻り、サイレントな PII 巻き戻りが
//     起きる。スコープを切ることで識別情報には一切触れない (v1 Codex 監査指摘の修正)。
//   - **セッション内メモリのみ**: 永続化しない。リロードで履歴は消える。snapshots
//     (IDB 災害復旧) とは別物・無関係。
//   - **カーソル方式 redo**: 戻す→進むで往復。新規編集が入ると redo 枝を破棄。
//   - **fail-closed**: 差し替え後の保存 (persist 注入) が失敗したら live を元へ戻し、
//     成功扱いにしない。
//
// v1 との差分 (UI 非依存化):
//   - appState/selectedNo の live binding 直読み → patient オブジェクトを引数で受ける。
//   - showToast / DOM ボタン更新 (refreshUndoButtons) → 戻り値 + onChange コールバックに
//     置き換え。表示は React 層の責務。
//   - persistActiveOrThrow / markUpdated は deps 注入 (persist は throw する契約)。

import type { Patient } from './types';
import { mergeTagsAdd, mergeTagsRemove } from './formatValues';

/** 患者ごとのスタック上限 (古いものから捨てる) */
export const PATIENT_UNDO_MAX = 50;

// 種別ごとに「戻す対象フィールド」を定義する。ここに無いフィールド (name/room/status/
// tags/activeFormatGroupId など患者識別情報) は Undo で一切触らない。
// Phase 7 (v1): 臨床入力本文は全て formatValues に集約されたため format スコープ 1 本。
const LABEL_FIELDS: Record<string, readonly string[]> = {
  format: ['formatValues'],
};
const DEFAULT_LABEL = 'format';

function fieldsFor(label: string): readonly string[] {
  return LABEL_FIELDS[label] || LABEL_FIELDS[DEFAULT_LABEL] || [];
}

// Entry = { label, fields, tagsAdded }。tagsAdded = この操作で自動付与されたタグ delta。
// Undo で除去 / Redo で再付与する (タグ列全体を巻き戻さず delta だけ扱う = 手編集タグを守る)。
interface Entry {
  label: string;
  fields: Record<string, unknown>;
  tagsAdded: string[];
}

interface Bucket {
  undo: Entry[];
  redo: Entry[];
}

function clone<T>(o: T): T | null {
  try {
    return JSON.parse(JSON.stringify(o)) as T;
  } catch {
    return null;
  }
}

function pidOf(p: Patient | null | undefined): string {
  return p && typeof p.pid === 'string' ? p.pid : '';
}

// 患者 p から、その label の対象フィールドだけをクローンして取り出す。
function snapshotFields(p: Patient, label: string): Record<string, unknown> | null {
  const out: Record<string, unknown> = {};
  for (const f of fieldsFor(label)) out[f] = clone(p[f]);
  return out;
}

export interface PatientUndoDeps {
  /**
   * fail-closed 保存 (v1 persistActiveOrThrow 相当)。失敗は必ず throw する契約。
   * throw された場合、undo/redo は live state をロールバックして ok:false を返す。
   */
  persist: () => Promise<void>;
  /**
   * 書き戻し + 保存成功後の通知 (v1 markUpdated + refreshPatientUI 相当)。
   * UI 再描画・toast は呼び出し側 (React 層) がここで行う。
   */
  onApplied?: (patient: Patient, dir: 'undo' | 'redo', label: string) => void;
  /** updatedAt 用の時刻注入 (テスト用)。既定 Date.now */
  now?: () => number;
}

export interface UndoStepResult {
  ok: boolean;
  label?: string;
}

export interface PatientUndo {
  /**
   * 値を変更する直前に呼ぶ Undo 起点 (操作単位)。preFields 省略時は現在患者の対象フィールド
   * クローン (= 変更適用の直前に呼ぶ前提)。opts.tagsAdded = この操作で自動付与されるタグ delta。
   */
  capture(
    patient: Patient | null | undefined,
    label?: string,
    opts?: { preFields?: Record<string, unknown>; tagsAdded?: string[] },
  ): void;
  canUndo(patient: Patient | null | undefined): boolean;
  canRedo(patient: Patient | null | undefined): boolean;
  undo(patient: Patient | null | undefined): Promise<UndoStepResult>;
  redo(patient: Patient | null | undefined): Promise<UndoStepResult>;
  /** 全患者の履歴を破棄 (病棟/ユーザー切替時など)。 */
  clearAll(): void;
}

export function createPatientUndo(deps: PatientUndoDeps): PatientUndo {
  const now = deps.now ?? Date.now;
  const hist = new Map<string, Bucket>(); // pid -> { undo, redo }

  function bucket(pid: string): Bucket {
    let b = hist.get(pid);
    if (!b) {
      b = { undo: [], redo: [] };
      hist.set(pid, b);
    }
    return b;
  }

  function pushUndo(pid: string, fields: Record<string, unknown>, label: string, tagsAdded: string[]): void {
    const b = bucket(pid);
    b.undo.push({ label, fields, tagsAdded: Array.isArray(tagsAdded) ? tagsAdded : [] });
    if (b.undo.length > PATIENT_UNDO_MAX) b.undo.shift();
    b.redo.length = 0; // 新規編集で redo 枝を破棄 (Ctrl-Z と同じ)
  }

  /**
   * entry の対象フィールドだけを患者へ in-place で書き戻し、反対スタックへ現状の同じ
   * フィールドを積む。患者オブジェクトは差し替えず識別情報には触れない。自動付与タグの
   * delta は dir に応じて undo=除去 / redo=再付与する (タグ列全体は巻き戻さない)。fail-closed。
   */
  async function applyEntry(
    p: Patient,
    entry: Entry,
    oppositeStack: Entry[],
    dir: 'undo' | 'redo',
  ): Promise<UndoStepResult> {
    const keys = Object.keys(entry.fields);
    const tags = Array.isArray(entry.tagsAdded) ? entry.tagsAdded : [];
    const cur: Record<string, unknown> = {}; // 反対スタック用 (書き戻し前の現状フィールド)
    for (const f of keys) cur[f] = clone(p[f]);
    const tagsBackup = tags.length ? clone(p.tags) : null; // ロールバック用
    for (const f of keys) p[f] = entry.fields[f]; // 対象フィールドだけ in-place 入替
    if (tags.length) {
      p.tags = dir === 'undo' ? mergeTagsRemove(p.tags, tags) : mergeTagsAdd(p.tags, tags);
    }
    p.updatedAt = now(); // v1 markUpdated 相当
    try {
      await deps.persist();
    } catch (e) {
      console.error('patient-undo: save failed, rolling back live state', e);
      for (const f of keys) p[f] = cur[f]; // 画面と durable を一致させる (成功扱いにしない)
      if (tagsBackup) p.tags = tagsBackup;
      return { ok: false };
    }
    oppositeStack.push({ label: entry.label, fields: cur, tagsAdded: tags });
    return { ok: true, label: entry.label };
  }

  async function step(p: Patient | null | undefined, dir: 'undo' | 'redo'): Promise<UndoStepResult> {
    const pid = pidOf(p);
    const b = hist.get(pid);
    const from = dir === 'undo' ? b?.undo : b?.redo;
    const to = dir === 'undo' ? b?.redo : b?.undo;
    if (!p || !from || !to || !from.length) return { ok: false };
    const entry = from.pop();
    if (!entry) return { ok: false };
    const res = await applyEntry(p, entry, to, dir);
    if (!res.ok) {
      from.push(entry); // 失敗時は戻す (履歴を失わない)
      return res;
    }
    if (deps.onApplied) deps.onApplied(p, dir, entry.label);
    return res;
  }

  return {
    capture(patient, label = DEFAULT_LABEL, opts) {
      const pid = pidOf(patient);
      if (!patient || !pid) return;
      const fields = opts?.preFields !== undefined ? opts.preFields : snapshotFields(patient, label);
      if (!fields) return;
      const tagsAdded = opts && Array.isArray(opts.tagsAdded) ? opts.tagsAdded.slice() : [];
      pushUndo(pid, fields, label, tagsAdded);
    },
    canUndo(patient) {
      const b = hist.get(pidOf(patient));
      return !!(b && b.undo.length);
    },
    canRedo(patient) {
      const b = hist.get(pidOf(patient));
      return !!(b && b.redo.length);
    },
    undo(patient) {
      return step(patient, 'undo');
    },
    redo(patient) {
      return step(patient, 'redo');
    },
    clearAll() {
      hist.clear();
    },
  };
}
