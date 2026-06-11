// 移植元: snishi-code-medical/hospital-rounds/src/features/user-picker.js
//
// ヘッダーのユーザー名タップで開く軽量 popup:
//   - 一覧からタップ → switchUser して閉じる (fail-closed: throw で中断 + toast)
//   - 鉛筆 → インラインリネーム (重複名は拒否)
//   - 「+ 新規ユーザー」→ 名前入力 → createUserAndSwitch
// 削除は設定画面の「ユーザー管理」に隔離 (破壊的操作はここに置かない — v1 と同じ)。

import { useEffect, useState } from 'react';
import { Modal } from '@snishi/foundation/ui/Modal';
import { IconButton } from '@snishi/foundation/ui/IconButton';
import { Icon } from '@snishi/foundation/ui/Icon';
import { useToast } from '@snishi/foundation/ui/toast';
import type { AppRuntime } from '../appRuntime';
import { EVENT } from '../../data/eventlog';
import { useRegisterOverlay } from '../registries';
import { t } from '../../i18n/strings';
import { UI } from '../../ui-contract';

interface UserRow {
  id: string;
  name: string;
  createdAt: number;
}

function fmtTimestamp(ms: number): string {
  if (!ms) return '';
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function UserPicker({ runtime, onClose }: { runtime: AppRuntime; onClose: () => void }) {
  useRegisterOverlay(onClose);
  const toast = useToast();
  const { store } = runtime;
  const [list, setList] = useState<UserRow[] | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const [adding, setAdding] = useState(false);
  const [addDraft, setAddDraft] = useState('');
  const [busy, setBusy] = useState(false);

  const currentId = store.storage.getCurrentUserId();

  async function fetchUsers(): Promise<UserRow[]> {
    try {
      const all = await store.storage.listUsers();
      // current が一番上、その他は登録順
      const sorted = all.slice().sort((a, b) => {
        if (a.id === currentId) return -1;
        if (b.id === currentId) return 1;
        return (a.createdAt || 0) - (b.createdAt || 0);
      });
      return sorted.map((u) => ({ id: u.id, name: u.name || '', createdAt: u.createdAt || 0 }));
    } catch (e) {
      console.error('listUsers failed:', e);
      return [];
    }
  }

  function reload(): void {
    void fetchUsers().then((rows) => setList(rows));
  }

  useEffect(() => {
    let alive = true;
    void fetchUsers().then((rows) => {
      if (alive) setList(rows);
    });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function switchTo(id: string): Promise<void> {
    if (busy) return;
    setBusy(true);
    try {
      // fail-closed: 現状の保存に失敗したら switchUser が throw → 切替中断 + 可視化
      await store.switchUser(id);
      runtime.eventlog.log(EVENT.USER_SWITCH);
      onClose();
    } catch (e) {
      console.error('user switch failed:', e);
      toast.show(t('io.user.switch.failed'), 'error');
    } finally {
      setBusy(false);
    }
  }

  async function commitRename(row: UserRow): Promise<void> {
    const next = renameDraft.trim();
    setRenamingId(null);
    if (!next || next === row.name) return;
    try {
      if (await store.storage.userNameExists(next, row.id)) {
        toast.show(t('io.user.name.duplicate'), 'error');
        return;
      }
      if (row.id === currentId) {
        // 現ユーザーは live キャッシュ名 + appState.title も更新するため store 経由
        const res = await store.renameCurrentUser(next);
        if (!res.ok) {
          toast.show(t(res.reason === 'duplicate' ? 'io.user.name.duplicate' : 'io.user.rename.failed'), 'error');
          return;
        }
        runtime.bump(); // ヘッダー表示更新
      } else {
        await store.storage.renameUser(row.id, next);
      }
      reload();
    } catch (e) {
      console.error('user rename failed:', e);
      toast.show(t('io.user.rename.failed'), 'error');
    }
  }

  async function commitAdd(): Promise<void> {
    const name = addDraft.trim();
    setAdding(false);
    setAddDraft('');
    if (!name) return;
    if (busy) return;
    setBusy(true);
    try {
      const res = await store.createUserAndSwitch(name);
      if (!res.ok) {
        if (res.reason === 'duplicate') toast.show(t('io.user.name.duplicate'), 'error');
        return;
      }
      runtime.eventlog.log(EVENT.USER_SWITCH);
      onClose();
    } catch (e) {
      console.error('user create failed:', e);
      toast.show(t('io.user.create.failed'), 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title={t('header.user.tooltip')}
      onClose={onClose}
      variant="dialog"
      dataUi={UI.picker.userDialog}
      closeLabel={t('common.close')}
    >
      <div className="pickerList">
        {list !== null && list.length === 0 ? <p className="muted">{t('io.user.list.empty')}</p> : null}
        {(list ?? []).map((row) => (
          <div key={row.id} className={`pickerRow${row.id === currentId ? ' selected' : ''}`}>
            {renamingId === row.id ? (
              <input
                className="input pickerRenameInput"
                type="text"
                value={renameDraft}
                autoComplete="off"
                aria-label={t('common.edit')}
                // 明示的な rename クリック後の単一入力 (中央ルールの明示経路)
                autoFocus
                onChange={(e) => setRenameDraft(e.target.value)}
                onBlur={() => void commitRename(row)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    void commitRename(row);
                  } else if (e.key === 'Escape') {
                    e.preventDefault();
                    setRenamingId(null);
                  }
                }}
              />
            ) : (
              <>
                <button
                  type="button"
                  className="pickerRowMain"
                  disabled={busy || row.id === currentId}
                  data-ui={UI.picker.userRow}
                  onClick={() => void switchTo(row.id)}
                >
                  <span className="pickerRowLabel">{row.name || t('io.user.untitled')}</span>
                  <span className="pickerRowMeta">{fmtTimestamp(row.createdAt)}</span>
                </button>
                <IconButton
                  label={t('common.edit')}
                  dataUi={UI.picker.userRename}
                  onClick={() => {
                    setRenamingId(row.id);
                    setRenameDraft(row.name);
                  }}
                >
                  <Icon name="edit" size={16} />
                </IconButton>
              </>
            )}
          </div>
        ))}
        {adding ? (
          <input
            className="input pickerAddInput"
            type="text"
            value={addDraft}
            placeholder={t('io.user.create.placeholder')}
            autoComplete="off"
            aria-label={t('io.user.create.action')}
            autoFocus
            onChange={(e) => setAddDraft(e.target.value)}
            onBlur={() => void commitAdd()}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                void commitAdd();
              } else if (e.key === 'Escape') {
                e.preventDefault();
                setAdding(false);
                setAddDraft('');
              }
            }}
          />
        ) : (
          <button
            type="button"
            className="menu-item pickerAddBtn"
            title={t('io.user.create.action')}
            aria-label={t('io.user.create.action')}
            data-ui={UI.picker.userAdd}
            onClick={() => setAdding(true)}
          >
            <Icon name="add" size={18} />
            {t('io.user.create.action')}
          </button>
        )}
      </div>
    </Modal>
  );
}
