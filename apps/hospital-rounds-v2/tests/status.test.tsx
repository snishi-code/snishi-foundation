// (e) ステータス変更が保存スケジュールされる (患者シートのステータスボックス →
//     markUpdated + scheduleSave)。導線は v1 同様: 患者カード → 詳細 → 患者メタ →
//     シート内ステータス (色 + 形マークのみ・シートは開いたまま)。
import './setup';
import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { STATUS } from '../src/domain/types';
import { renderApp, seedBundle } from './helpers';

describe('ステータス変更', () => {
  it('患者カード → 患者シート → 色ボックスで status 反映 + scheduleSave', async () => {
    const { runtime } = await renderApp({ bundle: seedBundle([{ name: 'テスト太郎', room: '203' }]) });
    const user = userEvent.setup();
    const scheduleSpy = vi.spyOn(runtime.store, 'scheduleSave');

    // ホームの患者カード本体タップ → 詳細
    await user.click(screen.getByRole('button', { name: '203 テスト太郎' }));
    // 患者メタボタン → 患者シート
    await user.click(
      await screen.findByRole('button', { name: '203 テスト太郎（タップして患者情報を編集）' }),
    );
    // ステータスは色 + 形マークのボックス (色名はアクセシブルネームのみ)
    await user.click(await screen.findByRole('button', { name: '緑' }));

    const patient = runtime.store.getAppState().patients[0]!;
    expect(patient.status).toBe(STATUS.GREEN);
    expect(scheduleSpy).toHaveBeenCalled();

    // シートは開いたまま (複数項目を続けて編集できる) + 選択状態が移る
    expect(screen.getByRole('button', { name: '緑' })).toHaveAttribute('aria-pressed', 'true');
  });
});
