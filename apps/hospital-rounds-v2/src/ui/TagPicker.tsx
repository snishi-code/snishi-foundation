// 移植元: snishi-code-medical/hospital-rounds/src/features/tags.js の §6 (UI ウィジェット)
//          makeTagPicker / makePatientTagPicker / makeSharedTagFilterPicker / makeAddTagWidget
//
// - TagSelection: タグ複数選択チップ列 (+ 新規タグ追加)。患者編集・フォーマット編集に
//   inline で埋め込む (v1 renderTagSelectionInto 相当。複数選択 = 開いたまま)。
// - TagFilterPicker: ホームのタグ絞り込み (ユーザータグのみ・AND 固定 + クリア)。
//   タグフィルタ状態 (ui/tags.ts) を更新し onChange で再描画させる。
//   AND/OR 切替と仮想ステータスタグは v2 では撤去済み (仕様判断 2026-06)。

import { useState } from 'react';
import { Popup } from '@snishi/foundation/ui/Popup';
import { Icon } from '@snishi/foundation/ui/Icon';
import { useToast } from '@snishi/foundation/ui/toast';
import type { HrStore } from '../data/store';
import { addNewTag, getAllTags, getHomeTagFilter, setHomeTagFilter, tagColorOf } from './tags';
import { useRegisterOverlay } from './registries';
import { t } from '../i18n/strings';
import { UI } from '../ui-contract';

/** 「+ 新規タグ」ウィジェット (タップで入力欄に展開 → Enter/blur で確定)。 */
export function AddTagWidget({ store, onAdded }: { store: HrStore; onAdded: () => void }) {
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');

  function commit(): void {
    const name = draft.trim();
    setEditing(false);
    setDraft('');
    if (!name) return;
    if (!addNewTag(store, name)) {
      toast.show(t('settings.tag.name.duplicate'), 'error');
      return;
    }
    onAdded();
  }

  if (!editing) {
    return (
      <button
        type="button"
        className="tagAddBtn"
        title={t('tag.add.title')}
        aria-label={t('tag.add.aria')}
        data-ui={UI.tags.addBtn}
        onClick={() => setEditing(true)}
      >
        <Icon name="add" size={14} />
      </button>
    );
  }
  return (
    <input
      className="input tagAddInput"
      type="text"
      value={draft}
      placeholder={t('tag.placeholder')}
      autoComplete="off"
      aria-label={t('tag.add.aria')}
      // 明示タップで現れた単一入力なので autoFocus してよい (中央ルールの明示経路)
      autoFocus
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          commit();
        } else if (e.key === 'Escape') {
          e.preventDefault();
          setEditing(false);
          setDraft('');
        }
      }}
    />
  );
}

/**
 * タグ複数選択 (inline チップ列 + 新規タグ追加)。selected はユーザータグ名の配列。
 * onChange は新しい選択配列を返す (保存は呼び出し側の責務)。
 */
export function TagSelection({
  store,
  selected,
  onChange,
  allowAdd = true,
}: {
  store: HrStore;
  selected: string[];
  onChange: (next: string[]) => void;
  allowAdd?: boolean;
}) {
  const [, setTick] = useState(0); // タグ追加後の一覧更新
  const settings = store.getSettings();
  const all = getAllTags(settings);
  const set = new Set(selected);
  return (
    <div className="tagSelection">
      {all.map((name) => {
        const on = set.has(name);
        const color = tagColorOf(settings, name);
        const colorMod = color !== 'gray' ? ` tagChip--${color}` : '';
        return (
          <button
            key={name}
            type="button"
            className={`tagChip${colorMod}${on ? ' on' : ''}`}
            aria-pressed={on}
            data-ui={UI.tags.selectChip}
            onClick={() => {
              const next = on ? selected.filter((x) => x !== name) : [...selected, name];
              onChange(next);
            }}
          >
            {name}
          </button>
        );
      })}
      {allowAdd ? <AddTagWidget store={store} onAdded={() => setTick((n) => n + 1)} /> : null}
    </div>
  );
}

/**
 * タグ絞り込みピッカー (ホーム用)。タグフィルタ状態を直接更新する。
 * 複数選択 = 開いたまま (背景タップ/× で閉じる)。onChange で親 view が再描画する。
 */
export function TagFilterPicker({ store, onChange }: { store: HrStore; onChange: () => void }) {
  const [open, setOpen] = useState(false);
  const [, setTick] = useState(0);
  const selected = getHomeTagFilter();
  const tags = getAllTags(store.getSettings());

  function update(next: string[]): void {
    setHomeTagFilter(next);
    setTick((n) => n + 1);
    onChange();
  }

  return (
    <>
      <button
        type="button"
        className={`tagFilterBtn${selected.length ? ' active' : ''}`}
        title={t('tag.sheet.filterTitle')}
        aria-label={t('tag.sheet.filterTitle')}
        data-ui={UI.tags.filterOpen}
        onClick={() => setOpen(true)}
      >
        <Icon name="tag" size={16} />
        {selected.length ? <span className="tagFilterCount">{selected.length}</span> : null}
      </button>
      {open ? (
        <TagFilterSheet store={store} tags={tags} selected={selected} onUpdate={update} onClose={() => setOpen(false)} />
      ) : null}
    </>
  );
}

function TagFilterSheet({
  store,
  tags,
  selected,
  onUpdate,
  onClose,
}: {
  store: HrStore;
  tags: string[];
  selected: string[];
  onUpdate: (next: string[]) => void;
  onClose: () => void;
}) {
  useRegisterOverlay(onClose);
  const settings = store.getSettings();
  return (
    <Popup ariaLabel={t('tag.sheet.filterTitle')} onClose={onClose} dataUi={UI.tags.filterSheet}>
      <div className="tagFilterSheet">
        <div className="tagSelection">
          {tags.length === 0 ? <p className="muted">{t('tag.filter.empty')}</p> : null}
          {tags.map((name) => {
            const on = selected.includes(name);
            const color = tagColorOf(settings, name);
            const colorMod = color !== 'gray' ? ` tagChip--${color}` : '';
            return (
              <button
                key={name}
                type="button"
                className={`tagChip${colorMod}${on ? ' on' : ''}`}
                aria-pressed={on}
                data-ui={UI.tags.filterOption}
                onClick={() => onUpdate(on ? selected.filter((x) => x !== name) : [...selected, name])}
              >
                {name}
              </button>
            );
          })}
        </div>
        {selected.length ? (
          <button
            type="button"
            className="btn tagFilterClearBtn"
            title={t('tag.filter.clear.label')}
            aria-label={t('tag.filter.clear.aria')}
            onClick={() => onUpdate([])}
          >
            {t('tag.filter.clear.label')}
          </button>
        ) : null}
      </div>
    </Popup>
  );
}
