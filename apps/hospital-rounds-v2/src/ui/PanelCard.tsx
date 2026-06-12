// 移植元: snishi-code-medical/hospital-rounds/src/features/formats.js の患者画面パネル部
//          (renderFormatStrip / renderExpandedFormats / buildExpandedWidget /
//           buildCardItemRow / buildInlineEditCell / buildInlineNormalFillBtn)
//
// 1 パネル分のカード: ヘッダ (ラベル + クイック chip) + 展開フォーマットカード群。
//
// 入力方式 (2026-06 フィードバック反映):
//   - number / fraction は **常時表示の入力欄**。行構成は [入力 1fr][単位][備考ボタン]
//     で、入力欄と単位は最初から見えたまま、見た場所にそのまま入力できる (タップで UI が
//     変形しない)。単位列は空でも固定幅で確保し、全行で縦に揃える。備考は使用頻度が低い
//     ため小ボタン + ポップアップへ分離し (NoteButton)、備考がある時だけ行下に小さく
//     本文を出す (「見たまま記入」の例外)。値は controlled (undo/redo の外部変更も即反映)。
//     Undo 起点はフォーカスセッションごとに 1 回 (DetailView 側 onNumericFocus / onNumericWrite)。
//   - text は v1 同様タップで inline 編集 (正常チェックの provenance と Back=編集解除のみ
//     の挙動を保つ)。編集中もグリッド列 ([ラベル][正常][値]) を崩さない。
//   - 正常チェック (✓) は誤タップ対策で長押し発火 (NormalCheckButton, 350ms)。

import { useRef } from 'react';
import {
  DEFAULT_ITEM_KIND,
  type Format,
  type FormatItem,
  type FormatPanel,
  type Patient,
  type Settings,
} from '../domain/types';
import { normalizeTextEntry, readNumericEntry, readTextValue } from '../domain/formatValues';
import {
  cardItemDisplay,
  quickAccessFormatsForPanel,
  shownCardFormatsForPanel,
} from './formatLogic';
import { t } from '../i18n/strings';
import { UI } from '../ui-contract';
import { NormalCheckButton } from './NormalCheckButton';
import { NoteButton } from './NoteButton';
import { focusPopupInput } from '@snishi/foundation/ui/focus';
import { useEffect } from 'react';

/** inline 編集セッション (v1 _inlineEdit)。DetailView が ref で保持する。 */
export interface InlineSession {
  formatId: string;
  panel: FormatPanel;
  i: number;
  openPid: string | null;
  /** text => string / number・fraction => { value, note } */
  draft: unknown;
  /** 編集開始時点の保存値 (text の provenance 比較基準) */
  orig: unknown;
  captured: boolean;
  dirty: boolean;
  /** registries.registerEditingSession の解除関数 */
  unregister: () => void;
}

export interface PanelCardCallbacks {
  onEnterInline(format: Format, item: FormatItem, i: number): void;
  /** inline ドラフト更新 + write-through (DetailView の commitInline) */
  onInlineDraft(draft: unknown): void;
  onPresetToggle(format: Format, item: FormatItem, i: number): void;
  onOpenSheet(format: Format): void;
  /** number/fraction 常時入力欄: フォーカスで Undo セッション開始 (DetailView) */
  onNumericFocus(format: Format, i: number): void;
  /** number/fraction 常時入力欄: write-through 保存 (DetailView) */
  onNumericWrite(format: Format, item: FormatItem, i: number, value: { value: string; note: string }): void;
}

const PANEL_LABEL_KEY = {
  S: 'panel.S',
  O: 'panel.O',
  A: 'panel.A',
  P: 'panel.P',
} as const;

function isRowEditing(inline: InlineSession | null, format: Format, i: number): boolean {
  return !!(inline && inline.formatId === format.id && inline.panel === format.panel && inline.i === i);
}

// ── text の inline 編集セル (非制御入力 + write-through) ──
//
// グリッド整合: CardItemRow (display:contents) の直下に [正常ボタン/スペーサ][textarea] を
// fragment で返し、表示モードと同じ列位置を保つ (編集に入っても列がずれない)。

function InlineEditTextCell({
  item,
  session,
  hasNormalCol,
  ariaLabel,
  onDraft,
}: {
  item: FormatItem;
  session: InlineSession;
  hasNormalCol: boolean;
  /** 入力欄のアクセシブルネーム (ラベルが空なら format 名で補う) */
  ariaLabel: string;
  onDraft: (draft: unknown) => void;
}) {
  const textRef = useRef<HTMLTextAreaElement | null>(null);

  // この編集セルは値セルへの明示タップで mount される = 中央ルールの「明示タップした
  // 時だけ focus」経路。mount 時に 1 回だけ入力欄へ focus する。
  useEffect(() => {
    focusPopupInput(textRef.current);
  }, []);

  const normal = item.normal || '';
  return (
    <>
      {normal ? (
        // 編集中の正常列: 長押しで編集中テキスト欄へ正常文を流し込む (再長押しで空に)。
        <NormalCheckButton
          on={false}
          title={t('format.normal.tooltip.has', { value: normal })}
          ariaLabel={t('common.normal')}
          onTrigger={() => {
            const ta = textRef.current;
            if (!ta) return;
            const next = ta.value === normal ? '' : normal;
            ta.value = next;
            onDraft(next);
          }}
        />
      ) : hasNormalCol ? (
        <div className="formatCardNormalSpacer" aria-hidden />
      ) : null}
      <textarea
        ref={textRef}
        className="textarea formatCardEditInput formatCardEditText"
        rows={1}
        defaultValue={readTextValue(session.draft)}
        aria-label={ariaLabel}
        data-ui={UI.format.cellInput}
        onInput={(e) => onDraft((e.target as HTMLTextAreaElement).value)}
      />
    </>
  );
}

// ── number/fraction の常時入力欄 (controlled + write-through) ──
//
// 見た場所にそのまま入力できる: 単位は最初から見えていて、タップしても UI が変形しない。
// controlled なので undo/redo の外部変更も即反映される。
// 行構成は [入力 1fr][単位 (固定幅・縦に揃う)][備考ボタン (固定幅)]。
// 備考は使用頻度が低いため小さなボタン + ポップアップへ分離 (「見たまま記入」の例外)。
// 備考がある時だけ行下に小さく本文を出す。

function NumericCellRow({
  format,
  item,
  i,
  stored,
  cb,
}: {
  format: Format;
  item: FormatItem;
  i: number;
  stored: Record<string, unknown>;
  cb: PanelCardCallbacks;
}) {
  const kind = item.kind || DEFAULT_ITEM_KIND;
  const { value, note } = readNumericEntry(stored[String(i)]);
  const labelText = String(item.label ?? '').trim();
  const ariaLabel = t('format.cell.edit.aria', { label: labelText || format.name });
  const onFocus = () => cb.onNumericFocus(format, i);

  const noteBtn = (
    <NoteButton
      note={note}
      ariaLabel={t('format.note.aria', { label: labelText || format.name })}
      onFocusSession={onFocus}
      onChange={(next) => cb.onNumericWrite(format, item, i, { value, note: next })}
    />
  );

  let inputs;
  if (kind === 'fraction') {
    const si = value.indexOf('/');
    const numer = si >= 0 ? value.slice(0, si) : value;
    const denom = si >= 0 ? value.slice(si + 1) : '';
    const inputMode = item.fracMode === 'numeric' ? 'numeric' : 'text';
    inputs = (
      <div className="formatInputFracGroup">
        <input
          className="input formatCardEditInput formatInputFracNumer"
          type="text"
          inputMode={inputMode}
          autoComplete="off"
          value={numer}
          aria-label={`${item.label} 1`}
          data-ui={UI.format.cellInput}
          onFocus={onFocus}
          onChange={(e) => cb.onNumericWrite(format, item, i, { value: `${e.target.value}/${denom}`, note })}
        />
        <span className="formatInputFracSlash">/</span>
        <input
          className="input formatCardEditInput formatInputFracDenom"
          type="text"
          inputMode={inputMode}
          autoComplete="off"
          value={denom}
          aria-label={`${item.label} 2`}
          onFocus={onFocus}
          onChange={(e) => cb.onNumericWrite(format, item, i, { value: `${numer}/${e.target.value}`, note })}
        />
      </div>
    );
  } else {
    inputs = (
      <input
        className="input formatCardEditInput formatCardEditNum"
        type="text"
        inputMode="decimal"
        autoComplete="off"
        value={value}
        aria-label={ariaLabel}
        data-ui={UI.format.cellInput}
        onFocus={onFocus}
        onChange={(e) => cb.onNumericWrite(format, item, i, { value: e.target.value, note })}
      />
    );
  }

  return (
    <div className="formatCardEditCell">
      <div className="formatCardEditValueRow">
        {inputs}
        {/* 単位列は空でも出して縦の開始位置を揃える */}
        <span className="formatInputUnit">{item.unit || ''}</span>
        {noteBtn}
      </div>
      {note.trim() ? <div className="formatNoteText">{note}</div> : null}
    </div>
  );
}

// ── 表示モードの 1 行 (ラベル + 正常チェック + 値セル) ──

function CardItemRow({
  format,
  item,
  i,
  stored,
  inline,
  hasLabelCol,
  hasNormalCol,
  cb,
}: {
  format: Format;
  item: FormatItem;
  i: number;
  stored: Record<string, unknown>;
  inline: InlineSession | null;
  hasLabelCol: boolean;
  hasNormalCol: boolean;
  cb: PanelCardCallbacks;
}) {
  const kind = item.kind || DEFAULT_ITEM_KIND;
  const editing = isRowEditing(inline, format, i);
  const labelText = String(item.label ?? '').trim();

  const label = hasLabelCol ? <div className="formatCardItemLabel">{labelText}</div> : null;

  // number / fraction は常時入力欄 (タップで UI が変形しない)
  if (kind === 'number' || kind === 'fraction') {
    return (
      <div className="formatCardItem">
        {label}
        {hasNormalCol ? <div className="formatCardNormalSpacer" aria-hidden /> : null}
        <NumericCellRow format={format} item={item} i={i} stored={stored} cb={cb} />
      </div>
    );
  }

  if (editing && inline) {
    return (
      <div className="formatCardItem editing">
        {label}
        <InlineEditTextCell
          item={item}
          session={inline}
          hasNormalCol={hasNormalCol}
          ariaLabel={t('format.cell.edit.aria', { label: labelText || format.name })}
          onDraft={cb.onInlineDraft}
        />
      </div>
    );
  }

  const disp = cardItemDisplay(item, stored[String(i)]);
  let normalBtn = null;
  if (kind === 'text' && item.normal) {
    // 緑/aria/tooltip は provenance (source) 基準。手入力が偶然 normal と同一でも
    // source=manual なら ON にしない (decidePresetToggle が編集起動)。
    // 発火は長押し (ミスタップ対策 — 2026-06 フィードバック)。
    const { source } = normalizeTextEntry(stored[String(i)], item.normal);
    const isPreset = source === 'preset';
    normalBtn = (
      <NormalCheckButton
        on={isPreset}
        title={
          source === 'empty'
            ? t('format.normal.tooltip.has', { value: item.normal })
            : isPreset
              ? t('format.normal.tooltip.clear')
              : t('format.normal.tooltip.edit')
        }
        ariaLabel={t('common.normal')}
        ariaPressed={isPreset}
        onTrigger={() => cb.onPresetToggle(format, item, i)}
      />
    );
  } else if (hasNormalCol) {
    normalBtn = <div className="formatCardNormalSpacer" aria-hidden />;
  }

  return (
    <div className="formatCardItem">
      {label}
      {normalBtn}
      <button
        type="button"
        className={`formatCardValue${disp.empty ? ' empty' : ''}`}
        aria-label={t('format.cell.edit.aria', { label: labelText || format.name })}
        data-ui={UI.format.cell}
        onClick={() => cb.onEnterInline(format, item, i)}
      >
        {disp.text}
      </button>
    </div>
  );
}

// ── パネルカード本体 ──

export function PanelCard({
  panel,
  patient,
  settings,
  inline,
  cb,
}: {
  panel: FormatPanel;
  patient: Patient;
  settings: Settings;
  inline: InlineSession | null;
  cb: PanelCardCallbacks;
}) {
  const quick = quickAccessFormatsForPanel(panel, settings);
  const cards = shownCardFormatsForPanel(panel, patient, settings);
  const fv = patient.formatValues && typeof patient.formatValues === 'object' ? patient.formatValues : {};

  return (
    <section className="card panelCard" aria-label={t(PANEL_LABEL_KEY[panel])}>
      <div className="panelCardHead">
        <div className="panelLabel">{t(PANEL_LABEL_KEY[panel])}</div>
        <div className="formatStrip">
          {/* クイックアクセス(B) chip: タップで入力シート */}
          {quick.map((f) => (
            <button
              key={f.id}
              type="button"
              className="formatStripBtn"
              title={t('format.chip.input.title', { name: f.name })}
              data-ui={UI.format.chip}
              onClick={() => cb.onOpenSheet(f)}
            >
              {f.name}
            </button>
          ))}
        </div>
      </div>
      <div className="panelCardBody">
        {cards.map((format) => {
          const stored =
            fv[format.id] && typeof fv[format.id] === 'object' ? (fv[format.id] as Record<string, unknown>) : {};
          const items = format.items || [];
          const hasLabelCol = items.some((it) => String(it?.label ?? '').trim() !== '');
          const hasNormalCol = items.some((it) => (it?.kind || DEFAULT_ITEM_KIND) === 'text' && !!it?.normal);
          return (
            <div key={format.id} className="formatExpanded">
              {typeof format.titleWrap === 'string' && format.titleWrap !== '' ? (
                <div className="formatExpandedName">{format.name}</div>
              ) : null}
              <div
                className={`formatCardBody${hasLabelCol ? ' hasLabel' : ''}${hasNormalCol ? ' hasNormal' : ''}`}
              >
                {items.map((item, i) => (
                  <CardItemRow
                    key={i}
                    format={format}
                    item={item}
                    i={i}
                    stored={stored}
                    inline={inline}
                    hasLabelCol={hasLabelCol}
                    hasNormalCol={hasNormalCol}
                    cb={cb}
                  />
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
