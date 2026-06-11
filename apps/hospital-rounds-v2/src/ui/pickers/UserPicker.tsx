// ユーザーピッカー — **後続エージェント実装のスタブ**。
//
// ヘッダーのユーザー名タップで開く軽量 popup (切替 + 新規作成 + リネーム)。
// 実装時の接続点:
//   - runtime.store: storage.listUsers()/switchUser()/createUserAndSwitch()/renameCurrentUser()
//   - 切替は fail-closed (switchUser が throw したら中断 + toast)
//   - 閉じる/戻る対応: ../registries の useRegisterOverlay(onClose) を必ず呼ぶ
//   - 文言: src/i18n/strings.ts に io.user.* を追記する

import { Modal } from '@snishi/foundation/ui/Modal';
import type { AppRuntime } from '../appRuntime';
import { useRegisterOverlay } from '../registries';
import { t } from '../../i18n/strings';

export function UserPicker(props: { runtime: AppRuntime; onClose: () => void }) {
  void props.runtime; // 後続実装が switchUser 等に接続する (props 契約を固定)
  const { onClose } = props;
  useRegisterOverlay(onClose);
  return (
    <Modal title={t('header.user.tooltip')} onClose={onClose} variant="dialog" closeLabel={t('common.close')}>
      <p className="muted">{t('picker.stub.body')}</p>
    </Modal>
  );
}
