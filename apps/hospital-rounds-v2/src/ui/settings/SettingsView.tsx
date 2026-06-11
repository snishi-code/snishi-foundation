// 設定ビュー — **後続エージェント実装のスタブ**。
//
// view 遷移 (home ↔ settings) だけ通す。実装時の接続点:
//   - runtime.store: getSettings()/saveSettingsOrThrow() (QR 取込は fail-closed)、
//     collectFormatDataIndices() (フォーマット item 編集の破壊防止判定)
//   - runtime.snapshots: 巻き戻し一覧 (list/restore) + restore_undo
//   - runtime.eventlog: ログ書出/消去
//   - QR: src/qr/settingsQr.ts / formatQr.ts / setQr.ts + useQrFlow (keyBytes=APP_KEY_BYTES)
//   - 文言: src/i18n/strings.ts に v1 strings.ja.json から追記する
//   - data-ui: src/ui-contract.ts の UI に settings.* を追記する

import type { AppRuntime } from '../appRuntime';
import { t } from '../../i18n/strings';

export function SettingsView(props: { runtime: AppRuntime }) {
  void props.runtime; // 後続実装が store/snapshots/eventlog に接続する (props 契約を固定)
  return (
    <section aria-label={t('header.settings')}>
      <div className="card card--pad">
        <h2 className="screen-title">{t('header.settings')}</h2>
        <p className="muted">{t('settings.stub.body')}</p>
      </div>
    </section>
  );
}
