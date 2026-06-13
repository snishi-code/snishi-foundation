// 移植元: snishi-code-medical/hospital-rounds/src/features/qr-flow.js の表示/受信 UI 部
//          (フロー制御は foundation qr/useQrFlow、描画は qr/render に分離済み)
//
// HM/ST 共通の QR 表示: canvas 描画 + 自動ページ送り + カメラ scan。
// 自動送り間隔は QR_AUTO_ADVANCE_MS 定数で管理 (マジックナンバー禁止)。
// 受信ステータス文言 (progress/duplicate/wrongKind 等) はここで i18n に変換する。
// テキスト貼り付け受信 (RND_… 貼付) は PWA 以前の遺残として撤去済み (2026-06)。
//
// 表示は患者詳細 QR (DetailQrDialog) と同じく Modal ポップアップに統一する (QrDialog)。
// overlay 登録により端末の「戻る」は QR だけを閉じる (画面遷移・終了確認に流れない)。

import { useEffect, useRef, useState } from 'react';
import type { QrFlow, ReceiveResult } from '@snishi/foundation/qr/useQrFlow';
import { useAutoPager } from '@snishi/foundation/qr/useAutoPager';
import { useWakeLock } from '@snishi/foundation/ui/useWakeLock';
import { drawQrToCanvas } from '@snishi/foundation/qr/render';
import { isScannerSupported, scanQrStream } from '@snishi/foundation/qr/scan';
import { Modal } from '@snishi/foundation/ui/Modal';
import { IconButton } from '@snishi/foundation/ui/IconButton';
import { Icon } from '@snishi/foundation/ui/Icon';
import { useToast } from '@snishi/foundation/ui/toast';
import { t } from '../i18n/strings';
import { UI } from '../ui-contract';
import { useRegisterOverlay } from './registries';
import { hapticReceive, hapticReceiveDone } from './feedback';

/** 自動ページ送りの間隔 (ms)。受信側カメラ + jsQR が取りこぼしにくい範囲。 */
export const QR_AUTO_ADVANCE_MS = 900;

/** ページドットの最大表示数 (超えたら表示しない = 多すぎると意味がない) */
const QR_PAGE_DOTS_MAX = 12;

function receiveStatusText(res: ReceiveResult, kindLabel: string): string {
  switch (res.status) {
    case 'unknownFormat':
      return t('qr.recv.unknownFormat');
    case 'wrongKind':
      return t('qr.recv.wrongKind', { label: kindLabel, got: res.gotKind ?? '?' });
    case 'duplicate':
      return t('qr.recv.duplicate', { got: res.got, total: res.total });
    case 'progress':
      return t('qr.recv.progress', { got: res.got, total: res.total });
    case 'complete':
      return t('qr.recv.complete', { total: res.total });
  }
}

/** カメラ読み取りモーダル。読み取った生テキストを onText に渡す (true で閉じる)。 */
function ScanDialog({
  onText,
  onClose,
  status,
}: {
  onText: (text: string) => void;
  onClose: () => void;
  status: string;
}) {
  useRegisterOverlay(onClose);
  const videoRef = useRef<HTMLVideoElement>(null);
  const onTextRef = useRef(onText);
  useEffect(() => {
    onTextRef.current = onText;
  });

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const session = scanQrStream(video, (text) => {
      onTextRef.current(text);
      // 停止判断は caller (受信完了で onClose → unmount → stop)
      return false;
    });
    return () => session.stop();
  }, []);

  return (
    <Modal title={t('qr.scan.head')} titleVariant="sr-only" onClose={onClose} variant="dialog" closeLabel={t('common.close')}>
      <p className="muted">{t('qr.scan.hint.stream')}</p>
      {/* カメラ映像 (外部送信なし: getUserMedia はローカル処理のみ) */}
      <video ref={videoRef} className="qrScanVideo" playsInline muted />
      <p className="qrRecvStatus" aria-live="polite" data-ui={UI.qr.recvStatus}>
        {status}
      </p>
    </Modal>
  );
}

export interface QrCardProps {
  flow: QrFlow;
  kindLabel: string;
  /** カメラ受信の入口を出すか (HM は true) */
  receivable?: boolean;
  /** カード内に閉じる × を出すか。Modal 内 (フロート × がある) では false にする */
  showClose?: boolean;
  onClose: () => void;
}

/**
 * QR 表示の中身。flow.isActive のときだけ親がレンダリングする。
 * 受信 (receivePage) の例外 = 復号/パース失敗は fail-closed (適用前に中断) として
 * toast で可視化する。consumed=false の入力はテキスト欄を消さない (v1 準拠)。
 */
export function QrCardBody({ flow, kindLabel, receivable = true, showClose = true, onClose }: QrCardProps) {
  const toast = useToast();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [drawError, setDrawError] = useState('');
  const [recvStatus, setRecvStatus] = useState('');
  // パルスクラスを付けるためのキー (変化するたびにアニメ再実行)
  const [pulseKey, setPulseKey] = useState(0);
  const [pulseClass, setPulseClass] = useState('');
  const [scanOpen, setScanOpen] = useState(false);

  const total = flow.pages.length;

  // 自動ページ送り。Modal 内で常に表示中なので active:true 固定。
  const pager = useAutoPager(total, { intervalMs: QR_AUTO_ADVANCE_MS, active: true });

  // 表示ページは pager.index で制御 (flow.pageIndex は使わない)
  const page = flow.pages[pager.index] ?? '';

  // QR 表示中は画面スリープを抑止
  useWakeLock(true);

  useEffect(() => {
    // 描画は次 tick に defer する (effect 本体での同期 setState を避ける)
    const timer = setTimeout(() => {
      const canvas = canvasRef.current;
      if (!canvas || !page) return;
      try {
        drawQrToCanvas(page, canvas);
        setDrawError('');
      } catch (e) {
        // 描画不能 (容量超過 / 2d context なし) を握らず表示する
        console.error('qr draw failed:', e);
        setDrawError(t('qr.render.failed'));
      }
    }, 0);
    return () => clearTimeout(timer);
  }, [page]);

  async function receive(text: string): Promise<void> {
    const raw = String(text || '').trim();
    if (!raw) return;
    try {
      const res = await flow.receivePage(raw);
      setRecvStatus(receiveStatusText(res, kindLabel));
      // 新ページ受理 (progress/complete) 時だけ視覚パルス + バイブ
      if (res.status === 'progress') {
        setPulseKey((k) => k + 1);
        setPulseClass('pulse');
        hapticReceive();
      } else if (res.status === 'complete') {
        setPulseKey((k) => k + 1);
        setPulseClass('pulseDone');
        hapticReceiveDone();
      }
      if (res.done) setScanOpen(false);
    } catch (e) {
      // 復号失敗・パース失敗: onApply に到達させず中断 (fail-closed)。ユーザーへ可視化。
      const message = e instanceof Error ? e.message : String(e);
      setRecvStatus(t('qr.recv.parse.failed', { message }));
      toast.show(t('qr.recv.parse.failed', { message }), 'error');
    }
  }

  // ページドット (total <= QR_PAGE_DOTS_MAX のときのみ表示)
  const showDots = total > 1 && total <= QR_PAGE_DOTS_MAX;

  return (
    <div className="qrWrap" data-ui={UI.qr.card}>
      <div className="qrCardHead">
        <span className="mono qrPageMeta" data-ui={UI.qr.pageMeta}>
          {total > 0 ? `(${pager.index + 1}/${total})` : ''}
        </span>
        <span className="qrCardHeadSpacer" />
        {/* 再生/一時停止トグル */}
        <IconButton
          label={pager.playing ? t('qr.autoplay.pause') : t('qr.autoplay.play')}
          onClick={pager.toggle}
          dataUi={UI.qr.playToggle}
        >
          {pager.playing ? (
            <Icon name="pause" size={18} />
          ) : (
            <Icon name="play" size={18} />
          )}
        </IconButton>
        {/* 手動ページ送り (自動が不安定な時の逃げ道) */}
        <IconButton
          label={t('qr.prev.tooltip')}
          onClick={pager.prev}
          disabled={pager.index <= 0}
          dataUi={UI.qr.prev}
        >
          <Icon name="chevronRight" size={18} className="iconFlipX" />
        </IconButton>
        <IconButton
          label={t('qr.next.tooltip')}
          onClick={pager.next}
          disabled={pager.index >= total - 1}
          dataUi={UI.qr.next}
        >
          <Icon name="chevronRight" size={18} />
        </IconButton>
        {receivable ? (
          <IconButton
            label={t('qr.scan.tooltip')}
            onClick={() => setScanOpen(true)}
            disabled={!isScannerSupported()}
            title={isScannerSupported() ? undefined : t('qr.scanner.unsupported')}
            dataUi={UI.qr.scan}
          >
            <Icon name="scan" size={18} />
          </IconButton>
        ) : null}
        {showClose ? (
          <IconButton label={t('common.close')} onClick={onClose}>
            <Icon name="close" size={18} />
          </IconButton>
        ) : null}
      </div>
      <canvas ref={canvasRef} className="qrCanvas" data-ui={UI.qr.canvas} />
      {showDots ? (
        <div className="qrPageDots" aria-hidden="true">
          {Array.from({ length: total }, (_, i) => (
            <span key={i} className={`qrPageDot${i === pager.index ? ' active' : ''}`} />
          ))}
        </div>
      ) : null}
      {drawError ? <p className="dangerText">{drawError}</p> : null}
      {receivable && recvStatus ? (
        <p
          key={pulseKey}
          className={`qrRecvStatus ${pulseClass}`}
          aria-live="polite"
          data-ui={UI.qr.recvStatus}
          onAnimationEnd={() => setPulseClass('')}
        >
          {recvStatus}
        </p>
      ) : null}
      {scanOpen ? (
        <ScanDialog
          status={recvStatus}
          onText={(text) => void receive(text)}
          onClose={() => setScanOpen(false)}
        />
      ) : null}
    </div>
  );
}

/**
 * QR 表示ポップアップ (HM/ST 共通)。患者詳細 QR と同じ Modal で表示し、
 * overlay 登録により Back は QR だけを閉じる。ページ送り / カメラ読み取り /
 * 閉じるは QrCardBody のまま維持する。
 */
export function QrDialog(props: QrCardProps) {
  useRegisterOverlay(props.onClose);
  return (
    <Modal
      title={props.kindLabel}
      titleVariant="sr-only"
      onClose={props.onClose}
      variant="dialog"
      dataUi={UI.qr.dialog}
      closeLabel={t('common.close')}
    >
      <QrCardBody {...props} showClose={false} />
    </Modal>
  );
}
