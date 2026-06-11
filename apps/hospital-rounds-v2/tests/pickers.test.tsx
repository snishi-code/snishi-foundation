// ピッカー: 病棟切替の fail-closed (保存失敗注入で切替中断) / ユーザー作成 + 切替
import './setup';
import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderApp, seedBundle } from './helpers';

describe('病棟ピッカー', () => {
  it('切替は fail-closed: 現病棟の保存に失敗したら切替を中断して通知する', async () => {
    const { runtime } = await renderApp({ bundle: seedBundle([{ name: '患者A', room: '101' }]) });
    const user = userEvent.setup();
    const { store } = runtime;

    // 2 つ目の病棟を作り (作成は切替を伴う)、元の病棟へ戻っておく
    const homeId = store.storage.getActiveWorkspaceId();
    await store.createWorkspace('別棟');
    await store.switchWorkspace(homeId);
    expect(store.storage.getActiveWorkspaceId()).toBe(homeId);

    // 保存を失敗させる (病棟切替前の persistActiveOrThrow が throw する)
    const spy = vi.spyOn(store.storage, 'saveBundle').mockRejectedValue(new Error('disk full'));

    await user.click(screen.getByRole('button', { name: '病棟を切替' }));
    const row = await screen.findByRole('button', { name: /別棟/ });
    await user.click(row);

    // 中断 + 可視化: アクティブ病棟は変わらない
    expect(await screen.findByText('病棟切替に失敗しました')).toBeInTheDocument();
    expect(store.storage.getActiveWorkspaceId()).toBe(homeId);

    // 保存が直れば切替できる
    spy.mockRestore();
    await user.click(screen.getByRole('button', { name: /別棟/ }));
    await waitFor(() => {
      expect(store.storage.getActiveWorkspaceId()).not.toBe(homeId);
    });
  });

  it('病棟の新規作成 → 切替', async () => {
    const { runtime } = await renderApp();
    const user = userEvent.setup();
    const before = runtime.store.storage.getActiveWorkspaceId();

    await user.click(screen.getByRole('button', { name: '病棟を切替' }));
    await user.click(await screen.findByRole('button', { name: '病棟を追加' }));
    await user.type(screen.getByLabelText('病棟を追加'), '新病棟{Enter}');

    await waitFor(() => {
      expect(runtime.store.storage.getActiveWorkspaceId()).not.toBe(before);
    });
    const list = await runtime.store.storage.listBundles();
    expect(list.some((w) => w.label === '新病棟')).toBe(true);
  });
});

describe('ユーザーピッカー', () => {
  it('ユーザー作成 → 切替され、ヘッダーのユーザー名が変わる', async () => {
    const { runtime } = await renderApp();
    const user = userEvent.setup();
    const before = runtime.store.storage.getCurrentUserId();

    await user.click(screen.getByRole('button', { name: 'ユーザーを切替' }));
    await user.click(await screen.findByRole('button', { name: 'ユーザーを追加' }));
    await user.type(screen.getByLabelText('ユーザーを追加'), '田中{Enter}');

    await waitFor(() => {
      expect(runtime.store.storage.getCurrentUserId()).not.toBe(before);
    });
    expect(runtime.store.getCurrentUserName()).toBe('田中');
    // ヘッダーのユーザー名ボタンに反映される (再描画は revision bump 経由の async — waitFor で待つ)
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'ユーザーを切替' })).toHaveTextContent('田中');
    });
  });
});
