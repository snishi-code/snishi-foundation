// P0/FB: 正常チェックの誤タップ対策。
//  - 正常チェックは長押し (NORMAL_HOLD_MS) でのみ発火する。単発クリックや
//    短い押下 (ゴーストタップ含む) では保存されない。
//  - detail 入場直後 / 前後切替直後のゴーストタップは freshTapRef ガードで
//    inline 編集も開かない (pid 変更でガードを掛け直す — 監査指摘の回帰)。
import './setup';
import { describe, expect, it } from 'vitest';
import { act, fireEvent, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readTextValue } from '../src/domain/formatValues';
import { NORMAL_HOLD_MS } from '../src/ui/NormalCheckButton';
import { renderApp, seedBundle } from './helpers';

async function hold(el: HTMLElement, ms: number): Promise<void> {
  fireEvent.pointerDown(el);
  await act(async () => {
    await new Promise((r) => setTimeout(r, ms));
  });
  fireEvent.pointerUp(el);
}

describe('正常チェックの誤タップ対策 (長押し発火)', () => {
  it('クリックや短い押下では保存されず、長押しで正常文が書かれる', async () => {
    const { runtime } = await renderApp({ bundle: seedBundle([{ name: 'ガード患者', room: '101' }]) });
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: '101 ガード患者' }));
    await screen.findByRole('region', { name: 'S' });

    const patient = runtime.store.getAppState().patients[0]!;
    const sFormat = runtime.store.getSettings().formats.find((f) => f.panel === 'S')!;
    const normalBtn = screen.getAllByRole('button', { name: '正常' })[0] as HTMLElement;

    // 単発クリック (ゴーストタップ相当) では発火しない
    fireEvent.click(normalBtn);
    expect(readTextValue(patient.formatValues[sFormat.id]?.['0'])).toBe('');

    // 閾値未満の短い押下でも発火しない
    await hold(normalBtn, Math.max(50, NORMAL_HOLD_MS - 250));
    expect(readTextValue(patient.formatValues[sFormat.id]?.['0'])).toBe('');

    // 長押し (閾値超え) で正常文が書かれる
    await hold(normalBtn, NORMAL_HOLD_MS + 120);
    expect(readTextValue(patient.formatValues[sFormat.id]?.['0'])).toBe(sFormat.items[0]!.normal);
  });

  it('前/次で患者を切り替えた直後のゴーストタップでは inline 編集が開かない (pid でガード掛け直し)', async () => {
    const { container } = await renderApp({
      bundle: seedBundle([
        { name: '一人目', room: '101' },
        { name: '二人目', room: '102' },
      ]),
    });
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: '101 一人目' }));
    await screen.findByRole('region', { name: 'S' });

    // 次の患者へ (このタップで pointerdown 済みだが、患者切替でガードが掛け直される)
    await user.click(screen.getByRole('button', { name: '次の患者' }));
    await screen.findByText(/102 二人目/);

    // 切替直後のゴーストタップ (新しい pointerdown なし) では値セルの編集が開かない
    const cell = screen.getAllByRole('button', { name: '自覚症状 を入力' })[0] as HTMLElement;
    fireEvent.click(cell);
    expect(container.querySelector('.formatCardItem.editing')).toBeNull();

    // 新しい pointerdown の後は通常どおり編集に入れる
    fireEvent.pointerDown(window);
    fireEvent.click(cell);
    expect(container.querySelector('.formatCardItem.editing')).not.toBeNull();
  });
});
