// 移植元: snishi-code-medical/hospital-rounds/src/features/move-patient.js のピッカー UI 部
//
// 患者の移動先ピッカー: 既存病棟一覧 + 「＋ 新しい病棟へ移動」。確認 → movePatients
// (fail-closed・補償付き、データ部は ui/movePatient.ts)。失敗は toast で可視化して中断。

import { useEffect, useState } from 'react';
import { Modal } from '@snishi/foundation/ui/Modal';
import { ConfirmDialog } from '@snishi/foundation/ui/ConfirmDialog';
import { useToast } from '@snishi/foundation/ui/toast';
import type { AppRuntime } from './appRuntime';
import { listOtherWorkspaces, movePatients, moveToNewWorkspace } from './movePatient';
import type { WorkspaceListing } from '../data/storage';
import { formatPatientLabel, isPatientTransferred } from './patientDisplay';
import { t } from '../i18n/strings';
import { UI } from '../ui-contract';
import { OverlayBinding, useRegisterOverlay } from './registries';

type PendingMove = { kind: 'existing'; ws: WorkspaceListing } | { kind: 'new'; label: string };

export function MovePatientDialog({
  patientIndex,
  runtime,
  onClose,
  onMoved,
}: {
  /** 0-based 患者 index */
  patientIndex: number;
  runtime: AppRuntime;
  onClose: () => void;
  onMoved?: () => void;
}) {
  useRegisterOverlay(onClose);
  const toast = useToast();
  const { store } = runtime;
  const [list, setList] = useState<WorkspaceListing[] | null>(null);
  const [pending, setPending] = useState<PendingMove | null>(null);
  const [newLabel, setNewLabel] = useState('');
  const [askNewLabel, setAskNewLabel] = useState(false);
  const [busy, setBusy] = useState(false);

  const patient = store.getAppState().patients[patientIndex] ?? null;
  const patientLabel = formatPatientLabel(patient, String(patientIndex + 1));

  useEffect(() => {
    let alive = true;
    void listOtherWorkspaces(store).then(
      (ws) => {
        if (alive) setList(ws);
      },
      () => {
        if (alive) setList([]);
      },
    );
    return () => {
      alive = false;
    };
  }, [store]);

  async function run(target: PendingMove): Promise<void> {
    if (busy) return;
    setBusy(true);
    try {
      const deps = { store, snapshots: runtime.snapshots };
      const dest = target.kind === 'existing' ? target.ws.label || target.ws.title : target.label;
      const n =
        target.kind === 'existing'
          ? await movePatients(deps, [patientIndex], target.ws.id, dest)
          : await moveToNewWorkspace(deps, [patientIndex], target.label);
      if (n > 0) {
        toast.show(t('move.done', { dest }));
        runtime.bump();
        onClose();
        if (onMoved) onMoved();
      } else {
        // 0 件 = 対象なし (空/移動済)。失敗とは区別して通知 (fail-visible)。
        toast.show(t('move.failed'), 'error');
        onClose();
      }
    } catch (e) {
      console.error('move failed:', e);
      toast.show(t('move.failed'), 'error');
      runtime.bump(); // 補償後の状態を再描画
    } finally {
      setBusy(false);
      setPending(null);
    }
  }

  if (patient && isPatientTransferred(patient)) {
    return (
      <Modal title={t('move.title')} onClose={onClose} variant="dialog" dataUi={UI.move.dialog} closeLabel={t('common.close')}>
        <p>{t('move.already.transferred', { dest: patient.transferredTo || '?' })}</p>
      </Modal>
    );
  }

  return (
    <>
      <Modal title={t('move.title')} onClose={onClose} variant="dialog" dataUi={UI.move.dialog} closeLabel={t('common.close')}>
        <p className="muted">{t('move.hint')}</p>
        <div className="menu-list">
          {list === null ? null : list.length === 0 ? <p className="muted">{t('move.list.empty')}</p> : null}
          {(list ?? []).map((ws) => (
            <button
              key={ws.id}
              type="button"
              className="menu-item"
              disabled={busy}
              data-ui={`${UI.move.rowPrefix}.${ws.id}`}
              onClick={() => setPending({ kind: 'existing', ws })}
            >
              {ws.label || ws.title || ws.id}
            </button>
          ))}
          {askNewLabel ? (
            <div className="moveNewWsRow">
              <input
                className="input"
                type="text"
                placeholder={t('move.newWs.prompt')}
                value={newLabel}
                autoComplete="off"
                aria-label={t('move.newWs.prompt')}
                onChange={(e) => setNewLabel(e.target.value)}
              />
              <button
                type="button"
                className="btn"
                disabled={busy}
                onClick={() => setPending({ kind: 'new', label: newLabel.trim() || t('move.newWs.default') })}
              >
                {t('patient.move')}
              </button>
            </div>
          ) : (
            <button
              type="button"
              className="menu-item"
              disabled={busy}
              data-ui={UI.move.newWs}
              onClick={() => setAskNewLabel(true)}
            >
              {t('move.newWs.row')}
            </button>
          )}
        </div>
      </Modal>
      {pending ? <OverlayBinding onClose={() => setPending(null)} /> : null}
      {pending ? (
        <ConfirmDialog
          title={t('move.title')}
          body={t('move.confirm', {
            patient: patientLabel,
            dest: pending.kind === 'existing' ? pending.ws.label || pending.ws.title : pending.label,
          })}
          confirmLabel={t('patient.move')}
          cancelLabel={t('common.cancel')}
          onCancel={() => setPending(null)}
          onConfirm={() => void run(pending)}
        />
      ) : null}
    </>
  );
}
