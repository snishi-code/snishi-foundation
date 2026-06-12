// 移植元: snishi-code-medical/hospital-rounds/src/features/formats.js の
//          フォーマット編集モーダル部 (openFormatEditModal / renderFormatEditItems /
//          saveFormatEdit / addFormatItem / morphItemKind)
//
// フォーマット編集 (新規/編集): name / joiner (2択) / titleWrap (checkbox) / tags /
// items (label / kind / unit / normal / fracMode)。
// v1 は draft を直接 mutate したが、v2 は React の不変条件 (描画値を直接書き換えない)
// に合わせて useState の immutable 更新でドラフトを持つ。キャンセル時は state 破棄。
//
// 項目の並び替え/削除 (2026-06 指示書で方針変更):
//   - 旧「入力済みならブロック」をやめ、保存時に全患者 (全病棟) の formatValues[formatId]
//     も同じ移動/削除で変換し、ラベルと保存値の対応を保つ (store.applyFormatEditWithRemap)。
//   - 削除は「その項目に入力済み患者がいる」場合のみ注意ポップアップ → OK で draft から
//     除去し、保存時に全患者の該当 index を削除して後続を詰める。
//   - kind (種類) 変更は保存形が変わるため、入力済み index では引き続きブロック。
//   - dataIndices = 現ユーザー全病棟横断の「入力済み item index 集合」
//     (collectFormatDataIndices)。収集中 (undefined) / 失敗 (null) は fail-closed で
//     構成変更 (削除/並び替え/kind 変更) を全ブロック。
//
// 並び替えは v1 のドラッグでなく ↑/↓ ボタン。
// labelSep は v1 同様 UI に出さない (既存値・プリセットを温存)。

import { useEffect, useState } from 'react';
import { Modal } from '@snishi/foundation/ui/Modal';
import { Button } from '@snishi/foundation/ui/Button';
import { IconButton } from '@snishi/foundation/ui/IconButton';
import { Icon } from '@snishi/foundation/ui/Icon';
import { useToast } from '@snishi/foundation/ui/toast';
import {
  DEFAULT_ITEM_KIND,
  DEFAULT_LABEL_SEP_OTHER,
  DEFAULT_LABEL_SEP_TEXT,
  FORMAT_ITEM_KINDS,
  type Format,
  type FormatItem,
  type FormatItemKind,
  type FormatPanel,
} from '../../domain/types';
import { newFormatId } from '../../domain/normalize';
import { ConfirmDialog } from '@snishi/foundation/ui/ConfirmDialog';
import { formatItemKindChangeBlocked } from '../../domain/formatValues';
import { encodeFormatPayload } from '../../qr/formatQr';
import type { AppRuntime } from '../appRuntime';
import { getAllTags } from '../tags';
import { TagSelection } from '../TagPicker';
import { QrShareDialog } from './QrShareDialog';
import { OverlayBinding, useRegisterOverlay } from '../registries';
import { t } from '../../i18n/strings';
import { UI } from '../../ui-contract';

// 新しい item を kind に応じたフィールドで生成 (fraction の新規は安全側 "text")。
function makeNewItem(kind: FormatItemKind): FormatItem {
  const k = FORMAT_ITEM_KINDS.includes(kind) ? kind : DEFAULT_ITEM_KIND;
  if (k === 'fraction') return { label: '', kind: k, unit: '', fracMode: 'text' };
  if (k === 'number') return { label: '', kind: k, unit: '' };
  return { label: '', kind: k, normal: '' };
}

// item の kind を変更した時に、必要なフィールドだけ残して埋め直す。
function morphItemKind(item: FormatItem, newKind: string): FormatItem {
  const k = (FORMAT_ITEM_KINDS as readonly string[]).includes(newKind)
    ? (newKind as FormatItemKind)
    : DEFAULT_ITEM_KIND;
  const label = String(item?.label ?? '');
  if (k === 'fraction') {
    return {
      label,
      kind: k,
      unit: String(item?.unit ?? ''),
      fracMode: item?.fracMode === 'numeric' ? 'numeric' : 'text',
    };
  }
  if (k === 'number') return { label, kind: k, unit: String(item?.unit ?? '') };
  return { label, kind: k, normal: String(item?.normal ?? '') };
}

export function FormatEditDialog({
  runtime,
  format,
  panel,
  onSaved,
  onClose,
}: {
  runtime: AppRuntime;
  /** null = 新規作成 */
  format: Format | null;
  panel: FormatPanel;
  onSaved?: (saved: Format) => void;
  onClose: () => void;
}) {
  useRegisterOverlay(onClose);
  const toast = useToast();
  const { store } = runtime;
  const isNew = !format;

  // 編集ドラフト (immutable 更新)。保存時に settings へ確定、キャンセルは破棄。
  const [target, setTarget] = useState<Format>(() =>
    format
      ? {
          ...format,
          tags: Array.isArray(format.tags) ? format.tags.slice() : [],
          items: (format.items || []).map((it) => ({ ...it })),
        }
      : {
          id: newFormatId(),
          name: '',
          panel,
          joiner: '\n',
          labelSep: DEFAULT_LABEL_SEP_OTHER,
          titleWrap: '', // 新規は既定でタイトル OFF
          tags: [],
          items: [],
        },
  );
  const [qrShareOpen, setQrShareOpen] = useState(false);
  // 各 draft item の元 index (mapping[newIndex]=oldIndex。新規追加は -1)。
  // 保存時に全患者の formatValues[formatId] を同じ移動/削除で変換するために持つ。
  const [origIdx, setOrigIdx] = useState<number[]>(() => (format?.items || []).map((_, i) => i));
  // 入力済みデータがある item の削除確認 (index)。OK で draft から除去 → 保存時に反映。
  const [itemDeleteConfirm, setItemDeleteConfirm] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);

  // 入力済み item index の収集 (新規は空集合。収集完了まで undefined = fail-closed)。
  const [dataIndices, setDataIndices] = useState<Set<number> | null | undefined>(
    isNew ? new Set() : undefined,
  );
  useEffect(() => {
    if (isNew) return;
    let alive = true;
    store
      .collectFormatDataIndices(target.id)
      .then((set) => {
        if (alive) setDataIndices(set);
      })
      .catch(() => {
        if (alive) setDataIndices(null);
      });
    return () => {
      alive = false;
    };
  }, [isNew, store, target.id]);

  const guardIndices = dataIndices instanceof Set ? dataIndices : null;

  function patchItem(i: number, patch: Partial<FormatItem>): void {
    setTarget((prev) => ({
      ...prev,
      items: prev.items.map((it, idx) => (idx === i ? { ...it, ...patch } : it)),
    }));
  }

  // 構成変更 (削除/並び替え) は、入力済みデータの有無が分からない間は許可しない (fail-closed)。
  const guardReady = guardIndices instanceof Set;

  function moveItem(from: number, to: number): void {
    if (to < 0 || from === to) return;
    if (!guardReady) {
      toast.show(t('format.itemGuard.unknown'), 'error');
      return;
    }
    setTarget((prev) => {
      if (to >= prev.items.length) return prev;
      const items = prev.items.slice();
      const [moved] = items.splice(from, 1);
      items.splice(to, 0, moved as FormatItem);
      return { ...prev, items };
    });
    setOrigIdx((prev) => {
      if (to >= prev.length) return prev;
      const arr = prev.slice();
      const [moved] = arr.splice(from, 1);
      arr.splice(to, 0, moved as number);
      return arr;
    });
  }

  function removeItemAt(i: number): void {
    setTarget((prev) => ({ ...prev, items: prev.items.filter((_, idx) => idx !== i) }));
    setOrigIdx((prev) => prev.filter((_, idx) => idx !== i));
  }

  function deleteItem(i: number): void {
    if (!guardReady) {
      toast.show(t('format.itemGuard.unknown'), 'error');
      return;
    }
    const oi = origIdx[i] ?? -1;
    if (oi >= 0 && guardIndices?.has(oi)) {
      // 入力済み患者がいる → 注意ポップアップ (OK した場合だけ draft から除去)
      setItemDeleteConfirm(i);
      return;
    }
    removeItemAt(i); // 入力済み患者ゼロは確認なしで削除
  }

  function changeKind(i: number, nextKind: string): void {
    const item = target.items[i];
    if (!item) return;
    if (
      nextKind !== (item.kind || DEFAULT_ITEM_KIND) &&
      formatItemKindChangeBlocked(guardIndices, origIdx[i] ?? -1)
    ) {
      toast.show(t('format.itemKind.blocked'), 'error');
      return;
    }
    setTarget((prev) => ({
      ...prev,
      items: prev.items.map((it, idx) => (idx === i ? morphItemKind(it, nextKind) : it)),
    }));
  }

  function addItem(): void {
    setTarget((prev) => {
      const last = prev.items[prev.items.length - 1];
      const kind = last && FORMAT_ITEM_KINDS.includes(last.kind) ? last.kind : DEFAULT_ITEM_KIND;
      return { ...prev, items: [...prev.items, makeNewItem(kind)] };
    });
    setOrigIdx((prev) => [...prev, -1]);
  }

  async function save(): Promise<void> {
    if (saving) return;
    const settings = store.getSettings();
    const name = target.name.trim();
    if (!name) {
      toast.show(t('format.name.required'), 'error');
      return;
    }
    const all = Array.isArray(settings.formats) ? settings.formats : [];
    if (all.some((f) => f.id !== target.id && f.name === name)) {
      toast.show(t('format.name.duplicate'), 'error');
      return;
    }

    // 確定オブジェクトを組み立てる (描画中ドラフトは触らない)
    // joiner は「ユーザーが select を触った時」だけ 2 択値が target に入っている
    // (未変更なら既存の独自 joiner を温存)。
    let labelSep = target.labelSep;
    if (typeof labelSep !== 'string') {
      const allText = target.items.every((it) => it && it.kind === 'text');
      labelSep = allText ? DEFAULT_LABEL_SEP_TEXT : DEFAULT_LABEL_SEP_OTHER;
    }
    const knownTags = new Set(getAllTags(settings));

    // 項目の除外ルール: text=label/normal どちらかあれば保持 / fraction=常に保持 /
    // number=label 必須。入力済みデータがある item の「暗黙の自動除外」だけは引き続き
    // ブロックする (削除は行ごとの × → 確認ポップアップ経由で明示的に行わせる)。
    const cleanedItems = target.items.map((it) =>
      (FORMAT_ITEM_KINDS as readonly string[]).includes(it.kind) ? it : morphItemKind(it, DEFAULT_ITEM_KIND),
    );
    const keepItem = (it: FormatItem): boolean => {
      const label = String(it.label || '').trim();
      if (it.kind === 'text') return !!label || !!String(it.normal || '').trim();
      if (it.kind === 'fraction') return true;
      return !!label;
    };
    for (let idx = 0; idx < cleanedItems.length; idx++) {
      const it = cleanedItems[idx] as FormatItem;
      if (keepItem(it)) continue;
      const oi = origIdx[idx] ?? -1;
      if (oi >= 0 && (!guardReady || guardIndices?.has(oi))) {
        toast.show(t('format.itemDelete.blocked'), 'error');
        return; // 保存ごと中断 (モーダルは開いたまま = ラベルを戻せば再保存できる)
      }
    }

    // mapping[newIndex] = oldIndex (keepItem で残った item のみ)。設定定義と全患者の
    // 保存値を同じ移動/削除で変換するための対応表。
    const keptPairs = cleanedItems
      .map((it, idx) => ({ it: it as FormatItem, oi: origIdx[idx] ?? -1 }))
      .filter(({ it }) => keepItem(it));
    const mapping = keptPairs.map((p) => p.oi);
    const origCount = format?.items?.length ?? 0;
    const structureChanged =
      !isNew && (mapping.length !== origCount || mapping.some((oi, ni) => oi !== ni));

    const final: Format = {
      ...target,
      name,
      joiner: typeof target.joiner === 'string' ? target.joiner : ', ',
      labelSep,
      titleWrap: typeof target.titleWrap === 'string' ? target.titleWrap : '',
      tags: (target.tags || []).filter((tg) => knownTags.has(tg)), // 削除済みタグを掃除
      items: keptPairs.map((p) => p.it),
    };

    if (structureChanged) {
      // 項目の並び替え/削除あり → 全病棟・全患者の formatValues[formatId] を同時変換
      // (fail-closed + 補償は store 側)。入力済みデータの有無が不明なら保存しない。
      if (!guardReady) {
        toast.show(t('format.itemGuard.unknown'), 'error');
        return;
      }
      setSaving(true);
      try {
        await store.applyFormatEditWithRemap(final, mapping);
      } catch (e) {
        console.error('format edit remap failed:', e);
        toast.show(t('format.remap.failed'), 'error');
        runtime.bump();
        return;
      } finally {
        setSaving(false);
      }
      runtime.bump();
      if (onSaved) onSaved(final);
      onClose();
      return;
    }

    // 構成変更なし: 従来どおりの設定保存 (v1 adapterSaveFormat 互換: fire-and-forget)
    if (!Array.isArray(settings.formats)) settings.formats = [];
    if (isNew) {
      settings.formats.push(final);
    } else {
      const idx = settings.formats.findIndex((f) => f.id === final.id);
      if (idx >= 0) settings.formats[idx] = final;
      else settings.formats.push(final);
    }
    void store.saveSettings();
    runtime.bump();
    if (onSaved) onSaved(final);
    onClose();
  }

  return (
    <Modal
      title={t(isNew ? 'format.editTitle.new' : 'format.editTitle.edit', { panel: t(`panel.${target.panel}`) })}
      onClose={onClose}
      variant="dialog"
      dataUi={UI.settings.formatEditDialog}
      closeLabel={t('common.close')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button
            variant="ghost"
            dataUi={UI.settings.formatEditQrShare}
            onClick={() => {
              if (!target.name.trim()) {
                toast.show(t('format.name.required'), 'error');
                return;
              }
              setQrShareOpen(true);
            }}
          >
            {t('qr.kind.format')}
          </Button>
          <Button variant="primary" disabled={saving} onClick={() => void save()} dataUi={UI.settings.formatEditSave}>
            {t('common.save')}
          </Button>
        </>
      }
    >
      <div className="field">
        <label className="field__label" htmlFor="hrFormatEditName">
          {t('format.field.name')}
        </label>
        <input
          id="hrFormatEditName"
          className="input"
          type="text"
          autoComplete="off"
          placeholder={t('format.placeholder.name')}
          value={target.name}
          data-ui={UI.settings.formatEditName}
          onChange={(e) => {
            const name = e.target.value;
            setTarget((prev) => ({ ...prev, name }));
          }}
        />
      </div>

      <div className="field formatEditOptionRow">
        <label className="field__label" htmlFor="hrFormatEditJoiner">
          {t('format.field.joiner')}
        </label>
        <select
          id="hrFormatEditJoiner"
          className="input formatEditJoiner"
          // 表示は "\n"→改行、それ以外→コンマに寄せる。未変更時は保存で既存 joiner を温存
          value={target.joiner === '\n' ? 'newline' : 'comma'}
          onChange={(e) => {
            // ユーザーが select を触った時だけ 2 択値で上書き (既存の独自 joiner を温存)
            const joiner = e.target.value === 'newline' ? '\n' : ', ';
            setTarget((prev) => ({ ...prev, joiner }));
          }}
        >
          <option value="newline">{t('format.joiner.newline')}</option>
          <option value="comma">{t('format.joiner.comma')}</option>
        </select>
        <label className="formatEditTitleToggle">
          <input
            type="checkbox"
            checked={typeof target.titleWrap === 'string' && target.titleWrap !== ''}
            onChange={(e) => {
              // ON: 既存の括弧ペアがあれば温存し、無ければ既定の "（）"。OFF: 空。
              const checked = e.target.checked;
              setTarget((prev) => ({
                ...prev,
                titleWrap: checked ? (prev.titleWrap !== '' ? prev.titleWrap : '（）') : '',
              }));
            }}
          />
          {t('format.field.showTitle')}
        </label>
      </div>

      <div className="field">
        <span className="field__label">{t('format.field.tags')}</span>
        <TagSelection
          store={store}
          selected={target.tags}
          onChange={(next) => setTarget((prev) => ({ ...prev, tags: next }))}
        />
      </div>

      <div className="field">
        <span className="field__label">{t('format.field.items')}</span>
        <div className="formatEditItems">
          {target.items.map((item, i) => (
            <div key={i} className="formatEditItemRow">
              <span className="formatEditItemMove">
                <IconButton label={t('format.reorderItem.up')} disabled={i === 0} onClick={() => moveItem(i, i - 1)}>
                  <Icon name="chevronRight" size={14} className="iconRotateUp" />
                </IconButton>
                <IconButton
                  label={t('format.reorderItem.down')}
                  disabled={i === target.items.length - 1}
                  onClick={() => moveItem(i, i + 1)}
                >
                  <Icon name="chevronRight" size={14} className="iconRotateDown" />
                </IconButton>
              </span>
              <input
                className="input formatEditItemLabel"
                type="text"
                autoComplete="off"
                placeholder={t('format.placeholder.label')}
                value={item.label || ''}
                aria-label={t('format.placeholder.label')}
                onChange={(e) => patchItem(i, { label: e.target.value })}
              />
              <select
                className="input formatEditItemKind"
                title={t('format.itemKind.title')}
                aria-label={t('format.itemKind.aria')}
                value={item.kind || DEFAULT_ITEM_KIND}
                onChange={(e) => changeKind(i, e.target.value)}
              >
                {FORMAT_ITEM_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {t(`format.itemKind.${k}`)}
                  </option>
                ))}
              </select>
              {item.kind === 'number' || item.kind === 'fraction' ? (
                <span className="formatEditItemAux">
                  <input
                    className="input formatEditItemUnit"
                    type="text"
                    autoComplete="off"
                    placeholder={t('format.placeholder.unit')}
                    value={item.unit || ''}
                    aria-label={t('format.placeholder.unit')}
                    onChange={(e) => patchItem(i, { unit: e.target.value })}
                  />
                  {item.kind === 'fraction' ? (
                    <select
                      className="input formatEditItemFracMode"
                      title={t('format.fracMode.title')}
                      aria-label={t('format.fracMode.aria')}
                      value={item.fracMode === 'numeric' ? 'numeric' : 'text'}
                      onChange={(e) =>
                        patchItem(i, { fracMode: e.target.value === 'numeric' ? 'numeric' : 'text' })
                      }
                    >
                      <option value="numeric">{t('format.fracMode.numeric')}</option>
                      <option value="text">{t('format.fracMode.text')}</option>
                    </select>
                  ) : null}
                </span>
              ) : (
                <input
                  className="input formatEditItemNormal"
                  type="text"
                  autoComplete="off"
                  placeholder={t('format.placeholder.normal')}
                  value={item.normal || ''}
                  aria-label={t('format.placeholder.normal')}
                  onChange={(e) => patchItem(i, { normal: e.target.value })}
                />
              )}
              <IconButton label={t('format.deleteItem.aria')} onClick={() => deleteItem(i)}>
                <Icon name="close" size={14} />
              </IconButton>
            </div>
          ))}
          <Button onClick={addItem} dataUi={UI.settings.formatEditAddItem}>
            {t('format.addItem')}
          </Button>
        </div>
      </div>

      {itemDeleteConfirm != null ? <OverlayBinding onClose={() => setItemDeleteConfirm(null)} /> : null}
      {itemDeleteConfirm != null ? (
        <ConfirmDialog
          title={t('common.delete')}
          body={t('format.itemDelete.withData.confirm', {
            label:
              String(target.items[itemDeleteConfirm]?.label || '').trim() ||
              t('format.placeholder.label'),
          })}
          confirmLabel={t('common.delete')}
          cancelLabel={t('common.cancel')}
          danger
          onCancel={() => setItemDeleteConfirm(null)}
          onConfirm={() => {
            const idx = itemDeleteConfirm;
            setItemDeleteConfirm(null);
            if (idx != null) removeItemAt(idx);
          }}
        />
      ) : null}

      {qrShareOpen ? (
        <QrShareDialog
          kind="FMT"
          kindLabel={t('qr.kind.format')}
          title={t('qrFormat.share.title')}
          // 未保存でも編集中状態の中身がそのまま QR 化される (= 試行錯誤しやすい・v1 準拠)
          encodePayload={() => encodeFormatPayload(target)}
          shouldEncrypt={() => !!store.getSettings().qrEncryption?.FMT}
          onClose={() => setQrShareOpen(false)}
        />
      ) : null}
    </Modal>
  );
}
