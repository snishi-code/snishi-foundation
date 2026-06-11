// 移植元: snishi-code-medical/hospital-rounds/src/features/status-ui.js (statusClass)
//          + features/tags.js の STATUS_TAG_MARK / getStatusOptions
//          + features/room.js の formatPatientLabel / ensureRoomOrder
//
// 患者表示の純ヘルパ。色値は app.css の --status-* 変数が正本 (ここはクラス名と形マークのみ)。

import { STATUS, type Patient, type PatientStatus } from '../domain/types';
import { t } from '../i18n/strings';

/**
 * 色覚多様性対応: ステータスを色だけでなく形マークでも示す正準マッピング
 * (v1 tags.js STATUS_TAG_MARK と同値)。青は ★ (十字ルールにより ＋ は使わない)。i18n 対象外。
 */
export const STATUS_MARK: Readonly<Record<PatientStatus, string>> = Object.freeze({
  [STATUS.NONE]: '−',
  [STATUS.YELLOW]: '▲',
  [STATUS.GREEN]: '✓',
  [STATUS.GRAY]: '✕',
  [STATUS.BLUE]: '★',
});

export function statusClass(status: PatientStatus | string): string {
  if (status === STATUS.YELLOW) return 'status-yellow';
  if (status === STATUS.GREEN) return 'status-green';
  if (status === STATUS.GRAY) return 'status-gray';
  if (status === STATUS.BLUE) return 'status-blue';
  return '';
}

export interface StatusOption {
  status: PatientStatus;
  label: string;
  mark: string;
}

/** ステータス選択ポップアップの選択肢 (v1 getStatusOptions 相当。色は CSS クラス側)。 */
export function getStatusOptions(): StatusOption[] {
  const labels: Record<PatientStatus, string> = {
    [STATUS.NONE]: t('tagStatus.none'),
    [STATUS.YELLOW]: t('tagStatus.yellow'),
    [STATUS.GREEN]: t('tagStatus.green'),
    [STATUS.GRAY]: t('tagStatus.gray'),
    [STATUS.BLUE]: t('tagStatus.blue'),
  };
  return (Object.values(STATUS) as PatientStatus[]).map((status) => ({
    status,
    label: labels[status],
    mark: STATUS_MARK[status],
  }));
}

/** 「部屋 氏名」表示。移動済は "(移)" prefix (元 name は触らない・表示のみ)。 */
export function formatPatientLabel(p: Patient | null | undefined, fallback: string): string {
  const name = p && p.name ? p.name : fallback || '';
  const room = String(p?.room ?? '').trim();
  const base = room ? `${room} ${name}` : name;
  if (p && p.transferredAt) return `${t('move.namePrefix')} ${base}`;
  return base;
}

export function isPatientTransferred(p: Patient | null | undefined): boolean {
  return !!(p && p.transferredAt);
}

function patientRoomCompare(a: Patient, b: Patient): number {
  // 移動済は常に末尾グループ (v1 room.js patientRoomCompare 移植)。
  const at = !!a.transferredAt;
  const bt = !!b.transferredAt;
  if (at !== bt) return at ? 1 : -1;
  const ar = String(a.room ?? '').trim();
  const br = String(b.room ?? '').trim();
  if (ar && br) {
    const ai = parseInt(ar, 10);
    const bi = parseInt(br, 10);
    if (!isNaN(ai) && !isNaN(bi)) return ai - bi;
    return ar.localeCompare(br);
  }
  if (ar) return -1;
  if (br) return 1;
  return 0;
}

/**
 * 部屋番号順の in-place ソート (v1 ensureRoomOrder)。各 view の描画前にだけ呼ぶ
 * (表示中は動かさない)。編集モード中は呼ばないこと (行が別患者を指す患者取り違え防止)。
 */
export function ensureRoomOrder(patients: Patient[]): void {
  patients.sort(patientRoomCompare);
}

export function sanitizeRoomInput(s: string): string {
  return String(s ?? '').replace(/[^0-9]/g, '');
}
