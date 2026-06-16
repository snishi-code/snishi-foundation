// 移植元: snishi-code-medical/hospital-rounds/src/views/detail.js の renderLifecycleActions
//
// 詳細画面下部の「患者管理」エリア。文脈で出すボタンを切り替える:
//   通常病棟・通常患者 : 転棟 / 削除 (Trash 退避)
//   通常病棟・(移) 患者: 完全削除 のみ (転棟は不可)
//   通常病棟・空スロット: 削除 (単純除去。30日保存しない)
//   削除済み病棟 (Trash): 転棟して復元 / 完全削除 + 注意書き
// 削除/復元は confirm → API (fail-closed) → 失敗は toast で中断 / 成功はホームへ。

import { useEffect, useState } from 'react';
import { Modal } from '@snishi/foundation/ui/Modal';
import { ConfirmDialog } from '@snishi/foundation/ui/ConfirmDialog';
import { useToast } from '@snishi/foundation/ui/toast';
import { isPatientEmpty } from '../domain/normalize';
import type { Patient } from '../domain/types';
import type { WorkspaceListing } from '../data/storage';
import type { AppRuntime } from './appRuntime';
import { listOtherWorkspaces } from './movePatient';
import {
  deletePatientToTrash,
  isTrashActive,
  isTrashWorkspaceId,
  permanentlyDeletePatient,
  restoreDeletedPatientToWorkspace,
  type LifecycleResult,
} from './patientLifecycle';
import { isPatientTransferred } from './patientDisplay';
import { MovePatientDialog } from './MovePatientDialog';
import { OverlayBinding, useRegisterOverlay } from './registries';
import { t } from '../i18n/strings';
import { UI } from '../ui-contract';
import type { StringKey } from '../i18n/strings';

type PendingAction = {
  confirmKey: StringKey;
  run: () => Promise<LifecycleResult>;
};

/** 復元先 (通常病棟) ピッカー。Trash と現アクティブを除く。 */
function RestoreDestDialog({
  runtime,
  patientIndex,
  onDone,
  onClose,
}: {
  runtime: AppRuntime;
  patientIndex: number;
  onDone: () => void;
  onClose: () => void;
}) {
  useRegisterOverlay(onClose);
  const toast = useToast();
  const { store } = runtime;
  const [list, setList] = useState<WorkspaceListing[] | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    void listOtherWorkspaces(store).then(
      (ws) => {
        if (alive) setList(ws.filter((r) => !isTrashWorkspaceId(r.id)));
      },
      () => {
        if (alive) setList([]);
      },
    );
    return () => {
      alive = false;
    };
  }, [store]);

  async function run(ws: WorkspaceListing): Promise<void> {
    if (busy) return;
    setBusy(true);
    try {
      const res = await restoreDeletedPatientToWorkspace(
        { store, snapshots: runtime.snapshots },
        patientIndex,
        ws.id,
      );
      if (!res.ok) {
        toast.show(t('patient.restore.failed'), 'error');
        runtime.bump();
        return;
      }
      runtime.bump();
      onClose();
      onDone();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title={t('patient.restore.title')}
      onClose={onClose}
      variant="dialog"
      dataUi={UI.lifecycle.restoreDialog}
      closeLabel={t('common.close')}
    >
      <div className="menu-list">
        {list !== null && list.length === 0 ? <p className="muted">{t('move.list.empty')}</p> : null}
        {(list ?? []).map((ws) => (
          <button
            key={ws.id}
            type="button"
            className="menu-item"
            disabled={busy}
            onClick={() => void run(ws)}
          >
            {ws.label || ws.title || ws.id}
          </button>
        ))}
      </div>
    </Modal>
  );
}

export function PatientLifecyclePanel({
  runtime,
  patient,
  patientIndex,
  onDone,
}: {
  runtime: AppRuntime;
  patient: Patient;
  /** 0-based index */
  patientIndex: number;
  /** 削除/復元の成功後 (= この患者が現病棟から消えた後) に呼ぶ。ホームへ戻す等 */
  onDone: () => void;
}) {
  const toast = useToast();
  const { store } = runtime;
  const [pending, setPending] = useState<PendingAction | null>(null);
  const [moveOpen, setMoveOpen] = useState(false);
  const [restoreOpen, setRestoreOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const trash = isTrashActive(store);
  // 受信病棟 (recipient) の名簿管理患者は手動転棟・削除を抑止 (正本端末で行う)。
  // Trash 内は復元/完全削除を維持するため除外する。
  const rosterLocked =
    !trash && store.getActiveRosterMeta().localRole === 'recipient' && patient.rosterManaged;
  const deps = { store, snapshots: runtime.snapshots };

  async function exec(action: PendingAction): Promise<void> {
    if (busy) return;
    setBusy(true);
    try {
      const res = await action.run();
      if (!res.ok) {
        toast.show(t('patient.delete.failed'), 'error');
        runtime.bump();
        return;
      }
      runtime.bump();
      onDone();
    } finally {
      setBusy(false);
      setPending(null);
    }
  }

  const buttons: Array<{ key: string; label: string; dataUi: string; danger?: boolean; onClick: () => void }> = [];
  if (rosterLocked) {
    // 受信した名簿の患者: 手動転棟・削除を出さない (buttons 空 → 下部に注記を出す)。
  } else if (trash) {
    buttons.push({
      key: 'restore',
      label: t('patient.restore'),
      dataUi: UI.lifecycle.restore,
      onClick: () => setRestoreOpen(true),
    });
    buttons.push({
      key: 'permanent',
      label: t('patient.delete.permanentBtn'),
      dataUi: UI.lifecycle.permanentDelete,
      danger: true,
      onClick: () =>
        setPending({
          confirmKey: 'patient.delete.permanent.confirm',
          run: () => permanentlyDeletePatient(deps, patientIndex),
        }),
    });
  } else if (isPatientTransferred(patient)) {
    // (移) 患者の削除は Trash へ送らず完全削除
    buttons.push({
      key: 'permanent',
      label: t('patient.delete.permanentBtn'),
      dataUi: UI.lifecycle.permanentDelete,
      danger: true,
      onClick: () =>
        setPending({
          confirmKey: 'patient.delete.permanent.confirm',
          run: () => permanentlyDeletePatient(deps, patientIndex),
        }),
    });
  } else if (isPatientEmpty(patient)) {
    // 空スロット: 転棟は出さない (移す中身が無い)。削除は単純除去。
    buttons.push({
      key: 'delete',
      label: t('patient.delete'),
      dataUi: UI.lifecycle.delete,
      danger: true,
      onClick: () =>
        setPending({
          confirmKey: 'patient.delete.emptySlot.confirm',
          run: () => permanentlyDeletePatient(deps, patientIndex),
        }),
    });
  } else {
    buttons.push({
      key: 'move',
      label: t('patient.move'),
      dataUi: UI.patient.move,
      onClick: () => setMoveOpen(true),
    });
    buttons.push({
      key: 'delete',
      label: t('patient.delete'),
      dataUi: UI.lifecycle.delete,
      danger: true,
      onClick: () =>
        setPending({
          confirmKey: 'patient.delete.toTrash.confirm',
          run: () => deletePatientToTrash(deps, patientIndex),
        }),
    });
  }

  return (
    <div className="lifecycleActions">
      {trash ? <p className="muted lifecycleNote">{t('trash.detail.note')}</p> : null}
      {rosterLocked ? (
        <p className="muted lifecycleNote">{t('patient.roster.managedActionDisabled')}</p>
      ) : null}
      <div className="section-label">{t('patient.lifecycle.actions.title')}</div>
      <div className="lifecycleBtnRow">
        {buttons.map((b) => (
          <button
            key={b.key}
            type="button"
            className={`btn${b.danger ? ' btn--danger' : ''}`}
            disabled={busy}
            data-ui={b.dataUi}
            onClick={b.onClick}
          >
            {b.label}
          </button>
        ))}
      </div>

      {pending ? <OverlayBinding onClose={() => setPending(null)} /> : null}
      {pending ? (
        <ConfirmDialog
          title={t('patient.lifecycle.actions.title')}
          body={t(pending.confirmKey)}
          confirmLabel={t('common.delete')}
          cancelLabel={t('common.cancel')}
          danger
          onCancel={() => setPending(null)}
          onConfirm={() => void exec(pending)}
        />
      ) : null}

      {moveOpen ? (
        <MovePatientDialog
          patientIndex={patientIndex}
          runtime={runtime}
          onClose={() => setMoveOpen(false)}
          onMoved={onDone}
        />
      ) : null}

      {restoreOpen ? (
        <RestoreDestDialog
          runtime={runtime}
          patientIndex={patientIndex}
          onDone={onDone}
          onClose={() => setRestoreOpen(false)}
        />
      ) : null}
    </div>
  );
}
