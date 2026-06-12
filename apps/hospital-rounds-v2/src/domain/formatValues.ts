// 移植元: snishi-code-medical/hospital-rounds/src/features/format-values.js (忠実移植・DOM 非依存)
//
// 展開(A)フォーマットの患者入力値 (patient.formatValues) の純データロジック。
//   formatValues[formatId] = { [itemIndex]: 値 }
//
// 各 item の保存形:
//   text     : 旧 = 文字列 / 新 = { value, source }  (source ∈ "preset" | "manual")
//   number   : 旧 = 文字列 "96" / 新 = { value:"96", note:"O2 2L" }
//   fraction : 旧 = 文字列 "120/53" / 新 = { value:"120/53", note:"…" }
//
// note は「フォーマット定義」ではなく「患者ごとの入力値」(SpO2 の酸素投与量など短文注記)。
// 旧文字列値は note="" として読む (後方互換)。normalize / payload / undo が共有する。

import {
  DEFAULT_ITEM_KIND,
  DEFAULT_LABEL_SEP_OTHER,
  FORMAT_PANELS,
  type Format,
  type FormatGroup,
  type FormatPanel,
  type Patient,
} from './types';

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

// ============================
// text item の provenance (Phase 6)
//
// text item の保存値は「正常文由来 (preset)」か「手入力由来 (manual)」かを区別する。
// これにより、ワンタップ正常チェックが手入力した臨床メモを誤って上書き/消去しない。
// 正常文の基準は「呼び出し側が渡す現在の format/item の normal」= settings.formats が正本。
// QR 平文出力 (composeFormatFromValues) は value だけを出すので source は wire に出ない。
// ============================

export type TextSource = 'empty' | 'preset' | 'manual';

/** text 保存値から「現在の値文字列」を取り出す (object なら .value、文字列ならそのまま)。 */
export function readTextValue(stored: unknown): string {
  if (isPlainObject(stored)) return String(stored.value ?? '');
  return String(stored ?? '');
}

/**
 * text 保存値を { value, source } に正規化する。明示 source を持つ object は信頼し、
 * legacy 文字列は現在の正常文と比較して source を推論する (空→empty / =normal→preset /
 * それ以外→manual)。
 */
export function normalizeTextEntry(
  stored: unknown,
  currentNormal: unknown,
): { value: string; source: TextSource } {
  const normal = String(currentNormal ?? '');
  if (isPlainObject(stored)) {
    const value = String(stored.value ?? '');
    const src = stored.source;
    if (src === 'preset' || src === 'manual') {
      return { value, source: value === '' ? 'empty' : src };
    }
    // source 欠落の object は legacy 同様に推論
    return { value, source: value === '' ? 'empty' : value === normal ? 'preset' : 'manual' };
  }
  const value = String(stored ?? '');
  return { value, source: value === '' ? 'empty' : value === normal ? 'preset' : 'manual' };
}

export type PresetToggleDecision =
  | { action: 'write'; value: { value: string; source: 'preset' } }
  | { action: 'clear'; value: '' }
  | { action: 'openEditor' };

/**
 * ワンタップ正常チェックの判定 (純関数・ミューテーションしない)。
 *   empty → write / preset かつ値が現正常文 → clear / それ以外 → openEditor。
 * 「設定で正常文を変更し、保存済み preset の値が現 normal と一致しない」場合も openEditor
 * (黙って上書き/消去せず明示編集に委ねる = fail-safe)。
 */
export function decidePresetToggle(stored: unknown, currentNormal: unknown): PresetToggleDecision {
  const normal = String(currentNormal ?? '');
  const { value, source } = normalizeTextEntry(stored, normal);
  if (source === 'empty') return { action: 'write', value: { value: normal, source: 'preset' } };
  if (source === 'preset' && value === normal) return { action: 'clear', value: '' };
  return { action: 'openEditor' };
}

/**
 * ポップアップ/インライン編集の保存時に text item の確定値を作る。draft が prev と変わった
 * item だけ manual entry 化し、未変更は既存 entry を保持する (未タッチの preset を manual に
 * 降格させない)。空は "" (未入力)。
 */
export function commitDraftTextEntry(prevStored: unknown, draftValue: unknown): unknown {
  const next = readTextValue(draftValue);
  if (next === '') return '';
  if (next === readTextValue(prevStored)) return prevStored; // 未変更は出所を保持
  return { value: next, source: 'manual' };
}

// ============================
// フォーマット自動付与タグの delta (Phase 6 / Undo 対応)
//
// フォーマット入力時に format.tags を患者タグへ merge する。Undo で「入力は戻したのに
// タグだけ残る」を防ぐため、その操作で **新規に付くタグだけ** を delta として扱い、
// Undo で除去 / Redo で再付与する。タグ列全体を巻き戻すと間に手編集したタグを失う
// (= 識別情報のサイレント巻き戻り) ため、必ず delta 単位で扱う。
// ============================

/** fmtTags のうち known に存在し existing にまだ無いもの = この操作で新規に付くタグ。 */
export function computeFormatTagsToAdd(
  fmtTags: unknown,
  knownTags: unknown,
  existingTags: unknown,
): string[] {
  const known = new Set(Array.isArray(knownTags) ? (knownTags as string[]) : []);
  const existing = new Set(Array.isArray(existingTags) ? (existingTags as string[]) : []);
  const out: string[] = [];
  const seen = new Set<string>();
  for (const tg of Array.isArray(fmtTags) ? (fmtTags as string[]) : []) {
    if (!known.has(tg) || existing.has(tg) || seen.has(tg)) continue;
    seen.add(tg);
    out.push(tg);
  }
  return out;
}

/** tags に toAdd を追加 (既存はスキップ・順序保持)。新しい配列を返す。 */
export function mergeTagsAdd(tags: unknown, toAdd: unknown): string[] {
  const out = Array.isArray(tags) ? (tags as string[]).slice() : [];
  const set = new Set(out);
  for (const tg of Array.isArray(toAdd) ? (toAdd as string[]) : []) {
    if (!set.has(tg)) {
      set.add(tg);
      out.push(tg);
    }
  }
  return out;
}

/** tags から toRemove を除く。新しい配列を返す。 */
export function mergeTagsRemove(tags: unknown, toRemove: unknown): string[] {
  const drop = new Set(Array.isArray(toRemove) ? (toRemove as string[]) : []);
  return (Array.isArray(tags) ? (tags as string[]) : []).filter((tg) => !drop.has(tg));
}

/** number/fraction の保存値を { value, note } に正規化する。旧文字列値も読める。 */
export function readNumericEntry(stored: unknown): { value: string; note: string } {
  if (isPlainObject(stored)) {
    return { value: String(stored.value ?? ''), note: String(stored.note ?? '') };
  }
  return { value: String(stored ?? ''), note: '' };
}

/**
 * 1 つの保存値に「入力がある」か判定する (空患者判定・サニタイズ用)。
 *   number/fraction (object): value (スラッシュ除去後) か note のどちらかに文字があれば true
 *   文字列 (text / 旧 number / 旧 fraction): スラッシュ除去後に文字があれば true
 */
export function formatValueHasInput(v: unknown): boolean {
  if (isPlainObject(v)) {
    return !!(
      String(v.value ?? '')
        .replace('/', '')
        .trim() || String(v.note ?? '').trim()
    );
  }
  return !!String(v ?? '')
    .replace('/', '')
    .trim();
}

// ============================
// 設定編集 (フォーマット item の削除/並び替え/種類変更) の破壊防止判定
//
// 患者の formatValues は item index に紐づくため、入力済みデータがある format の item を
// 削除・並び替えすると既存入力の意味ずれ・消失が起きる。dataIndices = Set<number> | null。
// null は「不明 (収集中 / 収集失敗)」= fail-closed で全ブロック扱い。
// ============================

/** patients[].formatValues[formatId] のうち入力がある item index の集合を into に集める。 */
export function collectFormatItemIndicesWithData(
  patients: readonly Patient[] | null | undefined,
  formatId: string,
  into: Set<number> = new Set(),
): Set<number> {
  for (const p of Array.isArray(patients) ? patients : []) {
    const fv = p?.formatValues;
    const vals = fv && typeof fv === 'object' ? fv[formatId] : undefined;
    if (!vals || typeof vals !== 'object') continue;
    for (const k of Object.keys(vals)) {
      const idx = Number(k);
      if (!Number.isInteger(idx) || idx < 0) continue;
      if (formatValueHasInput(vals[k])) into.add(idx);
    }
  }
  return into;
}

/** kind (種類) 変更可否: その index に入力があれば不可 (保存形が kind に依存するため)。 */
export function formatItemKindChangeBlocked(dataIndices: Set<number> | null, i: number): boolean {
  if (!(dataIndices instanceof Set)) return true; // 不明は fail-closed
  return dataIndices.has(i);
}

// ============================
// フォーマット item の並び替え/削除に伴う保存値の同時変換 (2026-06 指示書)
//
// 旧方針 (入力済みならブロック) から、「設定定義と全患者の formatValues[formatId] を
// 同じ移動/削除で変換し、ラベルと保存値の対応を保つ」方針へ変更。
// mapping[newIndex] = oldIndex (新規 item は -1)。kind 変更は保存形が変わるため
// 引き続き formatItemKindChangeBlocked でブロックする。
// ============================

/** mapping に従って 1 患者分の slot ({ oldIndex: 値 }) を新 index 形へ組み替える。 */
export function remapFormatValuesSlot(
  slot: unknown,
  mapping: readonly number[],
): Record<string, unknown> {
  const src: Record<string, unknown> = isPlainObject(slot) ? slot : {};
  const out: Record<string, unknown> = {};
  mapping.forEach((oldIdx, newIdx) => {
    if (typeof oldIdx !== 'number' || oldIdx < 0) return; // 新規 item は値なし
    const key = String(oldIdx);
    if (key in src) out[String(newIdx)] = src[key];
  });
  return out;
}

/** mapping が「入力済み index」に与える影響 (移動の有無と、削除される index 一覧)。 */
export function remapEffectOnData(
  mapping: readonly number[],
  dataIndices: ReadonlySet<number>,
): { moved: boolean; removed: number[] } {
  const newPosByOld = new Map<number, number>();
  mapping.forEach((oldIdx, newIdx) => {
    if (typeof oldIdx === 'number' && oldIdx >= 0) newPosByOld.set(oldIdx, newIdx);
  });
  let moved = false;
  const removed: number[] = [];
  for (const idx of dataIndices) {
    const pos = newPosByOld.get(idx);
    if (pos === undefined) removed.push(idx);
    else if (pos !== idx) moved = true;
  }
  removed.sort((a, b) => a - b);
  return { moved, removed };
}

/** patients それぞれの formatValues[formatId] を mapping で組み替える。変更患者数を返す。 */
export function remapPatientsFormatValues(
  patients: readonly Patient[] | null | undefined,
  formatId: string,
  mapping: readonly number[],
): number {
  let changed = 0;
  for (const p of Array.isArray(patients) ? patients : []) {
    const fv = p?.formatValues;
    if (!fv || typeof fv !== 'object') continue;
    const slot = fv[formatId];
    if (!slot || typeof slot !== 'object' || !Object.keys(slot).length) continue;
    fv[formatId] = remapFormatValuesSlot(slot, mapping);
    changed++;
  }
  return changed;
}

/**
 * 値 + 注記を組み合わせて「ラベル <labelSep> 値」を作る。注記がある場合だけ末尾に
 * 半角スペース + 注記を付ける (例: "SpO2 96% O2 2L")。label が空なら値だけ出す。
 */
export function combineLabelValueMemo(
  label: unknown,
  labelSep: string,
  value: unknown,
  memo: unknown,
): string {
  const lab = String(label ?? '').trim();
  const val = String(value ?? '').trim();
  const m = String(memo ?? '').trim();
  let body: string;
  if (lab) body = `${lab}${labelSep}${val}`;
  else body = val;
  if (m) body += ` ${m}`;
  return body;
}

/**
 * 保存値 (formatValues[fid] = { itemIndex: 値 }) からフォーマット出力テキストを組み立てる。
 * 展開(A)フォーマットの出力・流し込みで使う。fraction 値は "a/b" 文字列。
 * number/fraction は note を末尾に付ける。
 */
export function composeFormatFromValues(
  format: Format,
  values: unknown,
): { text: string; hasValue: boolean } {
  const vals: Record<string, unknown> = isPlainObject(values) ? values : {};
  const labelSep = typeof format.labelSep === 'string' ? format.labelSep : DEFAULT_LABEL_SEP_OTHER;
  const parts: string[] = [];
  (format.items || []).forEach((item, i) => {
    const kind = item.kind || DEFAULT_ITEM_KIND;
    const rawEntry = vals[String(i)];
    if (kind === 'number') {
      const { value, note } = readNumericEntry(rawEntry);
      const v = value.trim();
      if (!v) return; // 値なし注記だけは出力しない (文脈不明になるため)
      parts.push(combineLabelValueMemo(item.label, labelSep, `${v}${item.unit || ''}`, note));
    } else if (kind === 'fraction') {
      const { value, note } = readNumericEntry(rawEntry);
      // "a/b" 両側空 ("" or "/") はスキップ
      if (!value.replace('/', '').trim()) return;
      parts.push(combineLabelValueMemo(item.label, labelSep, `${value}${item.unit || ''}`, note));
    } else {
      // text: provenance (preset/manual) は内部判定専用。出力は value だけ (source は wire に出さない)。
      const value = readTextValue(rawEntry).trim();
      if (!value) return;
      const lab = String(item.label || '').trim();
      parts.push(lab ? `${lab}${labelSep}${value}` : value);
    }
  });
  const body = parts.join(format.joiner || ', ');
  const titleWrap = typeof format.titleWrap === 'string' ? format.titleWrap : '';
  let text = body;
  if (titleWrap) {
    const L = titleWrap[0] || '';
    const R = titleWrap[1] || '';
    const titleLine = `${L}${format.name}${R}`;
    text = body ? `${titleLine}\n${body}` : titleLine;
  }
  return { text, hasValue: parts.length > 0 };
}

// ============================
// パネル単位クリア (診察開始) — settings.formats[].panel を正本に formatId を解決する。
// ============================

/** settings.formats のうち panel に属する formatId 一覧 (panel が正本)。 */
export function formatIdsForPanel(panel: FormatPanel, formats: readonly Format[]): string[] {
  if (!Array.isArray(formats)) return [];
  return formats.filter((f) => f && f.panel === panel).map((f) => f.id);
}

/** panel に属する展開フォーマット値だけを患者から削除する (他 panel の値は触らない)。 */
export function clearPanelFormatValues(
  patient: Patient,
  panel: FormatPanel,
  formats: readonly Format[],
): void {
  if (!patient || !patient.formatValues || typeof patient.formatValues !== 'object') return;
  for (const fid of formatIdsForPanel(panel, formats)) {
    delete patient.formatValues[fid];
  }
}

/** panel に所属する展開フォーマット値を一括クリアする (診察開始)。6パネル共通の単一ソース。 */
export function clearPanelClinicalInput(
  patient: Patient,
  panel: FormatPanel,
  formats: readonly Format[],
): void {
  if (!patient) return;
  clearPanelFormatValues(patient, panel, formats);
}

// ============================
// 展開(expand)フォーマットの不変条件 (Phase 3 follow-up / 修正1)
//
// 「ワンタップ診察入力」を成立させるため、患者に適用しうる formatGroup は「含むパネル」
// ごとに最低 1 つの展開フォーマットを持つ必要がある。あるパネルのフォーマットを 1 つも
// 含まないグループは対象外 (患者画面ではデフォルトグループの expand へフォールバック)。
// ============================

/** group の formatIds のうち、指定 panel に属するフォーマット一覧 (formats が正本)。 */
export function panelFormatsInGroup(
  group: Pick<FormatGroup, 'formatIds'> | null | undefined,
  formats: readonly Format[],
  panel: FormatPanel,
): Format[] {
  const ids = new Set(Array.isArray(group?.formatIds) ? group.formatIds : []);
  return (Array.isArray(formats) ? formats : []).filter(
    (f) => f && f.panel === panel && ids.has(f.id),
  );
}

/** group が指定 panel で「展開(expand)」フォーマットを 1 つ以上持つか。 */
export function groupHasExpandForPanel(
  group: Pick<FormatGroup, 'formatIds' | 'expandFormatIds'> | null | undefined,
  formats: readonly Format[],
  panel: FormatPanel,
): boolean {
  const expand = new Set(Array.isArray(group?.expandFormatIds) ? group.expandFormatIds : []);
  return panelFormatsInGroup(group, formats, panel).some((f) => expand.has(f.id));
}

/** group が「含むパネル」のうち、展開フォーマットが欠けているパネル一覧。 */
export function missingExpandPanelsForGroup(
  group: Pick<FormatGroup, 'formatIds' | 'expandFormatIds'>,
  formats: readonly Format[],
): FormatPanel[] {
  const out: FormatPanel[] = [];
  for (const panel of FORMAT_PANELS) {
    const inPanel = panelFormatsInGroup(group, formats, panel);
    if (inPanel.length && !groupHasExpandForPanel(group, formats, panel)) out.push(panel);
  }
  return out;
}

/** group が「含む全パネル」で展開フォーマットを持つか (= 不変条件を満たすか)。 */
export function validateGroupHasExpandedFormatForEveryPanel(
  group: Pick<FormatGroup, 'formatIds' | 'expandFormatIds'>,
  formats: readonly Format[],
): boolean {
  return missingExpandPanelsForGroup(group, formats).length === 0;
}

/**
 * group 内で「ある panel の最後の展開フォーマット」が formatId かどうか
 * (= これを expand から外すとその panel の expand が 0 になる)。編集 UI のブロック判定。
 */
export function isLastExpandInPanel(
  group: Pick<FormatGroup, 'expandFormatIds'> | null | undefined,
  formats: readonly Format[],
  formatId: string,
  panel: FormatPanel,
): boolean {
  const byId = new Map((Array.isArray(formats) ? formats : []).map((f) => [f.id, f]));
  const expandInPanel = (Array.isArray(group?.expandFormatIds) ? group.expandFormatIds : []).filter(
    (id) => byId.get(id)?.panel === panel,
  );
  return expandInPanel.length === 1 && expandInPanel[0] === formatId;
}

/**
 * format を削除すると、いずれかのグループのいずれかのパネルで「最後の展開フォーマット」が
 * 失われる (= expand が 0 になる) なら true。設定画面の削除ブロックに使う。
 */
export function formatRemovalBreaksAnyGroupExpand(
  formatId: string,
  formats: readonly Format[],
  groups: readonly FormatGroup[],
): boolean {
  const fmt = (Array.isArray(formats) ? formats : []).find((f) => f && f.id === formatId);
  if (!fmt) return false;
  for (const g of Array.isArray(groups) ? groups : []) {
    if (isLastExpandInPanel(g, formats, formatId, fmt.panel)) return true;
  }
  return false;
}

/**
 * group の各パネルで展開フォーマットが欠けている場合、そのパネルに属する formatIds の先頭を
 * expand に昇格して補修する (壊れた外部QR/旧データの救済)。group を in-place で直して返す。
 */
export function repairGroupExpandInvariant<
  T extends Pick<FormatGroup, 'formatIds' | 'expandFormatIds'>,
>(group: T | null | undefined, formats: readonly Format[]): T | null | undefined {
  if (!group) return group;
  if (!Array.isArray(group.expandFormatIds)) group.expandFormatIds = [];
  const byId = new Map((Array.isArray(formats) ? formats : []).map((f) => [f.id, f]));
  for (const panel of FORMAT_PANELS) {
    const inPanel = (Array.isArray(group.formatIds) ? group.formatIds : []).filter(
      (id) => byId.get(id)?.panel === panel,
    );
    if (!inPanel.length) continue;
    if (inPanel.some((id) => group.expandFormatIds.includes(id))) continue;
    const first = inPanel[0];
    if (first) group.expandFormatIds.push(first); // そのパネルの先頭フォーマットを展開に昇格
  }
  return group;
}
