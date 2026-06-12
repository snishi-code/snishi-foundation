// 設定画面: フォーマット CRUD / 破壊変更ガード / 表示トグル / ST QR roundtrip (fail-closed)
import './setup';
import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderApp, seedBundle } from './helpers';
import { createAppRuntime } from '../src/ui/appRuntime';
import { encodeSettingsPayload, decodeSettingsPayload } from '../src/qr/settingsQr';
import { applySettingsPatch } from '../src/ui/settings/qrApply';
import { formatItemKindChangeBlocked } from '../src/domain/formatValues';

async function openSettings(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  await user.click(screen.getByRole('button', { name: '設定' }));
  await screen.findByText('診察開始でクリアする項目');
}

describe('設定: フォーマット CRUD', () => {
  it('新規フォーマットを作成すると一覧と settings.formats に入る', async () => {
    const { runtime } = await renderApp();
    const user = userEvent.setup();
    await openSettings(user);

    // S/O/A/P 各パネルに追加ボタンがある。先頭 (S 欄) で新規作成。
    const addButtons = screen.getAllByRole('button', { name: 'フォーマット追加' });
    await user.click(addButtons[0] as HTMLElement);

    const dialog = await screen.findByText('S のフォーマット 新規作成');
    expect(dialog).toBeInTheDocument();
    await user.type(screen.getByLabelText('名前'), 'テスト書式');
    await user.click(screen.getByRole('button', { name: '＋ 項目追加' }));
    await user.click(screen.getByRole('button', { name: '保存' }));

    // 一覧 + settings.formats に反映 (panel=S)
    expect(await screen.findByText('テスト書式')).toBeInTheDocument();
    const saved = runtime.store.getSettings().formats.find((f) => f.name === 'テスト書式');
    expect(saved).toBeTruthy();
    expect(saved?.panel).toBe('S');
    // 新規作成フォーマットのデフォルト display は quick
    expect(saved?.display).toBe('quick');
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

describe('設定: フォーマット項目の並び替え/削除 (全患者の保存値を同時変換)', () => {
  it('使用中 item index を収集し、kind 変更は引き続きブロックする', async () => {
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

    // kind (種類) 変更は保存形が変わるため当該 index ではブロック (不明 null も fail-closed)
    expect(formatItemKindChangeBlocked(indices, 1)).toBe(true);
    expect(formatItemKindChangeBlocked(indices, 0)).toBe(false);
    expect(formatItemKindChangeBlocked(null, 0)).toBe(true);
  });

  it('applyFormatEditWithRemap: 項目の入替/削除と同じ変換を全患者の保存値へ適用する', async () => {
    const runtime = createAppRuntime();
    await runtime.store.initStore({ bundle: seedBundle([{ name: '患者A' }]) });
    const { store } = runtime;

    // 身体所見 (text 複数項目) を対象に、item0 ↔ item1 を入替えて item2 を削除する
    const fmt = store.getSettings().formats.find((f) => f.items.length >= 3)!;
    expect(fmt).toBeTruthy();
    const p = store.getAppState().patients[0]!;
    p.formatValues = {
      [fmt.id]: { '0': '値ゼロ', '1': '値イチ', '2': '値ニ' },
    };

    const items = fmt.items.map((it) => ({ ...it }));
    const finalItems = [items[1]!, items[0]!, ...items.slice(3)];
    const mapping = [1, 0, ...items.slice(3).map((_, k) => k + 3)];
    await store.applyFormatEditWithRemap({ ...fmt, items: finalItems }, mapping);

    // 設定定義と患者の保存値が同じ移動/削除で変換されている (ラベルと値の対応を保つ)
    const savedFmt = store.getSettings().formats.find((f) => f.id === fmt.id)!;
    expect(savedFmt.items[0]!.label).toBe(items[1]!.label);
    expect(savedFmt.items[1]!.label).toBe(items[0]!.label);
    const slot = store.getAppState().patients[0]!.formatValues[fmt.id]!;
    expect(slot['0']).toBe('値イチ');
    expect(slot['1']).toBe('値ゼロ');
    expect(slot['2']).not.toBe('値ニ'); // index 2 (旧値ニ) は削除済み
  });

  it('applyFormatEditWithRemap: 保存不可なら live をロールバックして throw (fail-closed)', async () => {
    const runtime = createAppRuntime();
    await runtime.store.initStore({ bundle: seedBundle([{ name: '患者A' }]) });
    const { store } = runtime;
    const fmt = store.getSettings().formats.find((f) => f.items.length >= 2)!;
    const p = store.getAppState().patients[0]!;
    p.formatValues = { [fmt.id]: { '0': 'A', '1': 'B' } };
    const prevItems = fmt.items.map((it) => ({ ...it }));

    vi.spyOn(store.storage, 'isStorageAvailable').mockResolvedValue(false);
    await expect(
      store.applyFormatEditWithRemap({ ...fmt, items: [prevItems[1]!, prevItems[0]!] }, [1, 0]),
    ).rejects.toThrow();
    // live は無傷 (値も定義も変換されていない)
    expect(store.getAppState().patients[0]!.formatValues[fmt.id]).toEqual({ '0': 'A', '1': 'B' });
    expect(store.getSettings().formats.find((f) => f.id === fmt.id)!.items[0]!.label).toBe(
      prevItems[0]!.label,
    );
  });
});

describe('設定: フォーマット行トグルで display が切替わり保存される', () => {
  it('expand ↔ quick トグルが settings.formats に反映される', async () => {
    const { runtime } = await renderApp();
    const user = userEvent.setup();
    await openSettings(user);

    // デフォルトの formats[0] の現在の display を確認
    const fmt0 = runtime.store.getSettings().formats[0]!;
    const initialDisplay = fmt0.display;

    // settings UI: フォーマット行に「展開」「クイック」トグルボタンが存在する
    // 現在の display と反対のボタンをクリックして切り替える
    // ボタンテキストは i18n: expand='展開' / quick='クイック'
    const oppositeLabel = initialDisplay === 'expand' ? 'クイック' : '展開';
    const toggleBtns = screen.getAllByRole('button', { name: oppositeLabel });
    expect(toggleBtns.length).toBeGreaterThan(0);
    await user.click(toggleBtns[0] as HTMLElement);

    // settings.formats[0] の display が変わっている
    const updated = runtime.store.getSettings().formats.find((f) => f.id === fmt0.id)!;
    const expectedDisplay = initialDisplay === 'expand' ? 'quick' : 'expand';
    expect(updated.display).toBe(expectedDisplay);
  });

  it('expand/quick 両方のトグルボタンが設定フォーマット一覧に表示される', async () => {
    const { runtime } = await renderApp();
    const user = userEvent.setup();
    await openSettings(user);

    // フォーマット一覧には「展開」「クイック」ボタンが複数存在する (各フォーマット行ごとに1セット)
    const expandBtns = screen.getAllByRole('button', { name: '展開' });
    const quickBtns = screen.getAllByRole('button', { name: 'クイック' });
    expect(expandBtns.length).toBeGreaterThan(0);
    expect(quickBtns.length).toBeGreaterThan(0);
    // ボタン数はフォーマット数と一致する (各行に 1 セット)
    const fmtCount = runtime.store.getSettings().formats.length;
    expect(expandBtns.length).toBe(fmtCount);
    expect(quickBtns.length).toBe(fmtCount);
  });
});

describe('設定 QR (ST) roundtrip', () => {
  it('encode → decode → apply で settings が置換され保存される', async () => {
    const sender = createAppRuntime();
    await sender.store.initStore();
    const senderSettings = sender.store.getSettings();
    senderSettings.tags = [{ name: '内科', clearOnStart: false }, { name: '外科', clearOnStart: false }];
    senderSettings.formats[0]!.name = '送信側カスタム';

    const payload = encodeSettingsPayload(senderSettings);
    const patch = decodeSettingsPayload(payload);

    const receiver = createAppRuntime();
    await receiver.store.initStore();
    const res = await applySettingsPatch(receiver.store, patch);
    expect(res.ok).toBe(true);

    const applied = receiver.store.getSettings();
    expect(applied.tags).toEqual([{ name: '内科', clearOnStart: false }, { name: '外科', clearOnStart: false }]);
    expect(applied.formats.map((f) => f.name)).toContain('送信側カスタム');
    // ID は受信側で新発番 (送信側の上書きを避ける)
    expect(applied.formats[0]!.id).not.toBe(senderSettings.formats[0]!.id);
    // display は QR で正しく伝搬する
    const origDisplay = senderSettings.formats[0]!.display;
    expect(applied.formats.find((f) => f.name === '送信側カスタム')?.display).toBe(origDisplay);
    // formatGroups は存在しない (P3: FormatGroup 全廃)
    expect((applied as Record<string, unknown>).formatGroups).toBeUndefined();
    // 保存も確認 (IDB へ書かれた settings を読み戻す)
    const persisted = (await receiver.store.storage.loadGlobalSettings()) as { tags?: Array<{ name: string; clearOnStart: boolean }> };
    expect(persisted?.tags).toEqual([{ name: '内科', clearOnStart: false }, { name: '外科', clearOnStart: false }]);
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
