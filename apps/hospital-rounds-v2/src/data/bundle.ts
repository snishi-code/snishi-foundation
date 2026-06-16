// 移植元: snishi-code-medical/hospital-rounds/src/bundle.js (忠実移植)
//
// Bundle はアプリの正準シリアライズ形: JSON ファイル書き出し・IDB 内のワークスペース
// レコード・(暗号化後の) QR ペイロードが共有する。section 単位の content-addressed 構造
// なので、同じパーサがフルバックアップも部分転送も扱える。
//
// 注意: BUNDLE_FORMAT 文字列は v1 と同一 ("hospital-rounds-bundle") を維持する。
// これは **ストレージ識別子ではなく JSON ファイル形式マーカー** であり (仕様§7 の
// v1/v2 分離対象は DB 名・localStorage キー・cache 名)、v1 端末から書き出した JSON
// アーカイブを v2 が取り込めるようにするために一致が必要。

import { DEFAULT_APP_TITLE, type AppState, type Settings } from '../domain/types';
import { defaultRosterMeta, normalizeRosterMeta, type RosterMeta } from '../domain/roster';

export const BUNDLE_FORMAT = 'hospital-rounds-bundle';
export const BUNDLE_SCHEMA = 1;
export const BUNDLE_APP_VERSION = '2.0.0';

export const SECTION = Object.freeze({
  META: 'meta',
  SETTINGS: 'settings',
  PATIENTS: 'patients',
  ROSTER: 'roster',
  // 旧 bundle の未知 section (HISTORY / MEMO / SHARED 等) は parseBundle が温存する (forward compat)。
} as const);
export type SectionKey = (typeof SECTION)[keyof typeof SECTION];

/** 「全部保存」プリセットが書く既定 section (派生 section の roster は projection なので除外)。 */
export const FULL_BACKUP_SECTIONS = Object.freeze([
  SECTION.META,
  SECTION.SETTINGS,
  SECTION.PATIENTS,
] as const);

export interface Bundle {
  format: string;
  schema: number;
  appVersion: string;
  exportedAt: string;
  owner: { deviceId: string; label: string };
  /** 旧フィールド。互換のためすぐ消さない (rosterMeta へ移行)。 */
  rosterId: string;
  /** HM 名簿 QR の正本/受信メタ (domain/roster.ts)。section ではなく top-level に持つ。 */
  rosterMeta: RosterMeta;
  /** 未知 section も温存するため Record (forward compat) */
  sections: Record<string, unknown>;
}

function nowIso(): string {
  try {
    return new Date().toISOString();
  } catch {
    return '';
  }
}

function projectRosterView(patients: AppState['patients'], tags: Settings['tags'] | undefined) {
  // tags は TagDef[] → roster は name の文字列配列として射影する
  const tagNames = Array.isArray(tags) ? tags.map((t) => t.name) : [];
  return {
    patients: (patients || []).map((p) => ({
      pid: String(p.pid || ''),
      name: String(p.name || ''),
      room: String(p.room || ''),
      tags: Array.isArray(p.tags) ? p.tags.slice() : [],
    })),
    tags: tagNames,
  };
}

// ============================
// Project: in-memory state -> bundle
// ============================

export interface ProjectBundleArgs {
  appState: Pick<AppState, 'title' | 'patients'>;
  settings: Settings;
  sections?: readonly string[];
  owner?: { deviceId: string; label: string };
  exportedAt?: string;
  /** 病棟の名簿メタ。未指定は unmanaged 既定 (通常病棟・空病棟・移動先病棟)。 */
  rosterMeta?: RosterMeta;
}

export function projectBundle({
  appState,
  settings,
  sections = FULL_BACKUP_SECTIONS,
  owner,
  exportedAt,
  rosterMeta,
}: ProjectBundleArgs): Bundle {
  const want = new Set(sections);
  const out: Bundle = {
    format: BUNDLE_FORMAT,
    schema: BUNDLE_SCHEMA,
    appVersion: BUNDLE_APP_VERSION,
    exportedAt: exportedAt != null ? exportedAt : nowIso(),
    owner: owner || { deviceId: settings?.deviceId || '', label: '' },
    rosterId: '',
    rosterMeta: rosterMeta ? normalizeRosterMeta(rosterMeta) : defaultRosterMeta(),
    sections: {},
  };

  if (want.has(SECTION.META)) {
    out.sections[SECTION.META] = {
      title: String(appState?.title || DEFAULT_APP_TITLE),
    };
  }
  if (want.has(SECTION.SETTINGS) && settings) {
    out.sections[SECTION.SETTINGS] = settings;
  }
  if (want.has(SECTION.PATIENTS) && appState?.patients) {
    out.sections[SECTION.PATIENTS] = appState.patients;
  }
  if (want.has(SECTION.ROSTER) && appState?.patients) {
    out.sections[SECTION.ROSTER] = projectRosterView(appState.patients, settings?.tags);
  }
  return out;
}

// ============================
// Parse: raw -> bundle
// ============================

export function parseBundle(raw: unknown): Bundle {
  if (!raw || typeof raw !== 'object') {
    throw new Error('invalid bundle: not an object');
  }
  const b = raw as Record<string, unknown>;
  if (b.format !== BUNDLE_FORMAT || !b.sections || typeof b.sections !== 'object') {
    throw new Error('unknown file format');
  }
  return normalizeBundle(b);
}

function normalizeBundle(b: Record<string, unknown>): Bundle {
  const owner =
    b.owner && typeof b.owner === 'object'
      ? {
          deviceId: String((b.owner as Record<string, unknown>).deviceId || ''),
          label: String((b.owner as Record<string, unknown>).label || ''),
        }
      : { deviceId: '', label: '' };
  return {
    format: BUNDLE_FORMAT,
    schema: typeof b.schema === 'number' ? b.schema : BUNDLE_SCHEMA,
    appVersion: typeof b.appVersion === 'string' ? b.appVersion : '',
    exportedAt: typeof b.exportedAt === 'string' ? b.exportedAt : '',
    owner,
    rosterId: typeof b.rosterId === 'string' ? b.rosterId : '',
    // 古い bundle に rosterMeta が無くても unmanaged 既定へ倒す (forward compat)。
    rosterMeta: normalizeRosterMeta(b.rosterMeta),
    sections: { ...(b.sections as Record<string, unknown>) },
  };
}

// ============================
// Section accessors
// ============================

export function getSection(bundle: Bundle | null | undefined, key: string): unknown {
  return bundle && bundle.sections ? bundle.sections[key] : undefined;
}

export function hasSection(bundle: Bundle | null | undefined, key: string): boolean {
  return !!(
    bundle &&
    bundle.sections &&
    Object.prototype.hasOwnProperty.call(bundle.sections, key)
  );
}
