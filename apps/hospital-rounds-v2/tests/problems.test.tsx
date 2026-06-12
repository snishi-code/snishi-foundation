// P1: プロブレムリスト (患者ごとの独立データ patient.problems)。
//  - デフォルトで空の #1 入力欄 / 追加で #2, #3 が増える / 番号は配列順の自動付番
//  - 空行は確認なしで削除・入力ありは確認ポップアップ / 削除後は表示順で再採番
//  - QR (buildTabPayload) では S/O/A/P の前に `#n 本文` で出力し、空行は出さない
import './setup';
import { describe, expect, it } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { buildTabPayload } from '../src/domain/payload';
import { composeProblemsText } from '../src/domain/problems';
import { renderApp, seedBundle } from './helpers';

async function openDetail(user: ReturnType<typeof userEvent.setup>, label: string) {
  await user.click(screen.getByRole('button', { name: label }));
  await screen.findByRole('region', { name: 'プロブレムリスト' });
}

describe('プロブレムリスト (患者ごとの独立データ)', () => {
  it('空の #1 入力欄が出て、入力が patient.problems へ write-through される', async () => {
    const { runtime } = await renderApp({ bundle: seedBundle([{ name: 'P患者', room: '201' }]) });
    const user = userEvent.setup();
    await openDetail(user, '201 P患者');

    const input = screen.getByRole('textbox', { name: 'プロブレム #1' });
    await user.type(input, 'HF');
    expect(runtime.store.getAppState().patients[0]!.problems).toEqual(['HF']);
  });

  it('追加ボタンで #2 が増え、番号は配列順から自動付番される', async () => {
    await renderApp({ bundle: seedBundle([{ name: 'P患者', room: '201' }]) });
    const user = userEvent.setup();
    await openDetail(user, '201 P患者');

    await user.click(screen.getByRole('button', { name: 'プロブレム追加' }));
    expect(screen.getByRole('textbox', { name: 'プロブレム #1' })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'プロブレム #2' })).toBeInTheDocument();
  });

  it('空行は確認なしで削除 / 入力ありは確認ポップアップ → OK で削除 + 再採番', async () => {
    const { runtime } = await renderApp({
      bundle: seedBundle([{ name: 'P患者', room: '201', problems: ['HF', 'DM'] }]),
    });
    const user = userEvent.setup();
    await openDetail(user, '201 P患者');

    // 入力あり行 (#1 HF) の削除 → 確認ポップアップ
    await user.click(screen.getByRole('button', { name: 'プロブレム #1 を削除' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/「HF」を削除します/)).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: '削除' }));

    // 下の行が詰まり、DM が #1 になる (表示順で再採番)
    const p = runtime.store.getAppState().patients[0]!;
    expect(p.problems).toEqual(['DM']);
    expect(screen.getByRole('textbox', { name: 'プロブレム #1' })).toHaveValue('DM');

    // 空行を足して消す → 確認なしで即削除
    await user.click(screen.getByRole('button', { name: 'プロブレム追加' }));
    await user.click(screen.getByRole('button', { name: 'プロブレム #2 を削除' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(runtime.store.getAppState().patients[0]!.problems).toEqual(['DM']);
  });

  it('QR 出力: プロブレムは S/O/A/P の前・#n 付き・空行はスキップ', async () => {
    const { runtime } = await renderApp({
      bundle: seedBundle([{ name: 'P患者', room: '201', problems: ['HF', '', 'DM'] }]),
    });
    const p = runtime.store.getAppState().patients[0]!;
    const settings = runtime.store.getSettings();

    expect(composeProblemsText(p.problems)).toBe('#1 HF\n#3 DM');
    const payload = buildTabPayload(p, settings);
    expect(payload.startsWith('#1 HF\n#3 DM\n――\n(S)')).toBe(true);
  });
});
