// 移植元: snishi-code-medical/hospital-rounds/src/features/qr-format.js / qr-set.js の
//          送信オーバーレイ部 (openQrFormatOverlay / openQrSetOverlay)
//
// FMT / FS の「QR で共有」モーダル。送信カードは表示専用 (受信導線を持たせない —
// 受信は設定の統一「QR から追加」のみ。v1 受信ルーター規約)。

import { useEffect } from 'react';
import { Modal } from '@snishi/foundation/ui/Modal';
import { useQrFlow } from '@snishi/foundation/qr/useQrFlow';
import { useToast } from '@snishi/foundation/ui/toast';
import type { QrKind } from '../../domain/types';
import { APP_KEY_BYTES } from '../../qr/appKey';
import { QrCardBody } from '../QrCard';
import { useRegisterOverlay } from '../registries';
import { t } from '../../i18n/strings';

export function QrShareDialog({
  kind,
  kindLabel,
  title,
  encodePayload,
  shouldEncrypt,
  onClose,
}: {
  kind: QrKind;
  kindLabel: string;
  title: string;
  /** 表示時点の対象を encode する純関数 (空文字 = QR を出さない) */
  encodePayload: () => string;
  shouldEncrypt: () => boolean;
  onClose: () => void;
}) {
  useRegisterOverlay(onClose);
  const toast = useToast();
  const flow = useQrFlow<never>({
    kind,
    kindLabel,
    keyBytes: APP_KEY_BYTES,
    encodePayload,
    // 表示専用 (receivable=false) のため受信デコードには到達しない
    decodePayload: () => {
      throw new Error('display-only');
    },
    shouldEncrypt,
    compress: true,
    onApply: () => {},
  });

  const open = flow.open;
  useEffect(() => {
    void open().catch((e) => {
      // 暗号化失敗 = QR を出さない (fail-closed)。握らず可視化。
      console.error('qr share open failed:', e);
      toast.show(t('qr.render.failed'), 'error');
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    // 可視タイトルは出さない (QR を見れば分かる)。aria 上の名前は sr-only title で維持。
    <Modal title={title} titleVariant="sr-only" onClose={onClose} variant="dialog" closeLabel={t('common.close')}>
      {flow.isActive ? (
        <QrCardBody flow={flow} kindLabel={kindLabel} receivable={false} showClose={false} onClose={onClose} />
      ) : null}
    </Modal>
  );
}
