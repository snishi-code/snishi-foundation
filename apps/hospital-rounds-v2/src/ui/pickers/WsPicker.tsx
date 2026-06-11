// ワークスペース (病棟) ピッカー — **後続エージェント実装のスタブ**。
//
// ヘッダーの病棟名タップで開く軽量 popup (切替 + 新規作成のみ。rename/delete は設定画面)。
// 実装時の接続点:
//   - runtime.store: storage.listBundles()/switchWorkspace()/createWorkspace()
//   - 切替・作成は fail-closed (throw したら中断 + toast t('io.ws.switch.failed'))
//   - 閉じる/戻る対応: ../registries の useRegisterOverlay(onClose) を必ず呼ぶ
//   - 文言: src/i18n/strings.ts に io.ws.* を追記する

import { Modal } from '@snishi/foundation/ui/Modal';
import type { AppRuntime } from '../appRuntime';
import { useRegisterOverlay } from '../registries';
import { t } from '../../i18n/strings';

export function WsPicker(props: { runtime: AppRuntime; onClose: () => void }) {
  void props.runtime; // 後続実装が switchWorkspace 等に接続する (props 契約を固定)
  const { onClose } = props;
  useRegisterOverlay(onClose);
  return (
    <Modal title={t('header.ws.tooltip')} onClose={onClose} variant="dialog" closeLabel={t('common.close')}>
      <p className="muted">{t('picker.stub.body')}</p>
    </Modal>
  );
}
