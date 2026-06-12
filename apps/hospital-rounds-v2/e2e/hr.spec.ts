/*
 * hospital-rounds-v2 コアフロー E2E（chromium / 本番ビルド preview）。
 * v1 e2e（app-history.spec / inline-edit.spec / smoke.spec）の核心ケースを
 * data-ui（src/ui-contract.ts）ベースで移植。各テストはまっさらな context で走る。
 */
import { test, expect, type Page } from '@playwright/test';

const ui = (name: string) => `[data-ui="${name}"]`;

async function boot(page: Page) {
  await page.goto('./');
  await expect(page.locator(ui('home.grid'))).toBeVisible({ timeout: 15_000 });
  await expect(page.locator(ui('home.start'))).toBeVisible();
}

/** 末尾スロットへ患者を追加して名前を入れ、編集ポップアップを閉じる。 */
async function addPatient(page: Page, name: string) {
  await page.locator(ui('home.addPatient')).click();
  const popup = page.locator(ui('patient.edit.popup'));
  await expect(popup).toBeVisible();
  await page.locator(ui('patient.edit.name')).fill(name);
  await popup.getByRole('button', { name: '閉じる' }).click();
  await expect(popup).toBeHidden();
  await expect(page.locator(ui('patient.card')).filter({ hasText: name })).toBeVisible();
}

/** name の患者カードを開いて詳細画面へ。 */
async function openPatient(page: Page, name: string) {
  await page.locator(ui('patient.card')).filter({ hasText: name }).click();
  await expect(page.locator(ui('detail.meta'))).toBeVisible();
}

async function openSettings(page: Page) {
  await page.locator(ui('nav.menu')).click();
  await page.locator(ui('nav.menu.settings')).click();
  await expect(page.locator(ui('settings.view'))).toBeVisible();
}

test('起動 → home が表示され、患者登録 → 詳細画面が開く', async ({ page }) => {
  await boot(page);
  await addPatient(page, 'テスト患者');
  await openPatient(page, 'テスト患者');
  // 詳細画面: 展開フォーマットカード（値セル）と undo ボタンが出る
  await expect(page.locator(ui('format.cell')).first()).toBeVisible();
  await expect(page.locator(ui('undo.btn'))).toBeVisible();
});

test('inline 編集中の Back は「編集解除のみ」で view は detail に留まる（v1 app-history 核心）', async ({
  page,
}) => {
  await boot(page);
  await addPatient(page, '患者A');
  await openPatient(page, '患者A');
  // 値セルをタップ → inline 編集開始
  await page.locator(ui('format.cell')).first().click();
  await expect(page.locator(ui('format.cell.input')).first()).toBeVisible();
  // ブラウザ Back → 編集解除のみ（detail に留まる）
  await page.goBack();
  await expect(page.locator(ui('format.cell.input'))).toHaveCount(0);
  await expect(page.locator(ui('detail.meta'))).toBeVisible();
  await expect(page.locator(ui('home.grid'))).toHaveCount(0);
  // もう一度 Back → 今度は home へ戻る
  await page.goBack();
  await expect(page.locator(ui('home.grid'))).toBeVisible();
});

test('フォーマット入力が反映され、undo で戻る', async ({ page }) => {
  await boot(page);
  await addPatient(page, '患者B');
  await openPatient(page, '患者B');
  // 最初の値セル（S パネルの text item）へ入力（write-through 自動保存）
  const firstCell = page.locator(ui('format.cell')).first();
  await firstCell.click();
  await page.locator(ui('format.cell.input')).first().fill('5');
  // Back で編集終了（値は input ごとに保存済み）
  await page.goBack();
  await expect(page.locator(ui('format.cell.input'))).toHaveCount(0);
  await expect(firstCell).toContainText('5');
  // undo → 入力前へ戻る
  await page.locator(ui('undo.btn')).click();
  await expect(page.locator(ui('toast'))).toBeVisible();
  await expect(firstCell).not.toContainText('5');
});

test('home の HM QR: ポップアップで canvas とページ表記 (n/m) が出て、Back で QR だけ閉じる', async ({
  page,
}) => {
  await boot(page);
  await addPatient(page, 'QR患者');
  await page.locator(ui('qr.show')).click();
  // QR はポップアップ (qr.dialog) として開く
  const dialog = page.locator(ui('qr.dialog'));
  await expect(dialog).toBeVisible();
  const card = page.locator(ui('qr.card'));
  await expect(card).toBeVisible();
  await expect(card.locator(ui('qr.canvas'))).toBeVisible({ timeout: 10_000 });
  await expect(card.locator(ui('qr.pageMeta'))).toHaveText(/\(\d+\/\d+\)/, { timeout: 10_000 });
  // Back → QR だけ閉じて home に留まる (終了確認に流れない)
  await page.goBack();
  await expect(dialog).toBeHidden();
  await expect(page.locator(ui('home.grid'))).toBeVisible();
});

test('患者詳細: 下までスクロールしても下部固定バーの前/次・QR が見えて操作できる', async ({
  page,
}) => {
  await boot(page);
  await addPatient(page, 'バー患者');
  await openPatient(page, 'バー患者');
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await expect(page.locator(ui('detail.actionBar'))).toBeInViewport();
  await expect(page.locator(ui('detail.qr.show'))).toBeInViewport();
  await expect(page.locator(ui('undo.btn'))).toBeInViewport();
  // バーの QR ボタンから患者 QR が開く
  await page.locator(ui('detail.qr.show')).click();
  await expect(page.locator(ui('detail.qr.dialog'))).toBeVisible();
});

test('プロブレムリスト: #1 へ入力し、QR プレビューの先頭に #1 が出る', async ({ page }) => {
  await boot(page);
  await addPatient(page, 'PL患者');
  await openPatient(page, 'PL患者');
  await page.locator(ui('problem.input')).first().fill('HF');
  await page.locator(ui('problem.add')).click();
  await expect(page.locator(ui('problem.input'))).toHaveCount(2);
  // 患者 QR の本文プレビューにプロブレムが #1 付きで先頭に出る
  await page.locator(ui('detail.qr.show')).click();
  const dialog = page.locator(ui('detail.qr.dialog'));
  await expect(dialog).toBeVisible();
  await dialog.locator('summary').click();
  await expect(dialog.locator('.qrTextPreview')).toContainText('#1 HF');
});

test('detail の電子カルテ転記 QR: 平文ペイロードのまま表示される（暗号化されない）', async ({
  page,
}) => {
  // DetailQrDialog は qr/crypto を import せず buildTabPayload の平文を drawQrToCanvas へ
  // 直接渡す（静的契約）。ここではダイアログ内のペイロードプレビューに入力した臨床値が
  // 平文のまま現れることを確認する。
  await boot(page);
  await addPatient(page, '転記患者');
  await openPatient(page, '転記患者');
  // 値を 1 つ入力（write-through）
  await page.locator(ui('format.cell')).first().click();
  await page.locator(ui('format.cell.input')).first().fill('37');
  await page.goBack();
  await expect(page.locator(ui('format.cell.input'))).toHaveCount(0);
  // QR ダイアログ → canvas 出現 + プレビューに平文値
  await page.locator(ui('detail.qr.show')).click();
  const dialog = page.locator(ui('detail.qr.dialog'));
  await expect(dialog).toBeVisible();
  await expect(dialog.locator(ui('qr.canvas'))).toBeVisible({ timeout: 10_000 });
  await dialog.locator('summary').click();
  await expect(dialog.locator('.qrTextPreview')).toContainText('37');
});

test('設定 → フォーマット作成 → 一覧に出る', async ({ page }) => {
  await boot(page);
  await openSettings(page);
  await page.locator(ui('settings.formats.add')).first().click();
  const dialog = page.locator(ui('settings.formats.editDialog'));
  await expect(dialog).toBeVisible();
  await page.locator(ui('settings.formats.editName')).fill('E2Eフォーマット');
  await page.locator(ui('settings.formats.editAddItem')).click();
  await dialog.locator('input.formatEditItemLabel').last().fill('項目1');
  await page.locator(ui('settings.formats.editSave')).click();
  await expect(dialog).toBeHidden();
  await expect(
    page.locator(ui('settings.formats.row')).filter({ hasText: 'E2Eフォーマット' }),
  ).toBeVisible();
});
