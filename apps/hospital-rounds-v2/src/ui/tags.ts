// 移植元: snishi-code-medical/hospital-rounds/src/features/tags.js の
//          §2 (クエリ) / §4 (タグ CRUD + 患者波及) / §5 (共有フィルタ状態)
//
// タグの正本は settings.tags (ユーザー設定)。患者側は patient.tags (名前参照)。
// 改名/削除は **アクティブ病棟の患者にのみ** 波及する (v1 仕様準拠 — 非アクティブ病棟の
// 患者タグは名前参照のため、改名後は「未登録タグ」として表示されず無害)。
//
// 共有フィルタ (home / memo / shared 横断) は v1 同様モジュールレベル状態。
// 変更後の再描画は呼び出し側が runtime.bump() で行う。

import {
  DEFAULT_TAG_FILTER_MODE,
  STATUS,
  STATUS_TAG_PREFIX,
  TAG_FILTER_MODE_AND,
  TAG_FILTER_MODE_OR,
  type Patient,
  type Settings,
} from '../domain/types';
import { t } from '../i18n/strings';
import { STATUS_MARK } from './patientDisplay';
import type { HrStore } from '../data/store';

// ============================
// クエリ
// ============================

/** ユーザー定義タグのみ (仮想ステータスタグは含まない)。 */
export function getAllTags(settings: Settings): string[] {
  return Array.isArray(settings.tags)
    ? settings.tags.filter((d) => typeof d === 'string' && d.trim()).map((d) => d.trim())
    : [];
}

export interface FilterEntry {
  value: string;
  label: string;
  /** 仮想ステータスタグの形マーク ("" = ユーザータグ) */
  mark: string;
}

export function isStatusTag(value: string): boolean {
  return typeof value === 'string' && value.startsWith(STATUS_TAG_PREFIX);
}

/** フィルタピッカー用: ユーザータグ + 仮想ステータスタグ。 */
export function getAllFilterEntries(settings: Settings): FilterEntry[] {
  const userTags = getAllTags(settings).map((name) => ({ value: name, label: name, mark: '' }));
  const statusLabels = {
    [STATUS.NONE]: t('tagStatus.none'),
    [STATUS.YELLOW]: t('tagStatus.yellow'),
    [STATUS.GREEN]: t('tagStatus.green'),
    [STATUS.GRAY]: t('tagStatus.gray'),
    [STATUS.BLUE]: t('tagStatus.blue'),
  } as const;
  const statusTags = (Object.values(STATUS) as Array<keyof typeof statusLabels>).map((s) => ({
    value: STATUS_TAG_PREFIX + s,
    label: statusLabels[s],
    mark: STATUS_MARK[s],
  }));
  return [...userTags, ...statusTags];
}

// ============================
// タグ CRUD (設定 + アクティブ病棟患者への波及)。保存は caller の責務に
// しない — v1 同様ここで saveSettings / scheduleSave まで行う。
// ============================

/** 新規タグ追加 (重複は false)。 */
export function addNewTag(store: HrStore, name: string): boolean {
  const trimmed = String(name || '').trim();
  if (!trimmed) return false;
  const settings = store.getSettings();
  if (!Array.isArray(settings.tags)) settings.tags = [];
  if (settings.tags.includes(trimmed)) return false;
  settings.tags.push(trimmed);
  void store.saveSettings();
  return true;
}

/** idx のタグを改名し、アクティブ病棟の患者タグも同名置換する。重複は false。 */
export function renameTagAt(store: HrStore, idx: number, newName: string): boolean {
  const settings = store.getSettings();
  if (!Array.isArray(settings.tags) || idx < 0 || idx >= settings.tags.length) return false;
  const oldName = settings.tags[idx];
  const next = String(newName || '').trim();
  if (!next) return false;
  if (oldName === next) return true;
  if (settings.tags.includes(next)) return false;
  settings.tags[idx] = next;
  for (const p of store.getAppState().patients) {
    if (Array.isArray(p.tags)) p.tags = p.tags.map((tg) => (tg === oldName ? next : tg));
  }
  void store.saveSettings();
  store.scheduleSave();
  return true;
}

/** idx のタグを削除し、アクティブ病棟の患者からも外す。 */
export function deleteTagAt(store: HrStore, idx: number): void {
  const settings = store.getSettings();
  if (!Array.isArray(settings.tags) || idx < 0 || idx >= settings.tags.length) return;
  const name = settings.tags[idx];
  settings.tags.splice(idx, 1);
  for (const p of store.getAppState().patients) {
    if (Array.isArray(p.tags) && p.tags.includes(name as string)) {
      p.tags = p.tags.filter((tg) => tg !== name);
    }
  }
  void store.saveSettings();
  store.scheduleSave();
}

// ============================
// 共有フィルタ状態 (home / memo / shared 横断。アプリ起動中のみ保持)
// ============================

let _sharedTagFilter: string[] = [];
let _sharedFilterMode: string = DEFAULT_TAG_FILTER_MODE;

export function getSharedTagFilter(): string[] {
  return _sharedTagFilter.slice();
}
export function setSharedTagFilter(tags: string[]): void {
  _sharedTagFilter = tags.slice();
}
export function getSharedFilterMode(): string {
  return _sharedFilterMode;
}
export function setSharedFilterMode(mode: string): void {
  _sharedFilterMode = mode === TAG_FILTER_MODE_OR ? TAG_FILTER_MODE_OR : TAG_FILTER_MODE_AND;
}
/** テスト間の残留防止。 */
export function _resetSharedFilterForTests(): void {
  _sharedTagFilter = [];
  _sharedFilterMode = DEFAULT_TAG_FILTER_MODE;
}

function patientFilterValues(p: Patient): string[] {
  const out = Array.isArray(p.tags) ? p.tags.slice() : [];
  out.push(STATUS_TAG_PREFIX + (p.status || STATUS.NONE));
  return out;
}

export function patientMatchesSharedFilter(p: Patient): boolean {
  if (!_sharedTagFilter.length) return true;
  const have = new Set(patientFilterValues(p));
  if (_sharedFilterMode === TAG_FILTER_MODE_OR) {
    return _sharedTagFilter.some((tg) => have.has(tg));
  }
  return _sharedTagFilter.every((tg) => have.has(tg));
}
