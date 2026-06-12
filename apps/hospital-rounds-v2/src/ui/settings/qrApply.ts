// 移植元: snishi-code-medical/hospital-rounds/src/features/qr-settings.js (applySettings)
//
// ST 受信の「適用」部 (確認ダイアログの後段)。fail-closed 規約:
//   適用 → saveSettingsOrThrow() を await → 失敗は in-memory をロールバックして
//   { ok:false } (成功表示・クローズへ進ませない)。
// FMT (フォーマット単体) / FS (フォーマットセット) は廃止済み。
// UI から分離してテスト可能にする (confirm 文言の組み立てもここ)。

import type { Settings } from '../../domain/types';
import { repairGroupExpandInvariant } from '../../domain/formatValues';
import type { DecodedSettingsPatch } from '../../qr/settingsQr';
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

