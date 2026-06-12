// 移植元: snishi-code-medical/hospital-rounds/src/views/memo.js + shared-list.js
//          + features/qr-shared.js (MM/SH フロー) + 受信ボックス (index.html #memoPasteCard 等)
//
// プロブレムリスト (panel=problem / MM) と共有 (panel=shared / SH) の一覧。構造は同一なので
// 1 コンポーネントに集約する:
//   - 行 = 患者見出しボタン (タップで詳細へ) + 該当パネルの合成本文 (タップで詳細へ)
//   - 鉛筆編集モード: 部屋/氏名のインライン編集。編集中は自動部屋順ソートを止め、
//     Back 1 回 = 編集解除のみ (useRegisterEditing → useAppHistory.isEditing)
//   - 受信ボックス (recvMemo / recvShared。病棟単位で永続化)
//   - MM/SH QR カード: 送信 = content がある患者のみ / 受信 = 受信ボックスへ整形 dump のみ
//     (患者欄への自動マッチング反映はしない — 上書き事故ゼロ)

import { useEffect, useState } from 'react';
import { Button } from '@snishi/foundation/ui/Button';
import { IconButton } from '@snishi/foundation/ui/IconButton';
import { Icon } from '@snishi/foundation/ui/Icon';
import { ConfirmDialog } from '@snishi/foundation/ui/ConfirmDialog';
import { useToast } from '@snishi/foundation/ui/toast';
import { useQrFlow } from '@snishi/foundation/qr/useQrFlow';
import type { Patient } from '../domain/types';
import { composeExpandedForPanel, composeProblemAreaText } from '../domain/payload';
import { EVENT } from '../data/eventlog';
import { encodePatientList, decodePatientList, type DecodedPatientList } from '../qr/patientList';
import { APP_KEY_BYTES } from '../qr/appKey';
import { Popup } from '@snishi/foundation/ui/Popup';
import { useRevision, type AppRuntime } from './appRuntime';
import { ensureRoomOrder, formatPatientLabel, sanitizeRoomInput, statusClass, STATUS_MARK } from './patientDisplay';
import { QrDialog } from './QrCard';
import { TagFilterPicker, TagSelection } from './TagPicker';
import { patientMatchesSharedFilter } from './tags';
import { OverlayBinding, useRegisterEditing, useRegisterOverlay } from './registries';
import { t } from '../i18n/strings';
import { UI } from '../ui-contract';
import type { HrStore } from '../data/store';

/** 編集モード行のタグピッカー (v1 makePatientTagPicker)。pid で患者を捕捉する。 */
function RowTagPicker({ store, pid, onChanged }: { store: HrStore; pid: string; onChanged: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <IconButton label={t('patientSheet.tags')} onClick={() => setOpen(true)}>
        <Icon name="tag" size={16} />
      </IconButton>
      {open ? <RowTagSheet store={store} pid={pid} onChanged={onChanged} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

function RowTagSheet({
  store,
  pid,
  onChanged,
  onClose,
}: {
  store: HrStore;
  pid: string;
  onChanged: () => void;
  onClose: () => void;
}) {
  useRegisterOverlay(onClose);
  const live = store.getAppState().patients.find((x) => x.pid === pid);
  if (!live) return null;
  return (
    <Popup ariaLabel={t('tag.sheet.title')} onClose={onClose}>
      <div className="tagFilterSheet">
        <TagSelection
          store={store}
          selected={Array.isArray(live.tags) ? live.tags : []}
          onChange={(next) => {
            // 患者は pid で handler 内に引き直す (並び替えで別患者へ書かない / 描画値を直接触らない)
            const target = store.getAppState().patients.find((x) => x.pid === pid);
            if (!target) return;
            target.tags = next;
            target.updatedAt = Date.now();
            store.scheduleSave();
            onChanged();
          }}
        />
      </div>
    </Popup>
  );
}

export type MemoSharedKind = 'memo' | 'shared';

const CONF = {
  memo: {
    panel: 'problem',
    qrKind: 'MM',
    recvKey: 'recvMemo',
    kindLabelKey: 'qr.kind.memo',
    qrShowKey: 'memo.qr.show',
    rowEmptyKey: 'memo.row.empty',
    rowOpenAriaKey: 'memo.row.openAria',
  },
  shared: {
    panel: 'shared',
    qrKind: 'SH',
    recvKey: 'recvShared',
    kindLabelKey: 'qr.kind.shared',
    qrShowKey: 'shared.qr.show',
    rowEmptyKey: 'shared.row.empty',
    rowOpenAriaKey: 'shared.row.openAria',
  },
} as const;

export function MemoSharedView({
  kind,
  runtime,
  onOpenPatient,
}: {
  kind: MemoSharedKind;
  runtime: AppRuntime;
  onOpenPatient: (no: number) => void;
}) {
  const conf = CONF[kind];
  const toast = useToast();
  const revision = useRevision(runtime);
  const { store } = runtime;
  const appState = store.getAppState();
  const settings = store.getSettings();

  const [editMode, setEditMode] = useState(false);
  const [recvOpen, setRecvOpen] = useState(false);
  const [recvClearConfirm, setRecvClearConfirm] = useState(false);

  // 編集中は Back 1 回 = 編集解除のみ (view 遷移しない)
  useRegisterEditing(editMode, () => setEditMode(false));

  // 編集中はインライン部屋入力があるので並べ替えない (患者取り違え防止)
  if (!editMode) ensureRoomOrder(appState.patients);

  // memo (プロブレムリスト) は患者ごとの独立データ problems が正本 (legacy problem パネル併記)。
  // shared は従来どおり shared パネルのフォーマット合成。
  const contentOf = (p: Patient) =>
    kind === 'memo'
      ? composeProblemAreaText(p, store.getSettings())
      : composeExpandedForPanel(conf.panel, p.formatValues, store.getSettings());

  const flow = useQrFlow<DecodedPatientList>({
    kind: conf.qrKind,
    kindLabel: t(conf.kindLabelKey),
    keyBytes: APP_KEY_BYTES,
    encodePayload: () =>
      encodePatientList(store.getAppState().patients, store.getSettings(), {
        kind: conf.qrKind,
        includeEmpty: false,
        contentOf,
      }),
    decodePayload: (plain) => decodePatientList(plain),
    shouldEncrypt: () => !!store.getSettings().qrEncryption?.[conf.qrKind],
    onApply(decoded, ctrl) {
      const entries = decoded.patients;
      if (!entries.length) {
        toast.show(t('qr.import.empty.shared'), 'error');
        return;
      }
      // 受信は受信ボックスへ整形して追記するだけ (マッチング・上書きはしない = v8.x 統一)
      const resolveTag = (idx: number) => store.getSettings().tags?.[idx - 1] || `#${idx}`;
      const pretty = entries
        .map((e) => {
          const tagsText = e.tagIdxs.length ? ` [${e.tagIdxs.map(resolveTag).join(', ')}]` : '';
          return `【${e.name || '?'} (${e.room || '?'})】${tagsText}\n${e.content}`;
        })
        .join('\n\n');
      const cur = store.getAppState()[conf.recvKey] || '';
      const sep = cur && !cur.endsWith('\n') ? '\n' : '';
      store.setRecvContent(conf.recvKey, cur + sep + pretty); // scheduleSave 込み
      runtime.bump();
      setRecvOpen(true);
      toast.show(t('qr.recv.complete', { total: entries.length }));
      ctrl.close();
    },
  });

  const refreshQr = flow.refresh;
  useEffect(() => {
    void refreshQr();
  }, [revision, refreshQr]);

  const recvContent = appState[conf.recvKey] || '';

  return (
    <section aria-label={t(conf.kindLabelKey)}>
      <div className="viewToolbar">
        <Button
          onClick={() => setEditMode((v) => !v)}
          aria-pressed={editMode}
          title={t(kind === 'memo' ? 'memo.edit.tooltip' : 'shared.edit.tooltip')}
          dataUi={UI.list.editToggle}
        >
          {t('common.edit')}
        </Button>
        {!recvOpen && recvContent ? (
          <Button onClick={() => setRecvOpen(true)} dataUi={UI.recv.open}>
            {t('recv.open')}
          </Button>
        ) : null}
        <TagFilterPicker store={store} onChange={() => runtime.bump()} />
        <span className="viewToolbarSpacer" />
        <IconButton
          label={t(conf.qrShowKey)}
          dataUi={UI.qr.show}
          onClick={() => {
            if (flow.isActive) {
              flow.close();
            } else {
              runtime.eventlog.log(EVENT.QR_SHOW, { kind: conf.qrKind });
              void flow.open().catch((e) => {
                console.error('qr open failed:', e);
                toast.show(t('qr.render.failed'), 'error');
              });
            }
          }}
        >
          <Icon name="qr" size={18} />
        </IconButton>
      </div>

      {flow.isActive ? <QrDialog flow={flow} kindLabel={t(conf.kindLabelKey)} onClose={flow.close} /> : null}

      {recvOpen ? (
        <div className="card recvCard" data-ui={UI.recv.box}>
          <div className="recvCardHead">
            <span className="section-label">{t('recv.label')}</span>
          </div>
          <p className="muted recvHint">{t('recv.hint')}</p>
          <textarea
            className="textarea recvArea"
            rows={6}
            value={recvContent}
            aria-label={t('recv.label')}
            data-ui={UI.recv.area}
            onChange={(e) => {
              store.setRecvContent(conf.recvKey, e.target.value);
              runtime.bump();
            }}
          />
          <div className="recvActions">
            <Button onClick={() => setRecvClearConfirm(true)} dataUi={UI.recv.clear}>
              {t('recv.clear')}
            </Button>
            <Button onClick={() => setRecvOpen(false)}>{t('common.close')}</Button>
          </div>
        </div>
      ) : null}

      <div className="memoList">
        {appState.patients.map((p, idx) => {
          if (!patientMatchesSharedFilter(p)) return null;
          const no = idx + 1;
          const label = formatPatientLabel(p, String(no));
          const composed =
            kind === 'memo'
              ? composeProblemAreaText(p, settings)
              : composeExpandedForPanel(conf.panel, p.formatValues, settings);
          return (
            <div key={p.pid} className={`memoRow ${editMode ? 'edit' : 'read'}`} data-ui={UI.list.row}>
              {editMode ? (
                <div className="memoRowEdit">
                  <input
                    className="input roomInput"
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    maxLength={6}
                    autoComplete="off"
                    defaultValue={p.room}
                    aria-label={t('patientSheet.room')}
                    data-ui={UI.patient.room}
                    onInput={(e) => {
                      const el = e.target as HTMLInputElement;
                      const cleaned = sanitizeRoomInput(el.value);
                      if (cleaned !== el.value) el.value = cleaned;
                      // 患者は pid で捕捉し handler 内で live を引き直す
                      // (並び替えで別患者へ書かない)
                      const live = store.getAppState().patients.find((x) => x.pid === p.pid);
                      if (!live) return;
                      if (live.room !== cleaned) live.room = cleaned;
                      live.updatedAt = Date.now();
                      store.scheduleSave();
                    }}
                  />
                  <input
                    className="input memoNameInput"
                    type="text"
                    autoComplete="off"
                    placeholder={String(no)}
                    defaultValue={p.name}
                    aria-label={t('patientSheet.name')}
                    data-ui={UI.patient.name}
                    onInput={(e) => {
                      const next = (e.target as HTMLInputElement).value;
                      const live = store.getAppState().patients.find((x) => x.pid === p.pid);
                      if (!live) return;
                      if (live.name !== next) live.name = next;
                      live.updatedAt = Date.now();
                      store.scheduleSave();
                    }}
                  />
                  <RowTagPicker store={store} pid={p.pid} onChanged={() => runtime.bump()} />
                </div>
              ) : (
                <button
                  type="button"
                  className={`memoNoBtn ${statusClass(p.status)}`}
                  title={label}
                  aria-label={label}
                  data-ui={UI.patient.card}
                  onClick={() => onOpenPatient(no)}
                >
                  {p.status !== 'none' ? (
                    <span className="patientBtnMark" aria-hidden="true">
                      {STATUS_MARK[p.status]}
                    </span>
                  ) : null}
                  {label}
                </button>
              )}
              <div
                className={`memoRowBody${composed ? '' : ' empty'}`}
                role="button"
                tabIndex={0}
                title={t(conf.rowOpenAriaKey)}
                aria-label={t(conf.rowOpenAriaKey)}
                data-ui={UI.list.rowBody}
                onClick={() => onOpenPatient(no)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') onOpenPatient(no);
                }}
              >
                {composed || t(conf.rowEmptyKey)}
              </div>
            </div>
          );
        })}
      </div>

      {recvClearConfirm ? (
        <OverlayBinding onClose={() => setRecvClearConfirm(false)} />
      ) : null}
      {recvClearConfirm ? (
        <ConfirmDialog
          title={t('recv.clear')}
          body={t('recv.clear.confirm')}
          confirmLabel={t('recv.clear')}
          cancelLabel={t('common.cancel')}
          danger
          onCancel={() => setRecvClearConfirm(false)}
          onConfirm={() => {
            store.setRecvContent(conf.recvKey, '');
            runtime.bump();
            setRecvClearConfirm(false);
          }}
        />
      ) : null}
    </section>
  );
}
