// 移植元: snishi-code-medical/hospital-rounds/src/features/patient-sheet.js
//
// 患者シート (ホーム患者カード追加直後 / 詳細の患者メタボタンから開く):
// ステータス (最上部 = 開いた指のすぐ近く) → 部屋番号 / 氏名 → タグ。
// ステータス変更は患者ボタンタップ直後に行う最頻操作なので、ボタン位置 (画面上部) から
// 指の移動距離が最小になる先頭に置く (ユーザー意図: 部屋番号付近の自然な位置)。
// v1 と同じく「キャンセル/保存ボタンなし・即時反映 (write-through)」。
// 可視タイトルは出さない (見れば分かる)。aria 上の名前は Modal の sr-only title で維持。
// フォーマットセット選択 UI は撤去済み (複数セット運用 UI を削除したため)。

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
      titleVariant="sr-only"
      onClose={onClose}
      variant="dialog"
      dataUi={UI.patient.editPopup}
      closeLabel={t('common.close')}
    >
      {/* ── 最上部: ステータス (色ボックス + 形マークのみ。色名テキストは出さない —
          aria/title で読める)。最頻操作なので指の移動距離が最小の先頭に置く。 ── */}
      <div className="patientSheetField patientSheetStatusField">
        <span className="patientSheetFieldLabel">{t('patientSheet.status')}</span>
        <div className="statusPickerList">
          {getStatusOptions().map((opt) => (
            <button
              key={opt.status}
              type="button"
              className={`statusPickerBox ${statusClass(opt.status) || 'status-none'}${p.status === opt.status ? ' selected' : ''}`}
              aria-pressed={p.status === opt.status}
              aria-label={opt.label}
              title={opt.label}
              data-ui={UI.patient.statusOption}
              onClick={() => commit(() => (p.status = opt.status as PatientStatus))}
            >
              <span aria-hidden="true">{opt.mark}</span>
            </button>
          ))}
        </div>
      </div>

      {/* ── 部屋番号 + 氏名 (頻繁に編集しないのでコンパクト横並び) ── */}
      <div className="patientSheetInfoRow">
        <label className="patientSheetInfoCell patientSheetRoomCell">
          <span className="patientSheetInfoLabel">{t('patientSheet.room')}</span>
          <input
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
        </label>
        <label className="patientSheetInfoCell patientSheetNameCell">
          <span className="patientSheetInfoLabel">{t('patientSheet.name')}</span>
          <input
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
        </label>
      </div>

      {/* ── 中央: タグ ── */}
      <div className="patientSheetField patientSheetTagsField">
        <span className="patientSheetFieldLabel">{t('patientSheet.tags')}</span>
        <TagSelection
          store={store}
          selected={Array.isArray(p.tags) ? p.tags : []}
          onChange={(next) => commit(() => (p.tags = next))}
        />
      </div>
    </Modal>
  );
}
