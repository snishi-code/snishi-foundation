// 移植元: snishi-code-medical/hospital-rounds/src/features/patient-sheet.js のステータス選択部
//
// ステータス選択ポップアップ (色 + 形マーク + ラベル。色だけに依存しない)。
// 単一選択 = 選んだら即閉じる (v1 popup 規約)。

import { Popup } from '@snishi/foundation/ui/Popup';
import type { PatientStatus } from '../domain/types';
import { getStatusOptions, statusClass } from './patientDisplay';
import { t } from '../i18n/strings';
import { UI } from '../ui-contract';
import { useRegisterOverlay } from './registries';

export function StatusPicker({
  current,
  onPick,
  onClose,
}: {
  current: PatientStatus;
  onPick: (status: PatientStatus) => void;
  onClose: () => void;
}) {
  useRegisterOverlay(onClose);
  return (
    <Popup ariaLabel={t('status.picker.title')} onClose={onClose}>
      <div className="statusPickerList" role="listbox" aria-label={t('status.picker.title')}>
        {getStatusOptions().map((opt) => (
          <button
            key={opt.status}
            type="button"
            role="option"
            aria-selected={opt.status === current}
            className={`statusOption ${statusClass(opt.status)}${opt.status === current ? ' selected' : ''}`}
            data-ui={UI.patient.statusOption}
            onClick={() => {
              onPick(opt.status);
              onClose();
            }}
          >
            <span className="statusOptionMark" aria-hidden="true">
              {opt.mark}
            </span>
            {opt.label}
          </button>
        ))}
      </div>
    </Popup>
  );
}
