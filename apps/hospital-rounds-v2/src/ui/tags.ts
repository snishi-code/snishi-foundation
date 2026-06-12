// 移植元: snishi-code-medical/hospital-rounds/src/features/tags.js の
//          §2 (クエリ) / §4 (タグ CRUD + 患者波及) / §5 (共有フィルタ状態)
//
// タグの正本は settings.tags (ユーザー設定)。患者側は patient.tags (名前参照)。
// 改名/削除は **アクティブ病棟の患者にのみ** 波及する (v1 仕様準拠 — 非アクティブ病棟の
// 患者タグは名前参照のため、改名後は「未登録タグ」として表示されず無害)。
//
// タグフィルタはモジュールレベル状態 (アプリ起動中のみ保持)。
// 変更後の再描画は呼び出し側が runtime.bump() で行う。
// フィルタはユーザータグのみ・全タグ一致 (AND) 固定。AND/OR 切替と仮想ステータスタグは
// v2 では撤去済み (仕様判断 2026-06)。

import type { Patient, Settings } from '../domain/types';
import type { HrStore } from '../data/store';

// ============================
// クエリ
// ============================

/** ユーザー定義タグ名一覧 (TagDef[] → string[])。 */
export function getAllTags(settings: Settings): string[] {
  return Array.isArray(settings.tags)
    ? settings.tags.map((t) => t.name).filter((n) => n.trim())
    : [];
}

// ============================
// タグ CRUD (設定 + アクティブ病棟患者への波及)。保存は caller の責務に
// しない — v1 同様ここで saveSettings / scheduleSave まで行う。
// ============================

/** 新規タグ追加 (重複は false)。 */
export function addNewTag(store: HrStore, name: string): boolean {
  const trimmed = String(name || '').trim();
  if (!trimmed) return false;
  const settings = store.getSettings();
  if (!Array.isArray(settings.tags)) settings.tags = [];
  if (settings.tags.some((t) => t.name === trimmed)) return false;
  settings.tags.push({ name: trimmed, clearOnStart: false });
  void store.saveSettings();
  return true;
}

/** idx のタグを改名し、アクティブ病棟の患者タグも同名置換する。重複は false。 */
export function renameTagAt(store: HrStore, idx: number, newName: string): boolean {
  const settings = store.getSettings();
  if (!Array.isArray(settings.tags) || idx < 0 || idx >= settings.tags.length) return false;
  const oldName = settings.tags[idx]!.name;
  const next = String(newName || '').trim();
  if (!next) return false;
  if (oldName === next) return true;
  if (settings.tags.some((t) => t.name === next)) return false;
  settings.tags[idx]!.name = next;
  for (const p of store.getAppState().patients) {
    if (Array.isArray(p.tags)) p.tags = p.tags.map((tg) => (tg === oldName ? next : tg));
  }
  void store.saveSettings();
  store.scheduleSave();
  return true;
}

/** idx のタグを削除し、アクティブ病棟の患者からも外す。 */
export function deleteTagAt(store: HrStore, idx: number): void {
  const settings = store.getSettings();
  if (!Array.isArray(settings.tags) || idx < 0 || idx >= settings.tags.length) return;
  const name = settings.tags[idx]!.name;
  settings.tags.splice(idx, 1);
  for (const p of store.getAppState().patients) {
    if (Array.isArray(p.tags) && p.tags.includes(name)) {
      p.tags = p.tags.filter((tg) => tg !== name);
    }
  }
  void store.saveSettings();
  store.scheduleSave();
}

/** idx のタグの clearOnStart フラグを変更する。 */
export function setTagClearOnStart(store: HrStore, idx: number, on: boolean): void {
  const settings = store.getSettings();
  if (!Array.isArray(settings.tags) || idx < 0 || idx >= settings.tags.length) return;
  settings.tags[idx]!.clearOnStart = on;
  void store.saveSettings();
}

// ============================
// ホームタグフィルタ状態 (アプリ起動中のみ保持)
// ============================

let _homeTagFilter: string[] = [];

export function getHomeTagFilter(): string[] {
  return _homeTagFilter.slice();
}
export function setHomeTagFilter(tags: string[]): void {
  _homeTagFilter = tags.slice();
}
/** テスト間の残留防止。 */
export function _resetHomeTagFilterForTests(): void {
  _homeTagFilter = [];
}

/** 選択タグをすべて持つ患者だけ表示する (AND 固定・ユーザータグのみ)。 */
export function patientMatchesTagFilter(p: Patient): boolean {
  if (!_homeTagFilter.length) return true;
  const have = new Set(Array.isArray(p.tags) ? p.tags : []);
  return _homeTagFilter.every((tg) => have.has(tg));
}
