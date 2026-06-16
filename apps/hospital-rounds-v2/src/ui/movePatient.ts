// 移植元: snishi-code-medical/hospital-rounds/src/features/move-patient.js (データ操作部)
//
// 患者の他ワークスペースへの移動 (転棟)。
//   - 元データは触らない (name/room は無傷)。元 ws の患者には transferredAt /
//     transferredTo マーカー + status=GRAY。
//   - 移動先には新 pid + status=BLUE で末尾 append。
//   - fail-closed + 補償: 元 ws の保存に失敗したら移動先へ append したコピーを
//     取り除き、マーカーも戻して throw (両病棟重複を残さない)。
//   - 破壊操作の直前に snapshot (REASON.MOVE) を撮る。
//
// v1 との差分: live binding をやめ runtime (store/snapshots) を引数で受ける。
// Trash 病棟は v2 UI コアでは未実装のため除外フィルタのみ将来用に残す。

import type { SnapshotStore } from '@snishi/foundation/snapshot/snapshots';
import { STATUS, type Patient } from '../domain/types';
import { isPatientEmpty, makeDefaultPatient } from '../domain/normalize';
import { SECTION, getSection } from '../data/bundle';
import type { HrStore } from '../data/store';
import { REASON, countActivePatients, type SnapshotData } from '../data/snapshots';
import type { WorkspaceListing } from '../data/storage';

export interface MoveDeps {
  store: HrStore;
  snapshots: SnapshotStore<SnapshotData>;
}

/** 現アクティブ以外のワークスペース一覧 (移動先候補)。更新の新しい順。 */
export async function listOtherWorkspaces(store: HrStore): Promise<WorkspaceListing[]> {
  const activeId = store.storage.getActiveWorkspaceId();
  const all = await store.storage.listBundles();
  return all.filter((r) => r.id !== activeId).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
}

// 移動先用コピー (pid 新発番 / status BLUE / 転棟マーカー無し / formatValues deep copy)。
// 名簿 (roster) ID はローカル pid と同じく移動先では引き継がない: この手動移動は別病棟への
// ローカルコピー (元には (移) マーカー) であり、roster の正本エピソード ID を維持する「転棟」
// (同じ rosterPatientId を保つ機能) は本タスクの非ゴール。別正本病棟の rosterPatientId を
// 移動先へ持ち込むと、その病棟が将来 HM 正本化された時に他病棟由来の rpid を配布してしまう
// (取り違え)。安全側に unmanaged へ倒す (rosterAware な転棟は 転棟/退院ログ タスクで実装)。
function buildDestCopy(src: Patient): Patient {
  return {
    ...src,
    pid: makeDefaultPatient().pid,
    status: STATUS.BLUE,
    updatedAt: Date.now(),
    transferredAt: 0,
    transferredTo: '',
    rosterPatientId: '',
    rosterManaged: false,
    tags: Array.isArray(src.tags) ? src.tags.slice() : [],
    formatValues:
      src.formatValues && typeof src.formatValues === 'object'
        ? (JSON.parse(JSON.stringify(src.formatValues)) as Patient['formatValues'])
        : {},
  };
}

function markTransferred(p: Patient, destLabel: string): void {
  p.transferredAt = Date.now();
  p.transferredTo = String(destLabel || '');
  p.status = STATUS.GRAY;
}

interface MarkBackup {
  src: Patient;
  transferredAt: number;
  transferredTo: string;
  status: Patient['status'];
}

function captureMarks(valid: Array<{ src: Patient }>): MarkBackup[] {
  return valid.map(({ src }) => ({
    src,
    transferredAt: src.transferredAt,
    transferredTo: src.transferredTo,
    status: src.status,
  }));
}

function revertMarks(marks: MarkBackup[]): void {
  for (const m of marks) {
    m.src.transferredAt = m.transferredAt;
    m.src.transferredTo = m.transferredTo;
    m.src.status = m.status;
  }
}

async function appendPatientsToWorkspace(store: HrStore, destId: string, patients: Patient[]): Promise<void> {
  const bundle = await store.storage.loadBundle(destId);
  if (!bundle) throw new Error(`workspace not found: ${destId}`);
  const current = getSection(bundle, SECTION.PATIENTS);
  const next = Array.isArray(current) ? (current as Patient[]).slice() : [];
  for (const p of patients) next.push(p);
  bundle.sections = bundle.sections || {};
  (bundle.sections as Record<string, unknown>)[SECTION.PATIENTS] = next;
  await store.storage.saveBundle(bundle, destId);
}

async function removePatientsFromWorkspace(store: HrStore, destId: string, pids: string[]): Promise<void> {
  const drop = new Set(pids.filter(Boolean));
  if (!drop.size) return;
  const bundle = await store.storage.loadBundle(destId);
  if (!bundle) return;
  const current = getSection(bundle, SECTION.PATIENTS);
  const next = (Array.isArray(current) ? (current as Patient[]) : []).filter((p) => !drop.has(p && p.pid));
  bundle.sections = bundle.sections || {};
  (bundle.sections as Record<string, unknown>)[SECTION.PATIENTS] = next;
  await store.storage.saveBundle(bundle, destId);
}

async function captureMoveSnapshot(deps: MoveDeps): Promise<void> {
  const { store, snapshots } = deps;
  const appState = store.getAppState();
  await snapshots.capture(
    REASON.MOVE,
    store.storage.getActiveWorkspaceId(),
    { title: appState.title, patients: appState.patients },
    String(countActivePatients(appState.patients)),
  );
}

/**
 * 複数患者を一括移動する。失敗時は補償して throw (全部成功か全部無し)。
 * 戻り値 = 実際に移動した件数 (空スロット・移動済はスキップ)。
 */
export async function movePatients(
  deps: MoveDeps,
  srcPatientIndices: number[],
  destId: string,
  destLabel: string,
): Promise<number> {
  const { store } = deps;
  if (destId === store.storage.getActiveWorkspaceId()) {
    throw new Error('cannot move within the same workspace');
  }
  const appState = store.getAppState();
  const valid: Array<{ idx: number; src: Patient }> = [];
  for (const idx of srcPatientIndices) {
    const p = appState.patients[idx];
    if (!p) continue;
    if (isPatientEmpty(p)) continue;
    if (p.transferredAt) continue; // 再移動は移動先増殖になるため不可
    valid.push({ idx, src: p });
  }
  if (!valid.length) return 0;

  // 破壊操作の直前スナップショット
  await captureMoveSnapshot(deps);

  const copies = valid.map(({ src }) => buildDestCopy(src));
  // 移動先へ append + save (失敗したら元 ws を一切触らず throw)
  await appendPatientsToWorkspace(store, destId, copies);

  const marks = captureMarks(valid);
  for (const { idx, src } of valid) {
    markTransferred(src, destLabel);
    store.markUpdated(idx + 1);
  }
  try {
    await store.persistActiveOrThrow();
  } catch (e) {
    // 補償: 移動先のコピーを取り除き、元 ws のマーカーも戻す (両病棟重複を防ぐ)
    try {
      await removePatientsFromWorkspace(store, destId, copies.map((c) => c.pid));
    } catch (e2) {
      console.error('move rollback (dest cleanup) failed:', e2);
    }
    revertMarks(marks);
    throw e;
  }
  return valid.length;
}

/** 指定患者だけを含む新規ワークスペースへ移動する。失敗時は補償して throw。 */
export async function moveToNewWorkspace(
  deps: MoveDeps,
  srcPatientIndices: number[],
  label: string,
): Promise<number> {
  const { store } = deps;
  const appState = store.getAppState();
  const valid: Array<{ idx: number; src: Patient }> = [];
  for (const idx of srcPatientIndices) {
    const p = appState.patients[idx];
    if (!p) continue;
    if (isPatientEmpty(p)) continue;
    if (p.transferredAt) continue;
    valid.push({ idx, src: p });
  }
  if (!valid.length) return 0;

  await captureMoveSnapshot(deps);

  const copies = valid.map(({ src }) => buildDestCopy(src));
  const newWsId = await store.createWorkspaceWithPatients(label, copies);
  const marks = captureMarks(valid);
  for (const { idx, src } of valid) {
    markTransferred(src, label);
    store.markUpdated(idx + 1);
  }
  try {
    await store.persistActiveOrThrow();
  } catch (e) {
    try {
      await store.storage.deleteBundle(newWsId);
    } catch (e2) {
      console.error('moveToNewWorkspace rollback (delete new ws) failed:', e2);
    }
    revertMarks(marks);
    throw e;
  }
  return valid.length;
}
