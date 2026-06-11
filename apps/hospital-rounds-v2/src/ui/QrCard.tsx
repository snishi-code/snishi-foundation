// 移植元: snishi-code-medical/hospital-rounds/src/features/qr-flow.js の表示/受信 UI 部
//          (フロー制御は foundation qr/useQrFlow、描画は qr/render に分離済み)
//
// HM/MM/SH 共通の QR カード: canvas 描画 + ページナビ + カメラ scan + テキスト受信。
// 受信ステータス文言 (progress/duplicate/wrongKind 等) はここで i18n に変換する。

import { useEffect, useRef, useState } from 'react';
import type { QrFlow, ReceiveResult } from '@snishi/foundation/qr/useQrFlow';
import { drawQrToCanvas } from '@snishi/foundation/qr/render';
import { isScannerSupported, scanQrStream } from '@snishi/foundation/qr/scan';
import { Modal } from '@snishi/foundation/ui/Modal';
import { IconButton } from '@snishi/foundation/ui/IconButton';
import { Icon } from '@snishi/foundation/ui/Icon';
import { Button } from '@snishi/foundation/ui/Button';
import { useToast } from '@snishi/foundation/ui/toast';
import { t } from '../i18n/strings';
import { UI } from '../ui-contract';
import { useRegisterOverlay } from './registries';

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
  /** カメラ/テキスト受信の入口を出すか (HM/MM/SH は true) */
  receivable?: boolean;
  /** カード内に閉じる × を出すか。Modal 内 (フロート × がある) では false にする */
  showClose?: boolean;
  onClose: () => void;
}

/**
 * QR 表示カード。flow.isActive のときだけ親がレンダリングする。
 * 受信 (receivePage) の例外 = 復号/パース失敗は fail-closed (適用前に中断) として
 * toast で可視化する。consumed=false の入力はテキスト欄を消さない (v1 準拠)。
 */
export function QrCard({ flow, kindLabel, receivable = true, showClose = true, onClose }: QrCardProps) {
  const toast = useToast();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [drawError, setDrawError] = useState('');
  const [recvStatus, setRecvStatus] = useState('');
  const [scanOpen, setScanOpen] = useState(false);
  const [pasteText, setPasteText] = useState('');

  const page = flow.pages[flow.pageIndex] ?? '';
  const total = flow.pages.length;

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

  async function receive(text: string, opts: { fromPaste: boolean }): Promise<void> {
    const raw = String(text || '').trim();
    if (!raw) {
      setRecvStatus(t('qr.recv.text.empty'));
      return;
    }
    try {
      const res = await flow.receivePage(raw);
      setRecvStatus(receiveStatusText(res, kindLabel));
      // consumed=false (形式不一致・kind 違い) は入力欄を消さない (v1 準拠)
      if (opts.fromPaste && res.consumed) setPasteText('');
      if (res.done) setScanOpen(false);
    } catch (e) {
      // 復号失敗・パース失敗: onApply に到達させず中断 (fail-closed)。ユーザーへ可視化。
      const message = e instanceof Error ? e.message : String(e);
      setRecvStatus(t('qr.recv.parse.failed', { message }));
      toast.show(t('qr.recv.parse.failed', { message }), 'error');
    }
  }

  return (
    <div className="card qrWrap" data-ui={UI.qr.card}>
      <div className="qrCardHead">
        <span className="mono qrPageMeta" data-ui={UI.qr.pageMeta}>
          {total > 0 ? `(${flow.pageIndex + 1}/${total})` : ''}
        </span>
        <span className="qrCardHeadSpacer" />
        <IconButton
          label={t('qr.prev.tooltip')}
          onClick={flow.prev}
          disabled={flow.pageIndex <= 0}
          dataUi={UI.qr.prev}
        >
          <Icon name="chevronRight" size={18} className="iconFlipX" />
        </IconButton>
        <IconButton
          label={t('qr.next.tooltip')}
          onClick={flow.next}
          disabled={flow.pageIndex >= total - 1}
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
      {drawError ? <p className="dangerText">{drawError}</p> : null}
      {receivable ? (
        <div className="qrTextRecv">
          <textarea
            className="textarea qrTextRecvArea"
            rows={2}
            placeholder={t('qr.recv.text.placeholder')}
            value={pasteText}
            onChange={(e) => setPasteText(e.target.value)}
            data-ui={UI.qr.recvText}
            aria-label={t('qr.recv.text.read')}
          />
          <div className="qrTextRecvActions">
            <span className="qrRecvStatus" aria-live="polite" data-ui={UI.qr.recvStatus}>
              {recvStatus}
            </span>
            <Button onClick={() => void receive(pasteText, { fromPaste: true })} dataUi={UI.qr.recvRead}>
              {t('qr.recv.text.read')}
            </Button>
          </div>
        </div>
      ) : null}
      {scanOpen ? (
        <ScanDialog
          status={recvStatus}
          onText={(text) => void receive(text, { fromPaste: false })}
          onClose={() => setScanOpen(false)}
        />
      ) : null}
    </div>
  );
}
