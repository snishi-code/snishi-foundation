// 患者移動 (転棟) の roster 不変条件: 移動先コピーは roster の正本 ID を引き継がない。
// roster-aware な転棟 (同じ rosterPatientId を維持) は 転棟/退院ログ タスクの非ゴール。
// 別正本病棟の rosterPatientId を持ち込むと将来の HM 正本 QR で取り違えになるため。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import type { SnapshotStore } from '@snishi/foundation/snapshot/snapshots';
import { createHrStorage, type HrStorage } from '../src/data/storage';
import { createHrStore, type HrStore } from '../src/data/store';
import { SECTION, getSection } from '../src/data/bundle';
import { moveToNewWorkspace, type MoveDeps } from '../src/ui/movePatient';
import type { SnapshotData } from '../src/data/snapshots';
import type { Patient } from '../src/domain/types';

function makeStorageStub(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (k: string) => map.get(k) ?? null,
    key: (i: number) => [...map.keys()][i] ?? null,
    removeItem: (k: string) => {
      map.delete(k);
    },
    setItem: (k: string, v: string) => {
      map.set(k, String(v));
    },
  };
}

// snapshot は本テストの対象外。capture だけを no-op で満たす最小スタブ。
const fakeSnapshots = { capture: async () => {} } as unknown as SnapshotStore<SnapshotData>;

let storage: HrStorage;
let store: HrStore;

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
  vi.stubGlobal('localStorage', makeStorageStub());
  storage = createHrStorage();
  store = createHrStore({ storage });
});

afterEach(() => {
  storage._resetForTests();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('movePatient: roster identity を引き継がない', () => {
  it('moveToNewWorkspace: 移動先コピーは rosterPatientId/rosterManaged をリセットし、元は無傷', async () => {
    await store.initStore();
    const p0 = store.getAppState().patients[0]!;
    p0.name = '正本太郎';
    p0.room = '301';
    p0.rosterPatientId = 'rp_x';
    p0.rosterManaged = true;

    const deps: MoveDeps = { store, snapshots: fakeSnapshots };
    const moved = await moveToNewWorkspace(deps, [0], '転棟先');
    expect(moved).toBe(1);

    // 移動先 (= active 以外) の病棟を読む
    const list = await storage.listBundles();
    const destId = list.find((w) => w.id !== storage.getActiveWorkspaceId())!.id;
    const dest = await storage.loadBundle(destId);
    const pats = (getSection(dest, SECTION.PATIENTS) as Patient[]) ?? [];
    const copy = pats.find((p) => p.name === '正本太郎')!;

    // 移動先: pid 同様 roster ID も引き継がない (unmanaged 化)
    expect(copy.rosterPatientId).toBe('');
    expect(copy.rosterManaged).toBe(false);
    expect(copy.pid).not.toBe(p0.pid);

    // 元患者: roster 由来データは無傷 ((移) マーカーのみ付く)
    expect(store.getAppState().patients[0]!.rosterPatientId).toBe('rp_x');
    expect(store.getAppState().patients[0]!.rosterManaged).toBe(true);
    expect(store.getAppState().patients[0]!.transferredAt).toBeGreaterThan(0);
  });
});
