// 移植元: snishi-code-medical/hospital-rounds/src/features/qr-settings.js (applySettings)
//          + qr-format.js (applyReceivedFormat) + qr-set.js (applyReceivedSet)
//
// ST/FMT/FS 受信の「適用」部 (確認ダイアログの後段)。共通の fail-closed 規約:
//   適用 → saveSettingsOrThrow() を await → 失敗は in-memory をロールバックして
//   { ok:false } (成功表示・クローズへ進ませない)。
// UI から分離してテスト可能にする (confirm 文言の組み立てもここ)。

import { uniqueName } from '@snishi/foundation/qr/protocol';
import type { Format, FormatGroup, Settings } from '../../domain/types';
import { ensureOneDefaultGroup, newFormatId, newGroupId } from '../../domain/normalize';
import { repairGroupExpandInvariant } from '../../domain/formatValues';
import type { DecodedSettingsPatch } from '../../qr/settingsQr';
import type { DecodedSetPayload } from '../../qr/setQr';
import type { HrStore } from '../../data/store';
import { t } from '../../i18n/strings';

export type ApplyResult = { ok: true; message: string } | { ok: false; message: string };

// ============================
// ST: 設定全体の置換 (formats + formatGroups + clearTargets + tags)
// ============================

/** ST 受信の確認ダイアログ本文 (summary 付き)。 */
export function settingsImportConfirmBody(patch: DecodedSettingsPatch): string {
  const summary: string[] = [];
  if (Array.isArray(patch.tags)) summary.push(t('qrSettings.summary.tags', { n: patch.tags.length }));
  if (Array.isArray(patch.formats)) summary.push(t('qrSettings.summary.formats', { n: patch.formats.length }));
  if (Array.isArray(patch.formatGroups)) {
    summary.push(t('qrSettings.summary.sets', { n: patch.formatGroups.length }));
  }
  if (patch.clearTargets) summary.push(t('qrSettings.summary.clearTargets'));
  const summaryText = summary.length ? `（${summary.join(', ')}）` : '';
  return t('qrSettings.import.confirm', { summary: summaryText });
}

// formats と formatGroups はセットで置換 (groups は format ID を参照するため不可分)。
const ST_APPLIED_FIELDS = ['formats', 'formatGroups', 'clearTargets', 'tags'] as const;

/** ST を適用する。fail-closed: 保存失敗は in-memory を戻して中断。 */
export async function applySettingsPatch(store: HrStore, patch: DecodedSettingsPatch): Promise<ApplyResult> {
  const prev = store.getSettings(); // 保存失敗時のロールバック用
  const next: Settings = { ...prev };
  for (const k of ST_APPLIED_FIELDS) {
    if (patch[k] !== undefined) (next as Record<string, unknown>)[k] = patch[k];
  }
  // 取り込んだ全セットを「含むパネルで展開フォーマットを最低 1 つ持つ」よう補修
  // (setSettings は normalize を通さないので、壊れた外部設定が保存される前に直す)。
  if (Array.isArray(next.formatGroups) && Array.isArray(next.formats)) {
    for (const g of next.formatGroups) repairGroupExpandInvariant(g, next.formats);
  }
  store.setSettings(next);
  try {
    await store.saveSettingsOrThrow();
  } catch (e) {
    console.error('qr settings import: save failed:', e);
    store.setSettings(prev);
    return { ok: false, message: t('qr.recv.save.failed') };
  }
  return { ok: true, message: t('qrSettings.imported.alert') };
}

// ============================
// FMT: フォーマット 1 件の追加 (常に新規・同名 rename・未登録タグ無視)
// ============================

export interface PreparedFormat {
  format: Format;
  confirmBody: string;
}

/** FMT 受信の取込内容を確定する (rename / タグ除外 / 確認文言)。 */
export function prepareReceivedFormat(store: HrStore, decoded: Omit<Format, 'id'> & { id?: string }): PreparedFormat {
  const settings = store.getSettings();
  const all = Array.isArray(settings.formats) ? settings.formats : [];
  const baseName = String(decoded.name || t('qrFormat.untitled')).trim();
  const finalName = uniqueName(
    baseName,
    all.map((f) => f.name),
  );
  const knownTags = new Set(Array.isArray(settings.tags) ? settings.tags : []);
  const allTags = Array.isArray(decoded.tags) ? decoded.tags : [];
  const safeTags = allTags.filter((tg) => knownTags.has(tg));
  const droppedTags = allTags.filter((tg) => !knownTags.has(tg));

  const summaryParts = [
    t('qrFormat.summary.panel', { panel: decoded.panel || 'O' }),
    t('qrFormat.summary.items', { n: (decoded.items || []).length }),
  ];
  if (safeTags.length) summaryParts.push(t('qrFormat.summary.tags', { n: safeTags.length }));
  if (droppedTags.length) summaryParts.push(t('qrFormat.summary.droppedTags', { n: droppedTags.length }));
  const summary = `（${summaryParts.join(', ')}）`;

  const format: Format = {
    id: decoded.id || newFormatId(),
    name: finalName,
    panel: decoded.panel,
    joiner: decoded.joiner,
    labelSep: decoded.labelSep,
    titleWrap: typeof decoded.titleWrap === 'string' ? decoded.titleWrap : '',
    tags: safeTags,
    items: Array.isArray(decoded.items) ? decoded.items : [],
  };
  return { format, confirmBody: t('qrFormat.import.confirm', { name: finalName, summary }) };
}

/** FMT を適用する (push → 保存 → 失敗は追加分を戻す)。 */
export async function applyReceivedFormat(store: HrStore, format: Format): Promise<ApplyResult> {
  const settings = store.getSettings();
  if (!Array.isArray(settings.formats)) settings.formats = [];
  settings.formats.push(format);
  try {
    await store.saveSettingsOrThrow();
  } catch (e) {
    console.error('qr format import: save failed:', e);
    settings.formats = settings.formats.filter((f) => f !== format);
    return { ok: false, message: t('qr.recv.save.failed') };
  }
  return { ok: true, message: t('qrFormat.imported.alert', { name: format.name }) };
}

// ============================
// FS: セット + 参照フォーマット一式の追加 (常に新規・同名 rename)
// ============================

export interface PreparedSet {
  formats: Format[];
  group: FormatGroup;
  confirmBody: string;
}

/** FS 受信の取込内容を確定する (rename / 不変条件補修 / 確認文言)。 */
export function prepareReceivedSet(store: HrStore, decoded: DecodedSetPayload): PreparedSet {
  const settings = store.getSettings();
  const existingFormats = Array.isArray(settings.formats) ? settings.formats : [];
  const existingGroups = Array.isArray(settings.formatGroups) ? settings.formatGroups : [];

  // formats を rename (既存名 + このバッチ内で既に採用した名前を避ける)。ID は温存。
  const usedNames = new Set(existingFormats.map((f) => f.name));
  const newFormats = (Array.isArray(decoded.formats) ? decoded.formats : []).map((f) => {
    const finalName = uniqueName(f.name || t('qrFormat.untitled'), usedNames);
    usedNames.add(finalName);
    return { ...f, name: finalName };
  });

  const groupName = uniqueName(
    decoded.group.name || t('qrSet.untitled'),
    existingGroups.map((g) => g.name),
  );
  const newGroup: FormatGroup = {
    id: newGroupId(),
    name: groupName,
    isDefault: false,
    formatIds: (decoded.group.formatIds || []).slice(),
    defaultFormatIds: (decoded.group.defaultFormatIds || []).slice(),
    expandFormatIds: (decoded.group.expandFormatIds || []).slice(),
  };
  // 壊れた外部セット (あるパネルに展開フォーマットが無い) を取り込んでも、保存後に
  // そのパネルの展開カードが欠けないよう補修する。
  repairGroupExpandInvariant(newGroup, newFormats);

  const summary = `（${t('qrSet.summary.formats', { n: newFormats.length })}）`;
  return {
    formats: newFormats,
    group: newGroup,
    confirmBody: t('qrSet.import.confirm', { name: groupName, summary }),
  };
}

/** FS を適用する (push → 保存 → 失敗は追加分を戻す)。 */
export async function applyReceivedSet(store: HrStore, prepared: PreparedSet): Promise<ApplyResult> {
  const settings = store.getSettings();
  if (!Array.isArray(settings.formats)) settings.formats = [];
  if (!Array.isArray(settings.formatGroups)) settings.formatGroups = [];
  settings.formats.push(...prepared.formats);
  settings.formatGroups.push(prepared.group);
  ensureOneDefaultGroup(settings.formatGroups);
  try {
    await store.saveSettingsOrThrow();
  } catch (e) {
    console.error('qr set import: save failed:', e);
    settings.formats = settings.formats.filter((f) => !prepared.formats.includes(f));
    settings.formatGroups = settings.formatGroups.filter((g) => g !== prepared.group);
    return { ok: false, message: t('qr.recv.save.failed') };
  }
  return { ok: true, message: t('qrSet.imported.alert', { name: prepared.group.name }) };
}
