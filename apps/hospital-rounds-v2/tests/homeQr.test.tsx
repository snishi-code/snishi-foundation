// (d) HM QR ページ生成 (useQrFlow を実 store で。暗号化 transport 込み)
// 受信はカメラ読み取りのみ (テキスト貼り付け受信は 2026-06 に撤去済み)。
// 受信完了で確認なしに自動展開 (pendingImport ConfirmDialog は廃止)。
import './setup';
import { describe, expect, it, vi } from 'vitest';
import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderApp, seedBundle, type RenderedApp } from './helpers';

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
import { SECTION, getSection, projectBundle } from '../src/data/bundle';
import { encodePages, newBatchId } from '@snishi/foundation/qr/protocol';
import { packPayload } from '@snishi/foundation/qr/crypto';
import { APP_KEY_BYTES } from '../src/qr/appKey';
import { shouldEncryptQr } from '../src/qr/policy';
import { defaultSettings, makeDefaultPatient } from '../src/domain/normalize';
import type { RosterMeta } from '../src/domain/roster';

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

/** v5 managed の HM ページ列を生成する (aid/wid/wn と患者 rosterPatientId を引数化)。 */
async function buildManagedPages(opts: {
  aid?: string;
  wid?: string;
  wn?: string;
  patients: Array<{ name: string; room: string; rpid: string }>;
}): Promise<string[]> {
  const settings = defaultSettings();
  const patientObjs = opts.patients.map((p) => ({
    ...makeDefaultPatient(),
    name: p.name,
    room: p.room,
    rosterPatientId: p.rpid,
    rosterManaged: true,
  }));
  const rosterMeta: RosterMeta = {
    managed: true,
    localRole: 'authority',
    rosterAuthorityId: opts.aid ?? 'ra_remote',
    rosterWardId: opts.wid ?? 'rw_remote',
    wardName: opts.wn ?? '3階東',
    receivedAt: '',
    redistribution: 'prohibited',
  };
  let payload = encodePatientList(patientObjs, settings, { kind: 'HM', rosterMeta });
  payload = await packPayload(payload, {
    encrypt: shouldEncryptQr('HM'),
    compress: false,
    keyBytes: APP_KEY_BYTES,
  });
  return encodePages({ kind: 'HM', payload, batchId: newBatchId() });
}

/** v5 managed (正本メタ + 患者 rosterPatientId 付き) の HM ページ列を生成する (既存テスト用の固定値)。 */
function buildHmPagesManaged(): Promise<string[]> {
  return buildManagedPages({ patients: [{ name: '正本太郎', room: '301', rpid: 'rp_a' }] });
}

/** rosterPatientId で live 患者を引く (受信更新テスト用)。 */
function findByRpid(runtime: RenderedApp['runtime'], rpid: string) {
  return runtime.store.getAppState().patients.find((p) => p.rosterPatientId === rpid);
}

/** v4 (正本メタ無し) の HM ページ列を手組みで生成する (受信互換テスト用)。 */
async function buildHmPagesV4(): Promise<string[]> {
  let payload = JSON.stringify({ v: 4, td: ['内科'], p: [{ r: '401', n: 'v4太郎', t: [1] }] });
  payload = await packPayload(payload, {
    encrypt: shouldEncryptQr('HM'),
    compress: false,
    keyBytes: APP_KEY_BYTES,
  });
  return encodePages({ kind: 'HM', payload, batchId: newBatchId() });
}

/** ページ列をカメラ読み取りとして 1 枚ずつ注入する。 */
async function injectPages(pages: string[]): Promise<void> {
  for (const page of pages) {
    await act(async () => {
      scanMock.current?.(page);
      await Promise.resolve();
    });
  }
}

/** HM QR ダイアログを開き → カメラ受信入口を開き → ページ列を 1 枚ずつ注入する。 */
async function openAndScan(
  user: ReturnType<typeof userEvent.setup>,
  pages: string[],
): Promise<void> {
  await user.click(screen.getByRole('button', { name: 'ホームQR表示' }));
  await screen.findByText(/^\(1\/\d+\)$/);
  await user.click(screen.getByRole('button', { name: 'カメラで QR を読む' }));
  await waitFor(() => expect(scanMock.current).not.toBeNull());
  await injectPages(pages);
}

/**
 * 受信専用 (recipient) ダイアログから再スキャンする。recipient は QR ページを出さない
 * (= (1/n) 表記が無い) ので、ページ表示を待たずカメラ入口を直接開く。
 */
async function openRecipientScan(
  user: ReturnType<typeof userEvent.setup>,
  pages: string[],
): Promise<void> {
  await user.click(screen.getByRole('button', { name: 'ホームQR表示' }));
  await user.click(await screen.findByRole('button', { name: 'カメラで QR を読む' }));
  await waitFor(() => expect(scanMock.current).not.toBeNull());
  await injectPages(pages);
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

  it('正本側: HM QR を開く前に rosterAuthorityId / rosterWardId / rosterPatientId が保存される', async () => {
    const { runtime } = await renderApp({
      bundle: seedBundle([{ name: '正本太郎', room: '201' }]),
    });
    const user = userEvent.setup();
    // 開く前は unmanaged・正本 ID 未生成
    expect(runtime.store.getActiveRosterMeta().localRole).toBe('none');
    expect(runtime.store.storage.getRosterAuthorityId()).toBe('');

    await user.click(screen.getByRole('button', { name: 'ホームQR表示' }));
    await screen.findByText(/^\(1\/\d+\)$/);

    // active 病棟は authority に昇格し、正本 ID / 病棟 ID が確定する
    const meta = runtime.store.getActiveRosterMeta();
    expect(meta.localRole).toBe('authority');
    expect(meta.managed).toBe(true);
    expect(meta.redistribution).toBe('prohibited');
    expect(meta.rosterAuthorityId).not.toBe('');
    expect(meta.rosterAuthorityId).toBe(runtime.store.storage.getRosterAuthorityId());
    expect(meta.rosterWardId).toMatch(/^rw_/);
    // 実患者に rosterPatientId が発番され managed になる (ローカル pid とは別)
    const p = runtime.store.getAppState().patients.find((x) => x.name === '正本太郎')!;
    expect(p.rosterManaged).toBe(true);
    expect(p.rosterPatientId).toMatch(/^rp_/);
    expect(p.pid).not.toBe(p.rosterPatientId);
    // active bundle に永続化されている (保存してから QR を出す = fail-closed)
    const b = await runtime.store.storage.loadBundle(runtime.store.storage.getActiveWorkspaceId());
    expect(b?.rosterMeta.localRole).toBe('authority');
    expect(b?.rosterMeta.rosterAuthorityId).toBe(meta.rosterAuthorityId);
  });

  it('v5 HM 受信: managed recipient 病棟が作成され、旧病棟は破壊されない', async () => {
    const { runtime } = await renderApp({
      bundle: seedBundle([{ name: '既存患者', room: '101' }]),
    });
    const user = userEvent.setup();
    const oldWsId = runtime.store.storage.getActiveWorkspaceId();

    await openAndScan(user, await buildHmPagesManaged());

    await waitFor(() =>
      expect(runtime.store.getAppState().patients.some((p) => p.name === '正本太郎')).toBe(true),
    );

    // 受信病棟は managed recipient (payload の正本メタを復元)
    const meta = runtime.store.getActiveRosterMeta();
    expect(meta.localRole).toBe('recipient');
    expect(meta.managed).toBe(true);
    expect(meta.rosterAuthorityId).toBe('ra_remote');
    expect(meta.rosterWardId).toBe('rw_remote');
    expect(meta.wardName).toBe('3階東');
    expect(meta.receivedAt).not.toBe('');

    // 患者は新ローカル pid + 正本由来 rosterPatientId (混ぜない)
    const p = runtime.store.getAppState().patients.find((x) => x.name === '正本太郎')!;
    expect(p.rosterManaged).toBe(true);
    expect(p.rosterPatientId).toBe('rp_a');
    expect(p.pid).not.toBe('rp_a');

    // 別病棟へ切替・旧病棟は無傷
    const newWsId = runtime.store.storage.getActiveWorkspaceId();
    expect(newWsId).not.toBe(oldWsId);
    const oldBundle = await runtime.store.storage.loadBundle(oldWsId);
    const oldPatients = (getSection(oldBundle, SECTION.PATIENTS) as Array<{ name: string }>) ?? [];
    expect(oldPatients.some((p) => p.name === '既存患者')).toBe(true);
    expect(oldPatients.some((p) => p.name === '正本太郎')).toBe(false);
  });

  it('受信病棟: HM QR は再配布されない (ページ無し) が、受信導線は残る', async () => {
    const { runtime } = await renderApp({
      bundle: seedBundle([{ name: '既存患者', room: '101' }]),
    });
    const user = userEvent.setup();
    await openAndScan(user, await buildHmPagesManaged());
    await waitFor(() => expect(runtime.store.getActiveRosterMeta().localRole).toBe('recipient'));

    // ボタンは無効化しない (受信のため開ける)
    const showBtn = screen.getByRole('button', { name: 'ホームQR表示' });
    expect(showBtn).not.toBeDisabled();

    // 開いても QR ページは生成されない (再配布しない) が、カメラ受信入口と受信専用案内は出る
    await user.click(showBtn);
    expect(await screen.findByRole('button', { name: 'カメラで QR を読む' })).toBeInTheDocument();
    expect(screen.getByText(/受信専用です/)).toBeInTheDocument();
    expect(screen.queryByText(/^\(1\/\d+\)$/)).toBeNull(); // ページ表記が無い = QR を出していない
    // 開いただけで authority 化しない (誤って正本にならない)
    expect(runtime.store.getActiveRosterMeta().localRole).toBe('recipient');
  });

  it('受信病棟: 氏名・部屋番号が編集不可 (正本由来)', async () => {
    const { runtime, container } = await renderApp({
      bundle: seedBundle([{ name: '既存患者', room: '101' }]),
    });
    const user = userEvent.setup();
    await openAndScan(user, await buildHmPagesManaged());
    await waitFor(() => expect(runtime.store.getActiveRosterMeta().localRole).toBe('recipient'));

    // 患者詳細 → メタ編集ポップアップで氏名・部屋番号が編集不可
    await user.click(screen.getByRole('button', { name: '301 正本太郎' }));
    await user.click(screen.getByRole('button', { name: /正本太郎（タップして患者情報を編集）/ }));
    const roomInput = container.querySelector('[data-ui="patient.edit.room"]') as HTMLInputElement;
    const nameInput = container.querySelector('[data-ui="patient.edit.name"]') as HTMLInputElement;
    expect(roomInput).not.toBeNull();
    expect(roomInput.disabled).toBe(true);
    expect(nameInput.disabled).toBe(true);
    // 正本由来の値は表示されている
    expect(roomInput.value).toBe('301');
    expect(nameInput.value).toBe('正本太郎');
  });

  it('受信病棟: 患者管理の転棟・削除が出ず、注記が表示される', async () => {
    const { runtime } = await renderApp({
      bundle: seedBundle([{ name: '既存患者', room: '101' }]),
    });
    const user = userEvent.setup();
    await openAndScan(user, await buildHmPagesManaged());
    await waitFor(() => expect(runtime.store.getActiveRosterMeta().localRole).toBe('recipient'));

    await user.click(screen.getByRole('button', { name: '301 正本太郎' }));
    // 転棟・削除ボタンは出ない (受信した名簿の患者)
    expect(screen.queryByRole('button', { name: '転棟' })).toBeNull();
    expect(screen.queryByRole('button', { name: '削除' })).toBeNull();
    expect(
      screen.getByText('受信した名簿の患者です。転棟・削除は正本端末で行ってください'),
    ).toBeInTheDocument();
  });

  it('v4 HM 受信: 従来通り unmanaged 新規病棟として動く', async () => {
    const { runtime } = await renderApp({
      bundle: seedBundle([{ name: '既存患者', room: '101' }]),
    });
    const user = userEvent.setup();
    await openAndScan(user, await buildHmPagesV4());

    await waitFor(() =>
      expect(runtime.store.getAppState().patients.some((p) => p.name === 'v4太郎')).toBe(true),
    );
    // unmanaged (正本メタ無し)
    const meta = runtime.store.getActiveRosterMeta();
    expect(meta.localRole).toBe('none');
    expect(meta.managed).toBe(false);
    const p = runtime.store.getAppState().patients.find((x) => x.name === 'v4太郎')!;
    expect(p.rosterManaged).toBe(false);
    expect(p.rosterPatientId).toBe('');
  });

  it('v5 HM 再受信 (同じ aid/wid): 既存 recipient 病棟を更新し、新規病棟を増やさない', async () => {
    const { runtime } = await renderApp({
      bundle: seedBundle([{ name: '既存患者', room: '101' }]),
    });
    const user = userEvent.setup();
    // 初回受信 → recipient 病棟を作成して切替
    await openAndScan(user, await buildManagedPages({ patients: [{ name: '正本太郎', room: '301', rpid: 'rp_a' }] }));
    await waitFor(() => expect(runtime.store.getActiveRosterMeta().localRole).toBe('recipient'));
    const wsAfterFirst = runtime.store.storage.getActiveWorkspaceId();
    const countAfterFirst = (await runtime.store.storage.listBundles()).length;

    // 同じ aid/wid を再受信 (recipient ダイアログから・部屋番号を更新)
    await openRecipientScan(user, await buildManagedPages({ patients: [{ name: '正本太郎', room: '305', rpid: 'rp_a' }] }));
    await waitFor(() => expect(findByRpid(runtime, 'rp_a')?.room).toBe('305'));

    // 同じ病棟のまま (切替先 ID 不変)・病棟数は増えていない
    expect(runtime.store.storage.getActiveWorkspaceId()).toBe(wsAfterFirst);
    expect((await runtime.store.storage.listBundles()).length).toBe(countAfterFirst);
  });

  it('v5 HM 再受信: 同じ rosterPatientId は pid とローカル記録を保持し room/name だけ更新', async () => {
    const { runtime } = await renderApp({
      bundle: seedBundle([{ name: '既存患者', room: '101' }]),
    });
    const user = userEvent.setup();
    await openAndScan(user, await buildManagedPages({ patients: [{ name: '正本太郎', room: '301', rpid: 'rp_a' }] }));
    await waitFor(() => expect(findByRpid(runtime, 'rp_a')).toBeTruthy());

    // 受信側でローカル記録を付けて保存 (status / problems / freeText)
    const p1 = findByRpid(runtime, 'rp_a')!;
    const pidBefore = p1.pid;
    p1.status = 'yellow';
    p1.problems = ['#1 問題'];
    p1.freeText = 'メモ';
    await runtime.store.persistActiveOrThrow();

    // 再受信: 正本由来の room/name を更新
    await openRecipientScan(user, await buildManagedPages({ patients: [{ name: '正本太郎(改)', room: '305', rpid: 'rp_a' }] }));
    await waitFor(() => expect(findByRpid(runtime, 'rp_a')?.room).toBe('305'));

    const p2 = findByRpid(runtime, 'rp_a')!;
    expect(p2.pid).toBe(pidBefore); // pid 維持
    expect(p2.rosterPatientId).toBe('rp_a'); // rpid 維持
    expect(p2.rosterManaged).toBe(true);
    expect(p2.name).toBe('正本太郎(改)'); // 正本由来 name を更新
    expect(p2.room).toBe('305'); // 正本由来 room を更新
    // ローカル記録は保持
    expect(p2.status).toBe('yellow');
    expect(p2.problems).toEqual(['#1 問題']);
    expect(p2.freeText).toBe('メモ');
  });

  it('v5 HM 再受信: 新しい rosterPatientId の患者が追加される', async () => {
    const { runtime } = await renderApp({
      bundle: seedBundle([{ name: '既存患者', room: '101' }]),
    });
    const user = userEvent.setup();
    await openAndScan(user, await buildManagedPages({ patients: [{ name: '正本太郎', room: '301', rpid: 'rp_a' }] }));
    await waitFor(() => expect(findByRpid(runtime, 'rp_a')).toBeTruthy());

    await openRecipientScan(
      user,
      await buildManagedPages({
        patients: [
          { name: '正本太郎', room: '301', rpid: 'rp_a' },
          { name: '正本次郎', room: '302', rpid: 'rp_b' },
        ],
      }),
    );
    await waitFor(() => expect(findByRpid(runtime, 'rp_b')).toBeTruthy());

    const pb = findByRpid(runtime, 'rp_b')!;
    expect(pb.name).toBe('正本次郎');
    expect(pb.room).toBe('302');
    expect(pb.rosterManaged).toBe(true);
    expect(pb.pid).not.toBe('rp_b'); // ローカル pid は別発番
    // 既存 rp_a も維持されている
    expect(findByRpid(runtime, 'rp_a')?.name).toBe('正本太郎');
  });

  it('v5 HM 再受信: スナップショットから消えた managed 患者は削除されず未掲載として残る', async () => {
    const { runtime } = await renderApp({
      bundle: seedBundle([{ name: '既存患者', room: '101' }]),
    });
    const user = userEvent.setup();
    await openAndScan(
      user,
      await buildManagedPages({
        patients: [
          { name: '正本太郎', room: '301', rpid: 'rp_a' },
          { name: '正本次郎', room: '302', rpid: 'rp_b' },
        ],
      }),
    );
    await waitFor(() => expect(findByRpid(runtime, 'rp_b')).toBeTruthy());

    // 再受信: rp_b がスナップショットから消える
    await openRecipientScan(user, await buildManagedPages({ patients: [{ name: '正本太郎', room: '301', rpid: 'rp_a' }] }));
    await waitFor(() => expect(findByRpid(runtime, 'rp_b')?.status).toBe('blue'));

    const pb = findByRpid(runtime, 'rp_b')!;
    // 削除・転棟されず、未掲載フラグ (BLUE + 名簿未掲載 タグ) が付く
    expect(pb.deletedAt).toBe(0);
    expect(pb.transferredAt).toBe(0);
    expect(pb.status).toBe('blue');
    expect(pb.tags).toContain('名簿未掲載');
    // settings にも未掲載タグが追加される
    expect(runtime.store.getSettings().tags.some((tg) => tg.name === '名簿未掲載')).toBe(true);
    // 掲載されている rp_a は未掲載化されない
    expect(findByRpid(runtime, 'rp_a')?.status).not.toBe('blue');
  });

  it('v5 HM 再受信: 一度未掲載になった患者が再掲載されると未掲載タグが外れる', async () => {
    const { runtime } = await renderApp({
      bundle: seedBundle([{ name: '既存患者', room: '101' }]),
    });
    const user = userEvent.setup();
    const twoPatients = {
      patients: [
        { name: '正本太郎', room: '301', rpid: 'rp_a' },
        { name: '正本次郎', room: '302', rpid: 'rp_b' },
      ],
    };
    await openAndScan(user, await buildManagedPages(twoPatients));
    await waitFor(() => expect(findByRpid(runtime, 'rp_b')).toBeTruthy());

    // rp_b が消える → 未掲載化
    await openRecipientScan(user, await buildManagedPages({ patients: [{ name: '正本太郎', room: '301', rpid: 'rp_a' }] }));
    await waitFor(() => expect(findByRpid(runtime, 'rp_b')?.tags).toContain('名簿未掲載'));

    // rp_b が再掲載される → 未掲載タグが外れる (名簿に存在する患者に矛盾フラグを残さない)
    await openRecipientScan(user, await buildManagedPages(twoPatients));
    await waitFor(() => expect(findByRpid(runtime, 'rp_b')?.tags).not.toContain('名簿未掲載'));
    // 再掲載で room/name は正本値に戻り、患者は維持される
    expect(findByRpid(runtime, 'rp_b')?.name).toBe('正本次郎');
    expect(findByRpid(runtime, 'rp_b')?.room).toBe('302');
  });

  it('v5 HM 再受信: 既に転棟(移)済みの患者が消えても未掲載化せず転棟マーカーを保持する', async () => {
    const { runtime } = await renderApp({
      bundle: seedBundle([{ name: '既存患者', room: '101' }]),
    });
    const user = userEvent.setup();
    await openAndScan(
      user,
      await buildManagedPages({
        patients: [
          { name: '正本太郎', room: '301', rpid: 'rp_a' },
          { name: '正本次郎', room: '302', rpid: 'rp_b' },
        ],
      }),
    );
    await waitFor(() => expect(findByRpid(runtime, 'rp_b')).toBeTruthy());

    // rp_b を「転棟(移)済み」のローカル終端状態にする (transferredAt + GRAY マーカー) → 保存
    const pb1 = findByRpid(runtime, 'rp_b')!;
    pb1.transferredAt = 1_700_000_000_000;
    pb1.transferredTo = '別病棟';
    pb1.status = 'gray';
    await runtime.store.persistActiveOrThrow();

    // 再受信: rp_b がスナップショットから消える
    await openRecipientScan(user, await buildManagedPages({ patients: [{ name: '正本太郎', room: '301', rpid: 'rp_a' }] }));
    await waitFor(() => expect(findByRpid(runtime, 'rp_a')?.room).toBe('301'));

    const pb2 = findByRpid(runtime, 'rp_b')!;
    // 終端状態は触らない: 転棟マーカー保持・BLUE 化しない・未掲載タグを付けない
    expect(pb2.transferredAt).toBe(1_700_000_000_000);
    expect(pb2.status).toBe('gray');
    expect(pb2.tags).not.toContain('名簿未掲載');
  });

  it('v5 HM 受信: 病棟 ID (wid) が違えば別病棟として新規作成される', async () => {
    const { runtime } = await renderApp({
      bundle: seedBundle([{ name: '既存患者', room: '101' }]),
    });
    const user = userEvent.setup();
    await openAndScan(user, await buildManagedPages({ wid: 'rw_1', patients: [{ name: '正本太郎', room: '301', rpid: 'rp_a' }] }));
    await waitFor(() => expect(runtime.store.getActiveRosterMeta().rosterWardId).toBe('rw_1'));
    const ws1 = runtime.store.storage.getActiveWorkspaceId();
    const countAfterFirst = (await runtime.store.storage.listBundles()).length;

    // aid は同じ・wid が違う → 一致せず別病棟を新規作成
    await openRecipientScan(user, await buildManagedPages({ wid: 'rw_2', patients: [{ name: '別棟花子', room: '401', rpid: 'rp_x' }] }));
    await waitFor(() => expect(runtime.store.getActiveRosterMeta().rosterWardId).toBe('rw_2'));

    expect(runtime.store.storage.getActiveWorkspaceId()).not.toBe(ws1);
    expect((await runtime.store.storage.listBundles()).length).toBe(countAfterFirst + 1);
    expect(findByRpid(runtime, 'rp_x')?.name).toBe('別棟花子');
  });

  it('v5 HM 再受信: 同じ aid/wid の重複 recipient 病棟があっても active 病棟を優先更新する', async () => {
    const { runtime } = await renderApp({
      bundle: seedBundle([{ name: '既存患者', room: '101' }]),
    });
    const user = userEvent.setup();
    const storage = runtime.store.storage;

    // legacy 重複病棟 R2 を「非一致 wid」で先に作る (id が後の R1 より先に並び、最初の受信では
    // 一致しないので消費されない)。これで「id 順は R2 が先・しかし active は R1」を作り出す。
    const mkRecipientBundle = (wid: string, room: string) =>
      projectBundle({
        appState: {
          v: 3,
          title: '重複',
          patients: [{ ...makeDefaultPatient(), name: '旧太郎', room, rosterPatientId: 'rp_a', rosterManaged: true }],
        },
        settings: defaultSettings(),
        rosterMeta: {
          managed: true,
          localRole: 'recipient',
          rosterAuthorityId: 'ra_remote',
          rosterWardId: wid,
          wardName: '3階東',
          redistribution: 'prohibited',
          receivedAt: '2020-01-01T00:00:00.000Z',
        },
        sections: [SECTION.META, SECTION.PATIENTS],
      });
    const r2Id = await storage.createWorkspaceRecord('重複病棟', mkRecipientBundle('rw_OTHER', '999'));

    // 受信 → R2 は wid 不一致で消費されず、新規 recipient R1 が作られ active になる
    await openAndScan(user, await buildManagedPages({ wid: 'rw_x', patients: [{ name: '正本太郎', room: '301', rpid: 'rp_a' }] }));
    await waitFor(() => expect(runtime.store.getActiveRosterMeta().rosterWardId).toBe('rw_x'));
    const r1Id = storage.getActiveWorkspaceId();
    expect(r1Id).not.toBe(r2Id);

    // R2 を active と同じ wid (rw_x) へ書き換える = legacy 重複が active と同一 aid/wid を持つ状態
    await storage.saveBundle(mkRecipientBundle('rw_x', '999'), r2Id);

    // 再受信 → id 順で先の R2 ではなく active(R1) を更新し、active から離れない
    await openRecipientScan(user, await buildManagedPages({ wid: 'rw_x', patients: [{ name: '正本太郎', room: '305', rpid: 'rp_a' }] }));
    await waitFor(() => expect(findByRpid(runtime, 'rp_a')?.room).toBe('305'));

    expect(storage.getActiveWorkspaceId()).toBe(r1Id);
    // 重複 R2 は触られていない (room 999 のまま)
    const r2After = await storage.loadBundle(r2Id);
    const r2Patients = (getSection(r2After, SECTION.PATIENTS) as Array<{ room: string }>) ?? [];
    expect(r2Patients.some((p) => p.room === '999')).toBe(true);
    expect(r2Patients.some((p) => p.room === '305')).toBe(false);
  });

  it('受信専用 recipient ダイアログからも再スキャンして既存病棟を更新できる', async () => {
    const { runtime } = await renderApp({
      bundle: seedBundle([{ name: '既存患者', room: '101' }]),
    });
    const user = userEvent.setup();
    await openAndScan(user, await buildManagedPages({ patients: [{ name: '正本太郎', room: '301', rpid: 'rp_a' }] }));
    await waitFor(() => expect(runtime.store.getActiveRosterMeta().localRole).toBe('recipient'));
    const ws = runtime.store.storage.getActiveWorkspaceId();

    // 受信専用ダイアログ: QR ページは無く受信専用案内とカメラ入口が出る
    await user.click(screen.getByRole('button', { name: 'ホームQR表示' }));
    expect(await screen.findByRole('button', { name: 'カメラで QR を読む' })).toBeInTheDocument();
    expect(screen.getByText(/受信専用です/)).toBeInTheDocument();
    expect(screen.queryByText(/^\(1\/\d+\)$/)).toBeNull();

    // そのダイアログのカメラから再受信 → 同じ病棟が更新される (新規病棟を作らない)
    await user.click(screen.getByRole('button', { name: 'カメラで QR を読む' }));
    await waitFor(() => expect(scanMock.current).not.toBeNull());
    await injectPages(await buildManagedPages({ patients: [{ name: '正本太郎', room: '305', rpid: 'rp_a' }] }));
    await waitFor(() => expect(findByRpid(runtime, 'rp_a')?.room).toBe('305'));
    expect(runtime.store.storage.getActiveWorkspaceId()).toBe(ws);
  });
});
