// storage: fake-indexeddb での save/load/list/rename/delete、ユーザー backfill 冪等、
// fail-closed (put 失敗注入で throw)。
// (移植元 v1 test/check.mjs の storage 系 + ユーザー登録簿ケース相当)

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { DEFAULT_USER_ID, DB_NAME, STORE_BUNDLES, USERS_ID, settingsIdFor } from './constants';
import { projectBundle, SECTION } from './bundle';
import { createHrStorage, type HrStorage } from './storage';
import { defaultSettings, normalizePatientArray } from '../domain/normalize';

function freshBundle(title = 'T') {
  return projectBundle({
    appState: {
      title,
      patients: normalizePatientArray(null),
    },
    settings: defaultSettings(),
    sections: [SECTION.META, SECTION.PATIENTS],
  });
}

// Node 22+ の組み込み localStorage (--localstorage-file 無しでは動作しない) が jsdom の
// ものを隠すため、テストでは機能する in-memory Storage に差し替える (foundation と同じ手口)。
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

let storage: HrStorage;

beforeEach(() => {
  // テストごとに IDB と localStorage を全くの新品にする (DB 名は本番同一のため)
  globalThis.indexedDB = new IDBFactory();
  vi.stubGlobal('localStorage', makeStorageStub());
  storage = createHrStorage();
});

afterEach(() => {
  storage._resetForTests();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('ポインタ (localStorage)', () => {
  it('getActiveWorkspaceId は未設定なら "default"、set で永続化 (hrv2. prefix)', () => {
    expect(storage.getActiveWorkspaceId()).toBe('default');
    storage.setActiveWorkspaceId('ws_x');
    expect(storage.getActiveWorkspaceId()).toBe('ws_x');
    // v1 識別子 (hospital_rounds_*) を使っていないことの監査
    expect(localStorage.getItem('hrv2.active_workspace_id')).toBe('ws_x');
    expect(localStorage.getItem('hospital_rounds_active_workspace_id')).toBeNull();
  });

  it('不正値 (空/非文字列) の set は無視する', () => {
    storage.setActiveWorkspaceId('');
    expect(storage.getActiveWorkspaceId()).toBe('default');
  });
});

describe('ワークスペース save/load/list/rename/delete', () => {
  it('loadBundle はクリーン状態で null', async () => {
    expect(await storage.loadBundle()).toBeNull();
  });

  it('save → load round-trip (active 省略時)', async () => {
    await storage.ensureUsersInitialized();
    const b = freshBundle('回診');
    await storage.saveBundle(b);
    const loaded = await storage.loadBundle();
    expect(loaded).not.toBeNull();
    const meta = loaded!.sections['meta'] as { title: string };
    expect(meta.title).toBe('回診');
    const patients = loaded!.sections['patients'] as unknown[];
    expect(patients).toHaveLength(50);
  });

  it('listBundles: 予約レコードを除外し、現ユーザーの病棟だけ返す', async () => {
    await storage.ensureUsersInitialized();
    await storage.saveBundle(freshBundle());
    const otherId = await storage.createWorkspaceRecord('他人の病棟', freshBundle(), 'usr_other');
    const list = await storage.listBundles();
    expect(list.map((w) => w.id)).toEqual(['default']);
    expect(list[0]?.label).toBe('メイン'); // default 病棟の既定 label
    // listAllWorkspaces は全ユーザー横断
    const all = await storage.listAllWorkspaces();
    expect(all.map((w) => w.id).sort()).toEqual(['default', otherId].sort());
  });

  it('rename は label のみ書き換え (bundle / title は不変)', async () => {
    await storage.ensureUsersInitialized();
    const id = await storage.createWorkspaceRecord('元の名前', freshBundle('タイトル'));
    await storage.renameBundle(id, '新しい名前');
    const all = await storage.listAllWorkspaces();
    const w = all.find((x) => x.id === id);
    expect(w?.label).toBe('新しい名前');
    expect(w?.title).toBe('タイトル');
    const loaded = await storage.loadBundle(id);
    expect((loaded!.sections['meta'] as { title: string }).title).toBe('タイトル');
  });

  it('saveBundle: label 未指定なら既存 label を温存する', async () => {
    await storage.ensureUsersInitialized();
    const id = await storage.createWorkspaceRecord('病棟A', freshBundle());
    await storage.saveBundle(freshBundle('更新後'), id); // label 無し上書き
    const all = await storage.listAllWorkspaces();
    expect(all.find((x) => x.id === id)?.label).toBe('病棟A');
  });

  it('active workspace の削除は拒否する (誤削除防止)', async () => {
    await storage.ensureUsersInitialized();
    await storage.saveBundle(freshBundle());
    await expect(storage.deleteBundle('default')).rejects.toThrow(/active/);
    const id = await storage.createWorkspaceRecord('消す病棟', freshBundle());
    await storage.deleteBundle(id);
    expect(await storage.loadBundle(id)).toBeNull();
  });

  it('fail-closed: put 失敗で saveBundle は throw する (黙って成功扱いにしない)', async () => {
    await storage.ensureUsersInitialized();
    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(() => {
      throw new Error('injected put failure');
    });
    await expect(storage.saveBundle(freshBundle())).rejects.toThrow('injected put failure');
    await expect(storage.saveGlobalSettings(defaultSettings())).rejects.toThrow(
      'injected put failure',
    );
  });

  it('読み出しは縮退する (list 失敗 → [] / load 失敗 → null)', async () => {
    await storage.ensureUsersInitialized();
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(IDBObjectStore.prototype, 'getAll').mockImplementation(() => {
      throw new Error('injected scan failure');
    });
    expect(await storage.listBundles()).toEqual([]);
    warnSpy.mockRestore();
  });
});

describe('ユーザー登録簿と backfill', () => {
  it('ensureUsersInitialized は冪等: 2 回呼んでもユーザーは 1 人のまま', async () => {
    await storage.ensureUsersInitialized();
    const u1 = await storage.loadUsers();
    expect(u1).toHaveLength(1);
    expect(u1[0]?.id).toBe(DEFAULT_USER_ID);
    expect(u1[0]?.name).toBe('ユーザー1');
    expect(storage.getCurrentUserId()).toBe(DEFAULT_USER_ID);

    await storage.ensureUsersInitialized();
    const u2 = await storage.loadUsers();
    expect(u2).toHaveLength(1);
    expect(u2[0]?.createdAt).toBe(u1[0]?.createdAt); // 上書きされていない
  });

  it('backfill は userId 無し病棟へ usr_default を付与する', async () => {
    // 登録簿の無い状態で userId 無しの病棟レコードを直接置く
    await storage.db.put(DB_NAME ? 'bundles' : 'bundles', {
      id: 'ws_legacyless',
      label: 'L',
      title: '',
      updatedAt: 1,
      bundle: freshBundle(),
    });
    await storage.ensureUsersInitialized();
    const all = await storage.listAllWorkspaces();
    expect(all.find((w) => w.id === 'ws_legacyless')?.userId).toBe(DEFAULT_USER_ID);
  });

  it('currentUser ポインタが現存しないユーザーを指していたら先頭に補正する', async () => {
    await storage.ensureUsersInitialized();
    storage.setCurrentUserId('usr_ghost');
    await storage.ensureUsersInitialized();
    expect(storage.getCurrentUserId()).toBe(DEFAULT_USER_ID);
  });

  it('createUser / renameUser / userNameExists / setUserActiveWorkspaceId', async () => {
    await storage.ensureUsersInitialized();
    const id = await storage.createUser('  医師B ');
    const users = await storage.loadUsers();
    expect(users.find((u) => u.id === id)?.name).toBe('医師B'); // trim
    expect(await storage.userNameExists('医師B')).toBe(true);
    expect(await storage.userNameExists('医師B', id)).toBe(false); // 自分自身は除外
    await storage.renameUser(id, '医師C');
    expect((await storage.loadUsers()).find((u) => u.id === id)?.name).toBe('医師C');
    await storage.setUserActiveWorkspaceId(id, 'ws_1');
    expect(storage.getUserActiveWorkspaceId(await storage.loadUsers(), id)).toBe('ws_1');
  });

  it('deleteUser: 病棟 + 設定レコードを消し、purge 用の workspaceIds を返す', async () => {
    await storage.ensureUsersInitialized();
    const uid = await storage.createUser('消すユーザー');
    const ws1 = await storage.createWorkspaceRecord('w1', freshBundle(), uid);
    const ws2 = await storage.createWorkspaceRecord('w2', freshBundle(), uid);
    await storage.saveGlobalSettings(defaultSettings(), uid);

    const res = await storage.deleteUser(uid);
    expect(res.workspaceIds.sort()).toEqual([ws1, ws2].sort());
    expect(res.users.some((u) => u.id === uid)).toBe(false);
    expect(await storage.loadBundle(ws1)).toBeNull();
    expect(await storage.loadGlobalSettings(uid)).toBeNull();
    // 他ユーザーのデータは無傷
    expect((await storage.loadUsers()).some((u) => u.id === DEFAULT_USER_ID)).toBe(true);
  });
});

describe('buildWorkspaceRecord / writeImportBatch (アーカイブ取込の原子バッチ・Codex 監査 M3)', () => {
  // n 回目以降の put を同期 throw させる (runWrite の fn 内で発火 → 明示 abort → 全 rollback)。
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

  it('buildWorkspaceRecord は書き込まずにレコードを組み立てる (ID 採番 + meta title 反映)', async () => {
    await storage.ensureUsersInitialized();
    const rec = storage.buildWorkspaceRecord('病棟X', freshBundle('タイトルX'));
    expect(rec.id).toMatch(/^ws_/);
    expect(rec.label).toBe('病棟X');
    expect(rec.title).toBe('タイトルX');
    expect(rec.userId).toBe(DEFAULT_USER_ID); // override 無し → 現ユーザー
    expect(rec.updatedAt).toBeGreaterThan(0);
    expect(await storage.loadBundle(rec.id)).toBeNull(); // まだ書かれていない
    expect(storage.buildWorkspaceRecord('w', freshBundle(), 'usr_o').userId).toBe('usr_o');
  });

  it('writeImportBatch は users / settings / ws を一括で書く (createWorkspaceRecord と同形)', async () => {
    await storage.ensureUsersInitialized();
    const users = await storage.loadUsers();
    users.push({ id: 'usr_x', name: 'X', createdAt: 1, activeWorkspaceId: '', passhash: null });
    const ws = storage.buildWorkspaceRecord('一括病棟', freshBundle('一括'), 'usr_x');
    await storage.writeImportBatch({
      usersRecord: users,
      settingsRecords: [{ userId: 'usr_x', settings: defaultSettings() }],
      workspaceRecords: [ws],
    });
    expect((await storage.loadUsers()).some((u) => u.id === 'usr_x')).toBe(true);
    expect(await storage.loadGlobalSettings('usr_x')).not.toBeNull();
    expect(await storage.loadBundle(ws.id)).not.toBeNull();
    const listed = (await storage.listAllWorkspaces()).find((w) => w.id === ws.id);
    expect(listed).toMatchObject({ label: '一括病棟', title: '一括', userId: 'usr_x' });
  });

  it('原子性: 途中の put 失敗で全 rollback (先に発行済みの users / settings も残らない)', async () => {
    await storage.ensureUsersInitialized();
    await storage.saveGlobalSettings(defaultSettings(), 'usr_x');
    const usersBefore = await storage.loadUsers();
    const idsBefore = (await storage.db.getAll<{ id: string }>(STORE_BUNDLES))
      .map((r) => r.id)
      .sort();

    const users = [
      ...usersBefore,
      { id: 'usr_x', name: 'X', createdAt: 1, activeWorkspaceId: '', passhash: null },
    ];
    const s = defaultSettings();
    s.tags = [{ name: '置換後', color: 'gray' }];
    const ws = storage.buildWorkspaceRecord('w', freshBundle(), 'usr_x');
    injectPutFailureAt(3); // 1=__users__, 2=settings は発行済み → 3=ws で throw
    await expect(
      storage.writeImportBatch({
        usersRecord: users,
        settingsRecords: [{ userId: 'usr_x', settings: s }],
        workspaceRecords: [ws],
      }),
    ).rejects.toThrow('injected put failure');
    vi.restoreAllMocks();

    // 全レコード不変: 登録簿・既存 settings は元のまま、ws も増えていない
    expect(await storage.loadUsers()).toEqual(usersBefore);
    expect(((await storage.loadGlobalSettings('usr_x')) as { tags: unknown[] } | null)?.tags ?? []).toEqual([]);
    const idsAfter = (await storage.db.getAll<{ id: string }>(STORE_BUNDLES))
      .map((r) => r.id)
      .sort();
    expect(idsAfter).toEqual(idsBefore);
  });
});

describe('設定 (__settings__::<userId>)', () => {
  it('save → load round-trip (ユーザーごとに分離)', async () => {
    await storage.ensureUsersInitialized();
    const s = defaultSettings();
    s.tags = [{ name: '内科', color: 'gray' }];
    await storage.saveGlobalSettings(s);
    const loaded = (await storage.loadGlobalSettings()) as { tags: Array<{ name: string; color: string }> };
    expect(loaded.tags).toEqual([{ name: '内科', color: 'gray' }]);
    // 別ユーザーには見えない
    expect(await storage.loadGlobalSettings('usr_other')).toBeNull();
  });

  it('設定レコード ID は予約 prefix を使う (listBundles に混ざらない)', async () => {
    await storage.ensureUsersInitialized();
    await storage.saveGlobalSettings(defaultSettings());
    expect(settingsIdFor(DEFAULT_USER_ID)).toBe(`__settings__::${DEFAULT_USER_ID}`);
    const list = await storage.listBundles();
    expect(list.some((w) => w.id.startsWith('__'))).toBe(false);
    expect(list.some((w) => w.id === USERS_ID)).toBe(false);
  });
});
