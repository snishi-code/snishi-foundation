// 移植元: snishi-code-medical/hospital-rounds/src/constants.js + store.js の実データ構造
//
// hospital-rounds-v2 のドメイン型と enum 定数。既定値は defaults.json に集約し
// (ユーザーが触らずに保存した状態 = defaults.json)、コードからはこのモジュールを
// 通じて参照する設計を v1 から維持する。

import APP_DEFAULTS_RAW from './defaults.json';

// ============================
// enum 定数 (wire の index 表の元になるため、並びの変更 = QR WIRE_V bump)
// ============================

/** フォーマット表示方式: expand = 患者画面にカード常設 / quick = チップからシート入力。 */
export type FormatDisplay = 'expand' | 'quick';

export const STATUS = Object.freeze({
  NONE: 'none',
  YELLOW: 'yellow',
  GREEN: 'green',
  GRAY: 'gray',
  BLUE: 'blue',
} as const);
export type PatientStatus = (typeof STATUS)[keyof typeof STATUS];

// v2: 患者入力本文は S / O / A / P の4パネルを settings.formats + patient.formatValues で扱う。
// **この並びは QR wire の PANEL_BY_INDEX と一致する** (qr/wire.ts)。
export const FORMAT_PANELS = Object.freeze(['S', 'O', 'A', 'P'] as const);
export type FormatPanel = (typeof FORMAT_PANELS)[number];

// item ごとに kind を持つ:
//   text     : label + 規定文 (normal) + textarea 入力
//   number   : label + 単位 (unit) + 数値入力 + 注記 (note)
//   fraction : label + 単位 (unit) + 数値2つを "/" で結合 (例 BP 120/53)。日付 "5/20" もこれ
// v8.3+ (v1): 旧 "date" (カレンダー入力) は fraction に統合済み。normalizeFormatItem が移行する。
// **この並びは QR wire の KIND_BY_INDEX と一致する** (qr/wire.ts)。
export const FORMAT_ITEM_KINDS = Object.freeze(['text', 'number', 'fraction'] as const);
export type FormatItemKind = (typeof FORMAT_ITEM_KINDS)[number];
export const DEFAULT_ITEM_KIND: FormatItemKind = 'text';

// labelSep を未指定でフォーマットを作る時のフォールバック
// (全 item が kind=text なら「：」、それ以外は半角スペース)。
export const DEFAULT_LABEL_SEP_TEXT = '：';
export const DEFAULT_LABEL_SEP_OTHER = ' ';

// タグの色。gray = ニュートラル (残るタグ・デフォルト) / amber = 診察開始で外れる一時タグ。
// 将来色を増やす時はここに追加するだけで拡張できる構造にする。
// wire の tgc 配列の index と対応するため、並びの変更は WIRE_V bump が必要。
export const TAG_COLORS = Object.freeze(['gray', 'amber'] as const);
export type TagColor = (typeof TAG_COLORS)[number];

/**
 * タグ色 → clearTargets のキー文字列変換。
 *   gray  → 'tagGray'
 *   amber → 'tagAmber'
 * clearTargets に色ごとのキーを持つ方式 (statusYellow と同じ命名規則)。
 */
export function tagClearKey(color: TagColor): string {
  return 'tag' + color.charAt(0).toUpperCase() + color.slice(1);
}

// QR 種別 (kind コード)。患者画面 QR (clinical text → 電子カルテ貼付) は電子カルテ端末の
// 標準カメラで読む前提のため、常に平文・常に再配布可。
export const QR_KINDS = Object.freeze(['HM', 'ST'] as const);
export type QrKind = (typeof QR_KINDS)[number];

// アプリ表示名の既定 (= v1 の t("app.title"))。ドメイン層は i18n に依存しないため
// ここに定数で持ち、UI 層は必要なら呼び出し時に引数で上書きする。
export const DEFAULT_APP_TITLE = '回診';

// ============================
// defaults.json の読み込み (v1 constants.js 相当)
// ============================

export interface DefaultFormatItemSeed {
  label: string;
  kind: string;
  unit?: string;
  normal?: string;
  fracMode?: string;
}

export interface DefaultFormatSeed {
  name: string;
  panel: string;
  joiner: string;
  labelSep?: string;
  titleWrap?: string;
  tags?: string[];
  display?: string;
  /** 同名同パネルが無ければ既存設定にも常に補填する seed (O 欄のシンプル所見など) */
  _backfillAlways?: boolean;
  items: DefaultFormatItemSeed[];
}

interface AppDefaults {
  formats: DefaultFormatSeed[];
  clearTargets: Record<string, boolean>;
  tags: string[];
  deviceId: string;
  _app: { patientCount: number };
}

// JSON の推論型は要素ごとのリテラル union になり扱いづらいので、seed 型へ一度だけ集約する。
const APP_DEFAULTS = APP_DEFAULTS_RAW as unknown as AppDefaults;

export const DEFAULT_PATIENT_COUNT = APP_DEFAULTS._app.patientCount;
export const DEFAULT_FORMATS = APP_DEFAULTS.formats;
export const DEFAULT_CLEAR_TARGETS = APP_DEFAULTS.clearTargets;
export const DEFAULT_TAGS = APP_DEFAULTS.tags;
/** アプリ既定値の生 JSON (デバッグ・テスト用) */
export const APP_DEFAULTS_JSON = APP_DEFAULTS;

export function clone<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj)) as T;
}

// ============================
// ドメイン型 (store.js の実データ構造を正確に)
// ============================

/**
 * フォーマット項目。kind ごとに必要なフィールドだけ持つ:
 *   text     : { label, kind:"text",     normal }
 *   number   : { label, kind:"number",   unit   }
 *   fraction : { label, kind:"fraction", unit, fracMode }
 * fracMode: "numeric"(数字キーボード・血圧 120/80) / "text"(英数字混在・抗菌薬 1g/1)。
 */
export interface FormatItem {
  label: string;
  kind: FormatItemKind;
  unit?: string;
  normal?: string;
  fracMode?: 'numeric' | 'text';
}

export interface Format {
  id: string;
  name: string;
  panel: FormatPanel;
  /** 患者画面での表示方式: expand = カード常設 / quick = チップからシート入力 */
  display: FormatDisplay;
  /** 項目間の区切り */
  joiner: string;
  /** label と値の区切り */
  labelSep: string;
  /** 展開時にフォーマット名を囲む括弧ペア (例 "（）")。空 = タイトル行なし */
  titleWrap: string;
  /** フォーマット入力時に患者へ自動付与するタグ */
  tags: string[];
  items: FormatItem[];
}

/**
 * 展開フォーマットの患者入力値。formatValues[formatId] = { [itemIndex]: 値 }。
 * 値は保存世代により揺れる (旧文字列 / {value,note} / {value,source})。読み出しは
 * domain/formatValues.ts の正規化ヘルパを必ず通す。
 */
export type FormatValues = Record<string, Record<string, unknown>>;

export interface Patient {
  pid: string;
  status: PatientStatus;
  name: string;
  room: string;
  tags: string[];
  // 臨床入力本文は formatValues に一本化 (旧 s/memo/shared/oFree/a/p は撤去)。
  // ただしプロブレムリストと自由記述欄はフォーマットとは別構造の患者ごと独立データ。
  /** プロブレムリスト。`#1`/`#2` 等の番号は保存せず、表示・QR 出力時に配列順から自動付番する。 */
  problems: string[];
  /** 自由記述欄 (患者ごとの自由 textarea)。QR には含めない (電子カルテ転記対象外)。 */
  freeText: string;
  updatedAt: number;
  // 他ワークスペースへ移動した時に立つマーカー。元データ (name/room) は触らず表示時のみ装飾。
  //   transferredAt: 移動した時刻 (ms epoch)。0 = 未移動。
  transferredAt: number;
  transferredTo: string;
  // 削除済み病棟 (Trash) への退避マーカー。deletedAt: 0 = 未削除。30日超で自動 purge。
  deletedAt: number;
  deletedFromWorkspaceId: string;
  deletedFromWorkspaceLabel: string;
  // HM 名簿 QR の正本側入院エピソード ID (domain/roster.ts 参照)。病棟 ID に従属させず、
  // 転棟しても同じ患者エピソードとして維持する。ローカル pid とは別概念 (混ぜない)。
  // 既存・通常作成の患者は '' (unmanaged)。
  rosterPatientId: string;
  /** rosterPatientId を持つ名簿管理下の患者か (受信側の編集ロック判定に使う)。 */
  rosterManaged: boolean;
  formatValues: FormatValues;
}

/**
 * タグ定義オブジェクト。patient.tags は名前参照の string[] のまま。
 * color: 'gray' = ニュートラル (残るタグ・デフォルト) / 'amber' = 診察開始で外れる一時タグ。
 * 「診察開始でどの色のタグを外すか」は settings.clearTargets の tagGray / tagAmber で決める。
 */
export interface TagDef {
  name: string;
  color: TagColor;
}

/**
 * ユーザーごとの設定 (v1 の __settings__::<userId> レコード相当)。
 */
export interface Settings {
  v: number;
  formats: Format[];
  /** panel キー (S/O/A/P) + statusYellow/Green/Gray/Blue */
  clearTargets: Record<string, boolean>;
  tags: TagDef[];
  deviceId: string;
}

export interface AppState {
  v: 3;
  /** ヘッダー表示タイトル = 現ユーザー名 (ユーザー機能・案B) */
  title: string;
  patients: Patient[];
}

/** ユーザー登録簿 (__users__ レコード) の 1 ユーザー */
export interface User {
  id: string;
  name: string;
  createdAt: number;
  /** そのユーザーが最後に開いていた病棟 ID */
  activeWorkspaceId: string;
  /** パスワードの器 (今は常に null) */
  passhash: null;
}
