// データの保存と復元: アーカイブ roundtrip (取込前 snapshot) / ユーザー削除の purgeForScopes
import './setup';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderApp, seedBundle } from './helpers';
import { createAppRuntime } from '../src/ui/appRuntime';
import { REASON } from '../src/data/snapshots';

async function openSettings(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  await user.click(screen.getByRole('button', { name: 'メニュー' }));
  await user.click(await screen.findByRole('button', { name: '設定' }));
  await screen.findByText('診察開始でクリアする項目');
}

describe('アーカイブ書き出し → 取込 roundtrip', () => {
  it('exportArchive の JSON を取り込むと病棟が追加され、取込前 snapshot が増える', async () => {
    // 送信側: 患者入りのアーカイブを作る
    const sender = createAppRuntime();
    await sender.store.initStore({ bundle: seedBundle([{ name: '移行患者', room: '301' }]) });
    // initStore({bundle}) は storage を経由しないため、export 前に一度永続化する
    await sender.store.persistActiveOrThrow();
    const archive = await sender.store.exportArchive();
    expect(archive.workspaces.length).toBeGreaterThan(0);
    expect(archive.workspaces[0]!.patients.some((p) => p.name === '移行患者')).toBe(true);

    // 受信側: UI (設定 > JSON 取り込み) から取り込む
    const { runtime } = await renderApp({ bundle: seedBundle([{ name: '既存患者' }]) });
    await runtime.store.persistActiveOrThrow();
    const user = userEvent.setup();
    await openSettings(user);

    const wsBefore = await runtime.store.storage.listBundles();
    const snapsBefore = await runtime.snapshots.list();

    const fileInput = document.querySelector('input[data-ui="settings.io.file"]') as HTMLInputElement;
    expect(fileInput).toBeTruthy();
    const file = new File([JSON.stringify(archive)], 'backup.json', { type: 'application/json' });
    fireEvent.change(fileInput, { target: { files: [file] } });

    // FileReader 完了 → 確認ダイアログ → 取込
    const confirmBtn = await screen.findByRole('button', { name: '取込' });
    await user.click(confirmBtn);

    await waitFor(async () => {
      const wsAfter = await runtime.store.storage.listBundles();
      expect(wsAfter.length).toBe(wsBefore.length + archive.workspaces.length);
    });

    // 取込前 snapshot (REASON.IMPORT) が増えている
    const snapsAfter = await runtime.snapshots.list();
    expect(snapsAfter.length).toBeGreaterThan(snapsBefore.length);
    expect(snapsAfter.some((s) => s.reason === REASON.IMPORT)).toBe(true);

    // 取り込んだ病棟に移行患者が入っている
    const wsAfter = await runtime.store.storage.listBundles();
    const newWs = wsAfter.find((w) => !wsBefore.some((b) => b.id === w.id));
    expect(newWs).toBeTruthy();
    const bundle = await runtime.store.storage.loadBundle(newWs!.id);
    expect(JSON.stringify(bundle)).toContain('移行患者');
  });
});

describe('ユーザー削除', () => {
  it('削除時に deleteUser の wsIds で snapshots.purgeForScopes が呼ばれる (PII 残留防止)', async () => {
    const { runtime } = await renderApp();
    const user = userEvent.setup();
    const { store } = runtime;

    // 2 人目のユーザーを作って (空病棟が 1 つできる)、元のユーザーへ戻る
    const firstUserId = store.storage.getCurrentUserId();
    const created = await store.createUserAndSwitch('削除対象');
    expect(created.ok).toBe(true);
    const victimId = created.ok ? created.id : '';
    const victimWsIds = (await store.storage.listAllWorkspaces())
      .filter((w) => w.userId === victimId)
      .map((w) => w.id);
    expect(victimWsIds.length).toBeGreaterThan(0);
    await store.switchUser(firstUserId);

    const purgeSpy = vi.spyOn(runtime.snapshots, 'purgeForScopes');

    await openSettings(user);
    // ユーザー管理セクションに 2 人 → 「削除対象」行の削除ボタン
    const row = (await screen.findByText('削除対象')).closest('[data-ui="settings.users.row"]') as HTMLElement;
    expect(row).toBeTruthy();
    const delBtn = row.querySelector('[data-ui="settings.users.delete"]') as HTMLElement;
    expect(delBtn).toBeTruthy();
    await user.click(delBtn);
    // 確認ダイアログの確定ボタン (画面内の他の「削除」ボタンと区別するため data-ui で特定)
    const confirm = await screen.findByText('ユーザー「削除対象」と、その全データ（病棟・設定）を削除しますか？元に戻せません。');
    expect(confirm).toBeInTheDocument();
    await user.click(document.querySelector('[data-ui="dialog.confirm"]') as HTMLElement);

    await waitFor(() => {
      expect(purgeSpy).toHaveBeenCalledWith(victimWsIds);
    });
    // 登録簿からも消えている
    const users = await store.storage.listUsers();
    expect(users.some((u) => u.id === victimId)).toBe(false);
  });
});
