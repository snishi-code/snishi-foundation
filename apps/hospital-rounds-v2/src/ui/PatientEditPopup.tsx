// 移植元: snishi-code-medical/hospital-rounds/src/features/patient-sheet.js (簡約版)
//
// 患者ヘッダ (詳細) から開く患者情報編集: ステータス / 部屋番号 / 氏名 / タグ。
// v1 患者シートと同じく「キャンセル/保存ボタンなし・即時反映 (write-through)」。

import { Modal } from '@snishi/foundation/ui/Modal';
import type { PatientStatus } from '../domain/types';
import type { AppRuntime } from './appRuntime';
import { getStatusOptions, sanitizeRoomInput, statusClass } from './patientDisplay';
import { TagSelection } from './TagPicker';
import { t } from '../i18n/strings';
import { UI } from '../ui-contract';
import { useRegisterOverlay } from './registries';

export function PatientEditPopup({
  patientNo,
  runtime,
  onClose,
}: {
  patientNo: number;
  runtime: AppRuntime;
  onClose: () => void;
}) {
  useRegisterOverlay(onClose);
  const { store } = runtime;
  const p = store.getAppState().patients[patientNo - 1];
  if (!p) return null;

  function commit(mutate: () => void): void {
    mutate();
    store.markUpdated(patientNo); // notify → bump (再描画) + updatedAt
    store.scheduleSave();
  }

  return (
    <Modal
      title={t('patientSheet.title')}
      onClose={onClose}
      variant="dialog"
      dataUi={UI.patient.editPopup}
      closeLabel={t('common.close')}
    >
      <div className="field">
        <span className="field__label">{t('patientSheet.status')}</span>
        <div className="statusPickerList statusPickerInline">
          {getStatusOptions().map((opt) => (
            <button
              key={opt.status}
              type="button"
              className={`statusOption ${statusClass(opt.status)}${p.status === opt.status ? ' selected' : ''}`}
              aria-pressed={p.status === opt.status}
              data-ui={UI.patient.statusOption}
              onClick={() => commit(() => (p.status = opt.status as PatientStatus))}
            >
              <span className="statusOptionMark" aria-hidden="true">
                {opt.mark}
              </span>
              {opt.label}
            </button>
          ))}
        </div>
      </div>
      <div className="field">
        <label className="field__label" htmlFor="hrPatientRoom">
          {t('patientSheet.room')}
        </label>
        <input
          id="hrPatientRoom"
          className="input"
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          maxLength={6}
          autoComplete="off"
          defaultValue={p.room}
          data-ui={UI.patient.room}
          onInput={(e) => {
            const el = e.target as HTMLInputElement;
            const cleaned = sanitizeRoomInput(el.value);
            if (cleaned !== el.value) el.value = cleaned;
            commit(() => (p.room = cleaned));
          }}
        />
      </div>
      <div className="field">
        <label className="field__label" htmlFor="hrPatientName">
          {t('patientSheet.name')}
        </label>
        <input
          id="hrPatientName"
          className="input"
          type="text"
          autoComplete="off"
          defaultValue={p.name}
          data-ui={UI.patient.name}
          onInput={(e) => {
            const next = (e.target as HTMLInputElement).value;
            commit(() => (p.name = next));
          }}
        />
      </div>
      <div className="field">
        <span className="field__label">{t('patientSheet.tags')}</span>
        <TagSelection
          store={store}
          selected={Array.isArray(p.tags) ? p.tags : []}
          onChange={(next) => commit(() => (p.tags = next))}
        />
      </div>
    </Modal>
  );
}
