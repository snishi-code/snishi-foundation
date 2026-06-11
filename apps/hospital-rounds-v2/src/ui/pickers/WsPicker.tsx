// 移植元: snishi-code-medical/hospital-rounds/src/features/ws-picker.js
//          + views/settings-view.js の buildWorkspaceRow (rename / delete を v2 ではここに集約)
//
// ヘッダーの病棟名タップで開く軽量 popup:
//   - 一覧からタップ → switchWorkspace して閉じる (fail-closed: throw で中断 + toast)
//   - 鉛筆 → インラインリネーム
//   - 削除 (active 以外のみ): confirm → **削除前にその病棟のスナップショット
//     (REASON.DELETE・14日 TTL の復旧網)** → deleteBundle
//   - 「+ 新規」→ ラベル入力 → createWorkspace (fail-closed)
//
// v1 との差分: v1 は rename/delete を設定画面に置き、削除時にスナップショットを purge
// した。v2 は仕様により rename/delete をこのピッカーへ集約し、削除前 snapshot
// (REASON.DELETE) を撮って 14 日間の復旧手段として残す (TTL 失効で自動消去)。

import { useEffect, useState } from 'react';
import { Modal } from '@snishi/foundation/ui/Modal';
import { ConfirmDialog } from '@snishi/foundation/ui/ConfirmDialog';
import { IconButton } from '@snishi/foundation/ui/IconButton';
import { Icon } from '@snishi/foundation/ui/Icon';
import { useToast } from '@snishi/foundation/ui/toast';
import type { Patient } from '../../domain/types';
import { SECTION, getSection } from '../../data/bundle';
import { REASON, countActivePatients } from '../../data/snapshots';
import type { WorkspaceListing } from '../../data/storage';
import type { AppRuntime } from '../appRuntime';
import { OverlayBinding, useRegisterOverlay } from '../registries';
import { t } from '../../i18n/strings';
import { UI } from '../../ui-contract';

function fmtTimestamp(ms: number): string {
  if (!ms) return '';
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function WsPicker({ runtime, onClose }: { runtime: AppRuntime; onClose: () => void }) {
  useRegisterOverlay(onClose);
  const toast = useToast();
  const { store } = runtime;
  const [list, setList] = useState<WorkspaceListing[] | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const [adding, setAdding] = useState(false);
  const [addDraft, setAddDraft] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<WorkspaceListing | null>(null);
  const [busy, setBusy] = useState(false);

  const activeId = store.storage.getActiveWorkspaceId();

  async function fetchWorkspaces(): Promise<WorkspaceListing[]> {
    try {
      const all = await store.storage.listBundles();
      // active が一番上、その他は updatedAt 降順
      return all.slice().sort((a, b) => {
        if (a.id === activeId) return -1;
        if (b.id === activeId) return 1;
        return (b.updatedAt || 0) - (a.updatedAt || 0);
      });
    } catch (e) {
      console.error('listBundles failed:', e);
      return [];
    }
  }

  function reload(): void {
    void fetchWorkspaces().then((rows) => setList(rows));
  }

  useEffect(() => {
    let alive = true;
    void fetchWorkspaces().then((rows) => {
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
      // fail-closed: 現病棟の保存に失敗したら switchWorkspace が throw → 切替中断
      await store.switchWorkspace(id);
      onClose();
    } catch (e) {
      console.error('workspace switch failed:', e);
      toast.show(t('io.ws.switch.failed'), 'error');
    } finally {
      setBusy(false);
    }
  }

  async function commitRename(row: WorkspaceListing): Promise<void> {
    const next = renameDraft.trim();
    setRenamingId(null);
    if (!next || next === (row.label || '')) return;
    try {
      await store.storage.renameBundle(row.id, next);
      runtime.bump(); // active 改名時のヘッダーラベル同期
      reload();
    } catch (e) {
      console.error('ws rename failed:', e);
      toast.show(t('io.ws.rename.failed'), 'error');
    }
  }

  async function commitAdd(): Promise<void> {
    const label = addDraft.trim();
    setAdding(false);
    setAddDraft('');
    if (!label) return;
    if (busy) return;
    setBusy(true);
    try {
      // fail-closed: 現病棟の保存に失敗したら createWorkspace が throw → 作成中断
      await store.createWorkspace(label);
      onClose();
    } catch (e) {
      console.error('workspace create failed:', e);
      toast.show(t('io.ws.create.failed'), 'error');
    } finally {
      setBusy(false);
    }
  }

  // 削除: 削除前にその病棟の患者を REASON.DELETE スナップショットへ控える
  // (14日 TTL の復旧網)。スナップショットが撮れない場合も削除自体は v1 同様続行しない
  // — capture は foundation 側で握る (best-effort) ため、deleteBundle 失敗だけを通知する。
  async function runDelete(row: WorkspaceListing): Promise<void> {
    if (busy) return;
    setBusy(true);
    try {
      const bundle = await store.storage.loadBundle(row.id);
      const patients = bundle ? ((getSection(bundle, SECTION.PATIENTS) as Patient[]) ?? []) : [];
      await runtime.snapshots.capture(
        REASON.DELETE,
        row.id,
        { title: row.title || row.label || '', patients: Array.isArray(patients) ? patients : [] },
        String(countActivePatients(Array.isArray(patients) ? patients : [])),
      );
      await store.storage.deleteBundle(row.id);
      runtime.bump();
      reload();
    } catch (e) {
      console.error('workspace delete failed:', e);
      toast.show(t('io.ws.delete.failed'), 'error');
    } finally {
      setBusy(false);
      setDeleteTarget(null);
    }
  }

  return (
    <Modal
      title={t('wsPicker.title')}
      onClose={onClose}
      variant="dialog"
      dataUi={UI.picker.wsDialog}
      closeLabel={t('common.close')}
    >
      <div className="pickerList">
        {list !== null && list.length === 0 ? <p className="muted">{t('io.ws.list.empty')}</p> : null}
        {(list ?? []).map((row) => (
          <div key={row.id} className={`pickerRow${row.id === activeId ? ' selected' : ''}`}>
            {renamingId === row.id ? (
              <input
                className="input pickerRenameInput"
                type="text"
                value={renameDraft}
                autoComplete="off"
                aria-label={t('io.ws.rename.title')}
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
                  disabled={busy || row.id === activeId}
                  data-ui={UI.picker.wsRow}
                  onClick={() => void switchTo(row.id)}
                >
                  <span className="pickerRowLabel">{row.label || row.title || t('io.ws.untitled')}</span>
                  <span className="pickerRowMeta">
                    {fmtTimestamp(row.updatedAt)}
                    {row.title ? ` ・ ${row.title}` : ''}
                  </span>
                </button>
                <IconButton
                  label={t('io.ws.rename.title')}
                  dataUi={UI.picker.wsRename}
                  onClick={() => {
                    setRenamingId(row.id);
                    setRenameDraft(row.label || row.title || '');
                  }}
                >
                  <Icon name="edit" size={16} />
                </IconButton>
                {row.id !== activeId ? (
                  <IconButton
                    label={t('common.delete')}
                    dataUi={UI.picker.wsDelete}
                    onClick={() => setDeleteTarget(row)}
                  >
                    <Icon name="delete" size={16} />
                  </IconButton>
                ) : null}
              </>
            )}
          </div>
        ))}
        {adding ? (
          <input
            className="input pickerAddInput"
            type="text"
            value={addDraft}
            placeholder={t('io.ws.create.placeholder')}
            autoComplete="off"
            aria-label={t('io.ws.create.action')}
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
            title={t('io.ws.create.action')}
            aria-label={t('io.ws.create.action')}
            data-ui={UI.picker.wsAdd}
            onClick={() => setAdding(true)}
          >
            <Icon name="add" size={18} />
            {t('io.ws.create.action')}
          </button>
        )}
      </div>

      {deleteTarget ? <OverlayBinding onClose={() => setDeleteTarget(null)} /> : null}
      {deleteTarget ? (
        <ConfirmDialog
          title={t('common.delete')}
          body={t('io.ws.delete.confirm', {
            name: deleteTarget.label || deleteTarget.title || t('io.ws.untitled'),
          })}
          confirmLabel={t('common.delete')}
          cancelLabel={t('common.cancel')}
          danger
          onCancel={() => setDeleteTarget(null)}
          onConfirm={() => void runDelete(deleteTarget)}
        />
      ) : null}
    </Modal>
  );
}
