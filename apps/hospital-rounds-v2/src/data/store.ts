// 移植元: snishi-code-medical/hospital-rounds/src/store.js の状態オーケストレーション部
//          (initStore / switchUser / switchWorkspace / saveNow / persistActiveOrThrow /
//           flushSavePending / アーカイブ入出力) を UI 非依存のファクトリに移植。
//
// v1 との差分:
//   - ES module live binding (export let settings) → ファクトリが保持する内部状態 +
//     getSettings()/getAppState() (live 参照を返す。ミューテーション後は scheduleSave +
//     通知が呼び出し側の責務 — v1 と同じ契約)。
//   - showToast / t() → onSaveError コールバック注入 + defaultTitle 引数 (UI 非依存)。
//   - 変更通知は単一 listener (setDataChangeHandler)。v1 の
//     setOnWorkspaceChanged / setOnUserChanged / setMarkUpdatedHandler を event 種別に統合。
//     React 接続 (再描画ディスパッチ) は UI エージェントが行う。
//   - 一回限り入力モデル移行 (migratePatientsInputModel, v1 で TEMP 注記) は撤去。
//     v2 は新規 DB (v1 を読まない) であり、現行 v1 からの JSON 書き出しは移行済み形式のみ。
//
// fail-closed 原則 (臨床データの根本原則・v1 から不変):
//   - fire-and-forget の saveNow() (catch して通知のみ) とは別に、病棟切替・ユーザー切替・
//     患者移動・QR 取込が使う persistActiveOrThrow() / saveSettingsOrThrow() は失敗を
//     必ず throw して呼び出し側に中断させる。
//   - IDB 不可 (open 失敗) の no-op 保存も「保存できていない事実」として失敗扱いにする。

import { DEFAULT_APP_TITLE, type AppState, type Patient, type Settings, type User } from '../domain/types';
import {
  defaultSettings,
  hasBackfilledDefaultFormats,
  isPatientEmpty,
  normalizeLoaded,
  normalizePatientArray,
  normalizeSettings,
} from '../domain/normalize';
import { collectFormatItemIndicesWithData } from '../domain/formatValues';
import { SECTION, getSection, parseBundle, projectBundle, type Bundle } from './bundle';
import { createHrStorage, type HrStorage, type HrWorkspaceRecord } from './storage';

/** オートセーブの debounce (v1 と同じ 180ms) */
export const SAVE_DEBOUNCE_MS = 180;

// ============================
// 全ワークスペース JSON 入出力 (アーカイブ)
//
// 形式マーカーは v1 と同一を維持する (v1 端末から書き出した JSON を v2 が取り込める
// ようにするため。ストレージ識別子ではないので仕様§7 の分離対象外)。
// ============================
export const ARCHIVE_FORMAT = 'hospital-rounds-archive';
export const ARCHIVE_SCHEMA = 1;
export const DEVICE_ARCHIVE_FORMAT = 'hospital-rounds-device-archive';
export const DEVICE_ARCHIVE_SCHEMA = 1;

export interface ArchiveWorkspace {
  label: string;
  title: string;
  patients: Patient[];
}

export interface Archive {
  format: typeof ARCHIVE_FORMAT;
  schema: number;
  exportedAt: string;
  settings: Settings;
  workspaces: ArchiveWorkspace[];
}

export interface DeviceArchiveUser {
  name: string;
  settings: Settings;
  workspaces: ArchiveWorkspace[];
}

export interface DeviceArchive {
  format: typeof DEVICE_ARCHIVE_FORMAT;
  schema: number;
  exportedAt: string;
  users: DeviceArchiveUser[];
}

export function isArchive(obj: unknown): obj is Archive {
  return !!(
    obj &&
    typeof obj === 'object' &&
    (obj as Record<string, unknown>).format === ARCHIVE_FORMAT &&
    Array.isArray((obj as Record<string, unknown>).workspaces)
  );
}

export function isDeviceArchive(obj: unknown): obj is DeviceArchive {
  return !!(
    obj &&
    typeof obj === 'object' &&
    (obj as Record<string, unknown>).format === DEVICE_ARCHIVE_FORMAT &&
    Array.isArray((obj as Record<string, unknown>).users)
  );
}

// ============================
// 変更通知 (単一 listener)
// ============================

export type StoreChangeEvent =
  | { type: 'workspace'; workspaceId: string } // 病棟切替・新規作成後の切替
  | { type: 'user'; userId: string } // ユーザー切替
  | { type: 'patient'; no: number }; // markUpdated (個別患者の更新)

export interface HrStoreDeps {
  /** 注入しなければ createHrStorage() を内部生成 */
  storage?: HrStorage;
  /**
   * fire-and-forget 保存 (saveNow) の失敗可視化 (v1 の showToast(save.failed) 相当)。
   * 黙って握り潰さないため、UI 層は必ず toast 等を配線すること。
   */
  onSaveError?: (e: unknown) => void;
  /** アプリ表示名の既定 (= v1 t("app.title"))。UI 層が i18n 値を注入してよい */
  defaultTitle?: string;
  saveDebounceMs?: number;
  now?: () => number;
}

export interface HrStore {
  storage: HrStorage;

  // ── live state (参照を返す。差し替えは set* 経由) ──
  getSettings(): Settings;
  setSettings(s: Settings): void;
  getAppState(): AppState;
  setAppState(s: AppState): void;
  /** ヘッダーのタイトル枠に出す現ユーザー名 (同期キャッシュ) */
  getCurrentUserName(): string;

  setDataChangeHandler(fn: ((ev: StoreChangeEvent) => void) | null): void;

  // ── hydration ──
  /**
   * 非同期 hydration。UI は描画前に必ず await すること。2 回目以降は同じ promise を返す
   * (冪等)。テストは { bundle } で storage を経由せず状態を注入できる。
   */
  initStore(opts?: { bundle?: unknown }): Promise<void>;
  /** テスト用: 次の initStore() を再実行できるよう内部状態をリセットする */
  _resetInitForTests(): void;

  // ── 保存 ──
  scheduleSave(): void;
  /** fire-and-forget 保存。失敗は onSaveError へ (例外は投げない) */
  saveNow(): Promise<void>;
  /**
   * fail-closed な保存経路。保存できなければ throw (病棟切替・患者移動・QR 取込用)。
   * IDB 不可の no-op 保存も「保存できていない事実」として失敗にする。
   */
  persistActiveOrThrow(): Promise<void>;
  /** beforeunload / visibilitychange="hidden" 用。debounce 中のセーブを即時実行に切替 */
  flushSavePending(): void;
  /** 設定保存 (実体は saveNow。呼び出し側の意図を名前に残す v1 互換) */
  saveSettings(): Promise<void>;
  /** fail-closed 版 saveSettings (QR 取込などが使う) */
  saveSettingsOrThrow(): Promise<void>;

  // ── 受信ボックス ──
  setRecvContent(key: 'recvMemo' | 'recvShared', value: string): void;

  // ── 患者更新マーカー ──
  markUpdated(no: number): void;

  // ── ワークスペース ──
  switchWorkspace(targetId: string): Promise<void>;
  createWorkspace(label: string): Promise<string>;
  /** 指定患者だけを含む新規 ws を作成して保存 (switch しない)。患者移動用 */
  createWorkspaceWithPatients(label: string, patients: Patient[]): Promise<string>;

  // ── ユーザー ──
  switchUser(targetUserId: string): Promise<void>;
  createUserAndSwitch(
    name: string,
  ): Promise<{ ok: true; id: string } | { ok: false; reason: 'empty' | 'duplicate' }>;
  renameCurrentUser(
    name: string,
  ): Promise<{ ok: true } | { ok: false; reason: 'empty' | 'duplicate' }>;

  // ── アーカイブ入出力 ──
  exportArchive(): Promise<Archive>;
  importArchive(archive: Archive, opts?: { includeSettings?: boolean }): Promise<number>;
  exportDeviceArchive(): Promise<DeviceArchive>;
  importDeviceArchive(archive: DeviceArchive): Promise<{ users: number; workspaces: number }>;

  // ── フォーマット編集の破壊防止 ──
  /**
   * 現ユーザーの全病棟を横断して、format の「入力がある item index」集合を返す。
   * 失敗時 (列挙やロードの失敗 = データの有無を確認できない) は null = fail-closed
   * (呼び出し側が全ブロック扱いにする)。
   */
  collectFormatDataIndices(formatId: string): Promise<Set<number> | null>;

  /** iOS Safari 等の eviction 抑制 (best-effort) */
  requestStoragePersistence(): void;
}

export function createHrStore(deps: HrStoreDeps = {}): HrStore {
  const storage = deps.storage ?? createHrStorage();
  const defaultTitle = deps.defaultTitle ?? DEFAULT_APP_TITLE;
  const debounceMs = deps.saveDebounceMs ?? SAVE_DEBOUNCE_MS;
  const now = deps.now ?? Date.now;

  let settings: Settings = defaultSettings();
  let appState: AppState = {
    v: 3,
    title: defaultTitle,
    patients: normalizePatientArray(null),
    recvMemo: '',
    recvShared: '',
  };
  // ヘッダーのタイトル枠は「現ユーザー名」を表示する (ユーザー機能, 案B)。
  // 同期で参照したいので、initStore / switchUser で取得した名前をここにキャッシュする。
  let currentUserName = '';
  let onChange: ((ev: StoreChangeEvent) => void) | null = null;
  let initPromise: Promise<void> | null = null;
  let saveTimer: ReturnType<typeof setTimeout> | null = null;

  function notify(ev: StoreChangeEvent): void {
    if (!onChange) return;
    try {
      onChange(ev);
    } catch {
      /* listener の失敗でデータ操作を壊さない */
    }
  }

  // settings はユーザーごと管理のため、ここでは patients / title (= ワークスペース固有 +
  // 現ユーザー名) だけを live state へ反映する。bundle の settings section は無視。
  function applyBundleToLive(bundle: Bundle | null): void {
    const sPatients = bundle ? getSection(bundle, SECTION.PATIENTS) : null;
    const meta = bundle ? (getSection(bundle, SECTION.META) as Record<string, unknown> | null) : null;
    appState = {
      v: 3,
      // title = 現ユーザー名。bundle.sections.meta.title は出力時の体裁のためだけに保持。
      title: currentUserName || defaultTitle,
      patients: normalizePatientArray(Array.isArray(sPatients) ? sPatients : null),
      // 受信ボックス (病棟単位で永続化)
      recvMemo: meta && typeof meta.recvMemo === 'string' ? meta.recvMemo : '',
      recvShared: meta && typeof meta.recvShared === 'string' ? meta.recvShared : '',
    };
  }

  // 現ユーザー名を IDB / キャッシュから最新化する。
  async function refreshCurrentUserName(): Promise<string> {
    try {
      const users = await storage.loadUsers();
      const me = users.find((u) => u.id === storage.getCurrentUserId());
      currentUserName = me ? me.name || '' : '';
    } catch {
      currentUserName = '';
    }
    return currentUserName;
  }

  // アクティブ ws の患者データ (bundle) とグローバル設定の両方を永続化する共通処理。
  // settings は ws bundle ではなくユーザー設定レコードに保存する。ws bundle には
  // 患者 + meta だけを書く (settings section は出さない)。
  async function persistActive(): Promise<void> {
    await storage.saveBundle(
      projectBundle({ appState, settings, sections: [SECTION.META, SECTION.PATIENTS] }),
    );
    await storage.saveGlobalSettings(settings);
  }

  async function persistActiveOrThrow(): Promise<void> {
    if (!(await storage.isStorageAvailable())) {
      throw new Error('persistActiveOrThrow: storage unavailable (IDB not usable)');
    }
    await persistActive();
  }

  // async だが「fire and forget」呼び出しが多いので返り値を await する義務はない。
  // 内部 catch で失敗は console + onSaveError に出す (黙って握り潰さない)。
  async function saveNow(): Promise<void> {
    saveTimer = null;
    try {
      await persistActive();
    } catch (e) {
      console.error('save failed:', e);
      // 保存失敗をユーザーに可視化する (v1 は toast)。ここに来るのは容量超過など
      // 「本当に書けなかった」失敗なので、UI 層は必ず通知を配線すること。
      if (deps.onSaveError) deps.onSaveError(e);
    }
  }

  function scheduleSave(): void {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      void saveNow();
    }, debounceMs);
  }

  function clearPendingTimer(): void {
    if (saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = null;
    }
  }

  // 空の病棟 bundle (default 50 患者)。settings はユーザー共通なので bundle には含めない。
  function buildEmptyBundle(): Bundle {
    const emptyAppState: AppState = {
      v: 3,
      title: defaultTitle,
      patients: normalizePatientArray(null),
      recvMemo: '',
      recvShared: '',
    };
    return projectBundle({
      appState: emptyAppState,
      settings,
      sections: [SECTION.META, SECTION.PATIENTS],
    });
  }

  const store: HrStore = {
    storage,

    getSettings: () => settings,
    setSettings(s) {
      settings = s;
    },
    getAppState: () => appState,
    setAppState(s) {
      appState = s;
    },
    getCurrentUserName: () => currentUserName,

    setDataChangeHandler(fn) {
      onChange = fn;
    },

    initStore(opts) {
      if (initPromise) return initPromise;
      initPromise = (async () => {
        // ユーザー機能 (案B): 登録簿を一度だけ初期化し、currentUser ポインタを確定させる
        // (冪等)。以降の loadBundle / listBundles / loadGlobalSettings は現ユーザー解決済み。
        try {
          await storage.ensureUsersInitialized();
        } catch (e) {
          console.warn('initStore: ensureUsersInitialized failed:', e);
        }
        await refreshCurrentUserName();

        let bundle: Bundle | null = null;
        if (opts && opts.bundle) {
          try {
            bundle = parseBundle(opts.bundle);
          } catch (e) {
            console.warn('initStore: seed parse failed:', e);
          }
        } else {
          try {
            bundle = await storage.loadBundle();
          } catch (e) {
            console.warn('initStore: storage load failed:', e);
          }
        }
        // settings はユーザー単位。未保存なら現バンドルの settings section から 1 度だけ
        // seed する (v1 からの引き継ぎ移行と同じ構造。v2 では主にテスト seed 用)。
        let gs: unknown = null;
        try {
          gs = await storage.loadGlobalSettings();
        } catch (e) {
          console.warn('initStore: load global settings failed:', e);
        }
        if (gs) {
          settings = normalizeSettings(gs);
          // backfill (既定フォーマットの補填) が起きたら disk へ収束させる
          if (hasBackfilledDefaultFormats(gs, settings)) {
            try {
              await storage.saveGlobalSettings(settings);
            } catch (e) {
              console.warn('initStore: save normalized settings failed:', e);
            }
          }
        } else {
          const seed = bundle ? getSection(bundle, SECTION.SETTINGS) : null;
          settings = normalizeSettings(seed || {});
          try {
            await storage.saveGlobalSettings(settings);
          } catch (e) {
            console.warn('initStore: seed global settings failed:', e);
          }
        }
        // patients / title (ws 固有 + 現ユーザー名) を適用
        applyBundleToLive(bundle);
      })();
      return initPromise;
    },

    _resetInitForTests() {
      initPromise = null;
      clearPendingTimer();
    },

    scheduleSave,
    saveNow,
    persistActiveOrThrow,

    // IDB トランザクションは microtask レベルで開始すれば page hide 中も完了することが
    // 多い (Chrome / Safari)。unload 経路で await できないため fire and forget。
    flushSavePending() {
      if (saveTimer) {
        clearTimeout(saveTimer);
        saveTimer = null;
        void saveNow();
      }
    },

    // 設定はアクティブ bundle と同じ経路で保存する。関数名は呼び出し側の意図を残す (v1 互換)。
    saveSettings() {
      return saveNow();
    },

    // fail-closed 版 saveSettings。QR 取込 (設定/フォーマット/セットの追加・上書き) など
    // 「保存できていないのに成功表示すると設定の取り違え/消失になる」操作が使う。
    // 失敗は throw して呼び出し側に中断 + ロールバックさせる。
    saveSettingsOrThrow() {
      return persistActiveOrThrow();
    },

    // 受信ボックスの内容を更新して永続化する (caller は UI 同期の責務)。
    setRecvContent(key, value) {
      if (key !== 'recvMemo' && key !== 'recvShared') return;
      appState[key] = String(value || '');
      scheduleSave();
    },

    markUpdated(no) {
      const p = appState.patients[no - 1];
      if (!p) return;
      p.updatedAt = now();
      notify({ type: 'patient', no });
    },

    // ============================
    // Workspace 切替・作成
    // ============================
    //
    // switchWorkspace(targetId):
    //   1) 現在のアクティブを debounce 中のものも含めて確実に保存 (fail-closed: 保存
    //      できなければポインタを動かす前に throw — 握って先へ進むと直前の編集が
    //      サイレントに失われる。caller が通知する)
    //   2) アクティブポインタを切替
    //   3) 新しいワークスペースを IDB から読み込み live state に適用
    //   4) 再描画は caller の責務 (= setDataChangeHandler 経由)
    async switchWorkspace(targetId) {
      if (!targetId) throw new Error('switchWorkspace: targetId required');
      clearPendingTimer();
      await persistActiveOrThrow();
      storage.setActiveWorkspaceId(targetId);
      let bundle: Bundle | null = null;
      try {
        bundle = await storage.loadBundle(targetId);
      } catch (e) {
        console.warn('load after switch failed:', e);
      }
      applyBundleToLive(bundle);
      notify({ type: 'workspace', workspaceId: targetId });
    },

    // 空の新規ワークスペースを作成し、そのワークスペースに切替える。
    async createWorkspace(label) {
      // 現アクティブを保存 (fail-closed: 保存できなければ新規作成・切替を中断)。
      clearPendingTimer();
      await persistActiveOrThrow();
      const emptyBundle = buildEmptyBundle();
      const newId = await storage.createWorkspaceRecord(label, emptyBundle);
      storage.setActiveWorkspaceId(newId);
      applyBundleToLive(parseBundle(emptyBundle));
      notify({ type: 'workspace', workspaceId: newId });
      return newId;
    },

    // 指定患者だけを含む新規ワークスペースを作成して保存する (switch はしない)。
    // 患者移動の「＋ 新規ワークスペースへ」用。空の 50 患者を作らない。
    async createWorkspaceWithPatients(label, patients) {
      const appStateForBundle: AppState = {
        v: 3,
        title: appState.title || defaultTitle,
        patients: Array.isArray(patients) ? patients : [],
        recvMemo: '',
        recvShared: '',
      };
      const bundle = projectBundle({
        appState: appStateForBundle,
        settings,
        sections: [SECTION.META, SECTION.PATIENTS],
      });
      return storage.createWorkspaceRecord(label, bundle);
    },

    // ============================
    // ユーザー切替・作成 (案B)
    // ============================
    async switchUser(targetUserId) {
      if (!targetUserId) throw new Error('switchUser: targetUserId required');
      const fromUserId = storage.getCurrentUserId();
      if (targetUserId === fromUserId) return;

      // 1) 現状を保存。fail-closed: 保存できなければ throw して切替を中断する。
      clearPendingTimer();
      await persistActiveOrThrow();
      // 2) 退出ユーザーの activeWorkspaceId を記録 (best-effort)
      try {
        await storage.setUserActiveWorkspaceId(fromUserId, storage.getActiveWorkspaceId());
      } catch {
        /* 記録失敗は切替を止めない (次回は最新病棟へフォールバック) */
      }

      // 3) ポインタ切替
      storage.setCurrentUserId(targetUserId);
      await refreshCurrentUserName();

      // 4) target の設定をロード (無ければ default を作成して保存)
      let gs: unknown = null;
      try {
        gs = await storage.loadGlobalSettings(); // current=target に解決済み
      } catch {
        /* 読めなければ default にフォールバック */
      }
      if (gs) {
        settings = normalizeSettings(gs);
        if (hasBackfilledDefaultFormats(gs, settings)) {
          try {
            await storage.saveGlobalSettings(settings);
          } catch (e) {
            console.warn('switchUser: save normalized settings failed:', e);
          }
        }
      } else {
        settings = defaultSettings();
        try {
          await storage.saveGlobalSettings(settings);
        } catch (e) {
          console.warn('switchUser: seed settings failed:', e);
        }
      }

      // 5) target の病棟を解決 (記録済み → 最新 → 空病棟を新規作成)
      const users = await storage.loadUsers();
      let wsId = storage.getUserActiveWorkspaceId(users, targetUserId);
      const owned = (await storage.listAllWorkspaces()).filter((w) => w.userId === targetUserId);
      const valid = wsId && owned.some((w) => w.id === wsId);
      if (!valid) {
        if (owned.length) {
          const newest = owned.slice().sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))[0];
          wsId = newest ? newest.id : '';
        } else {
          // 病棟が無い (新規ユーザー等) → 空病棟を作成。current=target なので target に属す。
          wsId = await storage.createWorkspaceRecord(
            storage.getDefaultWorkspaceLabel(),
            buildEmptyBundle(),
          );
        }
      }
      storage.setActiveWorkspaceId(wsId);
      try {
        await storage.setUserActiveWorkspaceId(targetUserId, wsId);
      } catch {
        /* 記録失敗は切替を止めない */
      }

      // 6) ロード + 適用
      let bundle: Bundle | null = null;
      try {
        bundle = await storage.loadBundle(wsId);
      } catch (e) {
        console.warn('load after user switch failed:', e);
      }
      applyBundleToLive(bundle);

      // 7) 通知 (UI は全 view 再描画 + ヘッダー更新)
      notify({ type: 'user', userId: targetUserId });
    },

    // 新規ユーザーを作成して切替える。重複名は拒否。
    async createUserAndSwitch(name) {
      const trimmed = String(name || '').trim();
      if (!trimmed) return { ok: false, reason: 'empty' };
      if (await storage.userNameExists(trimmed)) return { ok: false, reason: 'duplicate' };
      const newId = await storage.createUser(trimmed);
      await store.switchUser(newId); // 空病棟を 1 つ作って切替
      return { ok: true, id: newId };
    },

    // 現ユーザーの名前を変更し、live state (キャッシュ名 + appState.title) にも反映する。
    // caller はヘッダー再描画の責務。
    async renameCurrentUser(name) {
      const trimmed = String(name || '').trim();
      if (!trimmed) return { ok: false, reason: 'empty' };
      const uid = storage.getCurrentUserId();
      if (await storage.userNameExists(trimmed, uid)) return { ok: false, reason: 'duplicate' };
      await storage.renameUser(uid, trimmed);
      currentUserName = trimmed;
      appState.title = trimmed;
      return { ok: true };
    },

    // ============================
    // アーカイブ入出力 (現ユーザー単位)
    // ============================

    async exportArchive() {
      // 現在の状態を確実に保存してから全 ws を読み出す。fail-closed: 保存できなければ
      // 中断して throw (握って続行すると、直前編集を欠いた古い IDB 内容を「最新バック
      // アップ」として書き出してしまう)。caller が通知する。
      await persistActiveOrThrow();
      const list = await storage.listBundles();
      const workspaces: ArchiveWorkspace[] = [];
      for (const w of list) {
        let b: Bundle | null = null;
        try {
          b = await storage.loadBundle(w.id);
        } catch {
          /* 壊れた ws はスキップ (export 全体は止めない) */
        }
        const patients = b ? ((getSection(b, SECTION.PATIENTS) as Patient[]) ?? []) : [];
        const meta = b ? ((getSection(b, SECTION.META) as Record<string, unknown>) ?? {}) : {};
        workspaces.push({
          label: w.label || '',
          title: typeof meta.title === 'string' ? meta.title : w.title || '',
          patients: Array.isArray(patients) ? patients : [],
        });
      }
      return {
        format: ARCHIVE_FORMAT,
        schema: ARCHIVE_SCHEMA,
        exportedAt: new Date(now()).toISOString(),
        settings,
        workspaces,
      };
    },

    // アーカイブを取り込む (非破壊)。各 ws を新規作成し、includeSettings ならユーザー設定を
    // 置換する。既存 ws は消さない (= 再取込で重複し得るが、データ消失は避ける)。
    //
    // 原子性 (Codex 監査 M3): v1 は settings 保存 → ws 逐次作成の逐次書込で、途中失敗時に
    // 「settings だけ置換済み・一部 ws だけ作成済み」の部分適用が残り得た。v2 は仕様§8
    // (import は fail-closed) に従い、全レコードを事前構築して writeImportBatch (単一
    // トランザクション) で一括書込する = 全体成功 or 全体失敗。settings を ws より先に
    // 書く順序 (取り込んだ病棟の formatValues が参照するフォーマット ID の確定) は
    // 同一 tx 内の書き込み順として維持する。
    async importArchive(archive, opts) {
      const includeSettings = !!(opts && opts.includeSettings);
      const wss = Array.isArray(archive && archive.workspaces) ? archive.workspaces : [];
      const replaceSettings = !!(
        includeSettings &&
        archive &&
        archive.settings &&
        typeof archive.settings === 'object'
      );
      const targetSettings = replaceSettings ? normalizeSettings(archive.settings) : settings;

      // Pass 1: 病棟レコードを事前構築する (中身のない ws はスキップ)。まだ何も書かない。
      const workspaceRecords: HrWorkspaceRecord[] = [];
      for (const w of wss) {
        const patients = Array.isArray(w && w.patients) ? w.patients : [];
        const norm = normalizeLoaded({ title: (w && w.title) || defaultTitle, patients }, defaultTitle);
        if (!norm.patients.some((p) => !isPatientEmpty(p))) continue;
        const bundle = projectBundle({
          appState: norm,
          settings: targetSettings,
          sections: [SECTION.META, SECTION.PATIENTS],
        });
        workspaceRecords.push(storage.buildWorkspaceRecord(String((w && w.label) || ''), bundle));
      }

      // 書くものが無ければストレージに触らず終了。
      if (!replaceSettings && !workspaceRecords.length) return 0;

      // fail-closed: IDB 不可 (no-op 保存) も「保存できていない事実」として失敗扱い。
      if (!(await storage.isStorageAvailable())) {
        throw new Error('importArchive: storage unavailable (IDB not usable)');
      }
      // Pass 2: 単一トランザクションで一括書込 (1 件でも失敗すれば全 rollback で throw)。
      await storage.writeImportBatch({
        settingsRecords: replaceSettings
          ? [{ userId: storage.getCurrentUserId(), settings: targetSettings }]
          : undefined,
        workspaceRecords,
      });
      // 書込が成功してから in-memory を更新する (失敗時は live state も無傷)。
      if (replaceSettings) settings = targetSettings;
      return workspaceRecords.length;
    },

    // ============================
    // 端末まるごと (全ユーザー) JSON 入出力
    // ============================

    async exportDeviceArchive() {
      // fail-closed: 保存できなければ中断 (古い IDB 内容を最新バックアップと誤認させない)。
      await persistActiveOrThrow();
      const users = await storage.listUsers();
      const allWs = await storage.listAllWorkspaces();
      const outUsers: DeviceArchiveUser[] = [];
      for (const u of users) {
        let s: unknown = null;
        try {
          s = await storage.loadGlobalSettings(u.id);
        } catch {
          /* 設定が読めないユーザーは default で出す */
        }
        const us = s ? normalizeSettings(s) : defaultSettings();
        const workspaces: ArchiveWorkspace[] = [];
        for (const w of allWs.filter((x) => x.userId === u.id)) {
          let b: Bundle | null = null;
          try {
            b = await storage.loadBundle(w.id);
          } catch {
            /* 壊れた ws はスキップ */
          }
          const patients = b ? ((getSection(b, SECTION.PATIENTS) as Patient[]) ?? []) : [];
          const meta = b ? ((getSection(b, SECTION.META) as Record<string, unknown>) ?? {}) : {};
          workspaces.push({
            label: w.label || '',
            title: typeof meta.title === 'string' ? meta.title : w.title || '',
            patients: Array.isArray(patients) ? patients : [],
          });
        }
        outUsers.push({ name: u.name || '', settings: us, workspaces });
      }
      return {
        format: DEVICE_ARCHIVE_FORMAT,
        schema: DEVICE_ARCHIVE_SCHEMA,
        exportedAt: new Date(now()).toISOString(),
        users: outUsers,
      };
    },

    // 端末まるごとアーカイブを取り込む (非破壊)。同名ユーザーは既存に合流、無ければ新規作成。
    //
    // 原子性 (Codex 監査 M3): v1 相当の実装は user 作成 → settings 保存 (失敗時はその
    // ユーザーだけ skip) → ws 逐次作成で、「user は作られたが ws ゼロ」等の中間状態が
    // あり得た。v2 は仕様§8 (import は fail-closed) に従い、読み・解決フェーズ (登録簿
    // 読込・同名合流/新規 uid 採番・設定解決・空 ws スキップ) を全て先に済ませ、
    // `__users__` 登録簿 + settings×N + ws×M を 1 回の writeImportBatch (単一トランザク
    // ション) で書く = 全体成功 or 全体失敗。旧来の「settings 保存失敗 → そのユーザー
    // だけ continue」の縮退は廃止した (部分適用を残さない)。
    async importDeviceArchive(archive) {
      const arr = Array.isArray(archive && archive.users) ? archive.users : [];

      // ── 読み・解決フェーズ (ストレージへは一切書かない) ──
      const registry: User[] = await storage.loadUsers();
      let registryDirty = false;
      let createdUsers = 0;
      const settingsRecords: Array<{ userId: string; settings: unknown }> = [];
      const workspaceRecords: HrWorkspaceRecord[] = [];

      for (const au of arr) {
        const name = String((au && au.name) || '').trim();
        const wss = Array.isArray(au && au.workspaces) ? au.workspaces : [];
        // 名前も病棟も無いユーザーはスキップ
        if (!name && !wss.length) continue;
        // 同名ユーザーは合流、無ければ新規 (registry はローカルコピー。ここで push した
        // 新規ユーザーも後続の同名合流の対象になる)
        const target = registry.find((u) => (u.name || '').trim() === name && !!name);

        // そのユーザーの実効設定 (us) を解決する。
        //   - archive に設定あり: それで置換 (= 必ず保存)。
        //   - archive 設定なし・既存ユーザー: 現設定 (backfill 差分があれば保存)。
        //     ※ 同一 batch 内で解決済みの settings があればそれを「現設定」とみなす
        //       (同名ユーザーが archive に複数いる縮退ケース)。
        //   - archive 設定なし・新規ユーザー: defaults を seed (必ず保存)。
        let us: Settings;
        let needSettingsSave: boolean;
        if (au && au.settings && typeof au.settings === 'object') {
          us = normalizeSettings(au.settings);
          needSettingsSave = true;
        } else if (target) {
          const pending = settingsRecords.find((r) => r.userId === target.id);
          let existing: unknown = pending ? pending.settings : null;
          if (!existing) {
            try {
              existing = await storage.loadGlobalSettings(target.id);
            } catch {
              /* 読めなければ default 扱い */
            }
          }
          us = existing ? normalizeSettings(existing) : defaultSettings();
          needSettingsSave = !existing || hasBackfilledDefaultFormats(existing, us);
        } else {
          us = defaultSettings();
          needSettingsSave = true;
        }

        // user 確定 (merge or 新規)。新規は uid 採番とローカル registry への追加のみ行い、
        // `__users__` レコードの書込は writeImportBatch に寄せる。
        let uid: string;
        if (target) {
          uid = target.id;
        } else {
          uid = storage.newUserId();
          registry.push({
            id: uid,
            name: name || storage.getDefaultUserName(),
            createdAt: now(),
            activeWorkspaceId: '',
            passhash: null,
          });
          registryDirty = true;
          createdUsers++;
        }
        // ドメイン順序: 設定が保存されないと取り込んだ病棟の formatValues が参照する
        // フォーマット ID が確定せず孤立する。settings は writeImportBatch の書き込み順で
        // 同一 tx 内でも ws より先に put される。
        if (needSettingsSave) settingsRecords.push({ userId: uid, settings: us });

        // 病棟をそのユーザーへ (空 ws はスキップ)
        for (const w of wss) {
          const patients = Array.isArray(w && w.patients) ? w.patients : [];
          const norm = normalizeLoaded({ title: (w && w.title) || defaultTitle, patients }, defaultTitle);
          if (!norm.patients.some((p) => !isPatientEmpty(p))) continue;
          // bundle は META+PATIENTS のみ投影 (settings section は出さない)。
          const bundle = projectBundle({
            appState: norm,
            settings: us,
            sections: [SECTION.META, SECTION.PATIENTS],
          });
          workspaceRecords.push(
            storage.buildWorkspaceRecord(String((w && w.label) || ''), bundle, uid),
          );
        }
      }

      // 書くものが無ければストレージに触らず終了。
      if (!registryDirty && !settingsRecords.length && !workspaceRecords.length) {
        return { users: 0, workspaces: 0 };
      }

      // ── 書込フェーズ: 全体成功 or 全体失敗 ──
      // fail-closed: IDB 不可 (no-op 保存) も「保存できていない事実」として失敗扱い。
      if (!(await storage.isStorageAvailable())) {
        throw new Error('importDeviceArchive: storage unavailable (IDB not usable)');
      }
      await storage.writeImportBatch({
        usersRecord: registryDirty ? registry : undefined,
        settingsRecords,
        workspaceRecords,
      });
      return { users: createdUsers, workspaces: workspaceRecords.length };
    },

    // ============================
    // フォーマット item 編集の破壊防止: 入力済み item index の横断収集
    //
    // settings.formats は現ユーザーの全病棟共通なので、ある format の item 削除/並び替えは
    // 「アクティブ病棟以外」の患者データもずらし得る。
    //   - アクティブ病棟は live の appState.patients (debounce 中の未保存入力も含む)
    //   - 非アクティブ病棟は保存済みバンドル
    // ============================
    async collectFormatDataIndices(formatId) {
      try {
        const out = collectFormatItemIndicesWithData(appState.patients, formatId);
        const activeId = storage.getActiveWorkspaceId();
        for (const b of await storage.listBundles()) {
          if (b.id === activeId) continue;
          const bundle = await storage.loadBundle(b.id);
          if (!bundle) return null; // ロード不可 = 有無を確認できない → fail-closed
          collectFormatItemIndicesWithData(
            (getSection(bundle, SECTION.PATIENTS) as Patient[]) || [],
            formatId,
            out,
          );
        }
        return out;
      } catch (e) {
        console.warn('collectFormatDataIndices failed:', e);
        return null;
      }
    },

    // iOS Safari 等の eviction を抑制 (PWA インストール時に true を返すことが多い)。
    // 失敗しても挙動には影響しないので best-effort で呼ぶだけ。
    requestStoragePersistence() {
      if (
        typeof navigator !== 'undefined' &&
        navigator.storage &&
        typeof navigator.storage.persist === 'function'
      ) {
        navigator.storage.persist().catch(() => {});
      }
    },
  };

  return store;
}
