// (a) 起動 → home 描画 → 患者タップ → detail 遷移 (App シェル + ナビゲーション)
import './setup';
import { describe, expect, it } from 'vitest';
import { screen, within } from '@testing-library/react';
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

    // 患者タップ → detail (プロブレムリスト + S/O/A/P パネルカード + 自由記述 + 患者メタ)
    await user.click(taro);
    expect(await screen.findByText('203 テスト太郎')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'S' })).toBeInTheDocument();
    // 患者ページ内のプロブレムリスト・自由記述は復活している
    expect(screen.getByRole('region', { name: 'プロブレムリスト' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: '自由記述' })).toBeInTheDocument();
    // ただし旧「共有」パネル / 専用一覧は復活させない
    expect(screen.queryByRole('region', { name: '共有' })).toBeNull();

    // 選択患者は部屋順ソート後の index に一致する (203 = 2 番目)
    expect(runtime.store.getAppState().patients[1]?.name).toBe('テスト太郎');

    // ヘッダーの家ボタンで home へ戻れる
    await user.click(screen.getByRole('button', { name: 'ホーム' }));
    expect(await screen.findByRole('button', { name: '203 テスト太郎' })).toBeInTheDocument();
  });

  it('患者画面の下部バー・ホームボタンで home へ戻れる', async () => {
    const user = userEvent.setup();
    await renderApp({
      bundle: seedBundle([{ name: '花子', room: '101' }]),
    });

    // 患者タップ → detail
    await user.click(await screen.findByRole('button', { name: '101 花子' }));
    expect(await screen.findByRole('region', { name: '患者' })).toBeInTheDocument();

    // 下部バーのホームボタン (aria-label: 'ホームへ戻る')
    await user.click(screen.getByRole('button', { name: 'ホームへ戻る' }));
    expect(await screen.findByRole('button', { name: '101 花子' })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: '患者' })).toBeNull();
  });

  it('設定画面の下部バー・ホームボタンで home へ戻れる', async () => {
    const user = userEvent.setup();
    await renderApp();

    // 設定へ
    await user.click(screen.getByRole('button', { name: '設定' }));
    expect(await screen.findByRole('region', { name: '設定' })).toBeInTheDocument();

    // 設定画面下部の固定バー内のホームボタン (data-ui="settings.home.bottom" のバー内)
    const settingsSection = await screen.findByRole('region', { name: '設定' });
    const homeBtn = within(settingsSection).getAllByRole('button', { name: 'ホーム' })[0]!;
    await user.click(homeBtn);
    expect(await screen.findByText('診察開始')).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: '設定' })).toBeNull();
  });
});
