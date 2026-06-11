// 移植元: snishi-code-medical/hospital-rounds/src/features/formats.js の純ロジック部
//          (expandedFormatsForPanel / quickAccessFormatsForPanel / shownCardFormatsForPanel /
//           cardItemDisplay / writeFormatValue / formatTagsToAdd / applyFormatTags)
//
// 患者画面のフォーマット表示・書き込みヘルパ。DOM 依存を外し store/patient を引数で受ける。

import {
  DEFAULT_ITEM_KIND,
  type Format,
  type FormatGroup,
  type FormatItem,
  type FormatPanel,
  type Patient,
  type Settings,
} from '../domain/types';
import {
  composeFormatFromValues,
  computeFormatTagsToAdd,
  mergeTagsAdd,
  readNumericEntry,
  readTextValue,
} from '../domain/formatValues';
import { formatsForPanel, getDefaultFormatGroup, resolveActiveGroup } from '../domain/payload';
import type { HrStore } from '../data/store';

export { formatsForPanel, resolveActiveGroup };

/** 実効グループの「展開(A)」フォーマット (panel フィルタ済、expandFormatIds 順)。 */
export function expandedFormatsForPanel(
  panel: FormatPanel,
  group: FormatGroup | null,
  settings: Settings,
): Format[] {
  if (!group) return [];
  const byId = new Map(formatsForPanel(panel, settings).map((f) => [f.id, f]));
  const out: Format[] = [];
  for (const fid of group.expandFormatIds || []) {
    const f = byId.get(fid);
    if (f) out.push(f);
  }
  return out;
}

/** 展開フォーマットが無いパネルはデフォルトグループへフォールバック (ワンタップ保証)。 */
export function effectiveExpandedFormatsForPanel(
  panel: FormatPanel,
  group: FormatGroup | null,
  settings: Settings,
): Format[] {
  let out = expandedFormatsForPanel(panel, group, settings);
  if (!out.length) {
    const def = getDefaultFormatGroup(settings);
    if (def && (!group || def.id !== group.id)) out = expandedFormatsForPanel(panel, def, settings);
  }
  return out;
}

/** 実効グループの「クイックアクセス(B)」= グループ内かつ展開でない (チップ表示)。 */
export function quickAccessFormatsForPanel(
  panel: FormatPanel,
  group: FormatGroup | null,
  settings: Settings,
): Format[] {
  if (!group) return [];
  const expand = new Set(group.expandFormatIds || []);
  const byId = new Map(formatsForPanel(panel, settings).map((f) => [f.id, f]));
  const out: Format[] = [];
  for (const fid of group.formatIds || []) {
    if (expand.has(fid)) continue;
    const f = byId.get(fid);
    if (f) out.push(f);
  }
  return out;
}

/**
 * 患者画面にカードとして並ぶフォーマット: 常時出す展開カード + 値が入っている非展開
 * フォーマット (クイック/ランチャー入力で「展開」されたもの)。☰ ランチャーの除外判定と
 * 同じ集合を参照する単一ソース。
 */
export function shownCardFormatsForPanel(
  panel: FormatPanel,
  patient: Patient | null | undefined,
  settings: Settings,
): Format[] {
  if (!patient) return [];
  const fv = patient.formatValues && typeof patient.formatValues === 'object' ? patient.formatValues : {};
  const group = resolveActiveGroup(patient, settings);
  const expand = effectiveExpandedFormatsForPanel(panel, group, settings);
  const shown = new Set(expand.map((f) => f.id));
  const extras = formatsForPanel(panel, settings).filter(
    (f) => !shown.has(f.id) && composeFormatFromValues(f, fv[f.id] || {}).hasValue,
  );
  return [...expand, ...extras];
}

/** カード上の値表示テキストと空判定 (number/fraction は unit + note 付き)。 */
export function cardItemDisplay(
  item: FormatItem,
  stored: unknown,
): { text: string; empty: boolean } {
  const kind = item.kind || DEFAULT_ITEM_KIND;
  if (kind === 'number') {
    const { value, note } = readNumericEntry(stored);
    const v = value.trim();
    if (!v) return { text: '', empty: true };
    return { text: `${v}${item.unit || ''}${note.trim() ? ' ' + note.trim() : ''}`, empty: false };
  }
  if (kind === 'fraction') {
    const { value, note } = readNumericEntry(stored);
    if (!value.replace('/', '').trim()) return { text: '', empty: true };
    return { text: `${value}${item.unit || ''}${note.trim() ? ' ' + note.trim() : ''}`, empty: false };
  }
  const v = readTextValue(stored).trim();
  if (!v) return { text: '', empty: true };
  return { text: v, empty: false };
}

/** formatValues[format.id][itemIndex] へ値を書く (markUpdated + scheduleSave まで)。 */
export function writeFormatValue(
  store: HrStore,
  patient: Patient,
  patientNo: number,
  format: Format,
  itemIndex: number,
  value: unknown,
): void {
  if (!patient.formatValues || typeof patient.formatValues !== 'object') patient.formatValues = {};
  let slot = patient.formatValues[format.id];
  if (!slot || typeof slot !== 'object') {
    slot = {};
    patient.formatValues[format.id] = slot;
  }
  slot[String(itemIndex)] = value;
  store.markUpdated(patientNo);
  store.scheduleSave();
}

/** この操作で「新規に付くタグ」delta (設定にあるタグのみ・既存は除く)。Undo へ渡す。 */
export function formatTagsToAdd(format: Format, patient: Patient, settings: Settings): string[] {
  return computeFormatTagsToAdd(format.tags, settings.tags, patient.tags);
}

/** format.tags を患者タグへ merge する (重複追加なし)。戻り値 = 実際に付けた delta。 */
export function applyFormatTags(format: Format, patient: Patient, settings: Settings): string[] {
  const toAdd = formatTagsToAdd(format, patient, settings);
  if (!toAdd.length) return [];
  patient.tags = mergeTagsAdd(patient.tags, toAdd);
  return toAdd;
}
