// (e) ステータス変更が保存スケジュールされる (ステータスピッカー → markUpdated + scheduleSave)
import './setup';
import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { STATUS } from '../src/domain/types';
import { renderApp, seedBundle } from './helpers';

describe('ステータス変更', () => {
  it('バッジタップ → ピッカーで選択 → status 反映 + scheduleSave', async () => {
    const { runtime } = await renderApp({ bundle: seedBundle([{ name: 'テスト太郎', room: '203' }]) });
    const user = userEvent.setup();
    const scheduleSpy = vi.spyOn(runtime.store, 'scheduleSave');

    await user.click(screen.getByRole('button', { name: '203 テスト太郎 のステータスを変更' }));
    await user.click(await screen.findByRole('option', { name: /緑/ }));

    const patient = runtime.store.getAppState().patients[0]!;
    expect(patient.status).toBe(STATUS.GREEN);
    expect(scheduleSpy).toHaveBeenCalled();

    // ピッカーは単一選択 = 選んだら即閉じる
    await waitFor(() => {
      expect(screen.queryByRole('option', { name: /緑/ })).not.toBeInTheDocument();
    });
    // グリッドの患者カードに status-green が反映される
    const card = screen.getByRole('button', { name: '203 テスト太郎' });
    expect(card.className).toContain('status-green');
  });
});
