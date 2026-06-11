// 移植元: snishi-code-medical/hospital-rounds/src/features/patient-sheet.js
//
// 患者シート (ホーム患者カード追加直後 / 詳細の患者メタボタンから開く):
// ステータス (最上部 = 開いた指のすぐ近く) → 部屋番号 / 氏名 → タグ → フォーマットセット。
// ステータス変更は患者ボタンタップ直後に行う最頻操作なので、ボタン位置 (画面上部) から
// 指の移動距離が最小になる先頭に置く (ユーザー意図: 部屋番号付近の自然な位置)。
// v1 と同じく「キャンセル/保存ボタンなし・即時反映 (write-through)」。
// 可視タイトルは出さない (見れば分かる)。aria 上の名前は Modal の sr-only title で維持。

import { useState } from 'react';
import { Modal } from '@snishi/foundation/ui/Modal';
import { Popup } from '@snishi/foundation/ui/Popup';
import type { FormatGroup, PatientStatus } from '../domain/types';
import { resolveActiveGroup } from '../domain/payload';
import type { AppRuntime } from './appRuntime';
import { getStatusOptions, sanitizeRoomInput, statusClass } from './patientDisplay';
import { TagSelection } from './TagPicker';
import { t } from '../i18n/strings';
import { UI } from '../ui-contract';
import { useRegisterOverlay } from './registries';

/** フォーマットセット選択 (単一選択 = 選んだら即閉じる。v1 openFormatGroupPicker)。 */
function FormatGroupPicker({
  groups,
  currentId,
  onPick,
  onClose,
}: {
  groups: FormatGroup[];
  currentId: string;
  onPick: (group: FormatGroup) => void;
  onClose: () => void;
}) {
  useRegisterOverlay(onClose);
  return (
    <Popup ariaLabel={t('patientSheet.formatSet.change')} onClose={onClose}>
      <div className="pickerList" role="listbox" aria-label={t('patientSheet.formatSet.change')}>
        {groups.map((g) => (
          <button
            key={g.id}
            type="button"
            role="option"
            aria-selected={g.id === currentId}
            className={`pickerRowMain formatGroupPickerRow${g.id === currentId ? ' selected' : ''}`}
            onClick={() => {
              onPick(g);
              onClose();
            }}
          >
            <span className="pickerRowLabel">{g.name || t('formatGroup.option.none.label')}</span>
            {g.isDefault ? <span className="pickerRowMeta">{t('formatGroup.defaultBadge')}</span> : null}
          </button>
        ))}
      </div>
    </Popup>
  );
}

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
  const [setPickerOpen, setSetPickerOpen] = useState(false);
  const { store } = runtime;
  const settings = store.getSettings();
  const p = store.getAppState().patients[patientNo - 1];
  if (!p) return null;

  function commit(mutate: () => void): void {
    mutate();
    store.markUpdated(patientNo); // notify → bump (再描画) + updatedAt
    store.scheduleSave();
  }

  const activeGroup = resolveActiveGroup(p, settings);
  const groups = Array.isArray(settings.formatGroups) ? settings.formatGroups : [];

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

      {/* ── フォーマットセット (この患者の表示切替。v1 Phase 6 で患者シートへ移設) ── */}
      <div className="patientSheetField">
        <span className="patientSheetFieldLabel">{t('patientSheet.formatSet')}</span>
        <button
          type="button"
          className="btn patientSheetSetBtn"
          aria-label={t('patientSheet.formatSet.change')}
          data-ui={UI.patient.formatSet}
          onClick={() => setSetPickerOpen(true)}
        >
          {activeGroup?.name || t('formatGroup.option.none.label')}
        </button>
      </div>

      {setPickerOpen ? (
        <FormatGroupPicker
          groups={groups}
          currentId={activeGroup?.id || ''}
          onPick={(g) => commit(() => (p.activeFormatGroupId = g.id))}
          onClose={() => setSetPickerOpen(false)}
        />
      ) : null}
    </Modal>
  );
}
