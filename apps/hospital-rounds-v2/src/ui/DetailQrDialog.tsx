// 移植元: snishi-code-medical/hospital-rounds/src/views/detail.js の患者画面 QR ポップアップ
//          (#detailQrOverlay + renderQrIfNeeded)
//
// 電子カルテ転記用 QR: buildTabPayload の **平文** を分割表示する。電子カルテ端末の
// 標準カメラで読む前提のため暗号化マトリクスの対象外 (常に平文・qr/crypto を通さない)。

import { useEffect, useMemo, useRef, useState } from 'react';
import { Modal } from '@snishi/foundation/ui/Modal';
import { IconButton } from '@snishi/foundation/ui/IconButton';
import { Icon } from '@snishi/foundation/ui/Icon';
import { drawQrToCanvas } from '@snishi/foundation/qr/render';
import type { Patient, Settings } from '../domain/types';
import { buildTabPayload } from '../domain/payload';
import { splitTextToFitQr } from './qrText';
import { t } from '../i18n/strings';
import { UI } from '../ui-contract';
import { useRegisterOverlay } from './registries';

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
  const [pageIndex, setPageIndex] = useState(0);
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
  const page = pages ? (pages[Math.min(pageIndex, total - 1)] ?? '') : '';

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
      onClose={onClose}
      variant="dialog"
      dataUi={UI.detail.qrDialog}
      closeLabel={t('common.close')}
    >
      <div className="qrCardHead">
        <span className="mono qrPageMeta" data-ui={UI.qr.pageMeta}>
          {total > 1 ? `(${Math.min(pageIndex, total - 1) + 1}/${total})` : ''}
        </span>
        <span className="qrCardHeadSpacer" />
        <IconButton
          label={t('qr.prev.tooltip')}
          onClick={() => setPageIndex((i) => Math.max(0, i - 1))}
          disabled={pageIndex <= 0}
          dataUi={UI.qr.prev}
        >
          <Icon name="chevronRight" size={18} className="iconFlipX" />
        </IconButton>
        <IconButton
          label={t('qr.next.tooltip')}
          onClick={() => setPageIndex((i) => Math.min(total - 1, i + 1))}
          disabled={pageIndex >= total - 1}
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
