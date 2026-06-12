// 一覧画面 (共有) 用の「常時編集できるフォーマット項目エディタ」。
//
// 患者画面の該当パネルを抜き出した形 (2026-06 フィードバック): 一覧の行から患者画面へ
// 飛ばずにその場で入力できる。shownCardFormatsForPanel の各 item を controlled 入力で
// write-through 保存する。患者は pid で捕捉 (並び替えで別患者へ書かない)。
//   - text     : [ラベル][正常 ✓][textarea]。✓ は decidePresetToggle 準拠
//                (空→正常文 / preset→解除 / 手入力→何もしない: 直接編集できるため)。
//   - number   : [ラベル][値][単位][備考] の 1 行。
//   - fraction : [ラベル][上]/[下][単位][備考] の 1 行。
// Undo は 'format' スコープ。フォーカスセッションごとに 1 回 capture し、フォーマット
// 自動付与タグも最初の実変更で patient.tags へ merge する (患者画面と同じ挙動)。

import { useRef } from 'react';
import {
  DEFAULT_ITEM_KIND,
  type Format,
  type FormatItem,
  type FormatPanel,
} from '../domain/types';
import {
  commitDraftTextEntry,
  decidePresetToggle,
  normalizeTextEntry,
  readNumericEntry,
  readTextValue,
} from '../domain/formatValues';
import type { AppRuntime } from './appRuntime';
import { applyFormatTags, formatTagsToAdd, shownCardFormatsForPanel, writeFormatValue } from './formatLogic';
import { hapticTick } from './feedback';
import { t } from '../i18n/strings';
import { UI } from '../ui-contract';

interface EditSession {
  pid: string;
  key: string; // `${formatId}:${itemIndex}`
  orig: unknown;
  captured: boolean;
}

export function FormatItemsEditor({
  runtime,
  pid,
  panel,
}: {
  runtime: AppRuntime;
  pid: string;
  panel: FormatPanel;
}) {
  const { store } = runtime;
  const sessRef = useRef<EditSession | null>(null);

  const live = () => store.getAppState().patients.find((x) => x.pid === pid) ?? null;
  const liveNo = () => store.getAppState().patients.findIndex((x) => x.pid === pid) + 1;

  const patient = live();
  if (!patient) return null;
  const settings = store.getSettings();
  const formats = shownCardFormatsForPanel(panel, patient, settings);
  const fv = patient.formatValues && typeof patient.formatValues === 'object' ? patient.formatValues : {};

  const storedOf = (format: Format, i: number): unknown => {
    const slot = live()?.formatValues?.[format.id];
    return slot && typeof slot === 'object' ? (slot as Record<string, unknown>)[String(i)] : undefined;
  };

  function beginSession(format: Format, i: number): void {
    sessRef.current = { pid, key: `${format.id}:${i}`, orig: storedOf(format, i), captured: false };
  }

  // write-through (Undo 起点 + 自動付与タグはセッション最初の実変更で 1 回)
  function write(format: Format, i: number, value: unknown, changed: boolean): void {
    const p = live();
    if (!p) return;
    const no = liveNo();
    const liveSettings = store.getSettings();
    const s = sessRef.current;
    const session = s && s.pid === pid && s.key === `${format.id}:${i}` ? s : null;
    if (!session || !session.captured) {
      if (!changed) return;
      runtime.undo.capture(p, 'format', { tagsAdded: formatTagsToAdd(format, p, liveSettings) });
      writeFormatValue(store, p, no, format, i, value);
      applyFormatTags(format, p, liveSettings);
      if (session) session.captured = true;
      return;
    }
    writeFormatValue(store, p, no, format, i, value);
  }

  function onPresetToggle(format: Format, item: FormatItem, i: number): void {
    const stored = storedOf(format, i);
    const decision = decidePresetToggle(stored, item.normal);
    if (decision.action === 'openEditor') return; // 手入力済みは直接編集に委ねる
    const p = live();
    if (!p) return;
    const liveSettings = store.getSettings();
    const tagsAdded = decision.action === 'write' ? formatTagsToAdd(format, p, liveSettings) : [];
    runtime.undo.capture(p, 'format', { tagsAdded });
    writeFormatValue(store, p, liveNo(), format, i, decision.value);
    if (decision.action === 'write') applyFormatTags(format, p, liveSettings);
    hapticTick();
    runtime.bump();
  }

  return (
    <div className="formatItemsEditor">
      {formats.map((format) => {
        const items = format.items || [];
        const slot = fv[format.id];
        const stored: Record<string, unknown> =
          slot && typeof slot === 'object' ? (slot as Record<string, unknown>) : {};
        const hasLabelCol = items.some((it) => String(it?.label ?? '').trim() !== '');
        const hasNormalCol = items.some((it) => (it?.kind || DEFAULT_ITEM_KIND) === 'text' && !!it?.normal);
        return (
          <div key={format.id} className="formatExpanded">
            {typeof format.titleWrap === 'string' && format.titleWrap !== '' ? (
              <div className="formatExpandedName">{format.name}</div>
            ) : null}
            <div className={`formatCardBody${hasLabelCol ? ' hasLabel' : ''}${hasNormalCol ? ' hasNormal' : ''}`}>
              {items.map((item, i) => {
                const kind = item.kind || DEFAULT_ITEM_KIND;
                const labelText = String(item.label ?? '').trim();
                const label = hasLabelCol ? <div className="formatCardItemLabel">{labelText}</div> : null;
                const ariaLabel = t('format.cell.edit.aria', { label: labelText || format.name });

                if (kind === 'number' || kind === 'fraction') {
                  const { value, note } = readNumericEntry(stored[String(i)]);
                  const numeric = (
                    <div className="formatCardEditValueRow">
                      {kind === 'fraction' ? (
                        <div className="formatInputFracGroup">
                          <input
                            className="input formatCardEditInput formatInputFracNumer"
                            type="text"
                            inputMode={item.fracMode === 'numeric' ? 'numeric' : 'text'}
                            autoComplete="off"
                            value={value.includes('/') ? value.slice(0, value.indexOf('/')) : value}
                            aria-label={`${item.label} 1`}
                            onFocus={() => beginSession(format, i)}
                            onChange={(e) => {
                              const denom = value.includes('/') ? value.slice(value.indexOf('/') + 1) : '';
                              write(format, i, { value: `${e.target.value}/${denom}`, note }, true);
                            }}
                          />
                          <span className="formatInputFracSlash">/</span>
                          <input
                            className="input formatCardEditInput formatInputFracDenom"
                            type="text"
                            inputMode={item.fracMode === 'numeric' ? 'numeric' : 'text'}
                            autoComplete="off"
                            value={value.includes('/') ? value.slice(value.indexOf('/') + 1) : ''}
                            aria-label={`${item.label} 2`}
                            onFocus={() => beginSession(format, i)}
                            onChange={(e) => {
                              const numer = value.includes('/') ? value.slice(0, value.indexOf('/')) : value;
                              write(format, i, { value: `${numer}/${e.target.value}`, note }, true);
                            }}
                          />
                        </div>
                      ) : (
                        <input
                          className="input formatCardEditInput formatCardEditNum"
                          type="text"
                          inputMode="decimal"
                          autoComplete="off"
                          value={value}
                          aria-label={ariaLabel}
                          onFocus={() => beginSession(format, i)}
                          onChange={(e) => write(format, i, { value: e.target.value, note }, true)}
                        />
                      )}
                      {item.unit ? <span className="formatInputUnit">{item.unit}</span> : null}
                      <textarea
                        className="textarea formatInputMemo"
                        rows={1}
                        placeholder={t('format.placeholder.memo')}
                        aria-label={t('format.placeholder.memo')}
                        value={note}
                        onFocus={() => beginSession(format, i)}
                        onChange={(e) => write(format, i, { value, note: e.target.value }, true)}
                      />
                    </div>
                  );
                  return (
                    <div key={i} className="formatCardItem">
                      {label}
                      {hasNormalCol ? <div className="formatCardNormalSpacer" aria-hidden /> : null}
                      {numeric}
                    </div>
                  );
                }

                // text: controlled textarea + 正常 ✓
                const entry = normalizeTextEntry(stored[String(i)], item.normal);
                let normalBtn = null;
                if (item.normal) {
                  const isPreset = entry.source === 'preset';
                  normalBtn = (
                    <button
                      type="button"
                      className={`formatNormalBtn${isPreset ? ' on' : ''}`}
                      title={
                        entry.source === 'empty'
                          ? t('format.normal.tooltip.has', { value: item.normal })
                          : isPreset
                            ? t('format.normal.tooltip.clear')
                            : t('format.normal.tooltip.edit')
                      }
                      aria-label={t('common.normal')}
                      aria-pressed={isPreset}
                      data-ui={UI.format.normalBtn}
                      onClick={() => onPresetToggle(format, item, i)}
                    >
                      ✓
                    </button>
                  );
                } else if (hasNormalCol) {
                  normalBtn = <div className="formatCardNormalSpacer" aria-hidden />;
                }
                return (
                  <div key={i} className="formatCardItem">
                    {label}
                    {normalBtn}
                    <textarea
                      className="textarea formatCardEditInput formatCardEditText"
                      rows={1}
                      value={readTextValue(stored[String(i)])}
                      aria-label={ariaLabel}
                      onFocus={() => beginSession(format, i)}
                      onChange={(e) => {
                        const s = sessRef.current;
                        const orig =
                          s && s.pid === pid && s.key === `${format.id}:${i}` ? s.orig : stored[String(i)];
                        const next = e.target.value;
                        const changed = next !== readTextValue(orig);
                        write(format, i, commitDraftTextEntry(orig, next), changed);
                      }}
                    />
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
