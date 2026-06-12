// (e) ステータス変更が保存スケジュールされる (患者シートのステータスボックス →
//     markUpdated + scheduleSave)。導線は v1 同様: 患者カード → 詳細 → 患者メタ →
//     シート内ステータス (色 + 形マークのみ・シートは開いたまま)。
import './setup';
import { describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
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
    // 保存完了を待つ (ダイアログが消えたら完了)
    await screen.findByRole('button', { name: '診察開始' });

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
