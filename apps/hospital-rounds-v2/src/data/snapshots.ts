// 移植元: snishi-code-medical/hospital-rounds/src/features/snapshots.js
//          (foundation snapshot/snapshots createSnapshotStore に HR の構成を注入)
//
// スナップショット / 復元 — 患者データ本体 (bundles DB) ・イベントログとは別の専用 IDB。
// **個人情報を含む** ため「少なく・短く」保持する:
//   - 撮るタイミング = 破壊操作の直前 (clear / move / patient_delete / delete / import)
//     + 画面遷移直前の浅いアンドゥ (nav、直近 2 枚リング)
//   - 破壊操作前は「その日の最初の 1 枚」(同日再操作で『昨日』を消さない)
//   - すべて 14 日で自動失効
//   - 復元は履歴保持 (Git revert 型): 復元前に現状を restore_undo で 1 枚撮る
//   - 病棟/ユーザー削除時の purge は tombstone で retry 追跡 (PII を best-effort で捨てない)
//
// dedup / TTL / tombstone / 復元のロジックは foundation 側 (createSnapshotStore)。
// ここでは HR 固有の構成 (REASON・DB 名・署名関数) だけを注入する。

import {
  createSnapshotStore,
  type SnapshotStore,
} from '@snishi/foundation/snapshot/snapshots';
import type { PointerStore } from '@snishi/foundation/storage/pointers';
import { STATUS, type Patient } from '../domain/types';
import { SNAPSHOT_DB_NAME } from './constants';

/** 撮影理由の定数 (v1 REASON と同値。値は保存データに入るので変更不可) */
export const REASON = Object.freeze({
  CLEAR: 'clear', // 記録クリア (診察開始) 直前
  MOVE: 'move', // 患者一括移動 直前
  PATIENT_DELETE: 'patient_delete', // 患者削除/復元/完全削除 直前
  DELETE: 'delete', // 病棟削除 直前
  IMPORT: 'import', // 取込で現病棟に追記 直前
  RESTORE_UNDO: 'restore_undo', // 復元の直前 (復元の取り消し用)
  NAV: 'nav', // 画面遷移直前の浅いアンドゥ
} as const);
export type SnapshotReason = (typeof REASON)[keyof typeof REASON];

/** TTL (PII のため短め)。v1 と同じ 14 日 */
export const SNAPSHOT_TTL_DAYS = 14;
/** 病棟ごとに保持する nav スナップショット数。v1 と同じ 2 */
export const SNAPSHOT_NAV_KEEP = 2;

// 破壊操作前の reason (同日 dedup の対象)。v1 の isDestructive(reason !== NAV) と等価:
// restore_undo は foundation 側で dedup なしの専用扱い (v1 も直接 add していた)。
const DESTRUCTIVE_REASONS = [
  REASON.CLEAR,
  REASON.MOVE,
  REASON.PATIENT_DELETE,
  REASON.DELETE,
  REASON.IMPORT,
] as const;

/** スナップショット 1 枚のデータ (v1 レコードの title + patients 部分) */
export interface SnapshotData {
  title: string;
  patients: Patient[];
}

// 変化検出用の軽量ハッシュ (nav の重複撮影スキップ用)。v1 hashPatients の djb2 移植。
function hashPatients(patients: readonly Patient[]): string {
  let s: string;
  try {
    s = JSON.stringify(patients);
  } catch {
    s = '';
  }
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return String(h);
}

/**
 * 復元候補一覧の表示用件数 (v1 listRestorePoints の count 相当)。
 * v2 では foundation の list() がメタ (label) しか返さないため、capture 時に
 * countActivePatients(...) を label に入れて渡す (intentional difference)。
 */
export function countActivePatients(patients: readonly Patient[]): number {
  return (Array.isArray(patients) ? patients : []).filter(
    (p) => p && (p.name || p.status !== STATUS.NONE),
  ).length;
}

/**
 * HR-v2 構成のスナップショットストアを作る。
 * tombstones には data/storage.ts の pointers (LOCAL_PREFIX 名前空間) を渡す
 * (foundation 側が DB 名入りキーで namespacing するため衝突しない)。
 */
export function createHrSnapshots(
  tombstones: PointerStore,
  now?: () => number,
): SnapshotStore<SnapshotData> {
  return createSnapshotStore<SnapshotData>({
    dbName: SNAPSHOT_DB_NAME,
    ttlDays: SNAPSHOT_TTL_DAYS,
    navKeep: SNAPSHOT_NAV_KEEP,
    destructiveReasons: DESTRUCTIVE_REASONS,
    navReason: REASON.NAV,
    restoreUndoReason: REASON.RESTORE_UNDO,
    signatureOf: (data) => hashPatients(data.patients),
    tombstones,
    now,
  });
}
