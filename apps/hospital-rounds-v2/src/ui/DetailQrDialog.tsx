// 移植元: snishi-code-medical/hospital-rounds/src/views/detail.js の患者画面 QR ポップアップ
//          (#detailQrOverlay + renderQrIfNeeded)
//
// 電子カルテ転記用 QR: buildTabPayload の **平文** を分割表示する。電子カルテ端末の
// 標準カメラで読む前提のため暗号化マトリクスの対象外 (常に平文・qr/crypto を通さない)。
// 自動ページ送りは useAutoPager で制御 (送信のみ・受信なし)。

import { useEffect, useMemo, useRef } from 'react';
import { Modal } from '@snishi/foundation/ui/Modal';
import { IconButton } from '@snishi/foundation/ui/IconButton';
import { Icon } from '@snishi/foundation/ui/Icon';
import { useAutoPager } from '@snishi/foundation/qr/useAutoPager';
import { useWakeLock } from '@snishi/foundation/ui/useWakeLock';
import { drawQrToCanvas } from '@snishi/foundation/qr/render';
import type { Patient, Settings } from '../domain/types';
import { buildTabPayload } from '../domain/payload';
import { getQrPresentationDefault } from '../qr/policy';
import { splitTextToFitQr } from './qrText';
import { t } from '../i18n/strings';
import { UI } from '../ui-contract';
import { useRegisterOverlay } from './registries';
import { QR_AUTO_ADVANCE_MS } from './QrCard';
import { useState } from 'react';

export function DetailQrDialog({
  patient,
  settings,
  onClose,
}: {
  patient: Patient;
  settings: Settings;
  onClose: () => void;
}) {
  useRegisterOverlay(onClose);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [error, setError] = useState('');

  const payload = useMemo(() => buildTabPayload(patient, settings), [patient, settings]);
  const pages = useMemo(() => {
    try {
      return splitTextToFitQr(payload);
    } catch (e) {
      // 分割不能 (1 文字でも 750B 超) — 描画しないでエラー表示 (fail-visible)
      console.error('detail qr split failed:', e);
      return null;
    }
  }, [payload]);

  const total = pages ? pages.length : 0;

  // 自動ページ送り (送信のみ。このダイアログは受信なし)。
  // TAB policy は presentationDefault: 'static' = 表示開始時は止めて開く
  // (電子カルテ標準カメラで 1 枚ずつ順に読む前提。手動送り/再生は維持)。
  const pager = useAutoPager(total, {
    intervalMs: QR_AUTO_ADVANCE_MS,
    active: true,
    initialPlaying: getQrPresentationDefault('TAB') === 'dynamic',
  });

  // QR 表示中は画面スリープを抑止
  useWakeLock(true);

  const page = pages ? (pages[Math.min(pager.index, total - 1)] ?? '') : '';

  useEffect(() => {
    // 描画は次 tick に defer する (effect 本体での同期 setState を避ける)
    const timer = setTimeout(() => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      if (!pages) {
        setError(t('detail.qr.tooLong'));
        return;
      }
      try {
        drawQrToCanvas(page, canvas);
        setError('');
      } catch (e) {
        console.error('detail qr draw failed:', e);
        setError(t('qr.render.failed'));
      }
    }, 0);
    return () => clearTimeout(timer);
  }, [page, pages]);

  return (
    <Modal
      title={t('detail.qr.dialogAria')}
      titleVariant="sr-only"
      onClose={onClose}
      variant="dialog"
      dataUi={UI.detail.qrDialog}
      closeLabel={t('common.close')}
    >
      <div className="qrCardHead">
        <span className="mono qrPageMeta" data-ui={UI.qr.pageMeta}>
          {total > 1 ? `(${Math.min(pager.index, total - 1) + 1}/${total})` : ''}
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
      </div>
      <canvas ref={canvasRef} className="qrCanvas" data-ui={UI.qr.canvas} />
      {error ? <p className="dangerText">{error}</p> : null}
      <details className="qrPreviewDetails">
        <summary>{t('detail.qr.preview.summary')}</summary>
        <div className="mono qrTextPreview">{payload}</div>
      </details>
    </Modal>
  );
}
