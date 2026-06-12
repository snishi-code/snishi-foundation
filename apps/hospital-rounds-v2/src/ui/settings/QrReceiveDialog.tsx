// 移植元: snishi-code-medical/hospital-rounds/src/features/qr-receive.js (統一 QR 受信ルーター)
//
// 設定の「設定を受け取る」1 箇所で、カメラ / 貼り付け のいずれでも QR を受け取り、
// ST (設定全体) の受信処理へ振り分ける。
// FMT (フォーマット単体) / FS (フォーマットセット) は廃止済み。
// 患者系 (HM/MM/SH) はこの入口では読まない (各画面の受信導線が担う)。
//
// 受信 apply は fail-closed (qrApply.ts): confirm → saveSettingsOrThrow → 失敗は in-memory rollback。

import { useEffect, useRef, useState } from 'react';
import { Modal } from '@snishi/foundation/ui/Modal';
import { Button } from '@snishi/foundation/ui/Button';
import { ConfirmDialog } from '@snishi/foundation/ui/ConfirmDialog';
import { useToast } from '@snishi/foundation/ui/toast';
import { useQrFlow, type QrFlow, type ReceiveResult } from '@snishi/foundation/qr/useQrFlow';
import { decodePage } from '@snishi/foundation/qr/protocol';
import { isScannerSupported, scanQrStream } from '@snishi/foundation/qr/scan';
import { decodeSettingsPayload, type DecodedSettingsPatch } from '../../qr/settingsQr';
import { APP_KEY_BYTES } from '../../qr/appKey';
import type { AppRuntime } from '../appRuntime';
import { OverlayBinding, useRegisterOverlay } from '../registries';
import {
  applySettingsPatch,
  settingsImportConfirmBody,
  type ApplyResult,
} from './qrApply';
import { t } from '../../i18n/strings';
import { UI } from '../../ui-contract';

const ALLOWED_KINDS = ['ST'] as const;

type Pending = { kind: 'ST'; patch: DecodedSettingsPatch; body: string };

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
      return false; // 停止判断は caller (確認ダイアログ表示で閉じる)
    });
    return () => session.stop();
  }, []);
  return (
    <Modal title={t('qr.scan.head')} titleVariant="sr-only" onClose={onClose} variant="dialog" closeLabel={t('common.close')}>
      <p className="muted">{t('qr.scan.hint.stream')}</p>
      {/* カメラ映像 (外部送信なし: getUserMedia はローカル処理のみ) */}
      <video ref={videoRef} className="qrScanVideo" playsInline muted />
      <p className="qrRecvStatus" aria-live="polite">
        {status}
      </p>
    </Modal>
  );
}

export function QrReceiveDialog({ runtime, onClose }: { runtime: AppRuntime; onClose: () => void }) {
  useRegisterOverlay(onClose);
  const toast = useToast();
  const { store } = runtime;
  const [status, setStatus] = useState('');
  const [scanOpen, setScanOpen] = useState(false);
  const [pending, setPending] = useState<Pending | null>(null);
  const [busy, setBusy] = useState(false);

  // ST 受信フロー。onApply は確認ダイアログを出すだけ (適用は confirm 後・fail-closed)。
  const stFlow = useQrFlow<DecodedSettingsPatch>({
    kind: 'ST',
    kindLabel: t('qr.kind.settings'),
    keyBytes: APP_KEY_BYTES,
    encodePayload: () => '',
    decodePayload: decodeSettingsPayload,
    shouldEncrypt: () => false,
    onApply(patch) {
      setPending({ kind: 'ST', patch, body: settingsImportConfirmBody(patch) });
    },
  });

  const flowByKind: Record<string, QrFlow> = { ST: stFlow };

  // 生 QR テキスト 1 ページを kind 判定して該当フローへ (v1 routePage)。
  async function route(text: string): Promise<void> {
    const raw = String(text || '').trim();
    if (!raw) return;
    const decoded = decodePage(raw);
    if (!decoded) {
      setStatus(t('qr.recv.unknownFormat'));
      return;
    }
    if (!(ALLOWED_KINDS as readonly string[]).includes(decoded.kind)) {
      setStatus(t('qr.recv.router.notAllowed', { got: decoded.kind }));
      return;
    }
    const flow = flowByKind[decoded.kind];
    if (!flow) return;
    try {
      const res = await flow.receivePage(raw);
      const label = t('qr.kind.settings');
      setStatus(receiveStatusText(res, label));
      if (res.done) setScanOpen(false); // 全ページ受信 → 確認ダイアログへ (onApply 済)
    } catch (e) {
      // 復号失敗・パース失敗: fail-closed で中断 + 可視化
      const message = e instanceof Error ? e.message : String(e);
      setStatus(t('qr.recv.parse.failed', { message }));
      toast.show(t('qr.recv.parse.failed', { message }), 'error');
    }
  }

  // confirm 後の適用 (fail-closed)。成功でダイアログを閉じる。
  async function applyPending(target: Pending): Promise<void> {
    if (busy) return;
    setBusy(true);
    try {
      const res: ApplyResult = await applySettingsPatch(store, target.patch);
      if (!res.ok) {
        toast.show(res.message, 'error');
        return; // 受信ダイアログは開いたまま (再試行可能)
      }
      runtime.bump();
      toast.show(res.message);
      onClose();
    } finally {
      setBusy(false);
      setPending(null);
    }
  }

  return (
    <Modal
      title={t('qrReceive.title')}
      titleVariant="sr-only"
      onClose={onClose}
      variant="dialog"
      dataUi={UI.settings.qrReceiveDialog}
      closeLabel={t('common.close')}
    >
      <p className="muted">{t('qrReceive.overlayHint.st')}</p>
      <div className="qrReceiveActions">
        <Button
          onClick={() => setScanOpen(true)}
          disabled={!isScannerSupported()}
          title={isScannerSupported() ? undefined : t('qr.scanner.unsupported')}
          dataUi={UI.settings.qrReceiveScan}
        >
          {t('qr.scan.tooltip')}
        </Button>
        <span className="qrRecvStatus" aria-live="polite">
          {status}
        </span>
      </div>

      {scanOpen ? (
        <ScanDialog status={status} onText={(text) => void route(text)} onClose={() => setScanOpen(false)} />
      ) : null}

      {pending ? <OverlayBinding onClose={() => setPending(null)} /> : null}
      {pending ? (
        <ConfirmDialog
          title={t('qrReceive.title')}
          body={pending.body}
          confirmLabel={t('common.import')}
          cancelLabel={t('common.cancel')}
          onCancel={() => setPending(null)}
          onConfirm={() => void applyPending(pending)}
        />
      ) : null}
    </Modal>
  );
}
