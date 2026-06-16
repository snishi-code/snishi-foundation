// プロブレムリスト + 自由記述 (患者ごとの独立データ patient.problems / patient.freeText)。
//  - プロブレム: 空の #1 入力欄 / 追加で #2 が増える / 番号は配列順の自動付番
//    空行は確認なし削除・入力ありは確認ポップアップ / 削除後は表示順で再採番
//    QR (buildTabPayload) では S/O/A/P の前に `#n 本文` で出力し、空行は出さない
//  - 自由記述: 患者ごとの textarea。入力は patient.freeText へ write-through。QR には載らない
//  - フォーマット (settings.formats) / 専用一覧ページ / MM・SH QR / 受信ボックスは復活させない
import './setup';
import { describe, expect, it } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { buildTabPayload } from '../src/domain/payload';
import { composeProblemsText } from '../src/domain/problems';
import { FORMAT_PANELS, QR_KINDS } from '../src/domain/types';
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

  it('プロブレム空の患者は QR 先頭にプロブレム行を出さない (S から始まる)', async () => {
    const { runtime } = await renderApp({ bundle: seedBundle([{ name: 'P患者', room: '201' }]) });
    const p = runtime.store.getAppState().patients[0]!;
    const payload = buildTabPayload(p, runtime.store.getSettings());
    expect(payload.startsWith('(S)')).toBe(true);
  });
});

describe('自由記述欄 (患者ごとの独立データ)', () => {
  it('自由記述欄が表示され、入力が patient.freeText へ write-through される', async () => {
    const { runtime } = await renderApp({ bundle: seedBundle([{ name: 'F患者', room: '301' }]) });
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: '301 F患者' }));
    await screen.findByRole('region', { name: '自由記述' });

    const input = screen.getByRole('textbox', { name: '自由記述' });
    await user.type(input, '家族へ説明済み');
    expect(runtime.store.getAppState().patients[0]!.freeText).toBe('家族へ説明済み');
  });

  it('自由記述は QR (buildTabPayload) に含めない', async () => {
    const { runtime } = await renderApp({
      bundle: seedBundle([{ name: 'F患者', room: '301', freeText: '内緒メモ' }]),
    });
    const p = runtime.store.getAppState().patients[0]!;
    const payload = buildTabPayload(p, runtime.store.getSettings());
    expect(payload).not.toContain('内緒メモ');
  });
});

describe('復活させない範囲のガード (スリム化方針の維持)', () => {
  it('FORMAT_PANELS は S/O/A/P のみ (problem / shared パネルは戻さない)', () => {
    expect([...FORMAT_PANELS]).toEqual(['S', 'O', 'A', 'P']);
  });

  it('QR_KINDS は HM / ST のみ (MM / SH QR は戻さない)', () => {
    expect([...QR_KINDS]).toEqual(['HM', 'ST']);
  });
});
