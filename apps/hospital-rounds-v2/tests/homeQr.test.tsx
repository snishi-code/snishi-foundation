// (d) HM QR ページ生成 (useQrFlow を実 store で。暗号化 transport 込み)
import './setup';
import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderApp, seedBundle } from './helpers';

describe('ホーム QR (HM)', () => {
  it('QR 表示でページが生成され、ページメタとカードが出る', async () => {
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
    // 受信入口 (カメラ + テキスト) がカード内にある
    expect(screen.getByRole('button', { name: 'QR として読む' })).toBeInTheDocument();
    expect(screen.getByPlaceholderText('RND_… で始まる QR の中身')).toBeInTheDocument();
  });

  it('形式不一致のテキスト受信は consumed=false で入力を残す', async () => {
    await renderApp({ bundle: seedBundle([{ name: 'テスト太郎', room: '203' }]) });
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: 'ホームQR表示' }));
    await screen.findByText(/^\(1\/\d+\)$/);

    const area = screen.getByPlaceholderText('RND_… で始まる QR の中身');
    await user.type(area, 'こんにちは');
    await user.click(screen.getByRole('button', { name: 'QR として読む' }));

    expect(await screen.findByText('QR 形式が認識できません')).toBeInTheDocument();
    // 入力欄は消えていない (v1 準拠: consumed=false は入力を保持)
    expect(area).toHaveValue('こんにちは');
  });
});
