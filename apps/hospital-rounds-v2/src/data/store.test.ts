// store: initStore (cold/warm boot)・switch の fail-closed・debounce 保存・アーカイブ入出力。
// (移植元 v1 test/check.mjs の cold boot / warm boot / recv box / importArchive 系相当)

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { STORE_BUNDLES } from './constants';
import { projectBundle, SECTION, getSection } from './bundle';
import { createHrStorage, type HrStorage } from './storage';
import {
  createHrStore,
  isArchive,
  isDeviceArchive,
  type Archive,
  type DeviceArchive,
  type HrStore,
} from './store';
import { defaultSettings, normalizePatientArray } from '../domain/normalize';
import type { Patient } from '../domain/types';

// Node 22+ の組み込み localStorage が jsdom のものを隠すため in-memory stub に差し替える。
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

function wait(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

let storage: HrStorage;
let store: HrStore;

function makeStore(opts?: Parameters<typeof createHrStore>[0]) {
  storage = createHrStorage();
  store = createHrStore({ storage, ...opts });
  return store;
}

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
  vi.stubGlobal('localStorage', makeStorageStub());
  vi.useRealTimers();
  makeStore();
});

afterEach(() => {
  storage._resetForTests();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('initStore', () => {
  it('cold boot: 50 患者 + 既定 formats + 現ユーザー名がタイトルに入る', async () => {
    await store.initStore();
    const app = store.getAppState();
    expect(app.patients).toHaveLength(50);
    expect(app.patients.every((p) => typeof p.pid === 'string' && p.pid.length > 0)).toBe(true);
    expect(app.title).toBe('ユーザー1'); // 現ユーザー名 (backfill で作られた既定ユーザー)
    expect(store.getSettings().formats.length).toBeGreaterThan(0);
    expect(store.getCurrentUserName()).toBe('ユーザー1');
    // 設定がユーザー設定レコードへ seed されている
    expect(await storage.loadGlobalSettings()).not.toBeNull();
  });

  it('冪等: 2 回目の initStore は同じ promise を返す', async () => {
    const p1 = store.initStore();
    const p2 = store.initStore();
    expect(p1).toBe(p2);
    await p1;
  });

  it('warm boot: seed bundle から患者を hydrate する', async () => {
    const patients = normalizePatientArray(null);
    patients[0]!.name = 'テスト太郎';
    patients[0]!.status = 'yellow';
    const seed = projectBundle({
      appState: { title: 'x', patients },
      settings: defaultSettings(),
      sections: [SECTION.META, SECTION.PATIENTS],
    });
    await store.initStore({ bundle: JSON.parse(JSON.stringify(seed)) });
    const app = store.getAppState();
    expect(app.patients[0]?.name).toBe('テスト太郎');
  });

  it('既知フィールドが保存 round-trip で保持される (patient + settings)', async () => {
    await store.initStore();
    const app = store.getAppState();
    app.patients[0]!.name = 'A';
    await store.persistActiveOrThrow();

    // 別 store インスタンスで読み戻す (warm boot)
    const store2 = createHrStore({ storage });
    await store2.initStore();
    expect(store2.getAppState().patients[0]?.name).toBe('A');
  });
});

describe('保存 (debounce / fail-closed)', () => {
  it('scheduleSave は debounce で saveNow を 1 回に縮約 / flushSavePending で即時化', async () => {
    // fake timers は fake-indexeddb の内部タイマーまで止めるため、短い debounce + 実時間で検査
    makeStore({ saveDebounceMs: 20 });
    await store.initStore();
    const putSpy = vi.spyOn(storage, 'saveBundle');
    store.scheduleSave();
    store.scheduleSave(); // 連打は 1 回に縮約
    expect(putSpy).not.toHaveBeenCalled();
    await wait(60);
    expect(putSpy).toHaveBeenCalledTimes(1);

    store.scheduleSave();
    store.flushSavePending(); // タイマー待たず即時
    await wait(10);
    expect(putSpy).toHaveBeenCalledTimes(2);
  });

  it('saveNow は失敗を握らず onSaveError へ可視化する (throw はしない)', async () => {
    const onSaveError = vi.fn();
    makeStore({ onSaveError });
    await store.initStore();
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(storage, 'saveBundle').mockRejectedValue(new Error('quota'));
    await expect(store.saveNow()).resolves.toBeUndefined();
    expect(onSaveError).toHaveBeenCalledTimes(1);
    errSpy.mockRestore();
  });

  it('persistActiveOrThrow は保存失敗で throw する (fail-closed)', async () => {
    await store.initStore();
    vi.spyOn(storage, 'saveBundle').mockRejectedValue(new Error('quota'));
    await expect(store.persistActiveOrThrow()).rejects.toThrow('quota');
  });

  it('persistActiveOrThrow は IDB 不可 (no-op 保存) も失敗扱いにする', async () => {
    await store.initStore();
    vi.spyOn(storage, 'isStorageAvailable').mockResolvedValue(false);
    await expect(store.persistActiveOrThrow()).rejects.toThrow(/storage unavailable/);
  });
});

describe('markUpdated', () => {
  it('markUpdated は updatedAt を進め、単一 listener に通知する', async () => {
    await store.initStore();
    const events: unknown[] = [];
    store.setDataChangeHandler((ev) => events.push(ev));
    store.markUpdated(1);
    expect(store.getAppState().patients[0]!.updatedAt).toBeGreaterThan(0);
    expect(events).toEqual([{ type: 'patient', no: 1 }]);
  });
});

describe('switchWorkspace / createWorkspace (fail-closed)', () => {
  it('createWorkspace → switchWorkspace round-trip + 通知', async () => {
    await store.initStore();
    store.getAppState().patients[0]!.name = '元病棟の患者';
    const events: unknown[] = [];
    store.setDataChangeHandler((ev) => events.push(ev));

    const newId = await store.createWorkspace('新병棟'.replace('병', '病'));
    expect(storage.getActiveWorkspaceId()).toBe(newId);
    expect(store.getAppState().patients[0]?.name).toBe(''); // 空病棟

    await store.switchWorkspace('default');
    expect(store.getAppState().patients[0]?.name).toBe('元病棟の患者'); // 保存されていた
    expect(events).toEqual([
      { type: 'workspace', workspaceId: newId },
      { type: 'workspace', workspaceId: 'default' },
    ]);
  });

  it('切替前の保存が失敗したらポインタを動かさず throw (現データ無傷)', async () => {
    await store.initStore();
    vi.spyOn(storage, 'saveBundle').mockRejectedValue(new Error('disk full'));
    await expect(store.switchWorkspace('ws_target')).rejects.toThrow('disk full');
    expect(storage.getActiveWorkspaceId()).toBe('default'); // ポインタ無傷
  });

  it('createWorkspaceWithPatients は渡した患者だけの病棟を作る (switch しない)', async () => {
    await store.initStore();
    const patients = normalizePatientArray(null).slice(0, 2);
    patients[0]!.name = '移動患者';
    const id = await store.createWorkspaceWithPatients('移動先', patients as Patient[]);
    expect(storage.getActiveWorkspaceId()).toBe('default'); // switch しない
    const b = await storage.loadBundle(id);
    const saved = getSection(b!, SECTION.PATIENTS) as Patient[];
    expect(saved).toHaveLength(2);
    expect(saved[0]?.name).toBe('移動患者');
  });
});

describe('switchUser / createUserAndSwitch / renameCurrentUser', () => {
  it('createUserAndSwitch: 空病棟を作って切替・設定はユーザーごとに分離', async () => {
    await store.initStore();
    store.getSettings().tags = [{ name: 'ユーザー1のタグ', clearOnStart: false }];
    store.getAppState().patients[0]!.name = 'ユーザー1の患者';

    const res = await store.createUserAndSwitch('医師B');
    expect(res.ok).toBe(true);
    expect(store.getCurrentUserName()).toBe('医師B');
    expect(store.getAppState().title).toBe('医師B');
    expect(store.getAppState().patients[0]?.name).toBe(''); // 新ユーザーの空病棟
    expect(store.getSettings().tags).toEqual([]); // 設定は default seed

    // 元ユーザーへ戻ると病棟・設定も戻る
    const back = await storage.loadUsers();
    const u1 = back.find((u) => u.name === 'ユーザー1')!;
    await store.switchUser(u1.id);
    expect(store.getAppState().patients[0]?.name).toBe('ユーザー1の患者');
    expect(store.getSettings().tags).toEqual([{ name: 'ユーザー1のタグ', clearOnStart: false }]);
  });

  it('重複名・空名は拒否する', async () => {
    await store.initStore();
    expect(await store.createUserAndSwitch('  ')).toEqual({ ok: false, reason: 'empty' });
    expect(await store.createUserAndSwitch('ユーザー1')).toEqual({
      ok: false,
      reason: 'duplicate',
    });
  });

  it('renameCurrentUser は名前キャッシュと title を更新する', async () => {
    await store.initStore();
    const res = await store.renameCurrentUser('主治医A');
    expect(res).toEqual({ ok: true });
    expect(store.getCurrentUserName()).toBe('主治医A');
    expect(store.getAppState().title).toBe('主治医A');
  });
});

describe('アーカイブ入出力', () => {
  it('exportArchive → importArchive round-trip (空病棟はスキップ・非破壊追記)', async () => {
    await store.initStore();
    store.getAppState().patients[0]!.name = '輸出太郎';
    store.getSettings().tags = [{ name: '輸出タグ', clearOnStart: false }];
    const empty = await store.createWorkspace('空病棟'); // 患者ゼロ → import でスキップされる
    await store.switchWorkspace('default');

    const archive = await store.exportArchive();
    expect(isArchive(archive)).toBe(true);
    expect(isDeviceArchive(archive)).toBe(false);
    expect(archive.workspaces).toHaveLength(2);

    const before = (await storage.listBundles()).length;
    const created = await store.importArchive(archive, { includeSettings: true });
    expect(created).toBe(1); // 中身のある default だけ
    expect((await storage.listBundles()).length).toBe(before + 1); // 既存は消さない
    expect(store.getSettings().tags).toEqual([{ name: '輸出タグ', clearOnStart: false }]);
    void empty;
  });

  it('importArchive: includeSettings 時に IDB 不可なら何も作らず throw (fail-closed)', async () => {
    await store.initStore();
    const archive = await store.exportArchive();
    vi.spyOn(storage, 'isStorageAvailable').mockResolvedValue(false);
    await expect(store.importArchive(archive, { includeSettings: true })).rejects.toThrow(
      /storage unavailable/,
    );
  });

  it('exportDeviceArchive → importDeviceArchive: 同名ユーザーは合流・新規は作成', async () => {
    await store.initStore();
    store.getAppState().patients[0]!.name = '太郎';
    await store.persistActiveOrThrow();
    const device = await store.exportDeviceArchive();
    expect(isDeviceArchive(device)).toBe(true);
    expect(device.users).toHaveLength(1);

    // 新規ユーザー名に書き換えて取り込む → ユーザーが作られる
    device.users[0]!.name = '別端末の医師';
    const res = await store.importDeviceArchive(device);
    expect(res.users).toBe(1);
    expect(res.workspaces).toBe(1);
    const users = await storage.loadUsers();
    expect(users.some((u) => u.name === '別端末の医師')).toBe(true);

    // 同名で再取込 → ユーザーは増えない (合流)
    const res2 = await store.importDeviceArchive(device);
    expect(res2.users).toBe(0);
    expect(res2.workspaces).toBe(1);
  });
});

describe('アーカイブ取込の原子性 (Codex 監査 M3: 部分適用を残さない)', () => {
  // n 回目以降の put を同期 throw させる (writeImportBatch の単一 tx 内で発火 →
  // runWrite が明示 abort → 発行済みの put も含めて全 rollback)。
  function injectPutFailureAt(n: number): void {
    const realPut = IDBObjectStore.prototype.put;
    let calls = 0;
    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (
      this: IDBObjectStore,
      ...args: Parameters<IDBObjectStore['put']>
    ) {
      calls += 1;
      if (calls >= n) throw new Error('injected put failure');
      return realPut.apply(this, args);
    });
  }

  async function allRecordIds(): Promise<string[]> {
    return (await storage.db.getAll<{ id: string }>(STORE_BUNDLES)).map((r) => r.id).sort();
  }

  it('importArchive: 途中 put 失敗で settings 不変 + bundles に何も増えない (全 rollback)', async () => {
    await store.initStore();
    store.getAppState().patients[0]!.name = '患者A';
    store.getSettings().tags = [{ name: '元のタグ', clearOnStart: false }];
    await store.persistActiveOrThrow();
    // export は live settings の参照を返すため、archive は deep copy してから書き換える
    const archive = JSON.parse(JSON.stringify(await store.exportArchive())) as Archive;
    archive.settings.tags = [{ name: '取込タグ', clearOnStart: false }];
    archive.workspaces.push(JSON.parse(JSON.stringify(archive.workspaces[0])) as Archive['workspaces'][number]);

    const idsBefore = await allRecordIds();
    // batch 内の put 順: 1=settings, 2=ws1 (発行済み), 3=ws2 で throw
    injectPutFailureAt(3);
    await expect(store.importArchive(archive, { includeSettings: true })).rejects.toThrow(
      'injected put failure',
    );
    vi.restoreAllMocks();

    // in-memory settings 不変 (失敗時は live state も変更しない)
    expect(store.getSettings().tags).toEqual([{ name: '元のタグ', clearOnStart: false }]);
    // 保存済み settings 不変 (settings put は発行済みでも rollback されている)
    expect(((await storage.loadGlobalSettings()) as { tags: Array<{ name: string; clearOnStart: boolean }> }).tags).toEqual([{ name: '元のタグ', clearOnStart: false }]);
    // bundles ストアにレコードが 1 つも増えていない
    expect(await allRecordIds()).toEqual(idsBefore);
  });

  it('importDeviceArchive: 途中 put 失敗で users 登録簿・settings・ws すべて不変', async () => {
    await store.initStore();
    store.getAppState().patients[0]!.name = '太郎';
    await store.persistActiveOrThrow();
    const device = JSON.parse(JSON.stringify(await store.exportDeviceArchive())) as DeviceArchive;
    device.users[0]!.name = '別端末の医師'; // 新規ユーザー作成経路に乗せる

    const usersBefore = await storage.loadUsers();
    const idsBefore = await allRecordIds();
    // batch 内の put 順: 1=__users__, 2=settings (発行済み), 3=ws で throw
    injectPutFailureAt(3);
    await expect(store.importDeviceArchive(device)).rejects.toThrow('injected put failure');
    vi.restoreAllMocks();

    // 「user は作られたが ws ゼロ」の中間状態を残さない: 登録簿も settings も ws も不変
    expect(await storage.loadUsers()).toEqual(usersBefore);
    expect((await storage.loadUsers()).some((u) => u.name === '別端末の医師')).toBe(false);
    expect(await allRecordIds()).toEqual(idsBefore);
  });
});

describe('collectFormatDataIndices (fail-closed 横断収集)', () => {
  it('アクティブ病棟 (未保存 live) + 非アクティブ病棟 (保存済み) を横断して収集する', async () => {
    await store.initStore();
    // 非アクティブ病棟に入力データを置く
    const patients = normalizePatientArray(null).slice(0, 1);
    patients[0]!.formatValues = { fmt_target: { 2: '入力あり' } };
    await store.createWorkspaceWithPatients('別病棟', patients as Patient[]);
    // アクティブ病棟の live 入力 (debounce 中の未保存も含む想定)
    store.getAppState().patients[0]!.formatValues = { fmt_target: { 0: 'live' } };

    const got = await store.collectFormatDataIndices('fmt_target');
    expect(got).not.toBeNull();
    expect([...got!].sort()).toEqual([0, 2]);
  });

  it('非アクティブ病棟のロード失敗時は null (= fail-closed 全ブロック)', async () => {
    await store.initStore();
    await store.createWorkspaceWithPatients('別病棟', []);
    vi.spyOn(storage, 'loadBundle').mockResolvedValue(null);
    expect(await store.collectFormatDataIndices('fmt_x')).toBeNull();
  });
});
