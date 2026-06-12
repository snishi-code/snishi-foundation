// P0: 患者詳細を開いた直後のゴーストタップで正常チェックが反応しない (freshTapRef ガード)。
// inline 編集・入力シートと同じガードを onPresetToggle にも適用した修正の回帰テスト。
import './setup';
import { describe, expect, it } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readTextValue } from '../src/domain/formatValues';
import { renderApp, seedBundle } from './helpers';

describe('正常チェックの誤タップガード', () => {
  it('detail 入場直後 (新しい pointerdown なし) のクリックは保存されない', async () => {
    const { runtime } = await renderApp({ bundle: seedBundle([{ name: 'ガード患者', room: '101' }]) });
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: '101 ガード患者' }));
    await screen.findByRole('region', { name: 'S' });

    const patient = runtime.store.getAppState().patients[0]!;
    const sFormat = runtime.store.getSettings().formats.find((f) => f.panel === 'S')!;
    const normalBtn = screen.getAllByRole('button', { name: '正常' })[0] as HTMLElement;

    // ゴーストタップ相当: pointerdown を伴わない click (detail 入場前のタップの残り)
    fireEvent.click(normalBtn);
    expect(readTextValue(patient.formatValues[sFormat.id]?.['0'])).toBe('');

    // 新しい pointerdown の後は通常どおり正常文が書かれる
    fireEvent.pointerDown(window);
    fireEvent.click(normalBtn);
    expect(readTextValue(patient.formatValues[sFormat.id]?.['0'])).toBe(
      sFormat.items[0]!.normal,
    );
  });
});
