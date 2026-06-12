// 移植元: snishi-code-medical/hospital-rounds/src/main.js (Boot 配線) +
//          features/app-history.js (useAppHistory 経由) + index.html の view シェル
//
// App シェル:
//   - ToastProvider 配下で store.onSaveError → toast を必ず配線 (保存失敗を握らない)
//   - initStore() 完了まで起動画面 (描画前に必ず await — store の契約)
//   - useAppHistory で view 管理 (home/detail/settings)。戻る優先順位:
//     終了確認 > 一時 overlay > 編集モード解除 > view 復帰 > 終了確認表示
//   - beforeunload + visibilitychange(hidden) で flushSavePending (debounce 中の保存を確定)
//   - eventlog: APP_OPEN / APP_VISIBLE / APP_HIDDEN
//   - 画面遷移直前の nav スナップショット (浅いアンドゥ・直近 2 枚リング)

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { AppHeader } from '@snishi/foundation/ui/AppHeader';
import { IconButton } from '@snishi/foundation/ui/IconButton';
import { Icon } from '@snishi/foundation/ui/Icon';
import { ConfirmDialog } from '@snishi/foundation/ui/ConfirmDialog';
import { ToastProvider, useToast } from '@snishi/foundation/ui/toast';
import { useAppHistory } from '@snishi/foundation/history/useAppHistory';
import { EVENT } from './data/eventlog';
import { REASON, countActivePatients } from './data/snapshots';
import { createAppRuntime, useRevision, type AppRuntime } from './ui/appRuntime';
import { closeTopOverlay, exitTopEditing, isEditingActive } from './ui/registries';
import { purgeExpiredPatientLifecycleRecords } from './ui/patientLifecycle';
import { HomeView } from './ui/HomeView';
import { DetailView } from './ui/DetailView';
import { SettingsView } from './ui/settings/SettingsView';
import { UserPicker } from './ui/pickers/UserPicker';
import { WsPicker } from './ui/pickers/WsPicker';
import { t } from './i18n/strings';
import { UI } from './ui-contract';

type ViewName = 'home' | 'detail' | 'settings';

function AppShell({ runtime }: { runtime: AppRuntime }) {
  const toast = useToast();
  const revision = useRevision(runtime);
  const { store } = runtime;

  const [ready, setReady] = useState(false);
  const [selectedNo, setSelectedNo] = useState(1);
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
      // 患者ライフサイクルの30日自動 purge (Trash / (移) stub の PII を無期限に残さない)。
      // best-effort: 失敗しても起動は止めない (次回起動で再試行)。
      void purgeExpiredPatientLifecycleRecords(store).then((res) => {
        if (alive && res.activeChanged) runtime.bump();
      });
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

  // ヘッダー実測高を CSS 変数へ (v1 main.js の --headerH 相当)。各 view の上部ツールバー
  // (.viewToolbar) がヘッダー直下へ sticky で貼り付くための基準値。内容 wrap で高さが
  // 変わるので ResizeObserver で追従する。
  useEffect(() => {
    if (!ready) return;
    const el = document.querySelector('.app-header');
    if (!el) return;
    const set = () =>
      document.documentElement.style.setProperty('--hr-header-h', `${Math.ceil(el.getBoundingClientRect().height)}px`);
    set();
    if (typeof ResizeObserver === 'undefined') return; // jsdom 等は初期値のみ
    const ro = new ResizeObserver(set);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ready]);

  // ── スクロール体験 (P1):
  //   - ホーム一覧の位置は「患者詳細へ行って戻るだけ」なら保持する (openPatient で控え、
  //     home へ戻った描画後に復元)。明示的なホーム遷移 (ヘッダー/メニュー) はトップから。
  //   - 患者詳細は常に上部から開始 (前/次の切替も含む)。Ver1 の「全画面で同じ位置を共有」
  //     は誤タップの一因だったため持ち越さない。
  const homeScrollYRef = useRef(0);

  // ワークスペース切替時は患者 index を前 ws から引きずらない (v1 setOnWorkspaceChanged)
  const lastWsIdRef = useRef('');
  useEffect(() => {
    if (!ready) return;
    const wsId = store.storage.getActiveWorkspaceId();
    if (lastWsIdRef.current && lastWsIdRef.current !== wsId) {
      setSelectedNo(1);
      homeScrollYRef.current = 0; // 別病棟の一覧位置を持ち越さない
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
      if (next === 'home') homeScrollYRef.current = 0; // 明示遷移はトップから
      window.scrollTo(0, 0);
      navigate(next);
    },
    [captureNavSnapshot, navigate],
  );

  const openPatient = useCallback(
    (no: number) => {
      if (view === 'home') homeScrollYRef.current = window.scrollY; // 戻った時に復元
      setSelectedNo(no);
      captureNavSnapshot();
      window.scrollTo(0, 0);
      navigate('detail');
    },
    [captureNavSnapshot, navigate, view],
  );

  // 詳細内の前/次切替: 前患者のスクロール位置 (身体所見付近など) を次患者へ持ち越さない
  const selectNo = useCallback((no: number) => {
    setSelectedNo(no);
    window.scrollTo(0, 0);
  }, []);

  // Back (popstate) 等で home へ戻った時、控えた一覧位置を描画後に復元する
  useLayoutEffect(() => {
    if (view === 'home' && homeScrollYRef.current > 0) {
      window.scrollTo(0, homeScrollYRef.current);
    }
  }, [view]);

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
          <IconButton label={t('header.settings')} dataUi={UI.nav.settings} onClick={() => goto('settings')}>
            <Icon name="settings" size={18} />
          </IconButton>
        }
      />

      <main className="app-main">
        {view === 'home' ? <HomeView runtime={runtime} onOpenPatient={openPatient} /> : null}
        {view === 'detail' ? (
          <DetailView
            runtime={runtime}
            selectedNo={selectedNo}
            onSelectNo={selectNo}
            onNavigateHome={() => goto('home')}
          />
        ) : null}
        {view === 'settings' ? <SettingsView runtime={runtime} /> : null}
      </main>

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
