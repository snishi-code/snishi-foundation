// 設定画面: フォーマット CRUD / 破壊変更ガード / セット不変条件 / ST QR roundtrip (fail-closed)
import './setup';
import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ToastProvider } from '@snishi/foundation/ui/toast';
import { renderApp, seedBundle } from './helpers';
import { createAppRuntime } from '../src/ui/appRuntime';
import { encodeSettingsPayload, decodeSettingsPayload } from '../src/qr/settingsQr';
import { applySettingsPatch } from '../src/ui/settings/qrApply';
import { FormatGroupEditDialog } from '../src/ui/settings/FormatGroupEditDialog';
import {
  formatItemDeleteBlocked,
  formatItemKindChangeBlocked,
  formatItemReorderBlocked,
} from '../src/domain/formatValues';

async function openSettings(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  await user.click(screen.getByRole('button', { name: 'メニュー' }));
  await user.click(await screen.findByRole('button', { name: '設定' }));
  await screen.findByText('診察開始でクリアする項目');
}

describe('設定: フォーマット CRUD', () => {
  it('新規フォーマットを作成すると一覧と settings.formats に入る', async () => {
    const { runtime } = await renderApp();
    const user = userEvent.setup();
    await openSettings(user);

    // S 欄など各パネルに追加ボタンがある。先頭 (problem 欄) で新規作成。
    const addButtons = screen.getAllByRole('button', { name: 'フォーマット追加' });
    await user.click(addButtons[0] as HTMLElement);

    const dialog = await screen.findByText('プロブレムリスト 欄のフォーマット 新規作成');
    expect(dialog).toBeInTheDocument();
    await user.type(screen.getByLabelText('名前'), 'テスト書式');
    await user.click(screen.getByRole('button', { name: '＋ 項目追加' }));
    await user.click(screen.getByRole('button', { name: '保存' }));

    // 一覧 + settings.formats に反映 (panel=problem)
    expect(await screen.findByText('テスト書式')).toBeInTheDocument();
    const saved = runtime.store.getSettings().formats.find((f) => f.name === 'テスト書式');
    expect(saved).toBeTruthy();
    expect(saved?.panel).toBe('problem');
  });

  it('同名フォーマットは保存を拒否する', async () => {
    const { runtime } = await renderApp();
    const user = userEvent.setup();
    const existing = runtime.store.getSettings().formats[0];
    await openSettings(user);

    const addButtons = screen.getAllByRole('button', { name: 'フォーマット追加' });
    await user.click(addButtons[0] as HTMLElement);
    await user.type(await screen.findByLabelText('名前'), existing!.name);
    await user.click(screen.getByRole('button', { name: '保存' }));

    // ダイアログは開いたまま (保存中断) + 重複エラー toast
    expect(await screen.findByText('既に同名のフォーマットがあります。別の名前にしてください。')).toBeInTheDocument();
    const dupes = runtime.store.getSettings().formats.filter((f) => f.name === existing!.name);
    expect(dupes).toHaveLength(1);
  });
});

describe('設定: フォーマット破壊変更ガード (患者データの index ずれ防止)', () => {
  it('患者で使用中の item index を全病棟横断で収集し、削除/並び替え/種類変更をブロックする', async () => {
    const runtime = createAppRuntime();
    await runtime.store.initStore({ bundle: seedBundle([{ name: '患者A' }]) });
    const { store } = runtime;

    // 患者A が settings.formats[0] の item 1 に入力済み
    const fmt = store.getSettings().formats[0]!;
    const p = store.getAppState().patients[0]!;
    p.formatValues = { [fmt.id]: { '1': { value: '96', note: '' } } };

    const indices = await store.collectFormatDataIndices(fmt.id);
    expect(indices).toBeInstanceOf(Set);
    expect([...(indices as Set<number>)]).toEqual([1]);

    // index 1 に入力あり → 削除 'data'。index 0 は後ろに入力あり → 'shift'。index 2 は可。
    expect(formatItemDeleteBlocked(indices, 1)).toBe('data');
    expect(formatItemDeleteBlocked(indices, 0)).toBe('shift');
    expect(formatItemDeleteBlocked(indices, 2)).toBeNull();
    // 入力が 1 つでもある format は並び替え不可 / 当該 index の kind 変更不可
    expect(formatItemReorderBlocked(indices)).toBe(true);
    expect(formatItemKindChangeBlocked(indices, 1)).toBe(true);
    expect(formatItemKindChangeBlocked(indices, 0)).toBe(false);

    // 不明 (収集失敗 = null) は fail-closed で全ブロック
    expect(formatItemDeleteBlocked(null, 0)).toBe('data');
    expect(formatItemReorderBlocked(null)).toBe(true);
  });
});

describe('設定: フォーマットセットの不変条件 (isDefault ちょうど 1 つ)', () => {
  it('新しいセットをデフォルトにすると既存デフォルトが解除される', async () => {
    const runtime = createAppRuntime();
    await runtime.store.initStore();
    const settings = runtime.store.getSettings();
    const prevDefault = settings.formatGroups.find((g) => g.isDefault);
    expect(prevDefault).toBeTruthy();

    const user = userEvent.setup();
    const onClose = vi.fn();
    render(
      <ToastProvider>
        <FormatGroupEditDialog runtime={runtime} group={null} onClose={onClose} />
      </ToastProvider>,
    );

    await user.type(screen.getByLabelText('名前'), '新セット');
    await user.click(screen.getByRole('checkbox', { name: /このセットをデフォルトにする/ }));
    // フォーマットを 1 つ含める (先頭パネルの先頭チェックボックス)
    const dialog = screen.getByRole('dialog');
    const checkboxes = within(dialog).getAllByRole('checkbox');
    await user.click(checkboxes[1] as HTMLElement); // [0] は isDefault
    await user.click(screen.getByRole('button', { name: '保存' }));

    expect(onClose).toHaveBeenCalled();
    const groups = runtime.store.getSettings().formatGroups;
    const defaults = groups.filter((g) => g.isDefault);
    expect(defaults).toHaveLength(1);
    expect(defaults[0]?.name).toBe('新セット');
    expect(groups.find((g) => g.id === prevDefault!.id)?.isDefault).toBe(false);
    // 含むパネルで展開フォーマットが最低 1 つ (repairGroupExpandInvariant)
    expect(defaults[0]!.expandFormatIds.length).toBeGreaterThan(0);
  });
});

describe('設定 QR (ST) roundtrip', () => {
  it('encode → decode → apply で settings が置換され保存される', async () => {
    const sender = createAppRuntime();
    await sender.store.initStore();
    const senderSettings = sender.store.getSettings();
    senderSettings.tags = ['内科', '外科'];
    senderSettings.formats[0]!.name = '送信側カスタム';

    const payload = encodeSettingsPayload(senderSettings);
    const patch = decodeSettingsPayload(payload);

    const receiver = createAppRuntime();
    await receiver.store.initStore();
    const res = await applySettingsPatch(receiver.store, patch);
    expect(res.ok).toBe(true);

    const applied = receiver.store.getSettings();
    expect(applied.tags).toEqual(['内科', '外科']);
    expect(applied.formats.map((f) => f.name)).toContain('送信側カスタム');
    // ID は受信側で新発番 (送信側の上書きを避ける)
    expect(applied.formats[0]!.id).not.toBe(senderSettings.formats[0]!.id);
    // formatGroups は format ID を参照して再構築済み + isDefault ちょうど 1 つ
    expect(applied.formatGroups.filter((g) => g.isDefault)).toHaveLength(1);
    const knownIds = new Set(applied.formats.map((f) => f.id));
    for (const g of applied.formatGroups) {
      for (const id of g.formatIds) expect(knownIds.has(id)).toBe(true);
    }
    // 保存も確認 (IDB へ書かれた settings を読み戻す)
    const persisted = (await receiver.store.storage.loadGlobalSettings()) as { tags?: string[] };
    expect(persisted?.tags).toEqual(['内科', '外科']);
  });

  it('保存失敗時は in-memory をロールバックして中断する (fail-closed)', async () => {
    const sender = createAppRuntime();
    await sender.store.initStore();
    sender.store.getSettings().tags = ['ロールバック確認'];
    const patch = decodeSettingsPayload(encodeSettingsPayload(sender.store.getSettings()));

    const receiver = createAppRuntime();
    await receiver.store.initStore();
    const prevSettings = receiver.store.getSettings();
    const prevTags = prevSettings.tags.slice();

    // 保存経路を失敗させる (IDB 不可 = no-op 保存も失敗扱い)
    vi.spyOn(receiver.store.storage, 'isStorageAvailable').mockResolvedValue(false);

    const res = await applySettingsPatch(receiver.store, patch);
    expect(res.ok).toBe(false);
    // in-memory が取込前に戻っている
    expect(receiver.store.getSettings()).toBe(prevSettings);
    expect(receiver.store.getSettings().tags).toEqual(prevTags);
  });
});
