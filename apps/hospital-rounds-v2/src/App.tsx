// 移植元: snishi-code-medical/hospital-rounds/src/main.js (Boot 配線) +
//          features/app-history.js (useAppHistory 経由) + index.html の view シェル
//
// App シェル:
//   - ToastProvider 配下で store.onSaveError → toast を必ず配線 (保存失敗を握らない)
//   - initStore() 完了まで起動画面 (描画前に必ず await — store の契約)
//   - useAppHistory で view 管理 (home/detail/memo/shared/settings)。戻る優先順位:
//     終了確認 > 一時 overlay > 編集モード解除 > view 復帰 > 終了確認表示
//   - beforeunload + visibilitychange(hidden) で flushSavePending (debounce 中の保存を確定)
//   - eventlog: APP_OPEN / APP_VISIBLE / APP_HIDDEN
//   - 画面遷移直前の nav スナップショット (浅いアンドゥ・直近 2 枚リング)

import { useCallback, useEffect, useRef, useState } from 'react';
import { AppHeader } from '@snishi/foundation/ui/AppHeader';
import { IconButton } from '@snishi/foundation/ui/IconButton';
import { Icon } from '@snishi/foundation/ui/Icon';
import { Menu } from '@snishi/foundation/ui/Menu';
import { ConfirmDialog } from '@snishi/foundation/ui/ConfirmDialog';
import { ToastProvider, useToast } from '@snishi/foundation/ui/toast';
import { useAppHistory } from '@snishi/foundation/history/useAppHistory';
import { EVENT } from './data/eventlog';
import { REASON, countActivePatients } from './data/snapshots';
import { createAppRuntime, useRevision, type AppRuntime } from './ui/appRuntime';
import { OverlayBinding, closeTopOverlay, exitTopEditing, isEditingActive } from './ui/registries';
import { HomeView } from './ui/HomeView';
import { DetailView } from './ui/DetailView';
import { MemoSharedView } from './ui/MemoSharedView';
import { SettingsView } from './ui/settings/SettingsView';
import { UserPicker } from './ui/pickers/UserPicker';
import { WsPicker } from './ui/pickers/WsPicker';
import { t } from './i18n/strings';
import { UI } from './ui-contract';

type ViewName = 'home' | 'detail' | 'memo' | 'shared' | 'settings';

function AppShell({ runtime }: { runtime: AppRuntime }) {
  const toast = useToast();
  const revision = useRevision(runtime);
  const { store } = runtime;

  const [ready, setReady] = useState(false);
  const [selectedNo, setSelectedNo] = useState(1);
  const [menuOpen, setMenuOpen] = useState(false);
  const [exitConfirm, setExitConfirm] = useState(false);
  const [userPickerOpen, setUserPickerOpen] = useState(false);
  const [wsPickerOpen, setWsPickerOpen] = useState(false);
  const [wsLabel, setWsLabel] = useState('');

  // useAppHistory は callback を毎 render ref へ反映する (stale closure なし) ので、
  // state をそのまま閉じ込めてよい。
  const { view, navigate, beginExit } = useAppHistory({
    initialView: 'home',
    closeTopOverlay,
    isEditing: isEditingActive,
    exitEdit: exitTopEditing,
    showExitConfirm: () => setExitConfirm(true),
    isExitConfirmOpen: () => exitConfirm,
  });

  // ── 起動 (initStore 完了まで起動画面) + ライフサイクル配線 ──
  useEffect(() => {
    let alive = true;
    void store.initStore().then(() => {
      if (!alive) return;
      setReady(true);
      store.requestStoragePersistence();
      void runtime.eventlog.init();
      runtime.eventlog.log(EVENT.APP_OPEN);
    });

    const onBeforeUnload = () => {
      try {
        store.flushSavePending();
      } catch {
        /* unload 経路では通知できない */
      }
    };
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        runtime.eventlog.log(EVENT.APP_HIDDEN);
        try {
          store.flushSavePending();
        } catch {
          /* 同上 */
        }
      } else {
        runtime.eventlog.log(EVENT.APP_VISIBLE);
      }
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      alive = false;
      window.removeEventListener('beforeunload', onBeforeUnload);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [runtime, store]);

  // 保存失敗 (fire-and-forget saveNow) の可視化。ToastProvider 配下で必ず配線する。
  useEffect(() => {
    runtime.setSaveErrorHandler(() => toast.show(t('save.failed'), 'error'));
    return () => runtime.setSaveErrorHandler(null);
  }, [runtime, toast]);

  // ワークスペース切替時は患者 index を前 ws から引きずらない (v1 setOnWorkspaceChanged)
  const lastWsIdRef = useRef('');
  useEffect(() => {
    if (!ready) return;
    const wsId = store.storage.getActiveWorkspaceId();
    if (lastWsIdRef.current && lastWsIdRef.current !== wsId) {
      setSelectedNo(1);
      runtime.undo.clearAll(); // 病棟/ユーザー切替で患者ごとの undo 履歴を破棄
      runtime.eventlog.log(EVENT.WS_SWITCH);
    }
    lastWsIdRef.current = wsId;
    // ヘッダーの病棟ラベルを同期
    let aliveLabel = true;
    void store.storage.listBundles().then((list) => {
      if (!aliveLabel) return;
      const cur = list.find((b) => b.id === wsId);
      // 初回起動などレコード未作成時は既定病棟名でフォールバック (空表示にしない)
      setWsLabel(cur ? cur.label || cur.title || '' : store.storage.getDefaultWorkspaceLabel());
    });
    return () => {
      aliveLabel = false;
    };
  }, [ready, revision, runtime, store]);

  // 画面遷移直前の浅いアンドゥ (nav スナップショット。変化が無ければ foundation 側でスキップ)
  const captureNavSnapshot = useCallback(() => {
    if (!ready) return;
    const state = store.getAppState();
    void runtime.snapshots
      .capture(
        REASON.NAV,
        store.storage.getActiveWorkspaceId(),
        { title: state.title, patients: state.patients },
        String(countActivePatients(state.patients)),
      )
      .catch(() => {
        /* nav snapshot は best-effort (本処理を壊さない) */
      });
  }, [ready, runtime, store]);

  const goto = useCallback(
    (next: ViewName) => {
      captureNavSnapshot();
      window.scrollTo(0, 0);
      navigate(next);
    },
    [captureNavSnapshot, navigate],
  );

  const openPatient = useCallback(
    (no: number) => {
      setSelectedNo(no);
      captureNavSnapshot();
      window.scrollTo(0, 0);
      navigate('detail');
    },
    [captureNavSnapshot, navigate],
  );

  if (!ready) {
    // 起動画面 (initStore 完了まで)。データを読まずに描画しない (store の契約)。
    return (
      <main className="app-main appBoot">
        <p className="muted">{t('app.title')} …</p>
      </main>
    );
  }

  const userName = store.getCurrentUserName() || store.getAppState().title;

  return (
    <>
      <AppHeader
        dataUi="app.header"
        left={
          <IconButton label={t('header.home')} dataUi={UI.nav.home} onClick={() => goto('home')}>
            <Icon name="home" size={20} />
          </IconButton>
        }
        center={
          <div className="headerTitleRow">
            <button
              type="button"
              className="headerTitleBtn"
              title={t('header.user.tooltip')}
              aria-label={t('header.user.tooltip')}
              data-ui={UI.nav.user}
              onClick={() => setUserPickerOpen(true)}
            >
              {userName}
              <Icon name="expand" size={14} />
            </button>
            <span className="headerTitleSep" aria-hidden="true">
              /
            </span>
            <button
              type="button"
              className="headerTitleBtn"
              title={t('header.ws.tooltip')}
              aria-label={t('header.ws.tooltip')}
              data-ui={UI.nav.ws}
              onClick={() => setWsPickerOpen(true)}
            >
              {wsLabel}
              <Icon name="expand" size={14} />
            </button>
          </div>
        }
        right={
          <IconButton label={t('header.menu')} dataUi={UI.nav.menu} onClick={() => setMenuOpen(true)}>
            <Icon name="menu" size={18} />
          </IconButton>
        }
      />

      <main className="app-main">
        {view === 'home' ? <HomeView runtime={runtime} onOpenPatient={openPatient} /> : null}
        {view === 'detail' ? (
          <DetailView runtime={runtime} selectedNo={selectedNo} onSelectNo={setSelectedNo} />
        ) : null}
        {view === 'memo' ? <MemoSharedView kind="memo" runtime={runtime} onOpenPatient={openPatient} /> : null}
        {view === 'shared' ? <MemoSharedView kind="shared" runtime={runtime} onOpenPatient={openPatient} /> : null}
        {view === 'settings' ? <SettingsView runtime={runtime} /> : null}
      </main>

      {menuOpen ? <OverlayBinding onClose={() => setMenuOpen(false)} /> : null}
      {menuOpen ? (
        <Menu
          title={t('header.menu')}
          onClose={() => setMenuOpen(false)}
          items={[
            {
              key: 'memo',
              label: t('header.memo'),
              icon: 'memo',
              current: view === 'memo',
              dataUi: UI.nav.menuMemo,
              onSelect: () => goto('memo'),
            },
            {
              key: 'shared',
              label: t('header.shared'),
              icon: 'share',
              current: view === 'shared',
              dataUi: UI.nav.menuShared,
              onSelect: () => goto('shared'),
            },
            {
              key: 'settings',
              label: t('header.settings'),
              icon: 'settings',
              current: view === 'settings',
              dataUi: UI.nav.menuSettings,
              onSelect: () => goto('settings'),
            },
          ]}
        />
      ) : null}

      {userPickerOpen ? <UserPicker runtime={runtime} onClose={() => setUserPickerOpen(false)} /> : null}
      {wsPickerOpen ? <WsPicker runtime={runtime} onClose={() => setWsPickerOpen(false)} /> : null}

      {exitConfirm ? (
        <ConfirmDialog
          title={t('app.exit.confirm.title')}
          body={t('app.exit.confirm.body')}
          confirmLabel={t('app.exit.confirm.ok')}
          cancelLabel={t('common.cancel')}
          dismissMode="never"
          dataUi={UI.exit.confirm}
          onCancel={() => setExitConfirm(false)}
          onConfirm={() => {
            setExitConfirm(false);
            store.flushSavePending();
            beginExit();
          }}
        />
      ) : null}
    </>
  );
}

export function App({ runtime }: { runtime?: AppRuntime }) {
  const [rt] = useState(() => runtime ?? createAppRuntime());
  return (
    <ToastProvider>
      <AppShell runtime={rt} />
    </ToastProvider>
  );
}
