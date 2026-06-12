// 移植元: snishi-code-medical/hospital-rounds/src/features/formats.js の大入力シート
//          (openFormatSheet / applyFormatSheet / clearFormatSheet / build*Row)
//
// フォーマット単位の大きい入力面 (クイック chip / ☰ ランチャー / 値セル以外の入口)。
// draft を編集し「保存」で formatValues へ確定 / キャンセルで破棄 / 消去で空に。
//
// fail-closed: 開いた時点と患者 (pid) が変わっていたら保存しない (別患者への誤入力防止)。
// 自動フォーカスはしない (開いただけでキーボードを出さない — popup-behavior の中央ルール)。

import { useState } from 'react';
import { Modal } from '@snishi/foundation/ui/Modal';
import { Button } from '@snishi/foundation/ui/Button';
import { useToast } from '@snishi/foundation/ui/toast';
import { DEFAULT_ITEM_KIND, type Format, type FormatItem } from '../domain/types';
import { commitDraftTextEntry, readNumericEntry, readTextValue } from '../domain/formatValues';
import type { AppRuntime } from './appRuntime';
import { applyFormatTags } from './formatLogic';
import { t } from '../i18n/strings';
import { UI } from '../ui-contract';
import { useRegisterOverlay } from './registries';

type Draft = Record<string, unknown>;

function NumberRow({
  item,
  value,
  onChange,
}: {
  item: FormatItem;
  value: unknown;
  onChange: (v: unknown) => void;
}) {
  const { value: val, note } = readNumericEntry(value);
  return (
    <div className="formatInputRow number">
      <div className={`formatInputLabel${item.label.trim() ? '' : ' formatInputLabelEmpty'}`}>{item.label}</div>
      <input
        className="input formatInputValue"
        type="text"
        inputMode="decimal"
        autoComplete="off"
        value={val}
        aria-label={t('format.cell.edit.aria', { label: item.label || t('common.edit') })}
        onChange={(e) => onChange({ value: e.target.value, note })}
      />
      <span className="formatInputUnit">{item.unit || ''}</span>
      <textarea
        className="textarea formatInputMemo"
        rows={1}
        placeholder={t('format.placeholder.memo')}
        value={note}
        aria-label={t('format.placeholder.memo')}
        onChange={(e) => onChange({ value: val, note: e.target.value })}
      />
    </div>
  );
}

function FractionRow({
  item,
  value,
  onChange,
}: {
  item: FormatItem;
  value: unknown;
  onChange: (v: unknown) => void;
}) {
  const { value: val, note } = readNumericEntry(value);
  const si = val.indexOf('/');
  const numer = si >= 0 ? val.slice(0, si) : val;
  const denom = si >= 0 ? val.slice(si + 1) : '';
  const numeric = item.fracMode === 'numeric';
  const inputMode = numeric ? 'numeric' : 'text';
  return (
    <div className="formatInputRow fraction">
      <div className={`formatInputLabel${item.label.trim() ? '' : ' formatInputLabelEmpty'}`}>{item.label}</div>
      <div className="formatInputFracGroup">
        <input
          className="input formatInputValue formatInputFracNumer"
          type="text"
          inputMode={inputMode}
          autoComplete="off"
          value={numer}
          aria-label={`${item.label} 1`}
          onChange={(e) => onChange({ value: `${e.target.value}/${denom}`, note })}
        />
        <span className="formatInputFracSlash">/</span>
        <input
          className="input formatInputValue formatInputFracDenom"
          type="text"
          inputMode={inputMode}
          autoComplete="off"
          value={denom}
          aria-label={`${item.label} 2`}
          onChange={(e) => onChange({ value: `${numer}/${e.target.value}`, note })}
        />
      </div>
      <span className="formatInputUnit">{item.unit || ''}</span>
      <textarea
        className="textarea formatInputMemo"
        rows={1}
        placeholder={t('format.placeholder.memo')}
        value={note}
        aria-label={t('format.placeholder.memo')}
        onChange={(e) => onChange({ value: val, note: e.target.value })}
      />
    </div>
  );
}

function TextRow({
  item,
  value,
  onChange,
}: {
  item: FormatItem;
  value: unknown;
  onChange: (v: unknown) => void;
}) {
  const val = readTextValue(value);
  const normal = item.normal || '';
  return (
    <div className="formatInputRow text">
      <div className={`formatInputLabel${item.label.trim() ? '' : ' formatInputLabelEmpty'}`}>{item.label}</div>
      {/* 正常文トグル: 一致していれば空に戻す (シートは編集画面なので上書き許容 = v1 準拠) */}
      <button
        type="button"
        className="formatNormalBtn"
        disabled={!normal}
        title={normal ? t('format.normal.tooltip.has', { value: normal }) : t('format.normal.tooltip.empty')}
        aria-label={t('common.normal')}
        data-ui={UI.format.normalBtn}
        onClick={() => onChange(val === normal ? '' : normal)}
      >
        ✓
      </button>
      <textarea
        className="textarea formatInputValue formatInputText"
        rows={1}
        value={val}
        aria-label={t('format.cell.edit.aria', { label: item.label || t('common.edit') })}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}

export function FormatSheet({
  format,
  patientNo,
  runtime,
  onClose,
}: {
  format: Format;
  /** 1-based 患者番号 (開いた時点) */
  patientNo: number;
  runtime: AppRuntime;
  onClose: () => void;
}) {
  useRegisterOverlay(onClose);
  const toast = useToast();
  const { store } = runtime;
  const appState = store.getAppState();
  const patient = appState.patients[patientNo - 1] ?? null;

  // orig = 開いた時点の保存値 (text の provenance 比較基準)。openPid = fail-closed 用。
  // mount 時に 1 度だけ確定する (useState initializer)。
  const [orig] = useState<Draft>(() => {
    const slot = patient?.formatValues?.[format.id];
    return slot && typeof slot === 'object' ? { ...slot } : {};
  });
  const [openPid] = useState<string | null>(() => patient?.pid ?? null);
  const [draft, setDraft] = useState<Draft>(() => ({ ...orig }));

  function apply(): void {
    const p = store.getAppState().patients[patientNo - 1];
    // fail-closed: 患者が変わっていたら保存しない
    if (!p || (openPid != null && p.pid !== openPid)) {
      onClose();
      toast.show(t('format.sheet.patientChanged'), 'error');
      runtime.bump();
      return;
    }
    if (!p.formatValues || typeof p.formatValues !== 'object') p.formatValues = {};
    const settings = store.getSettings();
    const next: Record<string, unknown> = {};
    const items = format.items || [];
    for (let i = 0; i < items.length; i++) {
      const key = String(i);
      if (!(key in draft)) continue;
      const kind = items[i]?.kind || DEFAULT_ITEM_KIND;
      // text は「変わった item だけ」manual 化 (未タッチの preset を降格させない)
      next[key] = kind === 'text' ? commitDraftTextEntry(orig[key], draft[key]) : draft[key];
    }
    p.formatValues[format.id] = next;
    applyFormatTags(format, p, settings);
    store.markUpdated(patientNo);
    store.scheduleSave();
    onClose();
    runtime.bump(); // カード反映 + QR (v1 _onTextChanged)
  }

  const showTitle = typeof format.titleWrap === 'string' && format.titleWrap !== '';

  return (
    <Modal
      title={showTitle ? format.name : t('format.cell.edit.aria', { label: format.name })}
      titleVariant={showTitle ? 'visible' : 'sr-only'}
      onClose={onClose}
      variant="dialog"
      dataUi={UI.format.sheet}
      closeLabel={t('common.close')}
      footer={
        <>
          <Button variant="ghost" onClick={() => setDraft({})} dataUi={UI.format.sheetClear}>
            {t('format.input.clear')}
          </Button>
          <Button onClick={onClose} dataUi={UI.format.sheetCancel}>
            {t('common.cancel')}
          </Button>
          <Button variant="primary" onClick={apply} dataUi={UI.format.sheetApply}>
            {t('common.save')}
          </Button>
        </>
      }
    >
      <div className="formatInputBody">
        {(format.items || []).map((item, i) => {
          const key = String(i);
          const kind = item.kind || DEFAULT_ITEM_KIND;
          const onChange = (v: unknown) => setDraft((d) => ({ ...d, [key]: v }));
          if (kind === 'number') return <NumberRow key={i} item={item} value={draft[key]} onChange={onChange} />;
          if (kind === 'fraction') return <FractionRow key={i} item={item} value={draft[key]} onChange={onChange} />;
          return <TextRow key={i} item={item} value={draft[key]} onChange={onChange} />;
        })}
      </div>
    </Modal>
  );
}
