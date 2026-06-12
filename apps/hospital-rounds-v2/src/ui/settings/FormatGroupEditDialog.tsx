// 移植元: snishi-code-medical/hospital-rounds/src/features/format-groups.js の
//          設定画面グループ CRUD UI 部 (openEditModal / renderFormatsCheckList / saveEdit)
//
// セット (formatGroup) 編集: パネル別フォーマットチェックリスト (含める + 展開/クイック 2 択)。
// v1 の draft 直接 mutate でなく useState の immutable 更新。
// 複数セット運用 UI は撤去済み。常にデフォルトセット 1 つを編集する。
// 不変条件:
//   - 含むパネルごとに展開フォーマット最低 1 つ (isLastExpandInPanel でブロック +
//     保存時 repairGroupExpandInvariant で防御的補修)

import { useState } from 'react';
import { Modal } from '@snishi/foundation/ui/Modal';
import { Button } from '@snishi/foundation/ui/Button';
import { useToast } from '@snishi/foundation/ui/toast';
import { FORMAT_PANELS, type FormatGroup, type FormatPanel } from '../../domain/types';
import { isLastExpandInPanel, repairGroupExpandInvariant } from '../../domain/formatValues';
import type { AppRuntime } from '../appRuntime';
import { useRegisterOverlay } from '../registries';
import { t } from '../../i18n/strings';
import { UI } from '../../ui-contract';

export function FormatGroupEditDialog({
  runtime,
  group,
  onSaved,
  onClose,
}: {
  runtime: AppRuntime;
  /** デフォルトグループ (必須) */
  group: FormatGroup;
  onSaved?: (saved: FormatGroup) => void;
  onClose: () => void;
}) {
  useRegisterOverlay(onClose);
  const toast = useToast();
  const { store } = runtime;

  const [target, setTarget] = useState<FormatGroup>(() => ({
    id: group.id,
    name: group.name,
    isDefault: !!group.isDefault,
    formatIds: Array.isArray(group.formatIds) ? group.formatIds.slice() : [],
    defaultFormatIds: Array.isArray(group.defaultFormatIds) ? group.defaultFormatIds.slice() : [],
    expandFormatIds: Array.isArray(group.expandFormatIds) ? group.expandFormatIds.slice() : [],
  }));
  const allFormats = store.getSettings().formats || [];

  function toggleInclude(formatId: string, panel: FormatPanel, next: boolean): void {
    if (!next && isLastExpandInPanel(target, allFormats, formatId, panel)) {
      // そのパネルの「最後の展開フォーマット」をセットから外すのは不可
      toast.show(t('formatGroup.expand.lastBlocked', { panel: t(`panel.${panel}`) }), 'error');
      return;
    }
    setTarget((prev) => {
      if (next) {
        if (prev.formatIds.includes(formatId)) return prev;
        return { ...prev, formatIds: [...prev.formatIds, formatId] };
      }
      return {
        ...prev,
        formatIds: prev.formatIds.filter((x) => x !== formatId),
        defaultFormatIds: prev.defaultFormatIds.filter((x) => x !== formatId),
        expandFormatIds: (prev.expandFormatIds || []).filter((x) => x !== formatId),
      };
    });
  }

  // 表示方法 2 択: 展開(A) = expandFormatIds / クイック(B) = どちらにも入れない。
  // 旧「規定文」(defaultFormatIds) はデータ層温存・UI 非露出 (v1 P5 P1 と同じ)。
  function setMode(formatId: string, panel: FormatPanel, next: 'expand' | 'quick'): void {
    if (next !== 'expand' && isLastExpandInPanel(target, allFormats, formatId, panel)) {
      toast.show(t('formatGroup.expand.lastBlocked', { panel: t(`panel.${panel}`) }), 'error');
      return;
    }
    setTarget((prev) => {
      const expand = (prev.expandFormatIds || []).filter((x) => x !== formatId);
      if (next === 'expand') expand.push(formatId);
      return {
        ...prev,
        expandFormatIds: expand,
        // 旧「規定文」割当が残っていたら、表示方法を触ったタイミングで整理する
        defaultFormatIds: prev.defaultFormatIds.filter((x) => x !== formatId),
      };
    });
  }

  function save(): void {
    const settings = store.getSettings();
    const all = Array.isArray(settings.formatGroups) ? settings.formatGroups : [];

    // 確定オブジェクト: 部分集合へ正規化 + 不変条件の防御的補修
    // 名前・isDefault は変更しない (対象は常にデフォルトグループ)
    const final: FormatGroup = {
      ...target,
      name: group.name,
      isDefault: group.isDefault,
      defaultFormatIds: (target.defaultFormatIds || []).filter((id) => target.formatIds.includes(id)),
      expandFormatIds: (target.expandFormatIds || []).filter((id) => target.formatIds.includes(id)),
    };
    repairGroupExpandInvariant(final, settings.formats);

    const idx = all.findIndex((g) => g.id === final.id);
    if (idx >= 0) settings.formatGroups[idx] = final;
    else settings.formatGroups.push(final);

    void store.saveSettings();
    runtime.bump();
    if (onSaved) onSaved(final);
    onClose();
  }

  return (
    <Modal
      title={t('formatGroup.edit.title.edit')}
      onClose={onClose}
      variant="dialog"
      dataUi={UI.settings.groupEditDialog}
      closeLabel={t('common.close')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button variant="primary" onClick={save} dataUi={UI.settings.groupEditSave}>
            {t('common.save')}
          </Button>
        </>
      }
    >
      <div className="field">
        <span className="field__label">{t('formatGroup.edit.formatsLabel')}</span>
        {allFormats.length === 0 ? <p className="muted">{t('formatGroup.edit.noFormats')}</p> : null}
        {FORMAT_PANELS.map((panel) => {
          // problem / shared は機能撤去済み。legacy フォーマットが残っている場合は表示しない
          // (FormatGroupEditDialog では S/O/A/P のみを対象とする)。
          if (panel === 'problem' || panel === 'shared') return null;
          const inPanel = allFormats.filter((f) => f.panel === panel);
          if (!inPanel.length) return null;
          return (
            <div key={panel} className="formatGroupEditSection">
              <div className="section-label">{t('format.panelSection', { panel: t(`panel.${panel}`) })}</div>
              {inPanel.map((f) => {
                const included = target.formatIds.includes(f.id);
                const mode = (target.expandFormatIds || []).includes(f.id) ? 'expand' : 'quick';
                return (
                  <div key={f.id} className={`formatGroupEditOpt${included ? ' included' : ''}`}>
                    <label className="formatGroupEditOptMain">
                      <input
                        type="checkbox"
                        checked={included}
                        onChange={(e) => toggleInclude(f.id, panel, e.target.checked)}
                      />
                      <span>{f.name}</span>
                    </label>
                    {included ? (
                      <span className="formatGroupModeSeg">
                        {(
                          [
                            ['expand', t('formatGroup.mode.expand'), t('formatGroup.mode.expand.title')],
                            ['quick', t('formatGroup.mode.quick'), t('formatGroup.mode.quick.title')],
                          ] as const
                        ).map(([key, label, title]) => (
                          <button
                            key={key}
                            type="button"
                            className={`formatGroupModeBtn${mode === key ? ' active' : ''}`}
                            title={title}
                            aria-pressed={mode === key}
                            onClick={() => setMode(f.id, panel, key)}
                          >
                            {label}
                          </button>
                        ))}
                      </span>
                    ) : null}
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>

    </Modal>
  );
}
