// 移植元: snishi-code-medical/hospital-rounds/src/views/settings-view.js (設定画面全節)
//          + features/import-export.js (JSON/端末まるごと/ログ入出力)
//          + features/qr-settings.js (ST 送信カード) + qr-receive.js (統一受信入口)
//
// 設定画面の構成 (v1 settings-view.js と同じ並び):
//   QR (ST 送信カード + QR から追加) / フォーマット CRUD (パネル別カード) / セット CRUD /
//   クリア対象 / タグ管理 / ユーザー管理 / 病棟 (JSON 取込・書出) / 巻き戻し /
//   研究ログ / 端末まるごと / 操作ガイド (準備中プレースホルダ)
//
// QR セキュリティ (暗号化 / 再配布制限) は v1 v7.1+ と同じくユーザー UI に出さない。
// 設定モデルは normalizeSettings がコード内固定値へ正規化して常時動作する。

import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Button } from '@snishi/foundation/ui/Button';
import { IconButton } from '@snishi/foundation/ui/IconButton';
import { Icon } from '@snishi/foundation/ui/Icon';
import { ConfirmDialog } from '@snishi/foundation/ui/ConfirmDialog';
import { useToast } from '@snishi/foundation/ui/toast';
import { useQrFlow } from '@snishi/foundation/qr/useQrFlow';
import type { RestorePoint } from '@snishi/foundation/snapshot/snapshots';
import {
  FORMAT_PANELS,
  STATUS,
  type Format,
  type FormatDisplay,
  type FormatPanel,
  type Patient,
  type PatientStatus,
} from '../../domain/types';
import { SECTION, getSection } from '../../data/bundle';
import { normalizePatientArray } from '../../domain/normalize';
import { encodeSettingsPayload } from '../../qr/settingsQr';
import { APP_KEY_BYTES, QR_ENCRYPT } from '../../qr/appKey';
import { isArchive, isDeviceArchive } from '../../data/store';
import { REASON, countActivePatients } from '../../data/snapshots';
import { EVENT } from '../../data/eventlog';
import { useRevision, type AppRuntime } from '../appRuntime';
import { statusClass, STATUS_MARK } from '../patientDisplay';
import { QrDialog } from '../QrCard';
import { AddTagWidget } from '../TagPicker';
import { deleteTagAt, renameTagAt, setTagClearOnStart } from '../tags';
import { OverlayBinding } from '../registries';
import { FormatEditDialog } from './FormatEditDialog';
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

const CLEAR_KEY_ORDER = ['S', 'O', 'A', 'P', 'statusYellow', 'statusGreen', 'statusGray', 'statusBlue'] as const;

const CLEAR_STATUS_BY_KEY: Readonly<Record<string, PatientStatus>> = Object.freeze({
  statusYellow: STATUS.YELLOW,
  statusGreen: STATUS.GREEN,
  statusGray: STATUS.GRAY,
  statusBlue: STATUS.BLUE,
});

function clearItemTitle(key: string): string {
  if (key in CLEAR_STATUS_BY_KEY) {
    return t(`settings.clear.${key}` as StringKey);
  }
  return t(`panel.${key}` as StringKey);
}

/** チップの中身 (v1 buildClearTargetLabelContent):
 *  S/O/A/P = 短いテキスト、ステータス = 色スウォッチ + 形マーク。
 *  文言は aria-label / title で読める (色だけに依存しない)。 */
function ClearTargetLabel({ key_ }: { key_: string }) {
  const status = CLEAR_STATUS_BY_KEY[key_];
  if (status) {
    return (
      <span className={`clearTargetSwatch ${statusClass(status)}`} aria-hidden="true">
        {STATUS_MARK[status]}
      </span>
    );
  }
  return <span>{t(`panel.${key_}` as StringKey)}</span>;
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
              aria-label={clearItemTitle(key)}
              title={clearItemTitle(key)}
              data-ui={UI.settings.clearTarget}
              onClick={() => {
                // 描画値は直接触らず handler 内で live settings を引き直す
                const live = store.getSettings();
                live.clearTargets[key] = !live.clearTargets[key];
                void store.saveSettings();
                runtime.bump();
              }}
            >
              <ClearTargetLabel key_={key} />
              <span className="clearTargetX" aria-hidden="true">
                <Icon name="close" size={12} />
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ============================
// タグ管理 (追加 / 改名 / 削除。初期化ボタンは置かない — v1 同様)
// ============================

function TagManagerSection({ runtime }: { runtime: AppRuntime }) {
  const toast = useToast();
  const { store } = runtime;
  const settings = store.getSettings();
  const [renamingIdx, setRenamingIdx] = useState<number | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const [deleteIdx, setDeleteIdx] = useState<number | null>(null);

  const tags = Array.isArray(settings.tags) ? settings.tags : [];

  function commitRename(idx: number): void {
    const next = renameDraft.trim();
    setRenamingIdx(null);
    if (!next || next === tags[idx]?.name) return;
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
        {tags.map((tagDef, idx) => {
          const name = tagDef.name;
          return (
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
                    className={`tagSettingClearOnStart${tagDef.clearOnStart ? ' selected' : ''}`}
                    aria-label={t('settings.tag.clearOnStart.label')}
                    aria-pressed={tagDef.clearOnStart}
                    title={t('settings.tag.clearOnStart.label')}
                    data-ui={UI.settings.tagClearOnStart}
                    onClick={() => {
                      setTagClearOnStart(store, idx, !store.getSettings().tags[idx]?.clearOnStart);
                      runtime.bump();
                    }}
                  >
                    {t('settings.tag.clearOnStart.label')}
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
          );
        })}
        <AddTagWidget store={store} onAdded={() => runtime.bump()} />
      </div>

      {deleteIdx != null ? <OverlayBinding onClose={() => setDeleteIdx(null)} /> : null}
      {deleteIdx != null ? (
        <ConfirmDialog
          title={t('common.delete')}
          body={t('settings.tag.delete.confirm', { name: tags[deleteIdx]?.name ?? '' })}
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
    </div>
  );
}

// ============================
// フォーマット CRUD (v1 と同じくパネルごとに 1 カード)
// ============================

function FormatsSection({ runtime }: { runtime: AppRuntime }) {
  const { store } = runtime;
  const settings = store.getSettings();
  const [editor, setEditor] = useState<{ format: Format | null; panel: FormatPanel } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Format | null>(null);

  const all = Array.isArray(settings.formats) ? settings.formats : [];

  function toggleDisplay(f: Format): void {
    const live = store.getSettings();
    const idx = live.formats.findIndex((x) => x.id === f.id);
    if (idx < 0) return;
    const next: FormatDisplay = live.formats[idx]!.display === 'expand' ? 'quick' : 'expand';
    live.formats[idx] = { ...live.formats[idx]!, display: next };
    void store.saveSettings();
    runtime.bump();
  }

  return (
    <>
      {FORMAT_PANELS.map((panel) => {
        const list = all.filter((f) => f.panel === panel);
        return (
          <div key={panel} className="card card--pad settingsSection settingsFormatPanel" data-ui={UI.settings.formatList}>
            <div className="settingsFormatPanelHead">
              <span className="section-label">{t('format.panelSection', { panel: t(`panel.${panel}`) })}</span>
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
              const mode = f.display === 'expand' ? 'expand' : 'quick';
              return (
                <div key={f.id} className="formatListRow" data-ui={UI.settings.formatRow}>
                  <span className="formatListName">{f.name}</span>
                  <span className="formatListActions">
                    {/* 展開/クイック トグル */}
                    <span className="formatDisplaySeg">
                      {(
                        [
                          ['expand', t('format.display.expand'), t('format.display.expand.title')],
                          ['quick', t('format.display.quick'), t('format.display.quick.title')],
                        ] as const
                      ).map(([key, label, title]) => (
                        <button
                          key={key}
                          type="button"
                          className={`formatDisplayBtn${mode === key ? ' active' : ''}`}
                          title={title}
                          aria-pressed={mode === key}
                          data-ui={UI.settings.formatDisplayToggle}
                          onClick={() => { if (mode !== key) toggleDisplay(f); }}
                        >
                          {label}
                        </button>
                      ))}
                    </span>
                    <IconButton
                      label={t('common.edit')}
                      dataUi={UI.settings.formatEdit}
                      onClick={() => setEditor({ format: f, panel })}
                    >
                      <Icon name="edit" size={14} />
                    </IconButton>
                    <IconButton
                      label={t('common.delete')}
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
            const idx = live.formats.findIndex((f) => f.id === target.id);
            if (idx >= 0) live.formats.splice(idx, 1);
            void store.saveSettings();
            runtime.bump();
          }}
        />
      ) : null}
    </>
  );
}

// ============================
// QR (ST 送信カード + 統一受信)。暗号化・再配布制限の設定 UI は出さない
// (v1 v7.1+ 同方針。コード内固定 = normalizeSettings が担保)。
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
    shouldEncrypt: () => QR_ENCRYPT.ST,
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
        <QrDialog flow={flow} kindLabel={t('qr.kind.settings')} receivable={false} onClose={flow.close} />
      ) : null}

      {receiveOpen ? <QrReceiveDialog runtime={runtime} onClose={() => setReceiveOpen(false)} /> : null}
    </div>
  );
}

// ============================
// データの保存と復元 (JSON / 研究ログ / 端末まるごと)
// v1 の並び (病棟 → 巻き戻し → 研究ログ → 端末まるごと) を保つため、JSON カードの
// 直後に挿し込む節 (= 巻き戻し) を between で受ける。取込ルーティング (archive/device
// 自動判別) と確認ダイアログは 1 箇所に集約したままにする。
// ============================

function DataSection({ runtime, between }: { runtime: AppRuntime; between?: ReactNode }) {
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
    <>
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
      </div>

      {between}

      {/* 開発者向け: 研究ログ・端末まるごと — デフォルト閉の折りたたみ */}
      <details className="settingsDevDetails">
        <summary className="settingsDevSummary">
          <span className="section-label">{t('settings.dev.section')}</span>
          <span className="muted settingsHint">{t('settings.dev.hint')}</span>
        </summary>

        <div className="card card--pad settingsSection">
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
        </div>

        <div className="card card--pad settingsSection">
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
        </div>
      </details>

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
    </>
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
// 病棟 (設定画面内で一覧・切替・改名・削除・追加まで直接行う — 2026-06 フィードバック:
// ポップアップへの二度手間をやめる。Ver1 settings-view の病棟管理節準拠。
// 削除前にその病棟の REASON.DELETE スナップショット (14日 TTL) を控える = WsPicker と同じ)
// ============================

interface WardRow {
  id: string;
  label: string;
  title: string;
  updatedAt: number;
}

function WardSection({ runtime }: { runtime: AppRuntime }) {
  const toast = useToast();
  const revision = useRevision(runtime);
  const { store } = runtime;
  const [wards, setWards] = useState<WardRow[] | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const [adding, setAdding] = useState(false);
  const [addDraft, setAddDraft] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<WardRow | null>(null);
  const [busy, setBusy] = useState(false);

  const activeId = store.storage.getActiveWorkspaceId();

  useEffect(() => {
    let alive = true;
    void store.storage.listBundles().then((all) => {
      if (!alive) return;
      const sorted = all.slice().sort((a, b) => {
        if (a.id === activeId) return -1;
        if (b.id === activeId) return 1;
        return (b.updatedAt || 0) - (a.updatedAt || 0);
      });
      setWards(
        sorted.map((w) => ({
          id: w.id,
          label: w.label || '',
          title: w.title || '',
          updatedAt: w.updatedAt || 0,
        })),
      );
    });
    return () => {
      alive = false;
    };
  }, [store, activeId, revision]);

  async function switchTo(id: string): Promise<void> {
    if (busy || id === activeId) return;
    setBusy(true);
    try {
      await store.switchWorkspace(id); // fail-closed (保存できなければ切替しない)
    } catch (e) {
      console.error('ward switch failed:', e);
      toast.show(t('io.ws.switch.failed'), 'error');
    } finally {
      setBusy(false);
    }
  }

  async function commitRename(row: WardRow): Promise<void> {
    const next = renameDraft.trim();
    setRenamingId(null);
    if (!next || next === (row.label || '')) return;
    try {
      await store.storage.renameBundle(row.id, next);
      runtime.bump(); // active 改名時のヘッダーラベル同期 + 一覧再取得 (revision)
    } catch (e) {
      console.error('ws rename failed:', e);
      toast.show(t('io.ws.rename.failed'), 'error');
    }
  }

  async function commitAdd(): Promise<void> {
    const label = addDraft.trim();
    setAdding(false);
    setAddDraft('');
    if (!label || busy) return;
    setBusy(true);
    try {
      // fail-closed: 現病棟の保存に失敗したら createWorkspace が throw → 作成中断
      await store.createWorkspace(label);
    } catch (e) {
      console.error('workspace create failed:', e);
      toast.show(t('io.ws.create.failed'), 'error');
    } finally {
      setBusy(false);
    }
  }

  // 削除: 削除前にその病棟の患者を REASON.DELETE スナップショットへ控える (14日 TTL の復旧網)
  async function runDelete(row: WardRow): Promise<void> {
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
    } catch (e) {
      console.error('workspace delete failed:', e);
      toast.show(t('io.ws.delete.failed'), 'error');
    } finally {
      setBusy(false);
      setDeleteTarget(null);
    }
  }

  return (
    <div className="card card--pad settingsSection">
      <div className="section-label">{t('settings.title.workspaces')}</div>
      <p className="muted settingsHint">{t('settings.ward.hint')}</p>
      <div data-ui={UI.settings.wardList}>
        {wards !== null && wards.length === 0 ? (
          <p className="muted settingsListEmpty">{t('io.ws.list.empty')}</p>
        ) : null}
        {(wards ?? []).map((w) => {
          const isCurrent = w.id === activeId;
          return (
            <div key={w.id} className={`formatListRow${isCurrent ? ' activeRow' : ''}`} data-ui={UI.settings.wardRow}>
              {renamingId === w.id ? (
                <input
                  className="input pickerRenameInput"
                  type="text"
                  value={renameDraft}
                  autoComplete="off"
                  aria-label={t('io.ws.rename.title')}
                  // 明示的な rename クリック後の単一入力 (中央ルールの明示経路)
                  autoFocus
                  onChange={(e) => setRenameDraft(e.target.value)}
                  onBlur={() => void commitRename(w)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      void commitRename(w);
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
                    disabled={busy || isCurrent}
                    onClick={() => void switchTo(w.id)}
                  >
                    <span className="pickerRowLabel">{w.label || t('io.ws.untitled')}</span>
                    <span className="pickerRowMeta">
                      {isCurrent ? t('settings.ward.current') : fmtTimestamp(w.updatedAt)}
                    </span>
                  </button>
                  <span className="formatListActions">
                    <IconButton
                      label={t('io.ws.rename.title')}
                      dataUi={UI.settings.wardRename}
                      onClick={() => {
                        setRenamingId(w.id);
                        setRenameDraft(w.label || w.title || '');
                      }}
                    >
                      <Icon name="edit" size={16} />
                    </IconButton>
                    {/* active 病棟は削除不可 (storage 側でも防御) */}
                    {!isCurrent ? (
                      <IconButton
                        label={t('common.delete')}
                        dataUi={UI.settings.wardDelete}
                        onClick={() => setDeleteTarget(w)}
                      >
                        <Icon name="delete" size={16} />
                      </IconButton>
                    ) : null}
                  </span>
                </>
              )}
            </div>
          );
        })}
      </div>
      <div className="settingsRowActions">
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
          <Button dataUi={UI.settings.wardAdd} onClick={() => setAdding(true)}>
            {t('io.ws.create.action')}
          </Button>
        )}
      </div>

      {deleteTarget ? <OverlayBinding onClose={() => setDeleteTarget(null)} /> : null}
      {deleteTarget ? (
        <ConfirmDialog
          title={t('common.delete')}
          body={t('io.ws.delete.confirm', { name: deleteTarget.label || t('io.ws.untitled') })}
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

export function SettingsView({ runtime, onNavigateHome }: { runtime: AppRuntime; onNavigateHome?: () => void }) {
  useRevision(runtime);
  // 並びは v1 settings-view.js 準拠: QR → フォーマット (パネル別) → セット → クリア対象 →
  // タグ → ユーザー → 病棟 (JSON) → 巻き戻し → 研究ログ → 端末まるごと → 操作ガイド。
  // 画面タイトルの見出しは出さない (v1 同様、内容を見れば分かる)。
  return (
    <section aria-label={t('header.settings')} className="settingsView" data-ui={UI.settings.view}>
      <QrSection runtime={runtime} />
      <FormatsSection runtime={runtime} />
      <ClearTargetsSection runtime={runtime} />
      <TagManagerSection runtime={runtime} />
      <UserSection runtime={runtime} />
      <WardSection runtime={runtime} />
      <DataSection runtime={runtime} between={<RestoreSection runtime={runtime} />} />
      <div className="card card--pad settingsSection">
        <div className="section-label">{t('settings.guide.section')}</div>
        {/* v1 の操作ガイド (docs-bundle) は配信前に人間判断 → 移植保留 */}
        <p className="muted">{t('settings.guide.pending')}</p>
      </div>

      {/* 下部固定バー: ホームへ戻る (左端 1 ボタン) */}
      {onNavigateHome ? (
        <div className="bottomActionBar" data-ui={UI.settings.homeBottom}>
          <IconButton
            label={t('header.home')}
            dataUi={UI.settings.homeBottom}
            onClick={onNavigateHome}
          >
            <Icon name="home" size={20} />
          </IconButton>
        </div>
      ) : null}
    </section>
  );
}
