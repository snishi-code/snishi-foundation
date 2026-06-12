// アプリ実行時の束 (store / snapshots / eventlog / 変更通知)。
//
// v1 の main.js が live binding + 中央 refreshPatientUI() で行っていた
// 「ミューテーション後の全 view 一括再描画」を、React では revision カウンタ +
// useSyncExternalStore で再現する (ui/useRevision.ts)。
//
// 原則 (v1 CLAUDE.md「状態更新後の再描画」):
//   - appState / settings を変更したら「保存 (scheduleSave / persist*OrThrow)」と
//     「bump() (= 再描画通知)」の両方を呼ぶ。保存と描画は別。
//   - store.setDataChangeHandler (markUpdated / switchWorkspace / switchUser) は
//     ここで bump に配線済み。markUpdated を呼ぶ経路は bump 不要。

import { useSyncExternalStore } from 'react';
import type { SnapshotStore } from '@snishi/foundation/snapshot/snapshots';
import type { EventLog } from '@snishi/foundation/eventlog/createEventLog';
import { createHrStore, type HrStore, type StoreChangeEvent } from '../data/store';
import { createHrSnapshots, type SnapshotData } from '../data/snapshots';
import { createHrEventLog } from '../data/eventlog';
import { t } from '../i18n/strings';

export interface AppRuntime {
  store: HrStore;
  snapshots: SnapshotStore<SnapshotData>;
  eventlog: EventLog;
  /** データ変更後の再描画通知 (v1 refreshPatientUI 相当)。 */
  bump(): void;
  subscribe(fn: () => void): () => void;
  getRevision(): number;
  /**
   * fire-and-forget 保存 (saveNow) の失敗通知先。ToastProvider 配下で必ず配線する
   * (保存失敗を握らない — 臨床データの fail-closed 原則)。
   */
  setSaveErrorHandler(fn: ((e: unknown) => void) | null): void;
  /** 最後に受けた store イベント (テスト/デバッグ用)。 */
  lastStoreEvent(): StoreChangeEvent | null;
}

export function createAppRuntime(): AppRuntime {
  let revision = 0;
  const listeners = new Set<() => void>();
  let saveErrorHandler: ((e: unknown) => void) | null = null;
  let lastEvent: StoreChangeEvent | null = null;

  function bump(): void {
    revision++;
    for (const fn of listeners) fn();
  }

  const store = createHrStore({
    defaultTitle: t('app.title'),
    onSaveError(e) {
      // UI 配線前に失敗した場合も握らない (console は store 側で出力済み)。
      if (saveErrorHandler) saveErrorHandler(e);
    },
  });

  // markUpdated / switchWorkspace / switchUser → 全 view 一括更新。
  // 個別 view を列挙しない (v1 で detail 列挙漏れの再発バグがあった)。
  store.setDataChangeHandler((ev) => {
    lastEvent = ev;
    bump();
  });

  const snapshots = createHrSnapshots(store.storage.pointers);
  const eventlog = createHrEventLog(() => store.storage.getCurrentUserId() || null);

  return {
    store,
    snapshots,
    eventlog,
    bump,
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    getRevision: () => revision,
    setSaveErrorHandler(fn) {
      saveErrorHandler = fn;
    },
    lastStoreEvent: () => lastEvent,
  };
}

/** revision を購読して、データ変更 (bump) のたびに再描画させる。返り値は現 revision。 */
export function useRevision(runtime: AppRuntime): number {
  return useSyncExternalStore(runtime.subscribe, runtime.getRevision, runtime.getRevision);
}
