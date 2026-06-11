// (c) undo ボタンで値が戻る (患者ごと・format スコープ・fail-closed 保存)
import './setup';
import { describe, expect, it } from 'vitest';
import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readTextValue } from '../src/domain/formatValues';
import { renderApp, seedBundle } from './helpers';

describe('patient undo', () => {
  it('inline 編集 → 戻す で値が編集前へ戻り、進む でやり直せる', async () => {
    const { runtime } = await renderApp({ bundle: seedBundle([{ name: 'テスト太郎', room: '203' }]) });
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: '203 テスト太郎' }));
    await screen.findByRole('region', { name: 'S' });

    const undoBtn = screen.getByRole('button', { name: '戻す（直前の入力を取り消し）' });
    expect(undoBtn).toBeDisabled();

    // inline 編集で実変更 → 最初の実変更で Undo 起点が積まれる
    await user.click(screen.getByRole('button', { name: '自覚症状 を入力' }));
    const ta = await screen.findByRole('textbox', { name: '自覚症状 を入力' });
    await user.type(ta, '嘔気');

    const patient = runtime.store.getAppState().patients[0]!;
    const sFormat = runtime.store.getSettings().formats.find((f) => f.panel === 'S')!;
    expect(readTextValue(patient.formatValues[sFormat.id]?.['0'])).toBe('嘔気');
    await waitFor(() => expect(undoBtn).toBeEnabled());

    // 編集を抜けてから undo (popstate で編集解除)
    act(() => {
      window.dispatchEvent(new PopStateEvent('popstate', { state: { view: 'home' } }));
    });

    await user.click(undoBtn);
    await waitFor(() => {
      expect(readTextValue(patient.formatValues[sFormat.id]?.['0'])).toBe('');
    });
    // toast で結果を通知 (v1 undo.done)
    expect(await screen.findByText(/戻しました/)).toBeInTheDocument();

    // redo で再適用
    const redoBtn = screen.getByRole('button', { name: '進む（取り消した入力をやり直し）' });
    await waitFor(() => expect(redoBtn).toBeEnabled());
    await user.click(redoBtn);
    await waitFor(() => {
      expect(readTextValue(patient.formatValues[sFormat.id]?.['0'])).toBe('嘔気');
    });
  });
});
