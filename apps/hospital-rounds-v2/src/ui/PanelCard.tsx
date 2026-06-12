// 移植元: snishi-code-medical/hospital-rounds/src/features/formats.js の患者画面パネル部
//          (renderFormatStrip / renderExpandedFormats / buildExpandedWidget /
//           buildCardItemRow / buildInlineEditCell / buildInlineNormalFillBtn)
//
// 1 パネル分のカード: ヘッダ (ラベル + クイック chip + ☰ ランチャー) + 展開フォーマット
// カード群。値セルはタップで inline 編集 (write-through 自動保存)。inline セッションの
// 状態管理 (draft/orig/captured/dirty) は DetailView 側 (InlineSession) が持ち、ここは描画。
//
// inline 編集の設計 (v1 から不変):
//   - 入力欄は非制御 (defaultValue)。1 文字ごとの全体再描画でカーソルを飛ばさない。
//     描画はドラフトを正本に組み直すので、途中再描画でも入力中の値は失われない。
//   - 値セルへの明示タップで入った項目なので、編集に入った入力欄へ focus してよい
//     (focusPopupInput の中央ルール「明示タップした時だけ focus」)。

import { useEffect, useRef, useState } from 'react';
import { Icon } from '@snishi/foundation/ui/Icon';
import { IconButton } from '@snishi/foundation/ui/IconButton';
import { Popup } from '@snishi/foundation/ui/Popup';
import { focusPopupInput } from '@snishi/foundation/ui/focus';
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
  formatsForPanel,
  quickAccessFormatsForPanel,
  resolveActiveGroup,
  shownCardFormatsForPanel,
} from './formatLogic';
import { t } from '../i18n/strings';
import { UI } from '../ui-contract';
import { useRegisterOverlay } from './registries';

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
}

const PANEL_LABEL_KEY = {
  problem: 'panel.problem',
  S: 'panel.S',
  O: 'panel.O',
  A: 'panel.A',
  P: 'panel.P',
  shared: 'panel.shared',
} as const;

function isRowEditing(inline: InlineSession | null, format: Format, i: number): boolean {
  return !!(inline && inline.formatId === format.id && inline.panel === format.panel && inline.i === i);
}

// ── inline 編集セル (非制御入力 + write-through) ──

function InlineEditCell({
  item,
  session,
  ariaLabel,
  onDraft,
}: {
  item: FormatItem;
  session: InlineSession;
  /** 主入力欄のアクセシブルネーム (ラベルが空なら format 名で補う) */
  ariaLabel: string;
  onDraft: (draft: unknown) => void;
}) {
  const kind = item.kind || DEFAULT_ITEM_KIND;
  const primaryRef = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);
  const valRef = useRef<HTMLInputElement>(null);
  const numerRef = useRef<HTMLInputElement>(null);
  const denomRef = useRef<HTMLInputElement>(null);
  const noteRef = useRef<HTMLTextAreaElement>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);

  // この編集セルは値セルへの明示タップで mount される = 中央ルールの「明示タップした
  // 時だけ focus」経路。mount 時に 1 回だけ主入力欄へ focus する。
  useEffect(() => {
    focusPopupInput(primaryRef.current);
  }, []);

  if (kind === 'number') {
    const { value, note } = readNumericEntry(session.draft);
    const emit = () => onDraft({ value: valRef.current?.value ?? '', note: noteRef.current?.value ?? '' });
    // 1 行に [値][単位][備考] を収める (スマホ幅で 2 行に崩さない — P1 入力UI)
    return (
      <div className="formatCardEditCell">
        <div className="formatCardEditValueRow">
          <input
            ref={(el) => {
              valRef.current = el;
              primaryRef.current = el;
            }}
            className="input formatCardEditInput formatCardEditNum"
            type="text"
            inputMode="decimal"
            autoComplete="off"
            defaultValue={value}
            aria-label={ariaLabel}
            data-ui={UI.format.cellInput}
            onInput={emit}
          />
          {item.unit ? <span className="formatInputUnit">{item.unit}</span> : null}
          <textarea
            ref={noteRef}
            className="textarea formatInputMemo"
            rows={1}
            placeholder={t('format.placeholder.memo')}
            aria-label={t('format.placeholder.memo')}
            defaultValue={note}
            onInput={emit}
          />
        </div>
      </div>
    );
  }

  if (kind === 'fraction') {
    const { value, note } = readNumericEntry(session.draft);
    const si = value.indexOf('/');
    const numer = si >= 0 ? value.slice(0, si) : value;
    const denom = si >= 0 ? value.slice(si + 1) : '';
    const inputMode = item.fracMode === 'numeric' ? 'numeric' : 'text';
    const emit = () =>
      onDraft({
        value: `${numerRef.current?.value ?? ''}/${denomRef.current?.value ?? ''}`,
        note: noteRef.current?.value ?? '',
      });
    // 血圧などは最初から [上]/[下] 単位 が 1 行で見えたまま、該当箇所へ直接入力する
    return (
      <div className="formatCardEditCell">
        <div className="formatCardEditValueRow">
          <div className="formatInputFracGroup">
            <input
              ref={(el) => {
                numerRef.current = el;
                primaryRef.current = el;
              }}
              className="input formatCardEditInput formatInputFracNumer"
              type="text"
              inputMode={inputMode}
              autoComplete="off"
              defaultValue={numer}
              aria-label={`${item.label} 1`}
              data-ui={UI.format.cellInput}
              onInput={emit}
            />
            <span className="formatInputFracSlash">/</span>
            <input
              ref={denomRef}
              className="input formatCardEditInput formatInputFracDenom"
              type="text"
              inputMode={inputMode}
              autoComplete="off"
              defaultValue={denom}
              aria-label={`${item.label} 2`}
              onInput={emit}
            />
          </div>
          {item.unit ? <span className="formatInputUnit">{item.unit}</span> : null}
          <textarea
            ref={noteRef}
            className="textarea formatInputMemo"
            rows={1}
            placeholder={t('format.placeholder.memo')}
            aria-label={t('format.placeholder.memo')}
            defaultValue={note}
            onInput={emit}
          />
        </div>
      </div>
    );
  }

  // text
  const normal = item.normal || '';
  return (
    <div className="formatCardEditCellRow">
      {normal ? (
        // 編集中の正常列: タップで編集中テキスト欄へ正常文を流し込む (再タップで空に)。
        <button
          type="button"
          className="formatNormalBtn"
          title={t('format.normal.tooltip.has', { value: normal })}
          aria-label={t('common.normal')}
          data-ui={UI.format.normalBtn}
          onClick={() => {
            const ta = textRef.current;
            if (!ta) return;
            const next = ta.value === normal ? '' : normal;
            ta.value = next;
            onDraft(next);
          }}
        >
          ✓
        </button>
      ) : null}
      <textarea
        ref={(el) => {
          textRef.current = el;
          primaryRef.current = el;
        }}
        className="textarea formatCardEditInput formatCardEditText"
        rows={1}
        defaultValue={readTextValue(session.draft)}
        aria-label={ariaLabel}
        data-ui={UI.format.cellInput}
        onInput={(e) => onDraft((e.target as HTMLTextAreaElement).value)}
      />
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

  if (editing && inline) {
    return (
      <div className="formatCardItem editing">
        {label}
        {hasNormalCol && !(kind === 'text' && item.normal) ? <div className="formatCardNormalSpacer" aria-hidden /> : null}
        <InlineEditCell
          item={item}
          session={inline}
          ariaLabel={t('format.cell.edit.aria', { label: labelText || format.name })}
          onDraft={cb.onInlineDraft}
        />
      </div>
    );
  }

  const disp = cardItemDisplay(item, stored[String(i)]);
  // fraction (血圧など) は空でも "/ 単位" を見せて、何をどこへ入れるか見たまま分かるようにする
  const emptyHint = disp.empty && kind === 'fraction' ? `/${item.unit ? ` ${item.unit}` : ''}` : '';
  let normalBtn = null;
  if (kind === 'text' && item.normal) {
    // 緑/aria/tooltip は provenance (source) 基準。手入力が偶然 normal と同一でも
    // source=manual なら ON にしない (再タップで消さない — decidePresetToggle が編集起動)。
    const { source } = normalizeTextEntry(stored[String(i)], item.normal);
    const isPreset = source === 'preset';
    normalBtn = (
      <button
        type="button"
        className={`formatNormalBtn${isPreset ? ' on' : ''}`}
        title={
          source === 'empty'
            ? t('format.normal.tooltip.has', { value: item.normal })
            : isPreset
              ? t('format.normal.tooltip.clear')
              : t('format.normal.tooltip.edit')
        }
        aria-label={t('common.normal')}
        aria-pressed={isPreset}
        data-ui={UI.format.normalBtn}
        onClick={(e) => {
          e.stopPropagation();
          cb.onPresetToggle(format, item, i);
        }}
      >
        ✓
      </button>
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
        {disp.empty ? emptyHint : disp.text}
      </button>
    </div>
  );
}

// ── ☰ ランチャー (カードに出ていないフォーマットへの入口) ──

function FormatLauncher({
  panel,
  patient,
  settings,
  onPick,
}: {
  panel: FormatPanel;
  patient: Patient;
  settings: Settings;
  onPick: (format: Format) => void;
}) {
  const [open, setOpen] = useState(false);
  const shown = new Set(shownCardFormatsForPanel(panel, patient, settings).map((f) => f.id));
  const candidates = formatsForPanel(panel, settings).filter((f) => !shown.has(f.id));
  return (
    <>
      <IconButton label={t('format.launcher.aria')} onClick={() => setOpen(true)} dataUi={UI.format.launcher}>
        <Icon name="menu" size={18} />
      </IconButton>
      {open ? (
        <LauncherPopup
          candidates={candidates}
          onPick={(f) => {
            setOpen(false);
            onPick(f);
          }}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </>
  );
}

function LauncherPopup({
  candidates,
  onPick,
  onClose,
}: {
  candidates: Format[];
  onPick: (f: Format) => void;
  onClose: () => void;
}) {
  useRegisterOverlay(onClose);
  return (
    <Popup ariaLabel={t('format.launcher.aria')} onClose={onClose}>
      <div className="menu-list">
        {candidates.length === 0 ? <p className="muted">{t('format.launcher.empty')}</p> : null}
        {candidates.map((f) => (
          <button
            key={f.id}
            type="button"
            className="menu-item"
            title={t('format.chip.input.title', { name: f.name })}
            onClick={() => onPick(f)}
          >
            {f.name}
          </button>
        ))}
      </div>
    </Popup>
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
  const group = resolveActiveGroup(patient, settings);
  const quick = quickAccessFormatsForPanel(panel, group, settings);
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
          <FormatLauncher panel={panel} patient={patient} settings={settings} onPick={cb.onOpenSheet} />
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
