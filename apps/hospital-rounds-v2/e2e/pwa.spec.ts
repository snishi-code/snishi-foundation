/*
 * PWA E2E（凍結 SW ポリシー版）。本番ビルド（preview）に対して:
 *  - manifest が installable な内容で読める
 *  - SW が登録・activate される（claim を呼ばないため初回ページは非制御 → リロード後に制御）
 *  - オフラインでも app shell が起動する（cache-first の検証）
 */
import { test, expect, type Page } from '@playwright/test';

const ui = (name: string) => `[data-ui="${name}"]`;

// index.html の env 判定は localhost を 'test' に倒す(本番限定の副作用を誤って有効化しない
// fail-safe)。SW の実挙動を localhost preview で検証するため、e2e では data-env を 'prod' へ
// 強制する(head の判定スクリプトが 'test' を書いた直後に observer が 'prod' へ戻す)。
async function forceProdEnv(page: Page) {
  await page.addInitScript(() => {
    // init script 実行時点では documentElement が未生成 → 生成を待って attribute を監視する
    const attach = (root: HTMLElement) => {
      if (root.dataset.env !== 'prod') root.dataset.env = 'prod';
      new MutationObserver(() => {
        if (root.dataset.env !== 'prod') root.dataset.env = 'prod';
      }).observe(root, { attributes: true, attributeFilter: ['data-env'] });
    };
    if (document.documentElement) {
      attach(document.documentElement);
    } else {
      const boot = new MutationObserver(() => {
        if (!document.documentElement) return;
        boot.disconnect();
        attach(document.documentElement);
      });
      boot.observe(document, { childList: true });
    }
  });
}

test('manifest が installable な内容で読める', async ({ page }) => {
  await page.goto('./');
  const href = await page.locator('link[rel="manifest"]').getAttribute('href');
  expect(href).toBeTruthy();
  const res = await page.request.get(new URL(href!, page.url()).toString());
  expect(res.ok()).toBeTruthy();
  const m = await res.json();
  expect(m.name).toBeTruthy();
  expect(m.start_url).toBeTruthy();
  expect(m.display).toBe('standalone');
  const sizes = (m.icons as { sizes: string }[]).map((i) => i.sizes);
  expect(sizes).toContain('192x192');
  expect(sizes).toContain('512x512');
});

test('SW が登録・activate される（凍結ポリシー: 初回ページは claim されない）', async ({
  page,
}) => {
  await forceProdEnv(page);
  await page.goto('./');
  const active = await page.evaluate(async () => {
    const reg = await navigator.serviceWorker.ready;
    return !!reg.active;
  });
  expect(active).toBe(true);
  const firstLoadControlled = await page.evaluate(() => navigator.serviceWorker.controller !== null);
  expect(firstLoadControlled).toBe(false);
  await page.reload();
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null, null, {
    timeout: 10_000,
  });
});

test('オフラインでも app shell が起動する（凍結 SW の cache-first）', async ({ page, context }) => {
  await forceProdEnv(page);
  await page.goto('./');
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.reload();
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null, null, {
    timeout: 10_000,
  });
  await expect(page.locator(ui('home.grid'))).toBeVisible({ timeout: 15_000 });
  // 制御下ロードでランタイムキャッシュ（assets）が埋まるまで待つ
  await page.waitForFunction(
    async () => {
      const keys = await caches.keys();
      for (const k of keys) {
        const reqs = await (await caches.open(k)).keys();
        if (reqs.some((r) => r.url.includes('/assets/'))) return true;
      }
      return false;
    },
    null,
    { timeout: 10_000 },
  );
  await context.setOffline(true);
  try {
    await page.reload();
    await expect(page.locator(ui('home.grid'))).toBeVisible({ timeout: 15_000 });
  } finally {
    await context.setOffline(false);
  }
});
