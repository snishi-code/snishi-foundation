// (a) 起動 → home 描画 → 患者タップ → detail 遷移 (App シェル + ナビゲーション)
import './setup';
import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderApp, seedBundle } from './helpers';

describe('App シェル', () => {
  it('起動 → home に患者グリッドが出る → 患者タップで detail へ', async () => {
    const { runtime } = await renderApp({
      bundle: seedBundle([{ name: 'テスト太郎', room: '203' }, { name: 'テスト次郎', room: '101' }]),
    });
    const user = userEvent.setup();

    // home: 部屋番号順 (101 が先) で患者カードが並ぶ
    const taro = await screen.findByRole('button', { name: '203 テスト太郎' });
    expect(screen.getByRole('button', { name: '101 テスト次郎' })).toBeInTheDocument();

    // 患者タップ → detail (S/O/A/P パネルカード + 患者メタ)
    await user.click(taro);
    expect(await screen.findByText('203 テスト太郎')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'S' })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'プロブレムリスト' })).toBeNull();
    expect(screen.queryByRole('region', { name: '共有' })).toBeNull();

    // 選択患者は部屋順ソート後の index に一致する (203 = 2 番目)
    expect(runtime.store.getAppState().patients[1]?.name).toBe('テスト太郎');

    // ヘッダーの家ボタンで home へ戻れる
    await user.click(screen.getByRole('button', { name: 'ホーム' }));
    expect(await screen.findByRole('button', { name: '203 テスト太郎' })).toBeInTheDocument();
  });
});
