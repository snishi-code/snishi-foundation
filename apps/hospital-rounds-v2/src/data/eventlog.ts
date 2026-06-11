// 移植元: snishi-code-medical/hospital-rounds/src/features/eventlog.js
//          (foundation eventlog/createEventLog に HR の構成を注入)
//
// イベントログ (研究用テレメトリ)。専用 IDB (EVENTLOG_DB_NAME) に閉じ、患者データ・
// スナップショットとは別 DB。**個人情報を残さない**: 1 イベント = { t, u, k }。
// 患者名・pid は載せない (extra に PII を入れないのは呼び出し側の責務)。
// 外部送信ゼロ: JSON 書出はユーザー操作 (exportAll) のみ。365 日ローリング保持。
//
// 起動時のライフサイクル配線 (visibilitychange / beforeunload で APP_VISIBLE 等を記録)
// は UI 層 (React) が行う: init() → log(EVENT.APP_OPEN) → addEventListener。

import { createEventLog, type EventLog } from '@snishi/foundation/eventlog/createEventLog';
import { EVENTLOG_DB_NAME } from './constants';

/** イベント種別。値は wire キーなので i18n 対象外 (データ層の定数・v1 と同値)。 */
export const EVENT = Object.freeze({
  APP_OPEN: 'app_open', // 起動 / 初回読込
  APP_VISIBLE: 'app_visible', // 前面化 (タブ復帰 / アプリ復帰)
  APP_HIDDEN: 'app_hidden', // 背面化 / 離脱
  USER_SWITCH: 'user_switch', // ユーザー切替
  WS_SWITCH: 'ws_switch', // 病棟切替
  PATIENT_EDIT: 'patient_edit', // 患者レコード更新 (無記名・誰かは残さない)
  CLEAR: 'clear', // 記録クリア (診察開始)
  QR_SHOW: 'qr_show', // QR 表示 (kind 付与でカルテ記載/共有を区別できる)
  SNAPSHOT_RESTORE: 'snapshot_restore', // スナップショットから復元
} as const);
export type HrEventKind = (typeof EVENT)[keyof typeof EVENT];

/** 生イベントの保持日数 (v1 と同じ 365 日ローリング) */
export const EVENTLOG_RETENTION_DAYS = 365;

/**
 * HR-v2 構成のイベントログを作る。getUserId は storage.getCurrentUserId を渡す
 * (端末内の乱数 ID = 非 PII)。
 */
export function createHrEventLog(getUserId: () => string | null, now?: () => number): EventLog {
  return createEventLog({
    dbName: EVENTLOG_DB_NAME,
    retentionDays: EVENTLOG_RETENTION_DAYS,
    getUserId,
    now,
  });
}
