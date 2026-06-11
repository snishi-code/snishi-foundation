// 移植元: snishi-code-medical/hospital-rounds/src/features/patient-lifecycle.js (忠実移植)
//
// 患者ライフサイクル: 削除 → 「削除済み」病棟 (Trash) への退避 / 復元 / 完全削除 /
// 30日自動 purge。
//
// 設計の要 (患者増殖を起こさない最重要不変条件):
//   - 削除退避: Trash へ deep copy を append → 元病棟から splice。元病棟保存が失敗したら
//     Trash append を巻き戻し、元病棟の live state も戻す (= 両病棟に重複させない / fail-closed)。
//   - 復元: 復元先へ append → Trash から splice。movePatients() は使わない
//     (使うと Trash 側に (移) が残り不正)。
//   - 完全削除: 配列から取り除くだけ。Trash へ送らない。
//   - (移) 患者の削除 / Trash 内の削除 = 完全削除に回す (Trash へ二重退避しない)。
//
// 保存は全て persistActiveOrThrow() (fail-closed)。非アクティブ病棟は bundle 直接読み書き。
// Trash 病棟 ID: `__trash__::<userId>` (ユーザー別固定。予約 ID ではないので病棟一覧には
// 出るが、転棟先候補とは別扱い = この API でのみ操作する)。

import type { SnapshotStore } from '@snishi/foundation/snapshot/snapshots';
import type { AppState, Patient } from '../domain/types';
import { isPatientEmpty, makeDefaultPatient } from '../domain/normalize';
import { SECTION, getSection, projectBundle, type Bundle } from '../data/bundle';
import type { HrStore } from '../data/store';
import { REASON, countActivePatients, type SnapshotData } from '../data/snapshots';
import { isPatientTransferred } from './patientDisplay';
import { t } from '../i18n/strings';

const TRASH_PREFIX = '__trash__';
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

export interface LifecycleDeps {
  store: HrStore;
  snapshots: SnapshotStore<SnapshotData>;
}

export type LifecycleResult =
  | { ok: true; mode?: 'trash' | 'permanent' }
  | { ok: false; reason: 'busy' | 'not_found' | 'save_failed' | 'not_trash' | 'bad_dest' | 'not_deleted' };

// 多重クリック / 再入防止。削除・復元・完全削除は IDB await を挟むので、処理中に
// もう一度呼ばれると二重退避・二重削除になりうる。1 操作ずつに直列化する。
let _busy = false;

// ============================
// ID / 判定ヘルパ (純粋)
// ============================

export function isTrashWorkspaceId(wsId: string): boolean {
  return typeof wsId === 'string' && wsId.startsWith(TRASH_PREFIX + '::');
}

export function getTrashWorkspaceId(store: HrStore, userId?: string): string {
  return `${TRASH_PREFIX}::${userId || store.storage.getCurrentUserId()}`;
}

export function isTrashActive(store: HrStore): boolean {
  return isTrashWorkspaceId(store.storage.getActiveWorkspaceId());
}

export function isPatientDeleted(p: Patient | null | undefined): boolean {
  return !!(p && p.deletedAt);
}

function deepCopyPatient(p: Patient): Patient {
  return JSON.parse(JSON.stringify(p)) as Patient;
}

// ============================
// 低レベル bundle 操作 (非アクティブ病棟用)
// ============================

async function loadWsPatients(
  store: HrStore,
  wsId: string,
): Promise<{ bundle: Bundle; patients: Patient[] } | null> {
  const bundle = await store.storage.loadBundle(wsId);
  if (!bundle) return null;
  const cur = getSection(bundle, SECTION.PATIENTS);
  return { bundle, patients: Array.isArray(cur) ? (cur as Patient[]).slice() : [] };
}

async function saveWsPatients(
  store: HrStore,
  wsId: string,
  bundle: Bundle,
  patients: Patient[],
): Promise<void> {
  bundle.sections = bundle.sections || {};
  (bundle.sections as Record<string, unknown>)[SECTION.PATIENTS] = patients;
  // label 省略で既存 label (= 削除済み 等) を温存
  await store.storage.saveBundle(bundle, wsId);
}

async function appendPatientToBundle(store: HrStore, wsId: string, patient: Patient): Promise<void> {
  const loaded = await loadWsPatients(store, wsId);
  if (!loaded) throw new Error(`workspace not found: ${wsId}`);
  const next = loaded.patients.slice();
  next.push(patient);
  await saveWsPatients(store, wsId, loaded.bundle, next);
}

async function removePatientFromBundle(store: HrStore, wsId: string, pid: string): Promise<void> {
  if (!pid) return;
  const loaded = await loadWsPatients(store, wsId);
  if (!loaded) return;
  await saveWsPatients(
    store,
    wsId,
    loaded.bundle,
    loaded.patients.filter((p) => p && p.pid !== pid),
  );
}

async function bundlePidSet(store: HrStore, wsId: string): Promise<Set<string>> {
  const loaded = await loadWsPatients(store, wsId);
  const set = new Set<string>();
  if (loaded) for (const p of loaded.patients) if (p && p.pid) set.add(p.pid);
  return set;
}

async function getActiveWorkspaceLabel(store: HrStore): Promise<string> {
  try {
    const id = store.storage.getActiveWorkspaceId();
    const all = await store.storage.listBundles();
    const me = all.find((r) => r.id === id);
    return me ? me.label || '' : '';
  } catch {
    return '';
  }
}

async function captureLifecycleSnapshot(deps: LifecycleDeps): Promise<void> {
  const { store, snapshots } = deps;
  const state = store.getAppState();
  await snapshots.capture(
    REASON.PATIENT_DELETE,
    store.storage.getActiveWorkspaceId(),
    { title: state.title, patients: state.patients },
    String(countActivePatients(state.patients)),
  );
}

// ============================
// Trash 病棟の作成/取得
// ============================

/** 現ユーザーの Trash 病棟が無ければ作成し、その ID を返す。 */
export async function ensureTrashWorkspace(store: HrStore): Promise<string> {
  const trashId = getTrashWorkspaceId(store);
  const existing = await store.storage.loadBundle(trashId);
  if (existing) return trashId;
  const emptyState: AppState = { v: 3, title: '', patients: [], recvMemo: '', recvShared: '' };
  const bundle = projectBundle({
    appState: emptyState,
    settings: store.getSettings(),
    sections: [SECTION.META, SECTION.PATIENTS],
  });
  await store.storage.saveBundle(bundle, trashId, t('trash.workspace.label'));
  return trashId;
}

// ============================
// 削除 → Trash 退避
// ============================

/**
 * 通常病棟での「削除」。対象を Trash へ deep copy で退避し、元病棟から取り除く。
 * 空スロット / (移) 患者 / Trash 内は完全削除へ委譲 (二重退避・無意味な30日保存を防ぐ)。
 */
export async function deletePatientToTrash(deps: LifecycleDeps, patientIndex: number): Promise<LifecycleResult> {
  if (_busy) return { ok: false, reason: 'busy' };
  const { store } = deps;
  const appState = store.getAppState();
  const p = appState.patients[patientIndex];
  if (!p) return { ok: false, reason: 'not_found' };

  const activeId = store.storage.getActiveWorkspaceId();
  if (isPatientEmpty(p) || isPatientTransferred(p) || isTrashWorkspaceId(activeId)) {
    return permanentlyDeletePatient(deps, patientIndex);
  }

  _busy = true;
  try {
    await captureLifecycleSnapshot(deps);
    const trashId = await ensureTrashWorkspace(store);
    const srcLabel = await getActiveWorkspaceLabel(store);

    const copy = deepCopyPatient(p);
    copy.deletedAt = Date.now();
    copy.deletedFromWorkspaceId = activeId;
    copy.deletedFromWorkspaceLabel = srcLabel;
    // 退避コピーには転棟マーカーを持ち込まない (Trash 内で (移) 扱いにしない)
    copy.transferredAt = 0;
    copy.transferredTo = '';

    // 1) Trash へ append (durable)
    await appendPatientToBundle(store, trashId, copy);

    // 2) 元病棟 (= アクティブ) から live で取り除く。空になったら既定患者を補充。
    const beforePatients = appState.patients.slice();
    const nextPatients = appState.patients.slice();
    nextPatients.splice(patientIndex, 1);
    if (nextPatients.length === 0) nextPatients.push(makeDefaultPatient());
    store.setAppState({ ...appState, patients: nextPatients });

    // 3) 元病棟を fail-closed 保存。失敗したら Trash append を巻き戻し live も戻す。
    try {
      await store.persistActiveOrThrow();
    } catch (e) {
      store.setAppState({ ...store.getAppState(), patients: beforePatients });
      try {
        await removePatientFromBundle(store, trashId, copy.pid);
      } catch (e2) {
        console.error('delete rollback (trash cleanup) failed:', e2);
      }
      console.error('deletePatientToTrash save failed:', e);
      return { ok: false, reason: 'save_failed' };
    }
    return { ok: true, mode: 'trash' };
  } finally {
    _busy = false;
  }
}

// ============================
// 完全削除
// ============================

export async function permanentlyDeletePatient(
  deps: LifecycleDeps,
  patientIndex: number,
): Promise<LifecycleResult> {
  const reentrant = _busy;
  const { store } = deps;
  const appState = store.getAppState();
  const p = appState.patients[patientIndex];
  if (!p) return { ok: false, reason: 'not_found' };
  if (!reentrant) _busy = true;
  try {
    await captureLifecycleSnapshot(deps);
    const beforePatients = appState.patients.slice();
    const nextPatients = appState.patients.slice();
    nextPatients.splice(patientIndex, 1);
    if (nextPatients.length === 0 && !isTrashWorkspaceId(store.storage.getActiveWorkspaceId())) {
      nextPatients.push(makeDefaultPatient());
    }
    store.setAppState({ ...appState, patients: nextPatients });
    try {
      await store.persistActiveOrThrow();
    } catch (e) {
      store.setAppState({ ...store.getAppState(), patients: beforePatients });
      console.error('permanentlyDeletePatient save failed:', e);
      return { ok: false, reason: 'save_failed' };
    }
    return { ok: true, mode: 'permanent' };
  } finally {
    if (!reentrant) _busy = false;
  }
}

// ============================
// Trash → 通常病棟 へ復元
// ============================

export async function restoreDeletedPatientToWorkspace(
  deps: LifecycleDeps,
  patientIndex: number,
  destWorkspaceId: string,
): Promise<LifecycleResult> {
  if (_busy) return { ok: false, reason: 'busy' };
  const { store } = deps;
  const activeId = store.storage.getActiveWorkspaceId();
  if (!isTrashWorkspaceId(activeId)) return { ok: false, reason: 'not_trash' };
  if (!destWorkspaceId || isTrashWorkspaceId(destWorkspaceId)) return { ok: false, reason: 'bad_dest' };
  const appState = store.getAppState();
  const p = appState.patients[patientIndex];
  if (!p || !isPatientDeleted(p)) return { ok: false, reason: 'not_deleted' };

  _busy = true;
  try {
    await captureLifecycleSnapshot(deps);

    const restored = deepCopyPatient(p);
    restored.deletedAt = 0;
    restored.deletedFromWorkspaceId = '';
    restored.deletedFromWorkspaceLabel = '';
    restored.transferredAt = 0;
    restored.transferredTo = '';
    // pid 衝突時のみ新発番
    const destPids = await bundlePidSet(store, destWorkspaceId);
    if (destPids.has(restored.pid)) restored.pid = makeDefaultPatient().pid;

    // 1) 復元先へ append (durable)
    await appendPatientToBundle(store, destWorkspaceId, restored);

    // 2) Trash (= アクティブ) から live で取り除く。Trash は空を許容 (補充しない)。
    const beforePatients = appState.patients.slice();
    const nextPatients = appState.patients.slice();
    nextPatients.splice(patientIndex, 1);
    store.setAppState({ ...appState, patients: nextPatients });

    // 3) Trash を fail-closed 保存。失敗したら復元先 append と live を巻き戻す。
    try {
      await store.persistActiveOrThrow();
    } catch (e) {
      store.setAppState({ ...store.getAppState(), patients: beforePatients });
      try {
        await removePatientFromBundle(store, destWorkspaceId, restored.pid);
      } catch (e2) {
        console.error('restore rollback (dest cleanup) failed:', e2);
      }
      console.error('restoreDeletedPatientToWorkspace save failed:', e);
      return { ok: false, reason: 'save_failed' };
    }
    return { ok: true };
  } finally {
    _busy = false;
  }
}

// ============================
// 30日自動 purge
// ============================

function makeKeepFilter(wsId: string, now: number): (p: Patient) => boolean {
  if (isTrashWorkspaceId(wsId)) {
    return (p) => isPatientDeleted(p) && now - p.deletedAt <= THIRTY_DAYS_MS;
  }
  return (p) => !(isPatientTransferred(p) && now - p.transferredAt > THIRTY_DAYS_MS);
}

/**
 * 個人情報を Trash / (移) stub に無期限で残さないための自動完全削除。起動後に呼ぶ。
 * 失敗は warning に留め、他病棟の purge は続ける (best-effort。次回起動で再試行)。
 */
export async function purgeExpiredPatientLifecycleRecords(
  store: HrStore,
  now: number = Date.now(),
): Promise<{ ok: boolean; saved: number; activeChanged: boolean }> {
  const activeId = store.storage.getActiveWorkspaceId();
  let saved = 0;
  let activeChanged = false;
  let all: Awaited<ReturnType<typeof store.storage.listBundles>>;
  try {
    all = await store.storage.listBundles();
  } catch (e) {
    console.warn('purge: listBundles failed:', e);
    return { ok: false, saved: 0, activeChanged: false };
  }

  for (const r of all) {
    const keep = makeKeepFilter(r.id, now);
    try {
      if (r.id === activeId) {
        const cur = store.getAppState().patients;
        const next = cur.filter(keep);
        if (next.length !== cur.length) {
          const before = cur;
          store.setAppState({ ...store.getAppState(), patients: next });
          try {
            await store.persistActiveOrThrow();
            saved++;
            activeChanged = true;
          } catch (e) {
            store.setAppState({ ...store.getAppState(), patients: before });
            console.warn('purge: active save failed:', e);
          }
        }
      } else {
        const loaded = await loadWsPatients(store, r.id);
        if (!loaded) continue;
        const next = loaded.patients.filter(keep);
        if (next.length === loaded.patients.length) continue;
        await saveWsPatients(store, r.id, loaded.bundle, next);
        saved++;
      }
    } catch (e) {
      console.warn('purge: workspace failed:', r.id, e);
    }
  }
  return { ok: true, saved, activeChanged };
}
