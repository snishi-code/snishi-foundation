// 移植元: snishi-code-medical/hospital-rounds/src/store.js L40-434 (正規化部の忠実移植)
//
// 方針 (v1 から不変): **型不一致 → デフォルトに倒す + 未知フィールド温存 = forward compat**。
// 旧バージョンが新版で追加されたフィールドを読み戻し→再保存する経路で未知フィールドが
// 消失しないよう、known フィールドだけを validation 付きで上書きし、残りはそのまま持ち越す。

import {
  DEFAULT_CLEAR_TARGETS,
  DEFAULT_FORMATS,
  DEFAULT_FORMAT_GROUPS,
  DEFAULT_ITEM_KIND,
  DEFAULT_LABEL_SEP_OTHER,
  DEFAULT_LABEL_SEP_TEXT,
  DEFAULT_PATIENT_COUNT,
  DEFAULT_QR_ENCRYPTION,
  DEFAULT_QR_REDISTRIBUTION,
  DEFAULT_TAGS,
  DEFAULT_APP_TITLE,
  FORMAT_ITEM_KINDS,
  FORMAT_PANELS,
  STATUS,
  clone,
  type AppState,
  type DefaultFormatSeed,
  type Format,
  type FormatGroup,
  type FormatItem,
  type FormatPanel,
  type Patient,
  type PatientStatus,
  type Settings,
} from './types';
import { formatValueHasInput, repairGroupExpandInvariant } from './formatValues';

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object';
}

// ============================
// ID 採番 (QR 受信 (settingsQr / setQr) でも共有するため export)
// ============================

export function newFormatId(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return 'fmt_' + crypto.randomUUID();
  return 'fmt_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}

export function newGroupId(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID)
    return 'grp_' + crypto.randomUUID().slice(0, 8);
  return 'grp_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

// ============================
// Settings defaults & normalization
// ============================

function makeDefaultFormats(): Format[] {
  return DEFAULT_FORMATS.map((f) => {
    const fmt = normalizeFormat({ ...f, id: newFormatId() });
    if (!fmt) throw new Error('defaults.json: invalid default format seed');
    return fmt;
  });
}

/**
 * 既定フォーマットグループを、生成済み formats 配列の ID で組み立てる。
 * defaults.json は formatIndexes / defaultFormatIndexes で formats を index 参照
 * しているので (ID は実行時生成)、ここで index → 生成 ID に解決する。
 */
export function makeDefaultFormatGroups(formats: readonly Format[]): FormatGroup[] {
  const seeds = Array.isArray(DEFAULT_FORMAT_GROUPS) ? DEFAULT_FORMAT_GROUPS : [];
  const groups = seeds.map((g) => {
    const idxToId = (i: number): string | null => formats[i]?.id ?? null;
    const formatIds = (Array.isArray(g.formatIndexes) ? g.formatIndexes : [])
      .map(idxToId)
      .filter((id): id is string => !!id);
    const defaultFormatIds = (Array.isArray(g.defaultFormatIndexes) ? g.defaultFormatIndexes : [])
      .map(idxToId)
      .filter((id): id is string => !!id && formatIds.includes(id));
    // expandFormatIds = グループ内で「展開(A)」にするフォーマット。残りは「クイックアクセス(B)」
    const expandFormatIds = (Array.isArray(g.expandFormatIndexes) ? g.expandFormatIndexes : [])
      .map(idxToId)
      .filter((id): id is string => !!id && formatIds.includes(id));
    return {
      id: newGroupId(),
      name: String(g.name || ''),
      isDefault: !!g.isDefault,
      formatIds,
      defaultFormatIds,
      expandFormatIds,
    };
  });
  return ensureOneDefaultGroup(groups);
}

/**
 * formatGroups の不変条件: 1 つ以上あるなら「ちょうど 1 つ」が isDefault=true。
 * 0 個 / 複数 true なら先頭を default に昇格 (残りは false)。空配列はそのまま返す。
 */
export function ensureOneDefaultGroup(groups: FormatGroup[]): FormatGroup[] {
  if (!Array.isArray(groups) || !groups.length) return groups || [];
  const firstDefault = groups.findIndex((g) => g.isDefault);
  const keep = firstDefault >= 0 ? firstDefault : 0;
  groups.forEach((g, i) => {
    g.isDefault = i === keep;
  });
  return groups;
}

export function defaultSettings(): Settings {
  const formats = makeDefaultFormats();
  return {
    v: 1,
    formats,
    // フォーマットの「束」。患者ごとに 1 つ active group を設定すると、各パネルの strip
    // チップがそのグループ所属フォーマットだけに切り替わる。active 未指定の患者は
    // isDefault=true のグループに解決される。デフォルトグループは起動時に必ず 1 つ存在する。
    formatGroups: makeDefaultFormatGroups(formats),
    clearTargets: clone(DEFAULT_CLEAR_TARGETS),
    tags: clone(DEFAULT_TAGS),
    deviceId: '',
    // QR セキュリティ: kind 別の暗号化フラグ ("HM" → true/false)
    qrEncryption: clone(DEFAULT_QR_ENCRYPTION) as Settings['qrEncryption'],
    // QR 受信したデータの再配布制限: kind 別 ("restricted" | "free")
    qrRedistribution: clone(DEFAULT_QR_REDISTRIBUTION) as Settings['qrRedistribution'],
  };
}

/**
 * item は kind ごとに必要なフィールドだけ持つ:
 *   text     : { label, kind:"text",     normal }
 *   number   : { label, kind:"number",   unit   }
 *   fraction : { label, kind:"fraction", unit   }   // 日付 "5/20" もこれで入力
 */
export function normalizeFormatItem(
  item: unknown,
  panel: FormatPanel,
  formatName: string,
): FormatItem | null {
  if (!isRecord(item)) return null;
  const label = String(item.label ?? '').trim();
  const rawKind = typeof item.kind === 'string' ? item.kind : '';
  // 旧 "date" (カレンダー) は fraction に移行統合
  let kind: FormatItem['kind'];
  if (rawKind === 'date') kind = 'fraction';
  else
    kind = (FORMAT_ITEM_KINDS as readonly string[]).includes(rawKind)
      ? (rawKind as FormatItem['kind'])
      : DEFAULT_ITEM_KIND;
  // text / fraction は label 任意 (text=規定文、fraction=日付 "5/20" 等)。number のみ必須。
  if (!label && kind === 'number') return null;
  const out: FormatItem = { label, kind };
  if (kind === 'number' || kind === 'fraction') {
    out.unit = String(item.unit ?? '');
    if (kind === 'fraction') {
      // 分数の入力方式: "numeric"(数字キーボード・血圧 120/80) / "text"(英数字混在・抗菌薬 1g/1)。
      // 明示指定は尊重。未指定 (旧データ) は安全側 "text" に倒すが、**既定バイタルの BP 形状だけ**
      // (panel=O / 名前=バイタル / label=BP / unit=mmHg) は numeric に補正する (実ユーザーの既存
      // BP を text キーボードのままにしないための narrow 補正。保存後は fracMode が永続化される)。
      if (item.fracMode === 'numeric') out.fracMode = 'numeric';
      else if (item.fracMode === 'text') out.fracMode = 'text';
      else
        out.fracMode =
          panel === 'O' && formatName === 'バイタル' && label === 'BP' && out.unit === 'mmHg'
            ? 'numeric'
            : 'text';
    }
  } else {
    // text は normal を持つ
    out.normal = String(item.normal ?? '');
  }
  return out;
}

function inferLabelSepFromItems(items: readonly FormatItem[]): string {
  if (!items || !items.length) return DEFAULT_LABEL_SEP_OTHER;
  const allText = items.every((it) => it && it.kind === 'text');
  return allText ? DEFAULT_LABEL_SEP_TEXT : DEFAULT_LABEL_SEP_OTHER;
}

export function normalizeFormat(raw: unknown): Format | null {
  if (!isRecord(raw)) return null;
  const name = String(raw.name ?? '').trim();
  if (!name) return null;
  const panel: FormatPanel = (FORMAT_PANELS as readonly string[]).includes(raw.panel as string)
    ? (raw.panel as FormatPanel)
    : 'O';
  const id = typeof raw.id === 'string' && raw.id ? raw.id : newFormatId();
  // panel/name を渡すのは fraction の既定 BP 補正 (normalizeFormatItem の narrow heuristic) のため。
  const items = Array.isArray(raw.items)
    ? raw.items
        .map((it) => normalizeFormatItem(it, panel, name))
        .filter((it): it is FormatItem => !!it)
    : [];
  const joiner = typeof raw.joiner === 'string' ? raw.joiner : ', ';
  // labelSep: 明示指定優先、なければ items から推定
  const labelSep = typeof raw.labelSep === 'string' ? raw.labelSep : inferLabelSepFromItems(items);
  const tags = Array.isArray(raw.tags)
    ? raw.tags.filter((t): t is string => typeof t === 'string' && !!t.trim()).map((t) => String(t))
    : [];
  // titleWrap: 患者画面へ展開する時にフォーマット名を囲む括弧ペア (例 "（）")。
  // 空文字 = タイトル行を出さない。1 文字目=左括弧 / 2 文字目=右括弧。
  const titleWrap = typeof raw.titleWrap === 'string' ? raw.titleWrap : '';
  return { id, name, panel, joiner, labelSep, titleWrap, tags, items };
}

function appendDefaultFormatSeed(
  out: Settings,
  def: FormatGroup | null,
  seed: DefaultFormatSeed,
): Format | null {
  const formats = Array.isArray(out.formats) ? out.formats : (out.formats = []);
  const created = normalizeFormat({ ...seed, id: newFormatId() });
  if (!created) return null;
  formats.push(created);
  if (def) {
    if (!Array.isArray(def.formatIds)) def.formatIds = [];
    if (!Array.isArray(def.expandFormatIds)) def.expandFormatIds = [];
    if (!def.formatIds.includes(created.id)) def.formatIds.push(created.id);
    if (!def.expandFormatIds.includes(created.id)) def.expandFormatIds.push(created.id);
  }
  return created;
}

/**
 * Phase 3 (v1): タップ中心入力のため、各パネルに「既定フォーマットカード」を最低 1 つ常設
 * する。既存設定で欠けているパネルだけ DEFAULT_FORMATS から補い、デフォルトグループの
 * formatIds + expandFormatIds に加える。さらに `_backfillAlways` 付き seed は、同名同パネルが
 * 無ければ既存設定にも追加する (O 欄のシンプルな受け皿など)。非破壊・冪等: 同名があれば触らない。
 */
function backfillPanelDefaults(out: Settings): void {
  const formats = Array.isArray(out.formats) ? out.formats : (out.formats = []);
  const groups = Array.isArray(out.formatGroups) ? out.formatGroups : [];
  const def = groups.find((g) => g.isDefault) || groups[0] || null;
  const havePanels = new Set(formats.map((f) => f && f.panel));
  const seeds = Array.isArray(DEFAULT_FORMATS) ? DEFAULT_FORMATS : [];
  for (const panel of FORMAT_PANELS) {
    if (havePanels.has(panel)) continue;
    const seed = seeds.find((f) => f.panel === panel);
    if (!seed) continue;
    const created = appendDefaultFormatSeed(out, def, seed);
    if (!created) continue;
    havePanels.add(panel);
  }
  for (const seed of seeds) {
    if (!seed || !seed._backfillAlways) continue;
    const name = String(seed.name || '').trim();
    const panel = seed.panel;
    if (!name || !(FORMAT_PANELS as readonly string[]).includes(panel)) continue;
    const exists = formats.some(
      (f) => f && f.panel === panel && String(f.name || '').trim() === name,
    );
    if (!exists) appendDefaultFormatSeed(out, def, seed);
  }
}

/**
 * normalizeSettings が backfill で raw に無いフォーマットを補ったか (= 正規化結果を一度
 * 保存し直すべきか) の判定。initStore / switchUser が使う。
 */
export function hasBackfilledDefaultFormats(raw: unknown, normalized: Settings): boolean {
  const rawFormats = isRecord(raw) && Array.isArray(raw.formats) ? raw.formats : [];
  const rawKeys = new Set(
    rawFormats.map((f: unknown) => {
      const r = isRecord(f) ? f : {};
      return `${String(r.panel ?? '')}\n${String(r.name ?? '').trim()}`;
    }),
  );
  return (Array.isArray(normalized?.formats) ? normalized.formats : []).some(
    (f) => f && !rawKeys.has(`${f.panel || ''}\n${String(f.name || '').trim()}`),
  );
}

export function normalizeSettings(raw: unknown): Settings {
  const out = defaultSettings();
  if (!isRecord(raw)) return out;
  // 未知フィールド温存 (forward compatibility): 旧バージョンが新版で追加されたフィールドを
  // 読んだ時に消失しないように、out に無いキーは raw からそのまま持ち越す。
  // 既知フィールドは下で validation + デフォルト補完されて上書きされる。
  for (const k of Object.keys(raw)) {
    if (!(k in out)) (out as Record<string, unknown>)[k] = raw[k];
  }
  // formats: 新規登録された設定。空または欠落ならデフォルトを採用。
  if (Array.isArray(raw.formats)) {
    const cleaned = raw.formats.map(normalizeFormat).filter((f): f is Format => !!f);
    if (cleaned.length) out.formats = cleaned;
  }
  if (isRecord(raw.clearTargets)) {
    // clearTargets は panel キー (problem/S/O/A/P/shared) + statusXxx。
    // 各 panel は FORMAT_PANELS から、status は固定キーから validation する。
    const ct = raw.clearTargets;
    out.clearTargets = {};
    for (const panel of FORMAT_PANELS) {
      out.clearTargets[panel] =
        typeof ct[panel] === 'boolean' ? (ct[panel] as boolean) : !!DEFAULT_CLEAR_TARGETS[panel];
    }
    for (const k of ['statusYellow', 'statusGreen', 'statusGray', 'statusBlue']) {
      out.clearTargets[k] =
        typeof ct[k] === 'boolean' ? (ct[k] as boolean) : !!DEFAULT_CLEAR_TARGETS[k];
    }
  }
  if (Array.isArray(raw.tags)) {
    out.tags = raw.tags.filter((d): d is string => typeof d === 'string').map((d) => String(d));
  }
  if (typeof raw.deviceId === 'string') out.deviceId = raw.deviceId;
  if (Array.isArray(raw.formatGroups) && raw.formatGroups.length) {
    const groups: FormatGroup[] = raw.formatGroups
      .filter((g: unknown): g is Record<string, unknown> => isRecord(g) && typeof g.id === 'string')
      .map((g) => {
        const formatIds = Array.isArray(g.formatIds)
          ? g.formatIds.filter((x): x is string => typeof x === 'string').map(String)
          : [];
        // defaultFormatIds (規定文) / expandFormatIds (展開=A) は formatIds の部分集合に正規化
        const defaultFormatIds = Array.isArray(g.defaultFormatIds)
          ? g.defaultFormatIds
              .filter((x): x is string => typeof x === 'string' && formatIds.includes(x))
              .map(String)
          : [];
        const expandFormatIds = Array.isArray(g.expandFormatIds)
          ? g.expandFormatIds
              .filter((x): x is string => typeof x === 'string' && formatIds.includes(x))
              .map(String)
          : [];
        return {
          id: String(g.id),
          name: String(g.name || ''),
          isDefault: !!g.isDefault,
          formatIds,
          defaultFormatIds,
          expandFormatIds,
        };
      });
    // 「ちょうど 1 つ」が default の不変条件を担保。全件 malformed で空になったら再投入
    const fixed = ensureOneDefaultGroup(groups);
    out.formatGroups = fixed.length ? fixed : makeDefaultFormatGroups(out.formats);
  } else {
    // raw に formatGroups が無い / 空 → 正規化済みの out.formats に対してデフォルトグループを
    // 再構築 (= 必ず 1 つ存在の不変条件)。
    out.formatGroups = makeDefaultFormatGroups(out.formats);
  }
  // QR セキュリティ: v1 authority (qr-protocol.js) と同じくコード内固定で常時動作させる。
  // ユーザー設定 UI には露出しない (v1 v7.1+ と同方針)。保存データに旧 UI 由来の値が
  // 残っていても、ここで常にデフォルト (全 kind 暗号化 ON / HM・MM のみ再配布制限) に
  // 正規化する。患者画面の電子カルテ転記用 QR はこのマトリクス外 (常に平文)。
  out.qrEncryption = clone(DEFAULT_QR_ENCRYPTION) as Settings['qrEncryption'];
  out.qrRedistribution = clone(DEFAULT_QR_REDISTRIBUTION) as Settings['qrRedistribution'];
  // 各パネルに既定フォーマットカードを常設する補完 (formats + formatGroups が確定した後に実行)。
  backfillPanelDefaults(out);
  // 修正1: 各グループが「含むパネル」で展開フォーマットを最低 1 つ持つよう補修する。
  // 壊れた外部QR/旧データを読んでも、保存後に各パネルの展開カードが欠けない (ワンタップ入力を保証)。
  if (Array.isArray(out.formatGroups)) {
    for (const g of out.formatGroups) repairGroupExpandInvariant(g, out.formats);
  }
  return out;
}

// ============================
// Patient helpers
// ============================

function newPatientId(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}

export function makeDefaultPatient(): Patient {
  return {
    pid: newPatientId(),
    status: STATUS.NONE,
    name: '',
    room: '',
    tags: [],
    updatedAt: 0,
    transferredAt: 0,
    transferredTo: '',
    deletedAt: 0,
    deletedFromWorkspaceId: '',
    deletedFromWorkspaceLabel: '',
    activeFormatGroupId: '',
    formatValues: {},
    problems: [],
    origin: '',
  };
}

/**
 * 「空患者」= 開いた直後の未使用スロット相当: ステータスが NONE (白) で、かつ name/room/
 * tags/formatValues がすべて初期値 (pid と updatedAt は無視)。
 * YELLOW/GREEN/BLUE/GRAY はユーザーが明示的にステータスを付けた状態なので、たとえ他の
 * フィールドが空でも「触れたボタン」と見なし削除対象外 (特に GRAY は「診察・カルテ記載終了」
 * の重要マーカーなので消してはならない)。
 */
export function isPatientEmpty(p: Patient | null | undefined): boolean {
  if (!p) return false;
  if (p.status !== STATUS.NONE) return false;
  if (p.name) return false;
  if (p.room) return false;
  if (Array.isArray(p.tags) && p.tags.length > 0) return false;
  // 展開(A)フォーマットに入力値があれば空ではない (値は文字列でも { value, note }
  // オブジェクトでも formatValueHasInput が正しく判定する)
  if (p.formatValues && typeof p.formatValues === 'object') {
    for (const fid of Object.keys(p.formatValues)) {
      const vals = p.formatValues[fid];
      if (vals && typeof vals === 'object' && Object.values(vals).some(formatValueHasInput)) {
        return false;
      }
    }
  }
  // プロブレムリスト (患者ごとの独立データ) に入力があれば空ではない
  if (Array.isArray(p.problems) && p.problems.some((x) => String(x ?? '').trim())) return false;
  // 「移動済」マーカーが立っているスロットは履歴として残してあるので空ではない
  if (p.transferredAt) return false;
  // 「削除済み退避」マーカーが立っているスロット (Trash 内) も空ではない
  if (p.deletedAt) return false;
  return true;
}

const VALID_STATUSES: readonly string[] = [
  STATUS.NONE,
  STATUS.YELLOW,
  STATUS.GREEN,
  STATUS.GRAY,
  STATUS.BLUE,
];

export function normalizePatientArray(arr: readonly unknown[] | null | undefined): Patient[] {
  const len = arr && arr.length ? arr.length : DEFAULT_PATIENT_COUNT;
  const out = new Array<Patient>(len);
  for (let i = 0; i < len; i++) {
    const rawEntry = arr ? arr[i] : null;
    const r: Record<string, unknown> | null = isRecord(rawEntry) ? rawEntry : null;
    const d = makeDefaultPatient();
    // 未知フィールド温存 (forward compatibility): r をまず spread し、その後 known フィールドを
    // validation 付きで上書きする。(未知フィールドの妥当性は保証しないので、誤フィールドや
    // 混入データもそのまま保持されることに留意。パイロット前は許容範囲)
    const base = r ? { ...r } : {};
    out[i] = {
      ...base,
      pid: r && typeof r.pid === 'string' && r.pid ? r.pid : d.pid,
      status:
        r && typeof r.status === 'string' && VALID_STATUSES.includes(r.status)
          ? (r.status as PatientStatus)
          : d.status,
      name: r && typeof r.name === 'string' ? r.name : d.name,
      room: r && typeof r.room === 'string' ? r.room : d.room,
      tags:
        r && Array.isArray(r.tags)
          ? r.tags
              .filter((t): t is string => typeof t === 'string' && !!t.trim())
              .map((t) => String(t))
          : [],
      updatedAt: r && typeof r.updatedAt === 'number' ? r.updatedAt : 0,
      transferredAt: r && typeof r.transferredAt === 'number' ? r.transferredAt : 0,
      transferredTo: r && typeof r.transferredTo === 'string' ? r.transferredTo : '',
      deletedAt: r && typeof r.deletedAt === 'number' ? r.deletedAt : 0,
      deletedFromWorkspaceId:
        r && typeof r.deletedFromWorkspaceId === 'string' ? r.deletedFromWorkspaceId : '',
      deletedFromWorkspaceLabel:
        r && typeof r.deletedFromWorkspaceLabel === 'string' ? r.deletedFromWorkspaceLabel : '',
      activeFormatGroupId:
        r && typeof r.activeFormatGroupId === 'string' ? r.activeFormatGroupId : '',
      formatValues:
        r && isRecord(r.formatValues) ? (r.formatValues as Patient['formatValues']) : {},
      problems:
        r && Array.isArray(r.problems)
          ? r.problems.filter((x): x is string => typeof x === 'string').map((x) => String(x))
          : [],
      origin: r && r.origin === 'external' ? 'external' : '',
    };
  }
  return out;
}

/**
 * import/export から呼ばれる。bundle 形式 / 配列 / { patients: [...] } のいずれかを
 * appState 形に正規化する薄いラッパ。defaultTitle は UI 層が i18n 文字列を渡してよい。
 */
export function normalizeLoaded(raw: unknown, defaultTitle: string = DEFAULT_APP_TITLE): AppState {
  const rec = isRecord(raw) ? raw : null;
  const arr =
    rec && Array.isArray(rec.patients) ? rec.patients : Array.isArray(raw) ? (raw as unknown[]) : null;
  return {
    v: 3,
    title: rec && typeof rec.title === 'string' ? rec.title : defaultTitle,
    patients: normalizePatientArray(arr),
    recvMemo: rec && typeof rec.recvMemo === 'string' ? rec.recvMemo : '',
    recvShared: rec && typeof rec.recvShared === 'string' ? rec.recvShared : '',
  };
}
