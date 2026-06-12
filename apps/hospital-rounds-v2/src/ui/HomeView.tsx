// 移植元: snishi-code-medical/hospital-rounds/src/views/home.js + features/qr-home.js
//          + main.js の clearAllBtn (診察開始)
//
// ホーム: 患者グリッド (タップで詳細へ / ステータスバッジ / 転棟メニュー)、
// 診察開始 (= 記録クリア: snapshot → clear → fail-closed 保存 → rollback)、
// HM QR カード (送信 = 名簿 / 受信 = 常に新規病棟として作成 + 切替)。

import { useEffect, useState } from 'react';
import { Button } from '@snishi/foundation/ui/Button';
import { IconButton } from '@snishi/foundation/ui/IconButton';
import { Icon } from '@snishi/foundation/ui/Icon';
import { ConfirmDialog } from '@snishi/foundation/ui/ConfirmDialog';
import { useToast } from '@snishi/foundation/ui/toast';
import { useQrFlow } from '@snishi/foundation/qr/useQrFlow';
import {
  FORMAT_PANELS,
  STATUS,
  clone,
  DEFAULT_PATIENT_COUNT,
  type AppState,
} from '../domain/types';
import { makeDefaultPatient } from '../domain/normalize';
import { clearPanelClinicalInput } from '../domain/formatValues';
import { SECTION, projectBundle } from '../data/bundle';
import { REASON, countActivePatients } from '../data/snapshots';
import { EVENT } from '../data/eventlog';
import { encodePatientList, decodePatientList, type DecodedPatientList } from '../qr/patientList';
import { APP_KEY_BYTES } from '../qr/appKey';
import { useRevision, type AppRuntime } from './appRuntime';
import { ensureRoomOrder, formatPatientLabel, statusClass, STATUS_MARK } from './patientDisplay';
import { QrDialog } from './QrCard';
import { PatientEditPopup } from './PatientEditPopup';
import { TagFilterPicker } from './TagPicker';
import { patientMatchesSharedFilter } from './tags';
import { isPatientDeleted, isTrashActive } from './patientLifecycle';
import { OverlayBinding } from './registries';
import { t } from '../i18n/strings';
import { UI } from '../ui-contract';

function formatRecvLabel(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const ts = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  return t('home.qrImport.newWs.label', { ts });
}

export function HomeView({
  runtime,
  onOpenPatient,
}: {
  runtime: AppRuntime;
  onOpenPatient: (no: number) => void;
}) {
  const toast = useToast();
  const revision = useRevision(runtime);
  const { store } = runtime;
  const appState = store.getAppState();

  // 描画前の自動部屋番号順ソート (v1 ensureRoomOrder。in-place・冪等。表示中は動かさない)
  ensureRoomOrder(appState.patients);

  const [clearConfirm, setClearConfirm] = useState(false);
  const [pendingImport, setPendingImport] = useState<{ decoded: DecodedPatientList; close: () => void } | null>(null);
  // 患者追加直後に開く編集ポップアップの対象 (部屋番号入力でソートされても取り違えない
  // よう index でなく pid で捕捉する — v1 add-patient.js の patient取り違え防止)
  const [addPid, setAddPid] = useState<string | null>(null);

  const trash = isTrashActive(store);

  const flow = useQrFlow<DecodedPatientList>({
    kind: 'HM',
    kindLabel: t('qr.kind.home'),
    keyBytes: APP_KEY_BYTES,
    encodePayload: () =>
      encodePatientList(store.getAppState().patients, store.getSettings(), { kind: 'HM', includeEmpty: true }),
    decodePayload: (plain) => decodePatientList(plain),
    shouldEncrypt: () => !!store.getSettings().qrEncryption?.HM,
    onApply(decoded, ctrl) {
      if (!decoded.patients.length) {
        toast.show(t('qr.import.empty.home'), 'error');
        return;
      }
      // 適用はユーザー確認後 (ConfirmDialog) — fail-closed は applyRoster 側
      setPendingImport({ decoded, close: ctrl.close });
    },
  });

  // データ変更で開いている QR を最新化 (v1 refreshHomeQrIfActive)。refresh は useCallback 安定。
  const refreshQr = flow.refresh;
  useEffect(() => {
    void refreshQr();
  }, [revision, refreshQr]);

  // 受信名簿 → 常に新規病棟として作成 + 切替 (v7.6+ 統一。上書き事故ゼロ)
  async function applyRoster(decoded: DecodedPatientList, close: () => void): Promise<void> {
    const { tagNames: senderTagNames, patients: roster } = decoded;
    const label = formatRecvLabel();
    const slotCount = Math.max(DEFAULT_PATIENT_COUNT, roster.length);
    const newPatients = [];
    for (let i = 0; i < slotCount; i++) {
      const p = makeDefaultPatient();
      const r = roster[i];
      if (r) {
        p.room = r.room || '';
        p.name = r.name || '';
        p.tags = (r.tagIdxs || []).map((idx) => senderTagNames[idx - 1]).filter((x): x is string => !!x);
        // 受信患者は外部由来マーク (qrRedistribution=restricted の再配布制限対象)
        if (p.room || p.name || p.tags.length) p.origin = 'external';
      }
      newPatients.push(p);
    }
    // 送信側タグを union (rollback できるよう旧値を控える)
    const liveSettings = store.getSettings();
    const prevTags = liveSettings.tags.slice();
    for (const tag of senderTagNames) {
      if (!liveSettings.tags.includes(tag)) liveSettings.tags.push(tag);
    }
    const newAppState: AppState = {
      v: 3,
      title: store.getAppState().title,
      patients: newPatients,
      recvMemo: '',
      recvShared: '',
    };
    const bundle = projectBundle({
      appState: newAppState,
      settings: liveSettings,
      sections: [SECTION.META, SECTION.PATIENTS],
    });
    try {
      const newId = await store.storage.createWorkspaceRecord(label, bundle);
      // switchWorkspace は切替前に現病棟 + 設定 (タグ union 込み) を fail-closed 保存する
      await store.switchWorkspace(newId);
    } catch (e) {
      console.error('qr import: create/switch new ws failed:', e);
      liveSettings.tags = prevTags; // タグ union をロールバック
      toast.show(t('io.ws.switch.failed'), 'error');
      runtime.bump();
      return;
    }
    close();
    toast.show(t('home.qrImport.newWs.done', { count: roster.length, label }));
  }

  // 診察開始 (= 記録クリア)。fail-closed: 保存できなければ live を戻して中断。
  async function runClear(): Promise<void> {
    setClearConfirm(false);
    const state = store.getAppState();
    await runtime.snapshots.capture(
      REASON.CLEAR,
      store.storage.getActiveWorkspaceId(),
      { title: state.title, patients: state.patients },
      String(countActivePatients(state.patients)),
    );
    const ct = store.getSettings().clearTargets;
    const now = Date.now();
    const backup = state.patients.map((p) => clone(p));
    for (const p of state.patients) {
      for (const panel of FORMAT_PANELS) {
        if (ct[panel]) clearPanelClinicalInput(p, panel, store.getSettings().formats);
      }
      if (p.status === STATUS.YELLOW && ct.statusYellow) p.status = STATUS.NONE;
      else if (p.status === STATUS.GREEN && ct.statusGreen) p.status = STATUS.NONE;
      else if (p.status === STATUS.GRAY && ct.statusGray) p.status = STATUS.NONE;
      else if (p.status === STATUS.BLUE && ct.statusBlue) p.status = STATUS.NONE;
      p.updatedAt = now;
    }
    try {
      await store.persistActiveOrThrow();
    } catch (e) {
      console.error('clear: save failed, rolling back:', e);
      state.patients = backup; // live state を破壊前へ戻す
      runtime.bump();
      toast.show(t('save.failed'), 'error');
      return; // 成功表示・event log へ進めない (fail-closed)
    }
    runtime.eventlog.log(EVENT.CLEAR);
    runtime.bump();
  }

  return (
    <section aria-label={t('header.home')}>
      <div className="viewToolbar">
        <Button onClick={() => setClearConfirm(true)} title={t('home.start.tooltip')} dataUi={UI.home.start}>
          {t('home.start.btn')}
        </Button>
        <TagFilterPicker store={store} onChange={() => runtime.bump()} />
        <span className="viewToolbarSpacer" />
        <IconButton
          label={t('home.qr.show')}
          dataUi={UI.qr.show}
          onClick={() => {
            if (flow.isActive) {
              flow.close();
            } else {
              runtime.eventlog.log(EVENT.QR_SHOW, { kind: 'HM' });
              void flow.open().catch((e) => {
                // 暗号化失敗 = QR を出さない (fail-closed)。握らず可視化。
                console.error('qr open failed:', e);
                toast.show(t('qr.render.failed'), 'error');
              });
            }
          }}
        >
          <Icon name="qr" size={18} />
        </IconButton>
      </div>

      {flow.isActive ? <QrDialog flow={flow} kindLabel={t('qr.kind.home')} onClose={flow.close} /> : null}

      {trash ? <div className="banner trashBanner">{t('trash.banner')}</div> : null}

      <div className="grid" data-ui={UI.home.grid}>
        {appState.patients.map((p, idx) => {
          // Trash では削除患者だけを出す (空スロットの inflate 分は隠す)
          if (trash && !isPatientDeleted(p)) return null;
          if (!patientMatchesSharedFilter(p)) return null;
          const no = idx + 1;
          const label = formatPatientLabel(p, String(no));
          const cls = statusClass(p.status);
          return (
            <button
              key={p.pid}
              type="button"
              className={`patientBtn ${cls}`}
              aria-label={label}
              data-ui={UI.patient.card}
              onClick={() => onOpenPatient(no)}
            >
              {p.status && p.status !== STATUS.NONE ? (
                <span className="patientBtnMark" aria-hidden="true">
                  {STATUS_MARK[p.status]}
                </span>
              ) : null}
              {label}
            </button>
          );
        })}
        {trash && !appState.patients.some(isPatientDeleted) ? (
          <p className="muted trashEmpty">{t('trash.empty')}</p>
        ) : null}
        {!trash ? (
          <button
            type="button"
            className="addPatientBtn"
            title={t('patient.add.title')}
            aria-label={t('patient.add.aria')}
            data-ui={UI.home.addPatient}
            onClick={() => {
              // 末尾に空患者を追加 → 保存予約 → すぐ患者編集を開く (pid で捕捉)
              const p = makeDefaultPatient();
              store.getAppState().patients.push(p);
              store.scheduleSave();
              setAddPid(p.pid);
              runtime.bump();
            }}
          >
            <Icon name="add" size={20} />
            <span className="addPatientBtnLabel">{t('patient.add')}</span>
          </button>
        ) : null}
      </div>

      {clearConfirm ? (
        <OverlayBinding onClose={() => setClearConfirm(false)} />
      ) : null}
      {clearConfirm ? (
        <ConfirmDialog
          title={t('home.start.btn')}
          body={t('home.start.confirm')}
          confirmLabel={t('home.start.btn')}
          cancelLabel={t('common.cancel')}
          danger
          onCancel={() => setClearConfirm(false)}
          onConfirm={() => void runClear()}
        />
      ) : null}

      {addPid != null
        ? (() => {
            // 部屋番号入力で並びが変わるため、描画ごとに pid → 現 index を解決する
            const no = appState.patients.findIndex((p) => p.pid === addPid) + 1;
            if (no <= 0) return null;
            return <PatientEditPopup patientNo={no} runtime={runtime} onClose={() => setAddPid(null)} />;
          })()
        : null}

      {pendingImport ? (
        <OverlayBinding onClose={() => setPendingImport(null)} />
      ) : null}
      {pendingImport ? (
        <ConfirmDialog
          title={t('qr.kind.home')}
          body={t('home.qrImport.newWs.confirm', {
            count: pendingImport.decoded.patients.length,
            label: formatRecvLabel(),
          })}
          confirmLabel={t('common.save')}
          cancelLabel={t('common.cancel')}
          onCancel={() => setPendingImport(null)}
          onConfirm={() => {
            const item = pendingImport;
            setPendingImport(null);
            if (item) void applyRoster(item.decoded, item.close);
          }}
        />
      ) : null}
    </section>
  );
}
