// 移植元: snishi-code-medical/hospital-rounds/src/features/qr-protocol.js のドメイン wire 変換部
//
// ============================================================================
// QR Wire Format Authority — ドメイン層 (v2 自己完結)
//
// transport 層 (ページ分割 RND_<KIND> / 圧縮・暗号 prefix) は foundation の
// qr/protocol.ts + qr/crypto.ts。このファイルはその上に乗る **ドメイン wire 変換**
// (Format / FormatGroup / Patient ↔ 短キー JSON) を定義する。各 kind モジュール
// (patientList / settingsQr) は本ファイルのヘルパーを **必ず経由**
// すること。独自の wire format を定義しないこと。
// v1 互換は正式終了 (2026-06)。このアプリの新旧バージョン間でのみ互換を考える。
//
// ── 設計 2 原則 ──
//
// 原則 ①「可変領域は冒頭辞書 + index 参照」:
//   ユーザーが順序や内容を変えうるもの (タグ名、フォーマット並び、項目並び等) は、
//   ペイロード冒頭に辞書を 1 回だけ置き、本体は数値 index で参照する。
//   位置依存のスキーマ宣言は禁止 (順序が変わると壊れる)。
//
// 原則 ②「コード固定値は wire に含めない」:
//   コード側で決まっている enum 許容値・デフォルト値は wire に乗せない。受信側コードが
//   復元する。enum 値は数値 index で送る (PANEL_BY_INDEX 等)。デフォルト等価値は省略する。
//
// ── 短キー命名規約 ──
//
//   トップレベル:
//     v   = version (WIRE_V)
//     td  = tag dictionary (string[]、1-based で参照される)
//           ※ ST は「設定全体」なので空でも常に載せる (受信側のタグを一致させる)
//     p   = patients array (HM/MM/SH)
//     f   = formats array (ST)
//     fg  = formatGroups array (ST) … 各要素は下記「フォーマットセット」
//     ct  = clearTargets (ST)
//
//   患者 (p[i]):
//     r = room / n = name / t = tag indices (td への 1-based。文字列も互換受信)
//     c = content (MM/SH のみ; HM では省略)
//
//   フォーマット (f[i] または FMT の f):
//     n  = name
//     p  = panel index (PANEL_BY_INDEX への 0-based 参照)
//     j  = joiner       (default ", " は省略)
//     ls = labelSep     (明示されていれば省略しない。受信側で kind 構成から復元)
//     tw = titleWrap    (空は省略)
//     t  = tag indices (td への 1-based、辞書なしなら文字列配列)
//     i  = items array
//
//   フォーマット項目 (f[i].i[j]):
//     l  = label
//     k  = kind index (KIND_BY_INDEX への 0-based 参照)
//     u  = unit         (空は省略)
//     nm = normal       (空は省略)
//     fm = fraction 入力方式 (1=numeric。default text は省略。新規フィールド=bump 不要)
//
//   フォーマットセット = formatGroup (ST の fg[i]):
//     n  = name
//     d  = isDefault (1 の時だけ出力、省略時 false)
//     fi = formatIds        (同 payload の f 配列への 1-based index 配列)
//     df = defaultFormatIds (同・fi の部分集合。規定文)
//     xf = expandFormatIds  (同・fi の部分集合。展開=A)
//     注: id は wire に含めない (受信側で新発番)。原則① に従い ID 直書きせず f 配列への
//         index 参照にする (フォーマット順が変わっても壊れない)。
//
// ── 互換性ルール (WIRE_V bump 判定) ──
//
//   bump 必須: 既存フィールドの意味変更・削除 / enum 許容値の追加 (旧版が未知 index を
//              解釈できない) / 短キー名の変更
//   bump 不要: 新規フィールドの追加 (normalize 側が未知フィールドを温存する forward compat)
//
// ── 将来の開発者へ ──
//
//   この設計は「ユーザーの編集自由と互換性を両立する」ために選ばれた。「キー名を直書き
//   する」「enum を文字列のまま送る」「位置依存の配列にする」といった素朴な実装に戻すと、
//   ユーザーが順序を変えた途端に壊れるデータ破壊バグになりうる。本仕様を絶対に逸脱しない
//   こと。詳細議論は v1 リポジトリの git log (v7.2.0) を参照。
// ============================================================================

import {
  DEFAULT_ITEM_KIND,
  DEFAULT_LABEL_SEP_OTHER,
  DEFAULT_LABEL_SEP_TEXT,
  FORMAT_ITEM_KINDS,
  FORMAT_PANELS,
  type Format,
  type FormatGroup,
  type FormatItem,
  type FormatPanel,
  type Patient,
  type Settings,
} from '../domain/types';

// ============================
// kind 別 WIRE_V (一箇所集約)
//
// v2 自己完結の wire バージョン。v1 互換は正式終了 (2026-06)。
// このアプリの新旧バージョン間でのみ互換を考える。
// bump 条件: 既存フィールドの意味変更・削除 / enum 許容値の追加 / 短キー名の変更。
// ============================
export const WIRE_V = Object.freeze({
  HM: 4,
  ST: 7,
} as const);

// ============================
// Enum index tables (原則 ②)
// wire の数値 index ↔ 文字列 enum の変換テーブル。新規 enum 値を末尾に追加する時は
// WIRE_V を bump する必要がある (旧版が未知 index を解釈できない)。
// ============================

export const PANEL_BY_INDEX: readonly FormatPanel[] = Object.freeze(FORMAT_PANELS.slice()); // ["S","O","A","P"]
export const KIND_BY_INDEX: readonly FormatItem['kind'][] = Object.freeze(
  FORMAT_ITEM_KINDS.slice(),
); // ["text","number","fraction"]

const PANEL_INDEX: Record<string, number> = Object.fromEntries(
  PANEL_BY_INDEX.map((v, i) => [v, i]),
);
const KIND_INDEX: Record<string, number> = Object.fromEntries(KIND_BY_INDEX.map((v, i) => [v, i]));

function panelToIdx(s: unknown): number {
  const i = PANEL_INDEX[String(s)];
  return typeof i === 'number' ? i : (PANEL_INDEX['O'] as number); // default O
}
function panelFromIdx(i: unknown): FormatPanel {
  return PANEL_BY_INDEX[typeof i === 'number' ? i : -1] || 'O';
}
function kindToIdx(s: unknown): number {
  const i = KIND_INDEX[String(s)];
  return typeof i === 'number' ? i : (KIND_INDEX[DEFAULT_ITEM_KIND] as number);
}
function kindFromIdx(i: unknown): FormatItem['kind'] {
  return KIND_BY_INDEX[typeof i === 'number' ? i : -1] || DEFAULT_ITEM_KIND;
}

// ============================
// Wire 型 (短キー JSON)
// ============================

export interface WireItem {
  l: string;
  k: number;
  u?: string;
  nm?: string;
  fm?: 1;
}

export interface WireFormat {
  n: string;
  p: number;
  j?: string;
  ls?: string;
  tw?: string;
  t?: Array<number | string>;
  i: WireItem[];
}

export interface WireFormatGroup {
  n: string;
  d?: 1;
  fi?: number[];
  df?: number[];
  xf?: number[];
}

export interface WirePatient {
  r?: string;
  n?: string;
  t?: Array<number | string>;
  c?: string;
}

// ============================
// Tag dictionary helpers (原則 ①)
//
// 送信側の settings.tags を辞書として 1 回だけ wire に乗せ、その他のタグ参照は 1-based の
// 数値 index に置換する。受信側は辞書から文字列を復元する。dict が null の時は文字列のまま
// wire に乗せる (後方互換受信のために維持)。
// ============================

/** 送信側の現在のタグ辞書を取得 (settings.tags の name 配列コピー)。ST (settingsQr.ts) が使用。 */
export function buildTagDict(settings: Pick<Settings, 'tags'>): string[] {
  return (settings.tags || []).map((t) => t.name);
}

/** タグ名配列 → wire 用の値配列。dict 指定時は 1-based index、なしは文字列のまま。 */
function tagsToWire(tagNames: unknown, dict: readonly string[] | null): Array<number | string> {
  if (!Array.isArray(tagNames)) return [];
  if (dict) {
    const out: number[] = [];
    for (const name of tagNames) {
      const idx = dict.indexOf(name as string);
      if (idx >= 0) out.push(idx + 1);
    }
    return out;
  }
  return (tagNames as unknown[]).filter((s): s is string => typeof s === 'string');
}

/** wire の値配列 → タグ名配列。数値は dict から、文字列はそのまま (互換受信)。 */
function tagsFromWire(wireValues: unknown, dict: readonly string[] | null | undefined): string[] {
  if (!Array.isArray(wireValues)) return [];
  const out: string[] = [];
  for (const v of wireValues) {
    if (typeof v === 'number') {
      const name = dict?.[v - 1];
      if (name) out.push(name);
    } else if (typeof v === 'string' && v) {
      out.push(v);
    }
  }
  return out;
}

// ============================
// Format ↔ wire (原則 ① + ②)
// ============================

export function formatToWire(format: Format | null | undefined, tagDict: readonly string[] | null): WireFormat {
  const f = format || ({} as Partial<Format>);
  const o: WireFormat = {
    n: String(f.name || ''),
    p: panelToIdx(f.panel),
    i: [],
  };
  // default 値は省略 (原則 ②)
  if (typeof f.joiner === 'string' && f.joiner !== ', ') o.j = f.joiner;
  if (typeof f.labelSep === 'string') {
    // labelSep の default は item の kind 構成によって決まるが、wire 上は
    // 「明示されていれば省略しない」シンプルルール。受信側で復元
    o.ls = f.labelSep;
  }
  if (typeof f.titleWrap === 'string' && f.titleWrap) o.tw = f.titleWrap;
  const tWire = tagsToWire(Array.isArray(f.tags) ? f.tags : [], tagDict);
  if (tWire.length) o.t = tWire;
  o.i = (Array.isArray(f.items) ? f.items : []).map(itemToWire);
  return o;
}

/** 戻り値に id は含めない (受信側で新発番する契約。v1 と同じ)。 */
export function formatFromWire(
  wire: WireFormat | null | undefined,
  tagDict: readonly string[] | null,
): Omit<Format, 'id'> {
  const w = wire || ({} as Partial<WireFormat>);
  const items = (Array.isArray(w.i) ? w.i : []).map(itemFromWire);
  const labelSep =
    typeof w.ls === 'string'
      ? w.ls
      : items.length && items.every((it) => it.kind === 'text')
        ? DEFAULT_LABEL_SEP_TEXT
        : DEFAULT_LABEL_SEP_OTHER;
  return {
    name: String(w.n || ''),
    panel: panelFromIdx(w.p),
    joiner: typeof w.j === 'string' ? w.j : ', ',
    labelSep,
    titleWrap: typeof w.tw === 'string' ? w.tw : '',
    tags: tagsFromWire(w.t, tagDict),
    items,
  };
}

function itemToWire(it: FormatItem | null | undefined): WireItem {
  const o: WireItem = { l: String(it?.label ?? ''), k: kindToIdx(it?.kind) };
  if (typeof it?.unit === 'string' && it.unit) o.u = it.unit;
  if (typeof it?.normal === 'string' && it.normal) o.nm = it.normal;
  // fraction の入力方式。default(text) は省略し numeric の時だけ載せる (原則②)。新規フィールド
  // 追加なので WIRE_V bump 不要 (旧版は未知キーとして無視 = forward/backward compat)。
  if (it?.kind === 'fraction' && it?.fracMode === 'numeric') o.fm = 1;
  return o;
}

function itemFromWire(w: WireItem | null | undefined): FormatItem {
  const kind = kindFromIdx(w?.k);
  const o: FormatItem = { label: String(w?.l || ''), kind };
  if (typeof w?.u === 'string') o.unit = w.u;
  if (typeof w?.nm === 'string') o.normal = w.nm;
  // fraction の入力方式を復元 (fm=1 → numeric、無し → 安全側 text)。
  if (kind === 'fraction') o.fracMode = w?.fm === 1 ? 'numeric' : 'text';
  return o;
}

// ============================
// FormatGroup (セット) ↔ wire (原則 ①: ID 直書きせず f 配列への index 参照)
//   formatGroupToWire(group, idToIndex):
//     idToIndex … format ID → 同 payload の f 配列での 1-based index を返す関数。
//                 解決できない (= payload に含めない format を参照している) ID は除外。
//   formatGroupFromWire(wire, formatsArr):
//     formatsArr … この payload で復元済みの formats 配列 (新 ID 採番済み)。
//                  wire の 1-based index を formatsArr[i-1].id に解決。範囲外は除外。
// ============================

export function formatGroupToWire(
  group: Partial<FormatGroup> | null | undefined,
  idToIndex: (id: string) => number | undefined,
): WireFormatGroup {
  const g = group || {};
  const resolve = (ids: unknown): number[] =>
    (Array.isArray(ids) ? (ids as string[]) : [])
      .map((id) => idToIndex(id))
      .filter((i): i is number => typeof i === 'number' && i >= 1);
  const o: WireFormatGroup = { n: String(g.name || '') };
  if (g.isDefault) o.d = 1;
  const fi = resolve(g.formatIds);
  if (fi.length) o.fi = fi;
  const df = resolve(g.defaultFormatIds);
  if (df.length) o.df = df;
  const xf = resolve(g.expandFormatIds);
  if (xf.length) o.xf = xf;
  return o;
}

/** 戻り値に id は含めない (受信側で新発番する契約)。 */
export function formatGroupFromWire(
  wire: WireFormatGroup | null | undefined,
  formatsArr: ReadonlyArray<Pick<Format, 'id'>>,
): Omit<FormatGroup, 'id'> {
  const w = wire || ({} as Partial<WireFormatGroup>);
  const arr = Array.isArray(formatsArr) ? formatsArr : [];
  const resolve = (idxs: unknown): string[] =>
    (Array.isArray(idxs) ? (idxs as number[]) : [])
      .map((i) => arr[i - 1]?.id)
      .filter((id): id is string => !!id);
  const formatIds = resolve(w.fi);
  const inFormat = new Set(formatIds);
  // df/xf は formatIds の部分集合に正規化 (normalizeSettings と同じ不変条件)
  const defaultFormatIds = resolve(w.df).filter((id) => inFormat.has(id));
  const expandFormatIds = resolve(w.xf).filter((id) => inFormat.has(id));
  return {
    name: String(w.n || ''),
    isDefault: !!w.d,
    formatIds,
    defaultFormatIds,
    expandFormatIds,
  };
}

// ============================
// Patient ↔ wire (HM/MM/SH 用)
//   content は呼び出し側が注入する (Phase 7 で patient[field] 直読みを廃止)。
//   HM では content=null/undefined で content を省く。
// ============================

export function patientToWire(
  patient: Patient | null | undefined,
  tagDict: readonly string[] | null,
  content: string | null | undefined,
): WirePatient {
  const p = patient || ({} as Partial<Patient>);
  const room = String(p.room || '').trim();
  const name = String(p.name || '').trim();
  const tagIdxs = tagsToWire(Array.isArray(p.tags) ? p.tags : [], tagDict);
  const hasContent = content != null; // HM は null/undefined (content 省略)
  const c = hasContent ? String(content).trim() : '';

  const isEmpty = !room && !name && tagIdxs.length === 0 && !c;
  if (isEmpty) return {};
  const obj: WirePatient = {};
  if (room) obj.r = room;
  if (name) obj.n = name;
  if (tagIdxs.length) obj.t = tagIdxs;
  if (hasContent) obj.c = c;
  return obj;
}

export interface DecodedWirePatient {
  room: string;
  name: string;
  tags: string[];
  content: string;
}

export function patientFromWire(
  wire: WirePatient | null | undefined,
  tagDict: readonly string[] | null | undefined,
): DecodedWirePatient {
  const w = wire || ({} as Partial<WirePatient>);
  return {
    room: String(w.r || ''),
    name: String(w.n || ''),
    tags: tagsFromWire(w.t, tagDict),
    content: String(w.c || ''),
  };
}
