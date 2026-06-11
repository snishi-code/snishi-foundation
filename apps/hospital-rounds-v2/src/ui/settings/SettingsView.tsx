// 移植元: snishi-code-medical/hospital-rounds/src/views/settings-view.js (設定画面全節)
//          + features/import-export.js (JSON/端末まるごと/ログ入出力)
//          + features/qr-settings.js (ST 送信カード) + qr-receive.js (統一受信入口)
//
// 設定画面の構成 (v1 と同じ並び):
//   クリア対象 / タグ管理 / フォーマット CRUD (パネル別) / セット CRUD /
//   QR (ST 送信カード + QR から追加 + QR セキュリティ) / データの保存と復元
//   (JSON・端末まるごと・研究ログ) / 巻き戻し (スナップショット) / ユーザー管理 /
//   操作ガイド (準備中プレースホルダ)

import { useEffect, useRef, useState } from 'react';
import { Button } from '@snishi/foundation/ui/Button';
import { IconButton } from '@snishi/foundation/ui/IconButton';
import { Icon } from '@snishi/foundation/ui/Icon';
import { ConfirmDialog } from '@snishi/foundation/ui/ConfirmDialog';
import { useToast } from '@snishi/foundation/ui/toast';
import { useQrFlow } from '@snishi/foundation/qr/useQrFlow';
import type { RestorePoint } from '@snishi/foundation/snapshot/snapshots';
import {
  FORMAT_PANELS,
  QR_KINDS,
  clone,
  DEFAULT_TAGS,
  type Format,
  type FormatGroup,
  type FormatPanel,
  type QrKind,
} from '../../domain/types';
import { normalizePatientArray } from '../../domain/normalize';
import { formatRemovalBreaksAnyGroupExpand } from '../../domain/formatValues';
import { encodeSettingsPayload } from '../../qr/settingsQr';
import { APP_KEY_BYTES } from '../../qr/appKey';
import { isArchive, isDeviceArchive } from '../../data/store';
import { REASON, countActivePatients } from '../../data/snapshots';
import { EVENT } from '../../data/eventlog';
import { useRevision, type AppRuntime } from '../appRuntime';
import { QrCard } from '../QrCard';
import { AddTagWidget } from '../TagPicker';
import { deleteTagAt, renameTagAt } from '../tags';
import { OverlayBinding } from '../registries';
import { FormatEditDialog } from './FormatEditDialog';
import { FormatGroupEditDialog } from './FormatGroupEditDialog';
import { QrReceiveDialog } from './QrReceiveDialog';
import { t, type StringKey } from '../../i18n/strings';
import { UI } from '../../ui-contract';

// ============================
// 小物
// ============================

function fmtTimestamp(ms: number): string {
  if (!ms) return '';
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function downloadJson(obj: unknown, filename: string): void {
  const blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.style.display = 'none';
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // revoke はダウンロード開始後に遅延 (即時 revoke は一部ブラウザで失敗する)
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

function timestampSuffix(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}_${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}`;
}

function envPrefix(): string {
  return document.documentElement.dataset.env === 'test' ? 'test_' : '';
}

// ============================
// クリア対象 (診察開始で消す項目)
// ============================

const CLEAR_KEY_ORDER = [...FORMAT_PANELS, 'statusYellow', 'statusGreen', 'statusGray', 'statusBlue'] as const;

function clearItemTitle(key: string): string {
  if (key === 'statusYellow' || key === 'statusGreen' || key === 'statusGray' || key === 'statusBlue') {
    return t(`settings.clear.${key}` as StringKey);
  }
  return t(`panel.${key}` as StringKey);
}

function ClearTargetsSection({ runtime }: { runtime: AppRuntime }) {
  const { store } = runtime;
  const settings = store.getSettings();
  return (
    <div className="card card--pad settingsSection">
      <div className="section-label">{t('clear.section.title')}</div>
      <p className="muted settingsHint">{t('clear.section.hint')}</p>
      <div className="clearTargets">
        {CLEAR_KEY_ORDER.map((key) => {
          const on = !!settings.clearTargets?.[key];
          return (
            <button
              key={key}
              type="button"
              className={`clearTargetBtn${on ? ' selected' : ''}`}
              aria-pressed={on}
              data-ui={UI.settings.clearTarget}
              onClick={() => {
                // 描画値は直接触らず handler 内で live settings を引き直す
                const live = store.getSettings();
                live.clearTargets[key] = !live.clearTargets[key];
                void store.saveSettings();
                runtime.bump();
              }}
            >
              {clearItemTitle(key)}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ============================
// タグ管理 (追加 / 改名 / 削除 / 初期化)
// ============================

function TagManagerSection({ runtime }: { runtime: AppRuntime }) {
  const toast = useToast();
  const { store } = runtime;
  const settings = store.getSettings();
  const [renamingIdx, setRenamingIdx] = useState<number | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const [deleteIdx, setDeleteIdx] = useState<number | null>(null);
  const [resetConfirm, setResetConfirm] = useState(false);

  const tags = Array.isArray(settings.tags) ? settings.tags : [];

  function commitRename(idx: number): void {
    const next = renameDraft.trim();
    setRenamingIdx(null);
    if (!next || next === tags[idx]) return;
    if (!renameTagAt(store, idx, next)) {
      toast.show(t('settings.tag.name.duplicate'), 'error');
      return;
    }
    runtime.bump();
  }

  return (
    <div className="card card--pad settingsSection">
      <div className="section-label">{t('settings.title.tags')}</div>
      <div className="tagSettingList" data-ui={UI.settings.tagList}>
        {tags.map((name, idx) => (
          <span key={`${name}-${idx}`} className="tagSettingChip" data-ui={UI.settings.tagRow}>
            {renamingIdx === idx ? (
              <input
                className="input tagSettingInput"
                type="text"
                value={renameDraft}
                placeholder={t('settings.tag.placeholder')}
                autoComplete="off"
                aria-label={t('common.edit')}
                // 明示的な編集タップ後の単一入力 (中央ルールの明示経路)
                autoFocus
                onChange={(e) => setRenameDraft(e.target.value)}
                onBlur={() => commitRename(idx)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    commitRename(idx);
                  } else if (e.key === 'Escape') {
                    e.preventDefault();
                    setRenamingIdx(null);
                  }
                }}
              />
            ) : (
              <>
                <button
                  type="button"
                  className="tagSettingChipLabel"
                  title={t('common.edit')}
                  onClick={() => {
                    setRenamingIdx(idx);
                    setRenameDraft(name);
                  }}
                >
                  {name || t('settings.tagGroup.name.empty')}
                </button>
                <button
                  type="button"
                  className="tagSettingDel"
                  title={t('common.delete')}
                  aria-label={t('settings.tag.delete.aria', { name: name || t('settings.tagGroup.name.empty') })}
                  data-ui={UI.settings.tagDelete}
                  onClick={() => setDeleteIdx(idx)}
                >
                  <Icon name="close" size={12} />
                </button>
              </>
            )}
          </span>
        ))}
        <AddTagWidget store={store} onAdded={() => runtime.bump()} />
      </div>
      <div className="settingsRowActions">
        <Button onClick={() => setResetConfirm(true)}>{t('common.reset')}</Button>
      </div>

      {deleteIdx != null ? <OverlayBinding onClose={() => setDeleteIdx(null)} /> : null}
      {deleteIdx != null ? (
        <ConfirmDialog
          title={t('common.delete')}
          body={t('settings.tag.delete.confirm', { name: tags[deleteIdx] ?? '' })}
          confirmLabel={t('common.delete')}
          cancelLabel={t('common.cancel')}
          danger
          onCancel={() => setDeleteIdx(null)}
          onConfirm={() => {
            const idx = deleteIdx;
            setDeleteIdx(null);
            deleteTagAt(store, idx);
            runtime.bump();
          }}
        />
      ) : null}

      {resetConfirm ? <OverlayBinding onClose={() => setResetConfirm(false)} /> : null}
      {resetConfirm ? (
        <ConfirmDialog
          title={t('settings.title.tags')}
          body={t('tag.reset.confirm')}
          confirmLabel={t('common.save')}
          cancelLabel={t('common.cancel')}
          onCancel={() => setResetConfirm(false)}
          onConfirm={() => {
            setResetConfirm(false);
            store.getSettings().tags = clone(DEFAULT_TAGS);
            void store.saveSettings();
            runtime.bump();
          }}
        />
      ) : null}
    </div>
  );
}

// ============================
// フォーマット CRUD (パネル別一覧)
// ============================

function FormatsSection({ runtime }: { runtime: AppRuntime }) {
  const { store } = runtime;
  const settings = store.getSettings();
  const [editor, setEditor] = useState<{ format: Format | null; panel: FormatPanel } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Format | null>(null);

  const all = Array.isArray(settings.formats) ? settings.formats : [];

  return (
    <div className="card card--pad settingsSection">
      <div className="section-label">{t('format.title')}</div>
      {FORMAT_PANELS.map((panel) => {
        const list = all.filter((f) => f.panel === panel);
        return (
          <div key={panel} className="settingsFormatPanel" data-ui={UI.settings.formatList}>
            <div className="settingsFormatPanelHead">
              <span className="settingsFormatPanelName">
                {t('format.panelSection', { panel: t(`panel.${panel}`) })}
              </span>
              <IconButton
                label={t('settings.addFormat.aria')}
                dataUi={UI.settings.formatAdd}
                onClick={() => setEditor({ format: null, panel })}
              >
                <Icon name="add" size={16} />
              </IconButton>
            </div>
            {list.length === 0 ? <p className="muted settingsListEmpty">{t('settings.format.list.empty')}</p> : null}
            {list.map((f) => {
              // このフォーマットが、いずれかのセットのいずれかのパネルで「最後の展開
              // フォーマット」なら削除不可 (ワンタップ入力カードが欠ける)。
              const soleExpand = formatRemovalBreaksAnyGroupExpand(f.id, all, settings.formatGroups);
              return (
                <div key={f.id} className="formatListRow" data-ui={UI.settings.formatRow}>
                  <span className="formatListName">{f.name}</span>
                  <span className="formatListActions">
                    <IconButton
                      label={t('common.edit')}
                      dataUi={UI.settings.formatEdit}
                      onClick={() => setEditor({ format: f, panel })}
                    >
                      <Icon name="edit" size={14} />
                    </IconButton>
                    <IconButton
                      label={soleExpand ? t('format.delete.soleExpandBlocked') : t('common.delete')}
                      disabled={soleExpand}
                      dataUi={UI.settings.formatDelete}
                      onClick={() => setDeleteTarget(f)}
                    >
                      <Icon name="delete" size={14} />
                    </IconButton>
                  </span>
                </div>
              );
            })}
          </div>
        );
      })}

      {editor ? (
        <FormatEditDialog
          runtime={runtime}
          format={editor.format}
          panel={editor.panel}
          onClose={() => setEditor(null)}
        />
      ) : null}

      {deleteTarget ? <OverlayBinding onClose={() => setDeleteTarget(null)} /> : null}
      {deleteTarget ? (
        <ConfirmDialog
          title={t('common.delete')}
          body={t('format.delete.confirm', { name: deleteTarget.name })}
          confirmLabel={t('common.delete')}
          cancelLabel={t('common.cancel')}
          danger
          onCancel={() => setDeleteTarget(null)}
          onConfirm={() => {
            const target = deleteTarget;
            setDeleteTarget(null);
            const live = store.getSettings();
            // 防御的に再判定 (確認中に状態が変わった場合)
            if (formatRemovalBreaksAnyGroupExpand(target.id, live.formats, live.formatGroups)) return;
            const idx = live.formats.findIndex((f) => f.id === target.id);
            if (idx >= 0) live.formats.splice(idx, 1);
            void store.saveSettings();
            runtime.bump();
          }}
        />
      ) : null}
    </div>
  );
}

// ============================
// セット (フォーマットグループ) CRUD
// ============================

function GroupsSection({ runtime }: { runtime: AppRuntime }) {
  const { store } = runtime;
  const settings = store.getSettings();
  const [editor, setEditor] = useState<{ group: FormatGroup | null } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<FormatGroup | null>(null);

  const groups = Array.isArray(settings.formatGroups) ? settings.formatGroups : [];

  return (
    <div className="card card--pad settingsSection" data-ui={UI.settings.groupList}>
      <div className="settingsFormatPanelHead">
        <span className="section-label">{t('formatGroup.section.title')}</span>
        <IconButton label={t('formatGroup.add')} dataUi={UI.settings.groupAdd} onClick={() => setEditor({ group: null })}>
          <Icon name="add" size={16} />
        </IconButton>
      </div>
      {groups.length === 0 ? <p className="muted settingsListEmpty">{t('formatGroup.empty')}</p> : null}
      {groups.map((g) => (
        <div key={g.id} className="formatListRow" data-ui={UI.settings.groupRow}>
          <span className="formatListName">{g.name}</span>
          {g.isDefault ? <span className="tag tag--primary formatGroupDefaultBadge">{t('formatGroup.defaultBadge')}</span> : null}
          <span className="formatListActions">
            <IconButton label={t('common.edit')} dataUi={UI.settings.groupEdit} onClick={() => setEditor({ group: g })}>
              <Icon name="edit" size={14} />
            </IconButton>
            <IconButton
              label={g.isDefault ? t('formatGroup.delete.defaultBlocked') : t('common.delete')}
              disabled={g.isDefault}
              dataUi={UI.settings.groupDelete}
              onClick={() => setDeleteTarget(g)}
            >
              <Icon name="delete" size={14} />
            </IconButton>
          </span>
        </div>
      ))}

      {editor ? <FormatGroupEditDialog runtime={runtime} group={editor.group} onClose={() => setEditor(null)} /> : null}

      {deleteTarget ? <OverlayBinding onClose={() => setDeleteTarget(null)} /> : null}
      {deleteTarget ? (
        <ConfirmDialog
          title={t('common.delete')}
          body={t('formatGroup.delete.confirm', { name: deleteTarget.name })}
          confirmLabel={t('common.delete')}
          cancelLabel={t('common.cancel')}
          danger
          onCancel={() => setDeleteTarget(null)}
          onConfirm={() => {
            const target = deleteTarget;
            setDeleteTarget(null);
            // デフォルトグループは削除不可 (防御的二重判定)
            if (target.isDefault) return;
            const live = store.getSettings();
            live.formatGroups = (live.formatGroups || []).filter((g) => g.id !== target.id);
            // 各患者の activeFormatGroupId からも掃除 ("" = デフォルトに従う)
            for (const p of store.getAppState().patients) {
              if (p.activeFormatGroupId === target.id) p.activeFormatGroupId = '';
            }
            void store.saveSettings();
            store.scheduleSave();
            runtime.bump();
          }}
        />
      ) : null}
    </div>
  );
}

// ============================
// QR (ST 送信カード + 統一受信 + セキュリティ設定)
// ============================

function QrSection({ runtime }: { runtime: AppRuntime }) {
  const toast = useToast();
  const revision = useRevision(runtime);
  const { store } = runtime;
  const [receiveOpen, setReceiveOpen] = useState(false);

  // ST 送信カード (表示専用・受信導線なし)
  const flow = useQrFlow<never>({
    kind: 'ST',
    kindLabel: t('qr.kind.settings'),
    keyBytes: APP_KEY_BYTES,
    encodePayload: () => encodeSettingsPayload(store.getSettings()),
    decodePayload: () => {
      throw new Error('display-only');
    },
    shouldEncrypt: () => !!store.getSettings().qrEncryption?.ST,
    compress: true,
    onApply: () => {},
  });
  const refreshQr = flow.refresh;
  useEffect(() => {
    void refreshQr();
  }, [revision, refreshQr]);

  return (
    <div className="card card--pad settingsSection">
      <div className="section-label">{t('qr.kind.settings')}</div>
      <div className="settingsRowActions">
        <Button
          dataUi={UI.settings.qrShow}
          onClick={() => {
            if (flow.isActive) {
              flow.close();
            } else {
              runtime.eventlog.log(EVENT.QR_SHOW, { kind: 'ST' });
              void flow.open().catch((e) => {
                console.error('qr open failed:', e);
                toast.show(t('qr.render.failed'), 'error');
              });
            }
          }}
        >
          {t('settings.qr.show')}
        </Button>
        <Button dataUi={UI.settings.qrReceiveOpen} onClick={() => setReceiveOpen(true)}>
          {t('qrReceive.open')}
        </Button>
      </div>
      <p className="muted settingsHint">{t('qrReceive.hint')}</p>

      {flow.isActive ? (
        <QrCard flow={flow} kindLabel={t('qr.kind.settings')} receivable={false} onClose={flow.close} />
      ) : null}

      <div className="section-label">{t('settings.qrSecurity.section')}</div>
      <p className="muted settingsHint">{t('settings.qrSecurity.hint')}</p>
      <div className="qrSecurityGrid">
        <span className="qrSecurityHead" aria-hidden="true" />
        <span className="qrSecurityHead">{t('settings.qrSecurity.encryption')}</span>
        <span className="qrSecurityHead">{t('settings.qrSecurity.redistribution')}</span>
        {QR_KINDS.map((kind: QrKind) => (
          <QrSecurityRowFragment key={kind} kind={kind} runtime={runtime} />
        ))}
      </div>

      {receiveOpen ? <QrReceiveDialog runtime={runtime} onClose={() => setReceiveOpen(false)} /> : null}
    </div>
  );
}

function QrSecurityRowFragment({ kind, runtime }: { kind: QrKind; runtime: AppRuntime }) {
  const { store } = runtime;
  const settings = store.getSettings();
  const enc = !!settings.qrEncryption?.[kind];
  const redis = settings.qrRedistribution?.[kind] === 'restricted';
  return (
    <>
      <span className="qrSecurityKind mono">{kind}</span>
      <label className="qrSecurityCell">
        <input
          type="checkbox"
          checked={enc}
          data-ui={UI.settings.qrEncryption}
          onChange={(e) => {
            store.getSettings().qrEncryption[kind] = e.target.checked;
            void store.saveSettings();
            runtime.bump();
          }}
        />
        {t('settings.qrSecurity.encryption')}
      </label>
      <label className="qrSecurityCell">
        <input
          type="checkbox"
          checked={redis}
          data-ui={UI.settings.qrRedistribution}
          onChange={(e) => {
            store.getSettings().qrRedistribution[kind] = e.target.checked ? 'restricted' : 'free';
            void store.saveSettings();
            runtime.bump();
          }}
        />
        {t('settings.qrSecurity.redistribution.restricted')}
      </label>
    </>
  );
}

// ============================
// データの保存と復元 (JSON / 端末まるごと / 研究ログ)
// ============================

function DataSection({ runtime }: { runtime: AppRuntime }) {
  const toast = useToast();
  const { store } = runtime;
  const fileRef = useRef<HTMLInputElement>(null);
  const [pendingImport, setPendingImport] = useState<
    | { kind: 'archive'; archive: Parameters<typeof store.importArchive>[0] }
    | { kind: 'device'; archive: Parameters<typeof store.importDeviceArchive>[0] }
    | null
  >(null);
  const [logClearConfirm, setLogClearConfirm] = useState(false);

  async function exportArchive(): Promise<void> {
    try {
      const archive = await store.exportArchive();
      const title = (store.getAppState().title || t('app.title')).replace(/[\\/:*?"<>|]/g, '_');
      downloadJson(archive, `${envPrefix()}${title}_${timestampSuffix()}.json`);
      toast.show(t('export.saved'));
    } catch (e) {
      console.error('export failed:', e);
      toast.show(t('export.failed'), 'error');
    }
  }

  async function exportDevice(): Promise<void> {
    try {
      const archive = await store.exportDeviceArchive();
      downloadJson(archive, `${envPrefix()}device_${timestampSuffix()}.json`);
      toast.show(t('export.saved'));
    } catch (e) {
      console.error('device export failed:', e);
      toast.show(t('export.failed'), 'error');
    }
  }

  async function exportLog(): Promise<void> {
    try {
      const log = await runtime.eventlog.exportAll();
      downloadJson(log, `${envPrefix()}log_${timestampSuffix()}.json`);
      toast.show(t('export.saved'));
    } catch (e) {
      console.error('log export failed:', e);
      toast.show(t('export.failed'), 'error');
    }
  }

  function onFileChosen(file: File): void {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed: unknown = JSON.parse(String(reader.result || ''));
        if (isDeviceArchive(parsed)) {
          setPendingImport({ kind: 'device', archive: parsed });
          return;
        }
        if (isArchive(parsed)) {
          setPendingImport({ kind: 'archive', archive: parsed });
          return;
        }
        // 旧来の単一バンドル形式は v2 では非対応 (v1 端末からは archive 形式で書き出す)
        toast.show(t('import.parse.failed'), 'error');
      } catch (e) {
        console.error('import failed:', e);
        toast.show(t('import.read.failed'), 'error');
      }
    };
    reader.readAsText(file);
  }

  async function runImport(target: NonNullable<typeof pendingImport>): Promise<void> {
    // 取込前スナップショット (REASON.IMPORT): 失敗しても取込自体は続行する
    // (snapshot は保険・主操作を塞がない)。
    const state = store.getAppState();
    await runtime.snapshots.capture(
      REASON.IMPORT,
      store.storage.getActiveWorkspaceId(),
      { title: state.title, patients: state.patients },
      String(countActivePatients(state.patients)),
    );
    try {
      if (target.kind === 'device') {
        const res = await store.importDeviceArchive(target.archive);
        toast.show(t('import.device.done', { users: res.users, n: res.workspaces }));
      } else {
        const created = await store.importArchive(target.archive, { includeSettings: true });
        toast.show(t('import.archive.done', { n: created }));
      }
      runtime.bump();
    } catch (e) {
      console.error('archive import failed:', e);
      toast.show(t('import.read.failed'), 'error');
    }
  }

  return (
    <div className="card card--pad settingsSection">
      <div className="section-label">{t('settings.io.section')}</div>
      <p className="muted settingsHint">{t('settings.workspace.hint')}</p>
      <div className="settingsRowActions">
        <Button dataUi={UI.settings.ioImport} onClick={() => fileRef.current?.click()}>
          {t('io.json.import.label')}
        </Button>
        <Button dataUi={UI.settings.ioExport} onClick={() => void exportArchive()}>
          {t('io.json.export.label')}
        </Button>
      </div>

      <div className="section-label">{t('settings.device.section')}</div>
      <p className="muted settingsHint">{t('settings.device.hint')}</p>
      <div className="settingsRowActions">
        <Button dataUi={UI.settings.ioDeviceImport} onClick={() => fileRef.current?.click()}>
          {t('io.device.import.label')}
        </Button>
        <Button dataUi={UI.settings.ioDeviceExport} onClick={() => void exportDevice()}>
          {t('io.device.export.label')}
        </Button>
      </div>

      <div className="section-label">{t('settings.log.section')}</div>
      <p className="muted settingsHint">{t('settings.log.hint')}</p>
      <div className="settingsRowActions">
        <Button dataUi={UI.settings.logExport} onClick={() => void exportLog()}>
          {t('io.log.export.label')}
        </Button>
        <Button dataUi={UI.settings.logClear} onClick={() => setLogClearConfirm(true)}>
          {t('io.log.clear.label')}
        </Button>
      </div>

      <input
        ref={fileRef}
        type="file"
        accept="application/json,.json"
        style={{ display: 'none' }}
        aria-hidden="true"
        tabIndex={-1}
        data-ui={UI.settings.ioFile}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) onFileChosen(file);
          e.target.value = '';
        }}
      />

      {pendingImport ? <OverlayBinding onClose={() => setPendingImport(null)} /> : null}
      {pendingImport ? (
        <ConfirmDialog
          title={t('common.import')}
          body={
            pendingImport.kind === 'device'
              ? t('import.device.confirm', { n: pendingImport.archive.users.length })
              : t('import.archive.confirm', { n: pendingImport.archive.workspaces.length })
          }
          confirmLabel={t('common.import')}
          cancelLabel={t('common.cancel')}
          onCancel={() => setPendingImport(null)}
          onConfirm={() => {
            const target = pendingImport;
            setPendingImport(null);
            if (target) void runImport(target);
          }}
        />
      ) : null}

      {logClearConfirm ? <OverlayBinding onClose={() => setLogClearConfirm(false)} /> : null}
      {logClearConfirm ? (
        <ConfirmDialog
          title={t('io.log.clear.label')}
          body={t('io.log.clear.confirm')}
          confirmLabel={t('io.log.clear.label')}
          cancelLabel={t('common.cancel')}
          danger
          onCancel={() => setLogClearConfirm(false)}
          onConfirm={() => {
            setLogClearConfirm(false);
            void runtime.eventlog.clear().then(() => toast.show(t('io.log.clear.done')));
          }}
        />
      ) : null}
    </div>
  );
}

// ============================
// 巻き戻し (スナップショット復元)
// ============================

const RESTORE_REASON_KEY: Record<string, StringKey> = {
  [REASON.CLEAR]: 'settings.restore.reason.clear',
  [REASON.MOVE]: 'settings.restore.reason.move',
  [REASON.PATIENT_DELETE]: 'settings.restore.reason.patientDelete',
  [REASON.DELETE]: 'settings.restore.reason.delete',
  [REASON.IMPORT]: 'settings.restore.reason.import',
  [REASON.NAV]: 'settings.restore.reason.nav',
  [REASON.RESTORE_UNDO]: 'settings.restore.reason.undo',
};

function RestoreSection({ runtime }: { runtime: AppRuntime }) {
  const toast = useToast();
  const revision = useRevision(runtime);
  const { store } = runtime;
  const [points, setPoints] = useState<RestorePoint[] | null>(null);
  const [pendingRestore, setPendingRestore] = useState<RestorePoint | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    const activeId = store.storage.getActiveWorkspaceId();
    // 現病棟のスナップショット (v1 同等) + 病棟削除前のスナップショット (REASON.DELETE は
    // 削除済み病棟の scope に紐づくため、現病棟フィルタだけだと復旧入口が無くなる)。
    // 復元はどちらも「現病棟へ戻す」(復元前に restore_undo を自動で撮る)。
    void runtime.snapshots.list().then((list) => {
      if (alive) setPoints(list.filter((s) => s.scopeId === activeId || s.reason === REASON.DELETE));
    });
    return () => {
      alive = false;
    };
  }, [runtime, store, revision]);

  async function runRestore(point: RestorePoint): Promise<void> {
    if (busy) return;
    setBusy(true);
    try {
      const state = store.getAppState();
      const res = await runtime.snapshots.restore(
        point.id,
        { title: state.title, patients: state.patients },
        async (data) => {
          // fail-closed: 保存できなければ live を戻して throw (restore は ok:false を返す)
          const before = store.getAppState().patients;
          store.setAppState({
            ...store.getAppState(),
            patients: normalizePatientArray(data.patients),
          });
          try {
            await store.persistActiveOrThrow();
          } catch (e) {
            store.setAppState({ ...store.getAppState(), patients: before });
            throw e;
          }
        },
      );
      if (!res.ok) {
        toast.show(t('settings.restore.failed'), 'error');
        runtime.bump();
        return;
      }
      runtime.eventlog.log(EVENT.SNAPSHOT_RESTORE);
      runtime.bump();
    } catch (e) {
      console.error('restore failed:', e);
      toast.show(t('settings.restore.failed'), 'error');
    } finally {
      setBusy(false);
      setPendingRestore(null);
    }
  }

  return (
    <div className="card card--pad settingsSection">
      <div className="section-label">{t('settings.restore.section')}</div>
      <p className="muted settingsHint">{t('settings.restore.hint')}</p>
      <div data-ui={UI.settings.restoreList}>
        {points !== null && points.length === 0 ? (
          <p className="muted settingsListEmpty">{t('settings.restore.empty')}</p>
        ) : null}
        {(points ?? []).map((p) => {
          const reasonKey = RESTORE_REASON_KEY[p.reason];
          const count = parseInt(p.label || '0', 10) || 0;
          return (
            <div key={p.id} className="formatListRow" data-ui={UI.settings.restoreRow}>
              <span className="formatListName">
                {fmtTimestamp(p.t)}
                <span className="muted restoreMeta">
                  {reasonKey ? `${t(reasonKey)} ・ ` : ''}
                  {t('settings.restore.count', { n: count })}
                </span>
              </span>
              <span className="formatListActions">
                <Button
                  disabled={busy}
                  dataUi={UI.settings.restoreAction}
                  onClick={() => setPendingRestore(p)}
                >
                  {t('settings.restore.action')}
                </Button>
                <IconButton
                  label={t('common.delete')}
                  dataUi={UI.settings.restoreDelete}
                  onClick={() => {
                    void runtime.snapshots.deleteOne(p.id).then(() => runtime.bump());
                  }}
                >
                  <Icon name="delete" size={16} />
                </IconButton>
              </span>
            </div>
          );
        })}
      </div>

      {pendingRestore ? <OverlayBinding onClose={() => setPendingRestore(null)} /> : null}
      {pendingRestore ? (
        <ConfirmDialog
          title={t('settings.restore.section')}
          body={t('settings.restore.confirm')}
          confirmLabel={t('settings.restore.action')}
          cancelLabel={t('common.cancel')}
          onCancel={() => setPendingRestore(null)}
          onConfirm={() => {
            const target = pendingRestore;
            setPendingRestore(null);
            if (target) void runRestore(target);
          }}
        />
      ) : null}
    </div>
  );
}

// ============================
// ユーザー管理 (改名はピッカー側・ここは切替/削除)
// ============================

interface SettingsUserRow {
  id: string;
  name: string;
  createdAt: number;
}

function UserSection({ runtime }: { runtime: AppRuntime }) {
  const toast = useToast();
  const revision = useRevision(runtime);
  const { store } = runtime;
  const [users, setUsers] = useState<SettingsUserRow[] | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<SettingsUserRow | null>(null);
  const [busy, setBusy] = useState(false);

  const currentId = store.storage.getCurrentUserId();

  useEffect(() => {
    let alive = true;
    void store.storage.listUsers().then((all) => {
      if (!alive) return;
      const sorted = all.slice().sort((a, b) => {
        if (a.id === currentId) return -1;
        if (b.id === currentId) return 1;
        return (a.createdAt || 0) - (b.createdAt || 0);
      });
      setUsers(sorted.map((u) => ({ id: u.id, name: u.name || '', createdAt: u.createdAt || 0 })));
    });
    return () => {
      alive = false;
    };
  }, [store, currentId, revision]);

  async function switchTo(id: string): Promise<void> {
    if (busy) return;
    setBusy(true);
    try {
      await store.switchUser(id); // fail-closed
      runtime.eventlog.log(EVENT.USER_SWITCH);
    } catch (e) {
      console.error('user switch failed:', e);
      toast.show(t('io.user.switch.failed'), 'error');
    } finally {
      setBusy(false);
    }
  }

  async function runDelete(row: SettingsUserRow): Promise<void> {
    if (busy) return;
    setBusy(true);
    try {
      const { workspaceIds } = await store.storage.deleteUser(row.id);
      // 削除ユーザーの病棟スナップショット (患者 PII) を別 DB からも消す。失敗 (ok=false)
      // は黙って成功扱いにせず通知する。tombstone により次回起動で自動再試行される。
      const purge = await runtime.snapshots.purgeForScopes(workspaceIds);
      if (!purge.ok) toast.show(t('io.snapshot.purge.deferred'), 'error');
      runtime.bump();
    } catch (e) {
      console.error('user delete failed:', e);
      toast.show(t('io.user.delete.failed'), 'error');
    } finally {
      setBusy(false);
      setDeleteTarget(null);
    }
  }

  const total = users?.length ?? 0;

  return (
    <div className="card card--pad settingsSection">
      <div className="section-label">{t('settings.user.section')}</div>
      <p className="muted settingsHint">{t('settings.user.hint')}</p>
      <div data-ui={UI.settings.userList}>
        {users !== null && users.length === 0 ? (
          <p className="muted settingsListEmpty">{t('io.user.list.empty')}</p>
        ) : null}
        {(users ?? []).map((row) => {
          const isCurrent = row.id === currentId;
          return (
            <div key={row.id} className={`formatListRow${isCurrent ? ' activeRow' : ''}`} data-ui={UI.settings.userRow}>
              <button
                type="button"
                className="pickerRowMain"
                disabled={busy || isCurrent}
                onClick={() => void switchTo(row.id)}
              >
                <span className="pickerRowLabel">{row.name || t('io.user.untitled')}</span>
                <span className="pickerRowMeta">{fmtTimestamp(row.createdAt)}</span>
              </button>
              <span className="formatListActions">
                {/* 削除: 現ユーザー / 最後の 1 人は不可 */}
                {!isCurrent && total > 1 ? (
                  <IconButton
                    label={t('common.delete')}
                    dataUi={UI.settings.userDelete}
                    onClick={() => setDeleteTarget(row)}
                  >
                    <Icon name="delete" size={16} />
                  </IconButton>
                ) : null}
              </span>
            </div>
          );
        })}
      </div>

      {deleteTarget ? <OverlayBinding onClose={() => setDeleteTarget(null)} /> : null}
      {deleteTarget ? (
        <ConfirmDialog
          title={t('common.delete')}
          body={t('io.user.delete.confirm', { name: deleteTarget.name || t('io.user.untitled') })}
          confirmLabel={t('common.delete')}
          cancelLabel={t('common.cancel')}
          danger
          onCancel={() => setDeleteTarget(null)}
          onConfirm={() => {
            const target = deleteTarget;
            setDeleteTarget(null);
            if (target) void runDelete(target);
          }}
        />
      ) : null}
    </div>
  );
}

// ============================
// 本体
// ============================

export function SettingsView({ runtime }: { runtime: AppRuntime }) {
  useRevision(runtime);
  return (
    <section aria-label={t('header.settings')} data-ui={UI.settings.view}>
      <h2 className="screen-title">{t('header.settings')}</h2>
      <ClearTargetsSection runtime={runtime} />
      <TagManagerSection runtime={runtime} />
      <FormatsSection runtime={runtime} />
      <GroupsSection runtime={runtime} />
      <QrSection runtime={runtime} />
      <DataSection runtime={runtime} />
      <RestoreSection runtime={runtime} />
      <UserSection runtime={runtime} />
      <div className="card card--pad settingsSection">
        <div className="section-label">{t('settings.guide.section')}</div>
        {/* v1 の操作ガイド (docs-bundle) は配信前に人間判断 → 移植保留 */}
        <p className="muted">{t('settings.guide.pending')}</p>
      </div>
    </section>
  );
}
