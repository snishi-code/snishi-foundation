// (b) inline 編集: dirty → 戻る (popstate) で「編集だけ解除」(view 遷移しない・入力は保持)
import './setup';
import { describe, expect, it } from 'vitest';
import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readTextValue } from '../src/domain/formatValues';
import { renderApp, seedBundle } from './helpers';

describe('inline 編集', () => {
  it('値セルタップで編集 → write-through 保存 → Back で編集解除のみ', async () => {
    const { runtime, container } = await renderApp({ bundle: seedBundle([{ name: 'テスト太郎', room: '203' }]) });
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: '203 テスト太郎' }));
    await screen.findByRole('region', { name: 'S' });

    // S パネルの値セル (自覚症状: ラベル空 text item) をタップ → inline 編集に入る
    await user.click(screen.getByRole('button', { name: '自覚症状 を入力' }));
    const ta = await screen.findByRole('textbox', { name: '自覚症状 を入力' });
    expect(container.querySelector('.formatCardItem.editing')).not.toBeNull();

    // 入力 → write-through (input ごとに formatValues へ書き込み済み)
    await user.type(ta, '頭痛あり');
    const patient = runtime.store.getAppState().patients[0]!;
    const sFormat = runtime.store.getSettings().formats.find((f) => f.panel === 'S')!;
    expect(readTextValue(patient.formatValues[sFormat.id]?.['0'])).toBe('頭痛あり');

    // 端末の「戻る」(popstate): 編集だけ解除し view は detail のまま (HR 修正#3)
    act(() => {
      window.dispatchEvent(new PopStateEvent('popstate', { state: { view: 'home' } }));
    });
    await waitFor(() => {
      expect(container.querySelector('.formatCardItem.editing')).toBeNull();
    });
    // view は detail のまま (患者メタが見えている)
    expect(screen.getByText('203 テスト太郎')).toBeInTheDocument();
    // 入力済みの値はカード表示に残る (write-through なので失われない)
    expect(screen.getByText('頭痛あり')).toBeInTheDocument();

    // もう一度 Back → 今度は view 遷移 (home へ)
    act(() => {
      window.dispatchEvent(new PopStateEvent('popstate', { state: { view: 'home' } }));
    });
    expect(await screen.findByRole('button', { name: '203 テスト太郎' })).toBeInTheDocument();
  });
});
