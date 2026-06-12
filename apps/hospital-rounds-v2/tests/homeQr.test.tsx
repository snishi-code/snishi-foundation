// (d) HM QR ページ生成 (useQrFlow を実 store で。暗号化 transport 込み)
// 受信はカメラ読み取りのみ (テキスト貼り付け受信は 2026-06 に撤去済み)。
import './setup';
import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderApp, seedBundle } from './helpers';

describe('ホーム QR (HM)', () => {
  it('QR 表示でページが生成され、ポップアップにメタとカメラ入口が出る (貼り付け受信なし)', async () => {
    await renderApp({
      bundle: seedBundle([
        { name: 'テスト太郎', room: '203' },
        { name: 'テスト次郎', room: '101' },
      ]),
    });
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: 'ホームQR表示' }));

    // encodePatientList → packPayload (E2 暗号化) → encodePages が完了するとメタが出る
    const meta = await screen.findByText(/^\(1\/\d+\)$/);
    expect(meta).toBeInTheDocument();
    // 受信入口はカメラのみ。テキスト貼り付け UI は存在しない (PWA 以前の遺残として撤去)
    expect(screen.getByRole('button', { name: 'カメラで QR を読む' })).toBeInTheDocument();
    expect(screen.queryByText('QR として読む')).toBeNull();
    expect(screen.queryByPlaceholderText(/RND_/)).toBeNull();
  });
});
