// 移植元: snishi-code-medical/hospital-rounds/src/constants.js + store.js の実データ構造
//
// hospital-rounds-v2 のドメイン型と enum 定数。既定値は defaults.json に集約し
// (ユーザーが触らずに保存した状態 = defaults.json)、コードからはこのモジュールを
// 通じて参照する設計を v1 から維持する。

import APP_DEFAULTS_RAW from './defaults.json';

// ============================
// enum 定数 (wire の index 表の元になるため、並びの変更 = QR WIRE_V bump)
// ============================

export const STATUS = Object.freeze({
  NONE: 'none',
  YELLOW: 'yellow',
  GREEN: 'green',
  GRAY: 'gray',
  BLUE: 'blue',
} as const);
export type PatientStatus = (typeof STATUS)[keyof typeof STATUS];

// Phase 7 (v1): 患者入力本文は problem / S / O / A / P / shared の6パネルすべてを
// settings.formats + patient.formatValues で扱う。problem = プロブレムリスト、
// shared = 共有。**この並びは QR wire の PANEL_BY_INDEX と一致する** (qr/wire.ts)。
export const FORMAT_PANELS = Object.freeze(['problem', 'S', 'O', 'A', 'P', 'shared'] as const);
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

// QR 種別 (kind コード)。患者画面 QR (clinical text → 電子カルテ貼付) は電子カルテ端末の
// 標準カメラで読む前提のため、この暗号化マトリクスに含まれない (常に平文・常に再配布可)。
// FMT (フォーマット単体) / FS (フォーマットセット) は廃止。設定共有は ST のみ。
// MM (プロブレムリスト共有 QR) / SH (共有欄 QR) は機能撤去済み (UI なし)。
export const QR_KINDS = Object.freeze(['HM', 'ST'] as const);
export type QrKind = (typeof QR_KINDS)[number];

export type QrRedistribution = 'restricted' | 'free';

// それぞれ「暗号化のデフォルト」「再配布のデフォルト」。設定 UI から変更可。
//   redistribution: "restricted" = 受信データの再配布禁止 (= origin=external を送信時に除外)
export const DEFAULT_QR_ENCRYPTION: Readonly<Record<QrKind, boolean>> = Object.freeze({
  HM: true,
  ST: true,
});
export const DEFAULT_QR_REDISTRIBUTION: Readonly<Record<QrKind, QrRedistribution>> =
  Object.freeze({
    HM: 'restricted',
    ST: 'free',
  });

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
  /** 同名同パネルが無ければ既存設定にも常に補填する seed (O 欄のシンプル所見など) */
  _backfillAlways?: boolean;
  items: DefaultFormatItemSeed[];
}

export interface DefaultFormatGroupSeed {
  name: string;
  isDefault?: boolean;
  /** DEFAULT_FORMATS への index 参照 (ID は実行時生成のため index で束ねる) */
  formatIndexes?: number[];
  defaultFormatIndexes?: number[];
  expandFormatIndexes?: number[];
}

interface AppDefaults {
  formats: DefaultFormatSeed[];
  formatGroups: DefaultFormatGroupSeed[];
  clearTargets: Record<string, boolean>;
  tags: string[];
  deviceId: string;
  _app: { patientCount: number };
}

// JSON の推論型は要素ごとのリテラル union になり扱いづらいので、seed 型へ一度だけ集約する。
const APP_DEFAULTS = APP_DEFAULTS_RAW as unknown as AppDefaults;

export const DEFAULT_PATIENT_COUNT = APP_DEFAULTS._app.patientCount;
export const DEFAULT_FORMATS = APP_DEFAULTS.formats;
export const DEFAULT_FORMAT_GROUPS = APP_DEFAULTS.formatGroups;
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
 * フォーマットの「束」(セット)。患者ごとに 1 つ active group を設定すると、各パネルの
 * strip チップがそのグループ所属フォーマットだけに切り替わる。
 * 不変条件: formatGroups が 1 つ以上あるなら「ちょうど 1 つ」が isDefault=true
 * (ensureOneDefaultGroup が担保)。
 */
export interface FormatGroup {
  id: string;
  name: string;
  isDefault: boolean;
  formatIds: string[];
  /** 規定文 (formatIds の部分集合) */
  defaultFormatIds: string[];
  /** 展開(A) = 患者画面に常時タップ可能なカードとして出す (formatIds の部分集合) */
  expandFormatIds: string[];
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
  // Phase 7 (v1): 臨床入力本文は formatValues に一本化 (旧 s/memo/shared/oFree/a/p は撤去)。
  updatedAt: number;
  // 他ワークスペースへ移動した時に立つマーカー。元データ (name/room) は触らず表示時のみ装飾。
  //   transferredAt: 移動した時刻 (ms epoch)。0 = 未移動。
  transferredAt: number;
  transferredTo: string;
  // 削除済み病棟 (Trash) への退避マーカー。deletedAt: 0 = 未削除。30日超で自動 purge。
  deletedAt: number;
  deletedFromWorkspaceId: string;
  deletedFromWorkspaceLabel: string;
  /** この患者で active なフォーマットグループ ID。"" = デフォルトグループに解決 */
  activeFormatGroupId: string;
  formatValues: FormatValues;
  /**
   * プロブレムリスト (患者ごとの独立データ)。機能撤去済み・保存データ温存のみ (UI なし)。
   * local-first 原則: 既存ユーザーのデータを黙って消さないため、フィールドは維持する。
   */
  problems: string[];
  /**
   * 患者識別データの出所マーカー。"external" = 他端末から QR で受信 = 再配布制限対象。
   * "" = この端末で作成 = 再配布可。
   */
  origin: '' | 'external';
  /** 未知フィールド温存 (forward compat): 新版が追加したフィールドを消さない */
  [key: string]: unknown;
}

/**
 * タグ定義オブジェクト。patient.tags は名前参照の string[] のまま。
 * clearOnStart: 「診察開始」ボタンで全患者からこのタグを外すかどうか。
 */
export interface TagDef {
  name: string;
  clearOnStart: boolean;
}

/**
 * ユーザーごとの設定 (v1 の __settings__::<userId> レコード相当)。
 * 未知フィールドは normalizeSettings が温存する (forward compat)。
 */
export interface Settings {
  v: number;
  formats: Format[];
  formatGroups: FormatGroup[];
  /** panel キー (problem/S/O/A/P/shared) + statusYellow/Green/Gray/Blue */
  clearTargets: Record<string, boolean>;
  tags: TagDef[];
  deviceId: string;
  /** QR セキュリティ: kind 別の暗号化フラグ */
  qrEncryption: Record<QrKind, boolean>;
  /** QR 受信データの再配布制限: kind 別 */
  qrRedistribution: Record<QrKind, QrRedistribution>;
  [key: string]: unknown;
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
