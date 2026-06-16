// (d) HM QR ページ生成 (useQrFlow を実 store で。暗号化 transport 込み)
// 受信はカメラ読み取りのみ (テキスト貼り付け受信は 2026-06 に撤去済み)。
// 受信完了で確認なしに自動展開 (pendingImport ConfirmDialog は廃止)。
import './setup';
import { describe, expect, it, vi } from 'vitest';
import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderApp, seedBundle } from './helpers';

// カメラ scan をモックし、注入したテキストを onResult へ流す (jsdom は getUserMedia/
// canvas frame を持たないため、受信→自動展開の経路はこの seam で実テストする)。
const scanMock = vi.hoisted(() => ({ current: null as ((t: string) => boolean | void) | null }));
vi.mock('@snishi/foundation/qr/scan', () => ({
  isScannerSupported: () => true,
  scanQrStream: (_video: unknown, onResult: (t: string) => boolean | void) => {
    scanMock.current = onResult;
    return {
      stop() {
        scanMock.current = null;
      },
    };
  },
}));
import { encodePatientList } from '../src/qr/patientList';
import { SECTION, getSection } from '../src/data/bundle';
import { encodePages, newBatchId } from '@snishi/foundation/qr/protocol';
import { packPayload } from '@snishi/foundation/qr/crypto';
import { APP_KEY_BYTES } from '../src/qr/appKey';
import { shouldEncryptQr } from '../src/qr/policy';
import { defaultSettings, makeDefaultPatient } from '../src/domain/normalize';

/** HM QR ページ列を実際に生成する (アプリと同一経路)。 */
async function buildHmPages(patients: Array<{ name: string; room: string }>): Promise<string[]> {
  const settings = defaultSettings();
  const patientObjs = patients.map((p) => ({
    ...makeDefaultPatient(),
    ...p,
  }));
  let payload = encodePatientList(patientObjs, settings, { kind: 'HM' });
  payload = await packPayload(payload, {
    encrypt: shouldEncryptQr('HM'),
    compress: false,
    keyBytes: APP_KEY_BYTES,
  });
  return encodePages({ kind: 'HM', payload, batchId: newBatchId() });
}

describe('ホーム QR (HM)', () => {
  it('QR 表示でページが生成され、ポップアップにメタとカメラ入口が出る (貼り付け受信なし)', async () => {
    await renderApp({
      bundle: seedBundle([
        { name: 'テスト太郎', room: '203' },
        { name: 'テスト次郎', room: '101' },
      ]),
    });
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: 'ホームQR表示' }));

    // encodePatientList → packPayload (E2 暗号化) → encodePages が完了するとメタが出る
    const meta = await screen.findByText(/^\(1\/\d+\)$/);
    expect(meta).toBeInTheDocument();
    // 受信入口はカメラのみ。テキスト貼り付け UI は存在しない (PWA 以前の遺残として撤去)
    expect(screen.getByRole('button', { name: 'カメラで QR を読む' })).toBeInTheDocument();
    expect(screen.queryByText('QR として読む')).toBeNull();
    expect(screen.queryByPlaceholderText(/RND_/)).toBeNull();
  });

  it('自動送りトグルボタンが QR ポップアップに表示される', async () => {
    await renderApp({
      bundle: seedBundle([{ name: 'テスト太郎', room: '203' }]),
    });
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'ホームQR表示' }));
    await screen.findByText(/^\(1\/\d+\)$/);

    // 再生中は「一時停止」ボタンが出る
    expect(screen.getByRole('button', { name: '自動送りを一時停止' })).toBeInTheDocument();

    // 一時停止ボタンを押すと「再開」ボタンに切り替わる
    await user.click(screen.getByRole('button', { name: '自動送りを一時停止' }));
    expect(await screen.findByRole('button', { name: '自動送りを再開' })).toBeInTheDocument();
  });

  it('HM 受信が完了すると確認なしで新規病棟に自動展開される (カメラ注入)', async () => {
    const { runtime } = await renderApp({
      bundle: seedBundle([{ name: '既存患者', room: '101' }]),
    });
    const user = userEvent.setup();

    // QR ダイアログ → カメラ受信を開く (scanQrStream モックが onResult を捕捉)
    await user.click(screen.getByRole('button', { name: 'ホームQR表示' }));
    await screen.findByText(/^\(1\/\d+\)$/);
    await user.click(screen.getByRole('button', { name: 'カメラで QR を読む' }));
    await waitFor(() => expect(scanMock.current).not.toBeNull());

    // 受信 (変異) が始まる前に旧 active 病棟 ID を控える (deterministic)
    const oldWsId = runtime.store.storage.getActiveWorkspaceId();

    // HM ページ列を実経路で生成し、カメラ読み取りとして 1 枚ずつ注入する
    const pages = await buildHmPages([{ name: '受信太郎', room: '201' }]);
    expect(pages.length).toBeGreaterThan(0);
    for (const page of pages) {
      await act(async () => {
        scanMock.current?.(page);
        await Promise.resolve();
      });
    }

    // 全ページ揃うと onApply → applyRoster が走り、新病棟へ切替 (確認ダイアログなし)
    await waitFor(() =>
      expect(runtime.store.getAppState().patients.some((p) => p.name === '受信太郎')).toBe(true),
    );
    // 旧 pendingImport ConfirmDialog の文言が出ないこと
    expect(screen.queryByText(/件の名簿を.*新規病棟/)).toBeNull();

    // 別病棟へ切り替わっている (新病棟が active)
    const newWsId = runtime.store.storage.getActiveWorkspaceId();
    expect(newWsId).not.toBe(oldWsId);

    // 既存病棟は破壊されず内容も保持される (= 自動展開を許容する根拠)
    const wards = await runtime.store.storage.listBundles();
    expect(wards.length).toBeGreaterThanOrEqual(2);
    const oldBundle = await runtime.store.storage.loadBundle(oldWsId);
    const oldPatients = (getSection(oldBundle, SECTION.PATIENTS) as Array<{ name: string }>) ?? [];
    expect(oldPatients.some((p) => p.name === '既存患者')).toBe(true);
    expect(oldPatients.some((p) => p.name === '受信太郎')).toBe(false);
  });

  it('患者詳細 QR (TAB) は static policy = 一時停止状態で開く (HM/ST は自動送り)', async () => {
    await renderApp({
      bundle: seedBundle([{ name: 'テスト太郎', room: '203' }]),
    });
    const user = userEvent.setup();

    // 患者カード右端の電子カルテ転記 QR ボタンを開く (空スロットと取り違えないよう氏名で特定)
    await user.click(screen.getByRole('button', { name: /テスト太郎 の電子カルテ転記用QRを表示/ }));

    // TAB は presentationDefault: 'static' → 初期は止まったまま (再生ボタンが出る)
    expect(await screen.findByRole('button', { name: '自動送りを再開' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '自動送りを一時停止' })).toBeNull();
  });

  it('buildHmPages が正常にページ列を生成できる (encode/crypto round-trip)', async () => {
    const pages = await buildHmPages([
      { name: '受信太郎', room: '201' },
      { name: '受信花子', room: '202' },
    ]);
    expect(pages.length).toBeGreaterThan(0);
    // 各ページが QR ヘッダ形式に従う
    for (const page of pages) {
      expect(page).toMatch(/^RND_HM\s+#\S+\s+\d+\/\d+\n/);
    }
  });
});
