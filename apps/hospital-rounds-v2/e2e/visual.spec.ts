/*
 * visual check（仕様§19）: mobile/tablet/desktop の 3 サイズで主要画面を撮影し、
 * 横スクロール（レイアウト破綻の代表症状）が無いことを機械検証する。
 * スクリーンショットは test-results/screenshots/ 配下に保存する。
 */
import { test, expect, type Page } from '@playwright/test';

const ui = (name: string) => `[data-ui="${name}"]`;

const VIEWPORTS = [
  { name: 'mobile-390x844', width: 390, height: 844 },
  { name: 'tablet-820x1180', width: 820, height: 1180 },
  { name: 'desktop-1280x800', width: 1280, height: 800 },
] as const;

async function expectNoHorizontalScroll(page: Page, label: string) {
  const overflow = await page.evaluate(() => {
    const el = document.scrollingElement ?? document.documentElement;
    return el.scrollWidth - el.clientWidth;
  });
  expect(overflow, `${label}: 横スクロールが発生 (${overflow}px)`).toBeLessThanOrEqual(1);
}

for (const vp of VIEWPORTS) {
  test(`主要画面のレイアウト確認 (${vp.name})`, async ({ page }) => {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await page.goto('./');
    await expect(page.locator(ui('home.grid'))).toBeVisible({ timeout: 15_000 });

    // 患者を 1 人登録（データのある画面で確認する）
    await page.locator(ui('home.addPatient')).click();
    const popup = page.locator(ui('patient.edit.popup'));
    await expect(popup).toBeVisible();
    await page.locator(ui('patient.edit.name')).fill('視覚確認');
    await popup.getByRole('button', { name: '閉じる' }).click();
    await expect(popup).toBeHidden();

    await expectNoHorizontalScroll(page, `home ${vp.name}`);
    await page.screenshot({
      path: `test-results/screenshots/hr-home-${vp.name}.png`,
      fullPage: true,
    });

    // 詳細画面
    await page.locator(ui('patient.card')).filter({ hasText: '視覚確認' }).click();
    await expect(page.locator(ui('detail.meta'))).toBeVisible();
    await expectNoHorizontalScroll(page, `detail ${vp.name}`);
    await page.screenshot({
      path: `test-results/screenshots/hr-detail-${vp.name}.png`,
      fullPage: true,
    });

    // 設定
    await page.locator(ui('nav.settings')).click();
    await expect(page.locator(ui('settings.view'))).toBeVisible();
    await expectNoHorizontalScroll(page, `settings ${vp.name}`);
    await page.screenshot({
      path: `test-results/screenshots/hr-settings-${vp.name}.png`,
      fullPage: true,
    });
  });
}
