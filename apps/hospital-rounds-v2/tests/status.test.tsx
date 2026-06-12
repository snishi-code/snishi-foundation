// (e) ステータス変更が保存スケジュールされる (患者シートのステータスボックス →
//     markUpdated + scheduleSave)。導線は v1 同様: 患者カード → 詳細 → 患者メタ →
//     シート内ステータス (色 + 形マークのみ・シートは開いたまま)。
// また Phase 4 で追加したホームの左端ステータスボタン経由の変更も検証する。
import './setup';
import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { STATUS } from '../src/domain/types';
import { renderApp, seedBundle } from './helpers';

describe('ステータス変更', () => {
  it('患者画面下部のステータスボタン → ポップアップ → 色選択で status 反映 + scheduleSave', async () => {
    const { runtime } = await renderApp({ bundle: seedBundle([{ name: '太郎', room: '101' }]) });
    const user = userEvent.setup();
    const scheduleSpy = vi.spyOn(runtime.store, 'scheduleSave');

    // 患者タップ → detail
    await user.click(screen.getByRole('button', { name: '101 太郎' }));
    // 下部バーのステータスボタン
    const statusBtn = await screen.findByRole('button', { name: 'ステータスを変更' });
    await user.click(statusBtn);

    // ポップアップ内の「黄」をクリック
    const popup = await screen.findByRole('dialog', { name: 'ステータスを選択' });
    await user.click(within(popup).getByRole('button', { name: '黄' }));

    // ポップアップが閉じる
    expect(screen.queryByRole('dialog', { name: 'ステータスを選択' })).toBeNull();

    // status が反映される
    const patient = runtime.store.getAppState().patients.find((p) => p.name === '太郎')!;
    expect(patient.status).toBe(STATUS.YELLOW);
    expect(scheduleSpy).toHaveBeenCalled();
  });

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

  it('ホームの左端ステータスボタン → ポップアップ → 色選択で status 反映 + scheduleSave + ポップアップが閉じる', async () => {
    const { runtime } = await renderApp({ bundle: seedBundle([{ name: '花子', room: '101' }]) });
    const user = userEvent.setup();
    const scheduleSpy = vi.spyOn(runtime.store, 'scheduleSave');

    // ホームに左端ステータスボタンがある
    const statusBtn = await screen.findByRole('button', { name: '101 花子 のステータスを変更' });
    expect(statusBtn).toBeInTheDocument();

    // ステータスボタンをタップ → ポップアップが開く
    await user.click(statusBtn);

    // ポップアップ内の「緑」をクリック
    const popup = await screen.findByRole('dialog', { name: 'ステータスを選択' });
    await user.click(within(popup).getByRole('button', { name: '緑' }));

    // ポップアップが閉じる
    expect(screen.queryByRole('dialog', { name: 'ステータスを選択' })).toBeNull();

    // status が反映される
    const patient = runtime.store.getAppState().patients.find((p) => p.name === '花子')!;
    expect(patient.status).toBe(STATUS.GREEN);
    expect(scheduleSpy).toHaveBeenCalled();
  });
});

describe('診察開始: clearOnStart タグ除去', () => {
  it('clearOnStart=true のタグだけ外れ、false のタグとステータス以外のデータは残る', async () => {
    const { runtime } = await renderApp();
    const user = userEvent.setup();

    // 設定に TagDef を直接セット
    runtime.store.getSettings().tags = [
      { name: '重症', clearOnStart: true },
      { name: '内科', clearOnStart: false },
      { name: '要観察', clearOnStart: true },
    ];
    runtime.store.getAppState().patients[0]!.name = '太郎';
    runtime.store.getAppState().patients[0]!.tags = ['重症', '内科'];
    runtime.store.getAppState().patients[1]!.name = '次郎';
    runtime.store.getAppState().patients[1]!.tags = ['内科', '要観察'];

    // 診察開始ボタン → 確認ダイアログ → 実行
    await user.click(screen.getByRole('button', { name: '診察開始' }));
    // ダイアログが出るのを待つ
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: '診察開始' }));
    // runClear はスナップショット取得 (async) の後に反映されるため、状態の変化自体を待つ
    await waitFor(() => {
      expect(runtime.store.getAppState().patients[0]!.tags).not.toContain('重症');
    });

    const p0 = runtime.store.getAppState().patients[0]!;
    const p1 = runtime.store.getAppState().patients[1]!;
    // clearOnStart=true の「重症」「要観察」は除去
    expect(p0.tags).not.toContain('重症');
    expect(p1.tags).not.toContain('要観察');
    // clearOnStart=false の「内科」は残る
    expect(p0.tags).toContain('内科');
    expect(p1.tags).toContain('内科');
    // 名前はそのまま
    expect(p0.name).toBe('太郎');
    expect(p1.name).toBe('次郎');
  });
});
