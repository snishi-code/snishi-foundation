// 移植元: snishi-code-medical/hospital-rounds/src/views/detail.js (renderDetail / メタボタン)
//          + features/formats.js の inline 編集セッション管理
//          (_inlineEdit / enterInlineEdit / commitInlineDraft / cancelInlineFormatEdit)
//
// 詳細 (患者) ビュー:
//   - 患者ヘッダ: 前後ナビ + メタボタン (ステータス形マーク + 部屋 + 氏名 + タグ概要)
//     → 患者情報ポップアップ / 転棟済バナー / 転棟ボタン
//   - 6 パネル (problem/S/O/A/P/shared) の展開フォーマットカード + inline 編集
//   - 患者画面 QR (平文)
//
// inline 編集セッションは ref で保持 (1 文字ごとに React 再描画しない = v1 と同じ
// 「編集終了時にまとめて反映」)。セッション開始/終了時だけ tick で再描画する。
// 戻る (popstate) 中の編集は registries 経由で「編集解除のみ」(view 遷移しない)。

import { useEffect, useRef, useState } from 'react';
import { IconButton } from '@snishi/foundation/ui/IconButton';
import { Icon } from '@snishi/foundation/ui/Icon';
import { useToast } from '@snishi/foundation/ui/toast';
import { DEFAULT_ITEM_KIND, FORMAT_PANELS, STATUS, type Format } from '../domain/types';
import {
  commitDraftTextEntry,
  decidePresetToggle,
  readNumericEntry,
  readTextValue,
} from '../domain/formatValues';
import { EVENT } from '../data/eventlog';
import { useRevision, type AppRuntime } from './appRuntime';
import { formatPatientLabel, isPatientTransferred, statusClass, STATUS_MARK } from './patientDisplay';
import { PanelCard, type InlineSession, type PanelCardCallbacks } from './PanelCard';
import { FormatSheet } from './FormatSheet';
import { DetailQrDialog } from './DetailQrDialog';
import { PatientEditPopup } from './PatientEditPopup';
import { PatientLifecyclePanel } from './PatientLifecyclePanel';
import { applyFormatTags, writeFormatValue } from './formatLogic';
import { hapticTick } from './feedback';
import { registerEditingSession } from './registries';
import { t } from '../i18n/strings';
import { UI } from '../ui-contract';

// kind 別に「保存値が同じか」(実変更の検出。text は値文字列、number/fraction は value+note)
function inlineValueUnchanged(kind: string, next: unknown, orig: unknown): boolean {
  if (kind === 'text') return readTextValue(next) === readTextValue(orig);
  const a = readNumericEntry(next);
  const b = readNumericEntry(orig);
  return a.value === b.value && a.note === b.note;
}

export function DetailView({
  runtime,
  selectedNo,
  onSelectNo,
  onNavigateHome,
}: {
  runtime: AppRuntime;
  /** 1-based 患者番号 */
  selectedNo: number;
  onSelectNo: (no: number) => void;
  /** 削除/復元の成功後にホームへ戻す (v1 afterLifecycleDone) */
  onNavigateHome?: () => void;
}) {
  const toast = useToast();
  useRevision(runtime);
  const { store } = runtime;
  const appState = store.getAppState();
  const settings = store.getSettings();
  const patient = appState.patients[selectedNo - 1] ?? null;

  const [sheetFormat, setSheetFormat] = useState<Format | null>(null);
  const [qrOpen, setQrOpen] = useState(false);
  const [metaOpen, setMetaOpen] = useState(false);

  // inline 編集セッション (v1 _inlineEdit)。実体は ref (1 文字ごとに再描画しない)。
  // 描画用ミラー inline は state (開始/終了時のみ setState)。同一オブジェクト参照。
  const inlineRef = useRef<InlineSession | null>(null);
  const [inline, setInline] = useState<InlineSession | null>(null);

  // 誤タップガード (ゴーストクリック抑止): detail 入場後、新しい pointerdown が来るまで
  // 入力シート / inline 編集 / 正常チェックを開かない (v1 _freshTapSinceEntry)。
  const freshTapRef = useRef(false);
  useEffect(() => {
    freshTapRef.current = false;
    const onDown = () => {
      freshTapRef.current = true;
    };
    window.addEventListener('pointerdown', onDown);
    return () => window.removeEventListener('pointerdown', onDown);
  }, []);

  // 前/次の患者切替は DetailView が再マウントされないため、患者 (pid) が変わったら
  // ガードを掛け直す (前患者での pointerdown を次患者へ持ち越さない — 監査指摘)。
  const pid = patient?.pid ?? null;
  useEffect(() => {
    freshTapRef.current = false;
  }, [pid]);

  // inline 編集の終了 (編集 UI を閉じるだけ。write-through 済みなので値は失われない)。
  // dirty なら QR 等も含めて全体反映 (v1 cancelInlineFormatEdit)。
  const endInline = (opts: { silent?: boolean } = {}): void => {
    const s = inlineRef.current;
    if (!s) return;
    inlineRef.current = null;
    s.unregister();
    setInline(null);
    if (!opts.silent && s.dirty) runtime.bump();
  };

  // アンマウント時 (画面遷移) は silent に破棄 (戻ってきたら全体再描画される)
  useEffect(() => {
    return () => {
      const s = inlineRef.current;
      if (s) {
        inlineRef.current = null;
        s.unregister();
      }
    };
  }, []);

  // 入力欄の外をタップしたら、inline 編集 (text) の終了に加えて、バイタル等の常時入力欄も
  // 含めてフォーカス (キーボード) を完全に解除する (監査指摘: 常時入力化した欄にも適用)。
  // endInline は安定参照 (ref / runtime) のみ触るため初回登録のままでよい。
  useEffect(() => {
    const onDownOutside = (e: PointerEvent) => {
      const target = e.target instanceof Element ? e.target : null;
      // text の inline 編集セッション終了
      if (inlineRef.current && !(target && target.closest('.formatCardItem.editing'))) {
        endInline();
      }
      // 入力欄 (input/textarea) の外をタップしたらフォーカス解除 (常時入力欄も対象)。
      // 別の入力欄へのタップはブラウザ既定のフォーカス移動に、編集中セル内の操作
      // (正常 ✓ で流し込み等) はそのセルに任せる。
      const active = document.activeElement;
      if (
        active instanceof HTMLElement &&
        (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA') &&
        (!target || (target !== active && !target.closest('input, textarea, .formatCardItem.editing')))
      ) {
        active.blur();
      }
    };
    window.addEventListener('pointerdown', onDownOutside);
    return () => window.removeEventListener('pointerdown', onDownOutside);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // write-through 本体 (v1 commitInlineDraft): input ごとに formatValues へ書き込む。
  // fail-closed: 患者/フォーマット消失で中断。
  function commitInline(): void {
    const s = inlineRef.current;
    if (!s) return;
    const p = store.getAppState().patients[selectedNo - 1];
    const liveSettings = store.getSettings();
    const format = (liveSettings.formats || []).find((f) => f.id === s.formatId);
    const item = format?.items?.[s.i];
    if (!p || !format || !item || (s.openPid != null && p.pid !== s.openPid)) {
      inlineRef.current = null;
      s.unregister();
      setInline(null);
      toast.show(t('format.sheet.patientChanged'), 'error');
      runtime.bump();
      return;
    }
    const kind = item.kind || DEFAULT_ITEM_KIND;
    const value = kind === 'text' ? commitDraftTextEntry(s.orig, s.draft) : s.draft;
    if (!s.captured) {
      if (inlineValueUnchanged(kind, value, s.orig)) return; // 実変更なし → 何も書かない
      s.captured = true;
      writeFormatValue(store, p, selectedNo, format, s.i, value);
      applyFormatTags(format, p, liveSettings);
      s.dirty = true;
      return;
    }
    writeFormatValue(store, p, selectedNo, format, s.i, value);
    s.dirty = true;
  }

  // number/fraction 常時入力欄のフォーカスセッション (フォーカスごとに実変更を 1 回検出)
  const numericRef = useRef<{
    formatId: string;
    i: number;
    openPid: string | null;
    orig: unknown;
    captured: boolean;
  } | null>(null);

  const cb: PanelCardCallbacks = {
    onEnterInline(format, item, i) {
      if (!freshTapRef.current || !patient) return;
      const slot = patient.formatValues?.[format.id];
      const stored: Record<string, unknown> = slot && typeof slot === 'object' ? slot : {};
      const kind = item.kind || DEFAULT_ITEM_KIND;
      const seed = kind === 'text' ? readTextValue(stored[String(i)]) : readNumericEntry(stored[String(i)]);
      const prev = inlineRef.current;
      if (prev) {
        inlineRef.current = null;
        prev.unregister();
      }
      const session: InlineSession = {
        formatId: format.id,
        panel: format.panel,
        i,
        openPid: patient.pid ?? null,
        draft: seed,
        orig: stored[String(i)],
        captured: false,
        dirty: false,
        unregister: () => {},
      };
      session.unregister = registerEditingSession(() => endInline());
      inlineRef.current = session;
      setInline(session);
      // 前セッションで実変更があれば QR 等も含めて全体更新 (編集終了時の反映)
      if (prev && prev.dirty) runtime.bump();
    },
    onInlineDraft(draft) {
      const s = inlineRef.current;
      if (!s) return;
      s.draft = draft;
      commitInline();
    },
    onPresetToggle(format, item, i) {
      // detail 入場直後のゴーストタップで正常チェックを書き込まない
      // (inline 編集・入力シートと同じ freshTapRef ガード — v1 から残っていたリスクの修正)
      if (!freshTapRef.current || !patient) return;
      const slot = patient.formatValues?.[format.id];
      const stored: Record<string, unknown> = slot && typeof slot === 'object' ? slot : {};
      const decision = decidePresetToggle(stored[String(i)], item.normal);
      if (decision.action === 'openEditor') {
        // 手入力済み → 上書きせず inline 編集へ (保存値は変えない)
        cb.onEnterInline(format, item, i);
        return;
      }
      const liveSettings = store.getSettings();
      writeFormatValue(store, patient, selectedNo, format, i, decision.value);
      if (decision.action === 'write') applyFormatTags(format, patient, liveSettings);
      hapticTick(); // 成功体感の補助 (視覚は .formatNormalBtn.on のアニメ)
      runtime.bump();
    },
    onOpenSheet(format) {
      if (!freshTapRef.current) return;
      setSheetFormat(format);
    },
    onNumericFocus(format, i) {
      if (!patient) return;
      const slot = patient.formatValues?.[format.id];
      const stored: Record<string, unknown> = slot && typeof slot === 'object' ? slot : {};
      numericRef.current = {
        formatId: format.id,
        i,
        openPid: patient.pid ?? null,
        orig: stored[String(i)],
        captured: false,
      };
    },
    onNumericWrite(format, _item, i, value) {
      const p = store.getAppState().patients[selectedNo - 1];
      if (!p) return;
      const liveSettings = store.getSettings();
      const s = numericRef.current;
      const session =
        s && s.formatId === format.id && s.i === i && s.openPid === (p.pid ?? null) ? s : null;
      if (!session || !session.captured) {
        const slot = p.formatValues?.[format.id];
        const orig = session
          ? session.orig
          : slot && typeof slot === 'object'
            ? (slot as Record<string, unknown>)[String(i)]
            : undefined;
        const a = readNumericEntry(value);
        const b = readNumericEntry(orig);
        if (a.value === b.value && a.note === b.note) return; // 実変更なし → 何も書かない
        writeFormatValue(store, p, selectedNo, format, i, value);
        applyFormatTags(format, p, liveSettings);
        if (session) session.captured = true;
        return;
      }
      writeFormatValue(store, p, selectedNo, format, i, value);
    },
  };

  if (!patient) return null;

  const label = formatPatientLabel(patient, String(selectedNo));
  const orderedTags = (settings.tags || []).map((t) => t.name).filter((tg) => (patient.tags || []).includes(tg));
  // 患者が変わっていたら inline 編集は表示しない (別患者のカードに前患者のドラフトを
  // 出さない = fail-safe。セッション自体は prev/next ハンドラと unmount cleanup が破棄する)
  const inlineForRender = inline && inline.openPid === (patient.pid ?? null) ? inline : null;

  return (
    <section aria-label={t('patientSheet.title')} className="detailView">
      {/* 上部 = 患者名・病室の表示 (タップで患者情報編集)。操作系は下部固定バーへ。 */}
      <div className="viewToolbar detailToolbar">
        <button
          type="button"
          className={`patientBtn detailMetaBtn ${statusClass(patient.status)}`}
          aria-label={t('patientSheet.editAria', { label })}
          data-ui={UI.detail.meta}
          onClick={() => setMetaOpen(true)}
        >
          {patient.status !== STATUS.NONE ? (
            <span className="patientBtnMark" aria-hidden="true">
              {STATUS_MARK[patient.status]}
            </span>
          ) : null}
          <span className="detailMetaLabel">{label}</span>
          {orderedTags.length ? (
            <span className="detailMetaTags">
              {orderedTags.map((tg) => (
                <span key={tg} className="tag tag--neutral detailMetaTagChip">
                  {tg}
                </span>
              ))}
            </span>
          ) : null}
          <Icon name="edit" size={15} className="detailMetaEditIcon" />
        </button>
      </div>

      {isPatientTransferred(patient) ? (
        <div className="banner detailTransferredBanner">
          {t('move.banner', {
            dest: patient.transferredTo || '?',
            date: new Date(patient.transferredAt).toISOString().slice(0, 10),
          })}
        </div>
      ) : null}

      {/* problem / shared パネルは機能撤去済み (キーは保存データ・wire 互換のため温存)。
          表示するのは S/O/A/P のみ。 */}
      {FORMAT_PANELS.filter((panel) => panel !== 'problem' && panel !== 'shared').map((panel) => (
        <PanelCard key={panel} panel={panel} patient={patient} settings={settings} inline={inlineForRender} cb={cb} />
      ))}

      <PatientLifecyclePanel
        runtime={runtime}
        patient={patient}
        patientIndex={selectedNo - 1}
        onDone={() => {
          if (onNavigateHome) onNavigateHome();
        }}
      />

      {/* 下部固定の操作バー: スクロール中でも前/次・患者編集・QR に届く
          (Ver1 の上部 sticky の代替。片手操作で親指が届く位置 + safe-area 対応)。 */}
      <div className="detailActionBar" data-ui={UI.detail.actionBar}>
        <IconButton
          label={t('detail.nav.prev')}
          disabled={selectedNo <= 1}
          dataUi={UI.detail.prev}
          onClick={() => {
            endInline({ silent: true });
            onSelectNo(selectedNo - 1);
          }}
        >
          <Icon name="chevronRight" size={20} className="iconFlipX" />
        </IconButton>
        <IconButton
          label={t('detail.nav.next')}
          disabled={selectedNo >= appState.patients.length}
          dataUi={UI.detail.next}
          onClick={() => {
            endInline({ silent: true });
            onSelectNo(selectedNo + 1);
          }}
        >
          <Icon name="chevronRight" size={20} />
        </IconButton>
        <IconButton
          label={t('detail.edit.bottomAria')}
          dataUi={UI.detail.metaBottom}
          onClick={() => setMetaOpen(true)}
        >
          <Icon name="edit" size={20} />
        </IconButton>
        <span className="viewToolbarSpacer" />
        <IconButton
          label={t('detail.qr.show')}
          dataUi={UI.detail.qrShow}
          onClick={() => {
            runtime.eventlog.log(EVENT.QR_SHOW, { kind: 'TAB' });
            setQrOpen(true);
          }}
        >
          <Icon name="qr" size={20} />
        </IconButton>
      </div>

      {sheetFormat ? (
        <FormatSheet
          format={sheetFormat}
          patientNo={selectedNo}
          runtime={runtime}
          onClose={() => setSheetFormat(null)}
        />
      ) : null}
      {qrOpen ? <DetailQrDialog patient={patient} settings={settings} onClose={() => setQrOpen(false)} /> : null}
      {metaOpen ? <PatientEditPopup patientNo={selectedNo} runtime={runtime} onClose={() => setMetaOpen(false)} /> : null}
    </section>
  );
}
