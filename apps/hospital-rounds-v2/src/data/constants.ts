// hospital-rounds-v2 の永続化識別子 (監査用の一箇所集約)。
//
// ============================================================================
// 識別子の v1 / v2 分離 (仕様§7 — 絶対条件)
//
// v2 は **v1 のデータを読まない・書かない・消さない**。そのため v1 の識別子
// (`hospital-rounds` / `hospital-rounds-snapshots` / `hospital-rounds-eventlog` /
// `hospital_rounds_*` localStorage キー / v1 SW cache 名) を **絶対に使わない**。
// 同一 origin に v1 と v2 が同居しても、ストレージが衝突・混線しないことを
// このファイルだけで監査できるようにする (識別子をコードに散らさない)。
// ============================================================================

/** 患者データ本体 (bundles) の IndexedDB 名 */
export const DB_NAME = 'hospital-rounds-v2';
export const DB_VERSION = 1;
/** bundles object store: 1 レコード = 1 ワークスペース (+ 予約レコード) */
export const STORE_BUNDLES = 'bundles';

/** スナップショット (破壊操作前バックアップ・PII を含む) の専用 IndexedDB 名 */
export const SNAPSHOT_DB_NAME = 'hospital-rounds-v2-snapshots';

/** イベントログ (研究用テレメトリ・非 PII) の専用 IndexedDB 名 */
export const EVENTLOG_DB_NAME = 'hospital-rounds-v2-eventlog';

/**
 * localStorage ポインタの名前空間 prefix (foundation createPointerStore に渡す)。
 * localStorage は「数バイトの同期ポインタ」のみ (アプリデータ本体は IndexedDB)。
 */
export const LOCAL_PREFIX = 'hrv2.';

/** Service Worker のキャッシュ名 (UI/PWA 層が使う。v1 の cache 名と衝突させない) */
export const CACHE_NAME = 'hospital-rounds-v2-v1';

// ============================
// bundles ストア内の予約 ID (v1 storage.js と同じ構造)
// ============================

/** 初回起動時に既定で active になるワークスペース ID */
export const DEFAULT_WORKSPACE_ID = 'default';

/**
 * ユーザーごとの設定レコード: `__settings__::<userId>`。
 * 設定 (formats / tags / clearTargets / qr 設定) はユーザー共通
 * (= 1 ユーザー内の全ワークスペースで共通) で、bundles ストア内に予約 ID で置き、
 * listBundles では除外する。DB スキーマ追加は不要 (v1 と同じ設計)。
 */
export const SETTINGS_PREFIX = '__settings__';

/** ユーザー登録簿 (予約レコード 1 個) */
export const USERS_ID = '__users__';

/** 既定ユーザー ID (初期化 backfill で作られる最初のユーザー) */
export const DEFAULT_USER_ID = 'usr_default';

/** ユーザーごとの設定レコード ID を解決する。 */
export function settingsIdFor(userId: string): string {
  return `${SETTINGS_PREFIX}::${userId || ''}`;
}

/** listBundles / 病棟列挙で除外すべき予約 ID か。 */
export function isReservedId(id: unknown): boolean {
  return (
    id === USERS_ID ||
    id === SETTINGS_PREFIX ||
    (typeof id === 'string' && id.startsWith(SETTINGS_PREFIX))
  );
}

// ============================
// localStorage ポインタキー (LOCAL_PREFIX 配下の名前。v1 の hospital_rounds_* は使わない)
// ============================

/** アクティブワークスペース ID (短い文字列・同期 read したい・別タブ storage event 検知) */
export const PK_ACTIVE_WORKSPACE = 'active_workspace_id';
/** 現在ユーザー ID */
export const PK_CURRENT_USER = 'current_user_id';
/** 初回オンボーディング完了時刻 (未設定 = 名前 + 同意ポップアップを出す合図) */
export const PK_ONBOARDED_AT = 'onboarded_at';
/** 最後にユーザーを確認した時刻 (再選択画面の判定) */
export const PK_LAST_USER_CONFIRM_AT = 'last_user_confirm_at';
/** ユーザー再選択インターバル ms (将来 UI から変更可能にする器) */
export const PK_USER_RESELECT_INTERVAL = 'user_reselect_interval_ms';
/**
 * ローカル端末の名簿正本 ID (HM 名簿 QR の rosterAuthorityId の source)。初回 HM QR 表示時に
 * 生成して永続化する。端末/インストール固有値なので localStorage ポインタに置き、ユーザー設定
 * (settings) や QR wire には載せない (ST QR は端末固有値を送らない既存方針を壊さない)。
 */
export const PK_ROSTER_AUTHORITY_ID = 'roster_authority_id';

/** ユーザー再選択の既定インターバル (1 日) */
export const DEFAULT_USER_RESELECT_INTERVAL_MS = 24 * 60 * 60 * 1000;
