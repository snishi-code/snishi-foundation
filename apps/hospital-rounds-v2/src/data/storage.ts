// 移植元: snishi-code-medical/hospital-rounds/src/storage.js
//          (foundation storage/idb createDatabase + storage/pointers createPointerStore 上に再構成)
//
// ワークスペース永続化 (IndexedDB)。
//   - `bundles` object store の 1 レコード = 1 ワークスペース
//   - 「アクティブワークスペース」「現在ユーザー」を指すポインタは PointerStore
//     (localStorage の LOCAL_PREFIX 名前空間。短い同期 read 用)
//   - 予約レコード: `__users__` (登録簿) / `__settings__::<userId>` (ユーザー別設定)
//
// 保存の 2 系統 (臨床データの fail-closed 原則):
//   - **fail-closed 系統**: saveBundle / saveGlobalSettings / saveUsers 等の書込は失敗を
//     必ず throw する。「保存できていないのに先へ進むと臨床被害になる」操作
//     (病棟切替・患者移動・QR 取込) は store.ts の persistActiveOrThrow がこれを使い、
//     事前に isStorageAvailable() で IDB 不可 (no-op 保存) も失敗扱いにする。
//   - **fire-and-forget 系統**: 読み出し (loadBundle / listBundles / loadUsers 等) は
//     失敗を warn + null/[] に縮退する (起動を止めない)。autosave (store.ts saveNow) は
//     書込 throw を catch して通知のみ行う。
//
// v1 との差分: v1 は IDB が開けない環境で書込を黙って no-op したが、v2 の書込は
// open 失敗も throw する (より fail-closed)。fire-and-forget 側の挙動は saveNow の
// catch で吸収されるため、呼び出し側の体験は同じ。

import { createDatabase, type DatabaseHandle } from '@snishi/foundation/storage/idb';
import { createPointerStore, type PointerStore } from '@snishi/foundation/storage/pointers';
import type { User } from '../domain/types';
import { newRosterAuthorityId } from '../domain/roster';
import { parseBundle, type Bundle } from './bundle';
import {
  DB_NAME,
  DB_VERSION,
  DEFAULT_USER_ID,
  DEFAULT_USER_RESELECT_INTERVAL_MS,
  DEFAULT_WORKSPACE_ID,
  LOCAL_PREFIX,
  PK_ACTIVE_WORKSPACE,
  PK_CURRENT_USER,
  PK_LAST_USER_CONFIRM_AT,
  PK_ONBOARDED_AT,
  PK_ROSTER_AUTHORITY_ID,
  PK_USER_RESELECT_INTERVAL,
  STORE_BUNDLES,
  USERS_ID,
  isReservedId,
  settingsIdFor,
} from './constants';

// bundles ストアに入るレコードの統合形 (病棟 / __users__ / __settings__::*)。
interface StoredRecord {
  id: string;
  updatedAt?: number;
  // 病棟レコード
  userId?: string;
  label?: string;
  title?: string;
  bundle?: unknown;
  // __users__ レコード
  users?: User[];
  // __settings__::<userId> レコード
  settings?: unknown;
}

export interface WorkspaceListing {
  id: string;
  label: string;
  title: string;
  updatedAt: number;
}

export interface WorkspaceListingAll extends WorkspaceListing {
  userId: string;
}

/** buildWorkspaceRecord が組み立てる病棟レコード (bundles ストアの 1 レコード分)。 */
export interface HrWorkspaceRecord {
  id: string;
  userId: string;
  label: string;
  title: string;
  updatedAt: number;
  bundle: Bundle;
}

/**
 * writeImportBatch の入力。アーカイブ取込が書く全レコードを事前構築して渡す
 * (Codex 監査 M3: 取込に部分適用を残さない = 全体成功 or 全体失敗)。
 */
export interface HrImportBatch {
  /** `__users__` 登録簿の置換 (省略時は触らない)。 */
  usersRecord?: User[];
  /** ユーザー別設定の置換 (`__settings__::<userId>` へ put)。 */
  settingsRecords?: Array<{ userId: string; settings: unknown }>;
  /** buildWorkspaceRecord で事前構築した病棟レコード群。 */
  workspaceRecords: HrWorkspaceRecord[];
}

export interface HrStorageOptions {
  /** "default" ワークスペースの表示名 (UI 層が i18n 文字列を注入してよい)。既定 "メイン" */
  defaultWorkspaceLabel?: string;
  /** 既定ユーザー名 (初期化 backfill で作る最初のユーザー)。既定 "ユーザー1" */
  defaultUserName?: string;
  now?: () => number;
}

export interface HrStorage {
  /** localStorage ポインタ (LOCAL_PREFIX 名前空間)。snapshots の tombstone 等と共有する */
  pointers: PointerStore;
  /** 低レベル DB ハンドル (テスト・全データ消去用) */
  db: DatabaseHandle;

  /** IndexedDB が実際に開けるか (= 永続化が効くか)。durable 経路の事前判定に使う */
  isStorageAvailable(): Promise<boolean>;

  // ── ポインタ (同期) ──
  getActiveWorkspaceId(): string;
  setActiveWorkspaceId(id: string): void;
  getCurrentUserId(): string;
  setCurrentUserId(id: string): void;
  getOnboardedAt(): number;
  setOnboardedAt(ts?: number): void;
  getLastUserConfirmAt(): number;
  setLastUserConfirmAt(ts?: number): void;
  getUserReselectIntervalMs(): number;
  setUserReselectIntervalMs(ms: number): void;
  /** 起動時にユーザー再選択を促すべきか */
  isUserReselectDue(): boolean;

  /** ローカル端末の名簿正本 ID (未生成なら ''。HM QR の正本判定に使う)。 */
  getRosterAuthorityId(): string;
  /** ローカル端末の名簿正本 ID を取得 (無ければ生成して永続化)。 */
  ensureRosterAuthorityId(): string;

  getDefaultWorkspaceLabel(): string;
  getDefaultUserName(): string;

  // ── ワークスペース (bundles) ──
  loadBundle(id?: string): Promise<Bundle | null>;
  saveBundle(bundle: Bundle, id?: string, label?: string, userIdOverride?: string): Promise<void>;
  listBundles(): Promise<WorkspaceListing[]>;
  listAllWorkspaces(): Promise<WorkspaceListingAll[]>;
  renameBundle(id: string, newLabel: string): Promise<void>;
  deleteBundle(id: string): Promise<void>;
  newWorkspaceId(): string;
  createWorkspaceRecord(label: string, bundle: Bundle, userIdOverride?: string): Promise<string>;
  /** 病棟レコードの純構築 (ID 採番 + 組み立てのみ。書込はしない)。writeImportBatch 用 */
  buildWorkspaceRecord(label: string, bundle: Bundle, userIdOverride?: string): HrWorkspaceRecord;
  /**
   * アーカイブ取込用の原子バッチ書込 (Codex 監査 M3)。全レコードを bundles ストアへ
   * 単一トランザクションで put し、1 件でも失敗すれば全 rollback で throw する
   * (= 書込系統の fail-closed に揃える。部分適用を残さない)。
   */
  writeImportBatch(batch: HrImportBatch): Promise<void>;

  // ── ユーザー登録簿 (__users__) ──
  loadUsers(): Promise<User[]>;
  listUsers(): Promise<Array<Pick<User, 'id' | 'name' | 'createdAt' | 'activeWorkspaceId'>>>;
  userNameExists(name: string, exceptId?: string): Promise<boolean>;
  createUser(name: string): Promise<string>;
  renameUser(id: string, name: string): Promise<void>;
  getUserActiveWorkspaceId(users: readonly User[], id: string): string;
  setUserActiveWorkspaceId(id: string, wsId: string): Promise<void>;
  /**
   * ユーザー削除 + そのユーザーの全病棟・設定レコード削除。戻り値の workspaceIds は
   * 呼び出し側がスナップショット DB の purge に使う (PII を別 DB に残さないため)。
   */
  deleteUser(id: string): Promise<{ users: User[]; workspaceIds: string[] }>;
  newUserId(): string;
  /** 起動時のユーザー初期化 (冪等)。__users__ が無ければ一度だけ backfill する */
  ensureUsersInitialized(): Promise<void>;

  // ── 設定 (__settings__::<userId>) ──
  loadGlobalSettings(userId?: string): Promise<unknown | null>;
  saveGlobalSettings(settings: unknown, userId?: string): Promise<void>;

  _resetForTests(): void;
}

export function createHrStorage(opts: HrStorageOptions = {}): HrStorage {
  const now = opts.now ?? Date.now;
  // 既定文字列はドメイン層の定数 (UI 層は i18n 値を注入して上書きできる)
  const defaultWorkspaceLabel = opts.defaultWorkspaceLabel ?? 'メイン';
  const defaultUserName = opts.defaultUserName ?? 'ユーザー1';

  const pointers = createPointerStore(LOCAL_PREFIX);

  const db = createDatabase({
    name: DB_NAME,
    version: DB_VERSION,
    upgrade: (database) => {
      if (!database.objectStoreNames.contains(STORE_BUNDLES)) {
        const store = database.createObjectStore(STORE_BUNDLES, { keyPath: 'id' });
        store.createIndex('updatedAt', 'updatedAt', { unique: false });
      }
    },
  });

  // ── ポインタヘルパ ──

  function getActiveWorkspaceId(): string {
    return pointers.get(PK_ACTIVE_WORKSPACE) || DEFAULT_WORKSPACE_ID;
  }
  function setActiveWorkspaceId(id: string): void {
    if (!id || typeof id !== 'string') return;
    pointers.set(PK_ACTIVE_WORKSPACE, id);
  }
  function getCurrentUserId(): string {
    return pointers.get(PK_CURRENT_USER) || DEFAULT_USER_ID;
  }
  function setCurrentUserId(id: string): void {
    if (!id || typeof id !== 'string') return;
    pointers.set(PK_CURRENT_USER, id);
  }

  function getIntPointer(key: string): number {
    return parseInt(pointers.get(key) || '0', 10) || 0;
  }

  // ── 低レベル読み書き (読みは縮退・書きは throw) ──

  async function getRecord(id: string): Promise<StoredRecord | undefined> {
    return db.get<StoredRecord>(STORE_BUNDLES, id);
  }

  async function putRecord(rec: StoredRecord): Promise<void> {
    await db.put(STORE_BUNDLES, rec);
  }

  // __users__ レコードへ users 配列を書く (失敗は throw = fail-closed)。
  async function saveUsers(users: User[]): Promise<void> {
    const rec: StoredRecord = {
      id: USERS_ID,
      users: Array.isArray(users) ? users : [],
      updatedAt: now(),
    };
    await putRecord(rec);
  }

  async function loadUsers(): Promise<User[]> {
    try {
      const rec = await getRecord(USERS_ID);
      if (rec && Array.isArray(rec.users)) return rec.users;
    } catch (e) {
      console.warn('idb load users failed:', e);
    }
    return [];
  }

  function newWorkspaceId(): string {
    const ts = now().toString(36);
    const rand = Math.random().toString(36).slice(2, 8);
    return `ws_${ts}_${rand}`;
  }

  function newUserId(): string {
    const ts = now().toString(36);
    const rand = Math.random().toString(36).slice(2, 8);
    return `usr_${ts}_${rand}`;
  }

  // 病棟レコードの純構築 (ID 採番 + 組み立てのみ。書込はしない)。
  // createWorkspaceRecord と writeImportBatch (アーカイブ取込の原子バッチ) が共用する。
  // 採番・label/title/userId の決め方は旧 createWorkspaceRecord (saveBundle 新規経路) と同一。
  function buildWorkspaceRecord(
    label: string,
    bundle: Bundle,
    userIdOverride?: string,
  ): HrWorkspaceRecord {
    const meta = (bundle?.sections?.['meta'] ?? null) as { title?: unknown } | null;
    return {
      id: newWorkspaceId(),
      userId: userIdOverride || getCurrentUserId(),
      label: String(label || ''),
      title: typeof meta?.title === 'string' ? meta.title : '',
      updatedAt: now(),
      bundle,
    };
  }

  const api: HrStorage = {
    pointers,
    db,

    async isStorageAvailable() {
      try {
        await db.open();
        return true;
      } catch {
        return false;
      }
    },

    getActiveWorkspaceId,
    setActiveWorkspaceId,
    getCurrentUserId,
    setCurrentUserId,

    getOnboardedAt: () => getIntPointer(PK_ONBOARDED_AT),
    setOnboardedAt(ts) {
      pointers.set(PK_ONBOARDED_AT, String(ts || now()));
    },
    getLastUserConfirmAt: () => getIntPointer(PK_LAST_USER_CONFIRM_AT),
    setLastUserConfirmAt(ts) {
      pointers.set(PK_LAST_USER_CONFIRM_AT, String(ts || now()));
    },
    getUserReselectIntervalMs() {
      const v = parseInt(pointers.get(PK_USER_RESELECT_INTERVAL) || '', 10);
      return Number.isFinite(v) && v >= 0 ? v : DEFAULT_USER_RESELECT_INTERVAL_MS;
    },
    setUserReselectIntervalMs(ms) {
      if (Number.isFinite(ms) && ms >= 0) pointers.set(PK_USER_RESELECT_INTERVAL, String(ms));
    },
    isUserReselectDue() {
      const last = api.getLastUserConfirmAt();
      if (!last) return true;
      return now() - last >= api.getUserReselectIntervalMs();
    },

    getRosterAuthorityId() {
      return pointers.get(PK_ROSTER_AUTHORITY_ID) || '';
    },
    ensureRosterAuthorityId() {
      const existing = pointers.get(PK_ROSTER_AUTHORITY_ID);
      if (existing) return existing;
      const id = newRosterAuthorityId();
      pointers.set(PK_ROSTER_AUTHORITY_ID, id);
      return id;
    },

    getDefaultWorkspaceLabel: () => defaultWorkspaceLabel,
    getDefaultUserName: () => defaultUserName,

    // ── ワークスペース ──

    async loadBundle(id) {
      const targetId = id || getActiveWorkspaceId();
      try {
        const rec = await getRecord(targetId);
        if (rec && rec.bundle) {
          try {
            return parseBundle(rec.bundle);
          } catch (e) {
            console.warn('idb bundle parse failed:', e);
          }
        }
      } catch (e) {
        console.warn('idb load failed:', e);
      }
      return null;
    },

    async saveBundle(bundle, id, label, userIdOverride) {
      const targetId = id || getActiveWorkspaceId();
      // label が未指定なら既存レコードの label を温存。新規作成だけ default label。
      // userId は: 明示指定 > 既存レコードの温存 > 現ユーザー の優先順。
      let finalLabel: string | null | undefined = label;
      let finalUserId: string | null = userIdOverride || null;
      try {
        const existing = await getRecord(targetId);
        if (existing) {
          if (finalLabel == null && typeof existing.label === 'string') finalLabel = existing.label;
          if (finalUserId == null && typeof existing.userId === 'string' && existing.userId) {
            finalUserId = existing.userId;
          }
        }
      } catch {
        /* 既存レコードが読めなくても保存自体は試みる (v1 と同じ) */
      }
      if (finalLabel == null) {
        finalLabel = targetId === DEFAULT_WORKSPACE_ID ? defaultWorkspaceLabel : '';
      }
      if (finalUserId == null) finalUserId = getCurrentUserId();
      const meta = (bundle?.sections?.['meta'] ?? null) as { title?: unknown } | null;
      const rec: StoredRecord = {
        id: targetId,
        userId: finalUserId,
        label: String(finalLabel),
        title: typeof meta?.title === 'string' ? meta.title : '',
        updatedAt: now(),
        bundle,
      };
      // 失敗は throw (fail-closed)。fire-and-forget 経路は呼び出し側 (saveNow) が catch する。
      await putRecord(rec);
    },

    async listBundles() {
      try {
        const all = await db.getAll<StoredRecord>(STORE_BUNDLES);
        const currentUserId = getCurrentUserId();
        return all
          // 予約レコード (__users__ / __settings__::*) は病棟ではない
          .filter((r) => !isReservedId(r.id))
          // 現ユーザーに属する病棟だけ
          .filter((r) => r.userId === currentUserId)
          .map((r) => ({
            id: r.id,
            label: r.label || (r.id === DEFAULT_WORKSPACE_ID ? defaultWorkspaceLabel : ''),
            title: r.title || '',
            updatedAt: r.updatedAt || 0,
          }));
      } catch (e) {
        console.warn('idb list failed:', e);
        return [];
      }
    },

    // 全ユーザー横断で病棟レコードを列挙する (端末まるごとエクスポート用)。
    async listAllWorkspaces() {
      try {
        const all = await db.getAll<StoredRecord>(STORE_BUNDLES);
        return all
          .filter((r) => !isReservedId(r.id))
          .map((r) => ({
            id: r.id,
            userId: r.userId || '',
            label: r.label || '',
            title: r.title || '',
            updatedAt: r.updatedAt || 0,
          }));
      } catch (e) {
        console.warn('idb listAll failed:', e);
        return [];
      }
    },

    // 既存ワークスペースの label のみを書き換える (bundle / updatedAt / title は触らない)。
    async renameBundle(id, newLabel) {
      if (!id) throw new Error('renameBundle: id required');
      const existing = await getRecord(id);
      if (!existing) return;
      existing.label = String(newLabel || '');
      await putRecord(existing);
    },

    // active workspace は誤削除防止。それ以外は削除可。
    async deleteBundle(id) {
      if (!id) throw new Error('delete: id required');
      if (id === getActiveWorkspaceId()) {
        throw new Error('cannot delete the active workspace');
      }
      await db.deleteRecord(STORE_BUNDLES, id);
    },

    newWorkspaceId,

    // 新規ワークスペースを作成して IDB に保存。switch はしない (caller の責務)。
    async createWorkspaceRecord(label, bundle, userIdOverride) {
      const rec = buildWorkspaceRecord(label, bundle, userIdOverride);
      // 失敗は throw (fail-closed)。
      await putRecord(rec);
      return rec.id;
    },

    buildWorkspaceRecord,

    // アーカイブ取込の原子バッチ書込 (Codex 監査 M3)。
    // 仕様§8「import は fail-closed」: 部分適用 (settings だけ置換済み・一部 ws だけ
    // 作成済み) を残さないため、取込が書く全レコードを単一 readwrite トランザクションで
    // put する。途中失敗は runWrite が明示 abort (非同期のリクエスト失敗もトランザクション
    // abort) → 全 rollback して throw。settings を ws より先に書く順序 (formatValues の
    // 参照先確定という v1 来のドメイン順序) は同一 tx 内の書き込み順として維持する。
    async writeImportBatch(batch) {
      const ts = now();
      await db.runWrite([STORE_BUNDLES], (tx) => {
        const store = tx.objectStore(STORE_BUNDLES);
        if (batch.usersRecord) {
          store.put({ id: USERS_ID, users: batch.usersRecord, updatedAt: ts } satisfies StoredRecord);
        }
        for (const s of batch.settingsRecords ?? []) {
          store.put({
            id: settingsIdFor(s.userId),
            settings: s.settings,
            updatedAt: ts,
          } satisfies StoredRecord);
        }
        for (const w of batch.workspaceRecords) store.put(w);
      });
    },

    // ── ユーザー登録簿 ──

    loadUsers,

    async listUsers() {
      const users = await loadUsers();
      return users.map((u) => ({
        id: u.id,
        name: u.name || '',
        createdAt: u.createdAt || 0,
        activeWorkspaceId: u.activeWorkspaceId || '',
      }));
    },

    // 重複名チェック (前後空白だけ無視した厳密一致。exceptId は自分自身)。
    async userNameExists(name, exceptId) {
      const trimmed = String(name || '').trim();
      const users = await loadUsers();
      return users.some((u) => u.id !== exceptId && (u.name || '').trim() === trimmed);
    },

    // 新規ユーザーを登録して id を返す。重複名は呼び出し側で弾く想定だが二重防御は caller 側。
    async createUser(name) {
      const users = await loadUsers();
      const id = newUserId();
      users.push({
        id,
        name: String(name || '').trim(),
        createdAt: now(),
        activeWorkspaceId: '',
        passhash: null, // パスワードの器 (今は常に null)
      });
      await saveUsers(users);
      return id;
    },

    async renameUser(id, name) {
      const users = await loadUsers();
      const u = users.find((x) => x.id === id);
      if (!u) return;
      u.name = String(name || '').trim();
      await saveUsers(users);
    },

    getUserActiveWorkspaceId(users, id) {
      const u = (users || []).find((x) => x.id === id);
      return u ? u.activeWorkspaceId || '' : '';
    },

    async setUserActiveWorkspaceId(id, wsId) {
      const users = await loadUsers();
      const u = users.find((x) => x.id === id);
      if (!u) return;
      u.activeWorkspaceId = String(wsId || '');
      await saveUsers(users);
    },

    async deleteUser(id) {
      // 1) このユーザーの病棟 id を集める (失敗は throw: 何が消えるか確認できないまま
      //    消さない = fail-closed)
      const all = await db.getAll<StoredRecord>(STORE_BUNDLES);
      const victimWsIds = all
        .filter((r) => !isReservedId(r.id) && r.userId === id)
        .map((r) => r.id);
      // 2) 病棟 + 設定レコードを 1 トランザクションで削除 (途中失敗は abort = 原子性)
      await db.runWrite([STORE_BUNDLES], (tx) => {
        const store = tx.objectStore(STORE_BUNDLES);
        for (const wsId of victimWsIds) store.delete(wsId);
        store.delete(settingsIdFor(id));
      });
      // 3) 登録簿から除去
      const users = (await loadUsers()).filter((u) => u.id !== id);
      await saveUsers(users);
      // workspaceIds は呼び出し側がスナップショット DB の purge に使う (PII 残留防止)。
      return { users, workspaceIds: victimWsIds };
    },

    newUserId,

    // ============================
    // ユーザー機能の起動時 backfill (冪等)
    //
    // `__users__` が無ければ「一度だけ」初期化する:
    //   (a) usr_default を作成 (名前は defaultUserName)
    //   (b) 既存の全病棟レコードに userId=usr_default を付与
    //   (c) currentUser ポインタ = usr_default、その activeWorkspaceId = 現 active ws
    // 2 回目以降は何もしない (currentUser ポインタが消えた場合だけ先頭ユーザーへ補正)。
    //
    // v1 との差分: v1 にあった「旧 __settings__ (ユーザー無し時代) の改名」は撤去した。
    // v2 の DB は新規 (v1 の DB を開かない = 仕様§7) ため、ユーザー無し時代のレコードは
    // 構造的に存在しない。
    // ============================
    async ensureUsersInitialized() {
      // 既に初期化済みか
      let usersRec: StoredRecord | undefined;
      try {
        usersRec = await getRecord(USERS_ID);
      } catch (e) {
        // 読めない (IDB 不可) なら初期化もできない。起動を止めず縮退する (v1 と同じ)。
        console.warn('ensureUsersInitialized: read failed:', e);
        return;
      }
      if (usersRec && Array.isArray(usersRec.users) && usersRec.users.length) {
        // currentUser ポインタが現存ユーザーを指しているか確認 (壊れていたら先頭に補正)
        const ids = usersRec.users.map((u) => u.id);
        if (!ids.includes(getCurrentUserId())) {
          const first = usersRec.users[0];
          if (first) setCurrentUserId(first.id);
        }
        return;
      }

      // --- 一度きりの backfill ---
      let all: StoredRecord[] = [];
      try {
        all = await db.getAll<StoredRecord>(STORE_BUNDLES);
      } catch {
        /* 列挙できなくても登録簿の作成は試みる */
      }

      const activeWsId = getActiveWorkspaceId();
      try {
        await db.runWrite([STORE_BUNDLES], (tx) => {
          const store = tx.objectStore(STORE_BUNDLES);
          // (b) 既存病棟に userId を付与
          for (const r of all) {
            if (isReservedId(r.id)) continue;
            if (!r.userId) {
              r.userId = DEFAULT_USER_ID;
              store.put(r);
            }
          }
          // (a)(c) 登録簿を作成
          store.put({
            id: USERS_ID,
            users: [
              {
                id: DEFAULT_USER_ID,
                name: defaultUserName,
                createdAt: now(),
                activeWorkspaceId: activeWsId,
                passhash: null,
              },
            ],
            updatedAt: now(),
          });
        });
      } catch (e) {
        console.error('ensureUsersInitialized: backfill failed:', e);
      }
      setCurrentUserId(DEFAULT_USER_ID);
    },

    // ============================
    // 設定 (ユーザーごと: __settings__::<userId>)
    // ============================

    // 設定オブジェクトを読む。未保存なら null (読みは縮退)。
    async loadGlobalSettings(userId) {
      const uid = userId || getCurrentUserId();
      try {
        const rec = await getRecord(settingsIdFor(uid));
        if (rec && rec.settings && typeof rec.settings === 'object') return rec.settings;
      } catch (e) {
        console.warn('idb load settings failed:', e);
      }
      return null;
    },

    // 設定オブジェクトを書く (失敗は throw = fail-closed)。
    async saveGlobalSettings(settings, userId) {
      const uid = userId || getCurrentUserId();
      await putRecord({ id: settingsIdFor(uid), settings, updatedAt: now() });
    },

    _resetForTests() {
      db._resetForTests();
    },
  };

  return api;
}
