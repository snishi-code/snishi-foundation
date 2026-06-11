# foundation で新アプリを作る手順書

このドキュメントはエージェントおよび開発者向け。`@snishi/foundation` を使って新しい PWA アプリを `apps/` に追加する手順を定義する。

---

## 1. apps/ 雛形の作成

```sh
mkdir -p apps/<my-app>/src/{domain,data,qr,ui} apps/<my-app>/public apps/<my-app>/tests
```

`apps/<my-app>/package.json` を作成(exact バージョンを維持):

```json
{
  "name": "<my-app>",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "license": "Apache-2.0",
  "dependencies": {
    "@snishi/foundation": "*",
    "react": "19.2.7",
    "react-dom": "19.2.7"
  },
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview",
    "test": "vitest run"
  }
}
```

---

## 2. 識別子の constants.ts 集約

`src/data/constants.ts` に永続化識別子を **全て一箇所に集約** する。コードに文字列リテラルで散らさない。

必須項目:
```ts
/** IndexedDB 名 */
export const DB_NAME = '<my-app>' as const;
export const DB_VERSION = 1 as const;

/** export/import 封筒 appId(他アプリと衝突しない一意名) */
export const APP_ID = 'snishi-code.<my-app>' as const;

/** スキーマ版。v2 新規アプリは 1 から開始。互換破壊変更ごとに +1 */
export const SCHEMA_VERSION = 1 as const;

/** localStorage ポインタ prefix。他アプリと衝突しない一意 prefix */
export const LOCAL_PREFIX = '<prefix>.' as const;

/** SW キャッシュ名 prefix */
export const CACHE_NAME_PREFIX = '<my-app>-' as const;
```

スナップショット・eventlog を使う場合:
```ts
export const SNAPSHOT_DB_NAME = '<my-app>-snapshots';
export const EVENTLOG_DB_NAME = '<my-app>-eventlog';
```

---

## 3. CSP head テンプレートの配置

`index.html` に以下の `<head>` を使う(既存アプリからコピーして title のみ変更):

```html
<meta
  http-equiv="Content-Security-Policy"
  content="default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; media-src 'self' blob:; worker-src 'self'; manifest-src 'self'; frame-src 'self'; child-src 'self'; form-action 'self'; base-uri 'self'; object-src 'none'"
/>
<script>
  (function () {
    var host = location.hostname;
    var isTest =
      /(^|[.-])dev\./.test(host) ||
      /\.pages\.dev$/.test(host) ||
      host === 'localhost' ||
      host === '127.0.0.1' ||
      /\.local$/.test(host);
    document.documentElement.dataset.env = isTest ? 'test' : 'prod';
  })();
</script>
```

`connect-src 'self'` は外部送信ゼロ方針の実行時防壁。絶対に変更しない。

---

## 4. SW テンプレートの複製

`packages/foundation/src/pwa/sw.template.js` を `public/sw.js` にコピーし、プレースホルダを置換する:

1. `__CACHE_NAME__` → `<my-app>-1`(キャッシュを捨てる時に末尾の数字を上げる)
2. `__PRECACHE_PATHS__` → `[]`(追加 precache がなければ空配列)

置換以外は編集しない。`skipWaiting` / `clients.claim` / `registration.update` / 自動更新プロンプトは追加しない(凍結ポリシー)。

`main.tsx` または `App.tsx` で:
```ts
import { useServiceWorker } from '@snishi/foundation/pwa/useServiceWorker';
// アプリのルートコンポーネント内で:
useServiceWorker('./sw.js');
```

---

## 5. --primary カラーの注入

`packages/foundation/src/ui/tokens.css` の `--primary` を上書きする CSS ファイルをアプリに作成する:

```css
/* apps/<my-app>/src/ui/app-theme.css */
:root {
  --primary: #<アプリカテゴリ色>;
}
```

カテゴリ色: 医療=`#2563eb` / 個人=`#14b8a6` / 新規は apex CLAUDE.md の設計方針に従う。

---

## 6. ui-contract.ts の作成

テスト安定名を一箇所に定義する:

```ts
// src/ui-contract.ts
import { uiAttr } from '@snishi/foundation/ui/contract';

export const UI = {
  // 例: journal.entry.save → <button data-ui="journal.entry.save">
  nav: {
    menu: uiAttr('nav.menu.button'),
  },
  // ...
} as const;
```

---

## 7. 必須テストの作成

最低限:
- `tests/setup.ts`: fake-indexeddb のリセット
- ドメインロジックのユニットテスト(pure function)
- storage/repository の CRUD テスト(fake-indexeddb 使用)
- UI スモークテスト: アプリが起動することを確認

---

## 8. no-exfil の確認

コード追加のたびに:
```sh
npm run no-exfil
```

`fetch` 等を追加する場合は `// network-ok: <理由>` を同じ行に付けて承認する。外部オリジンへの通信は承認不可。

---

## チェックリスト

- [ ] `constants.ts` に全識別子を集約した
- [ ] DB 名 / localStorage prefix が既存アプリと衝突しない
- [ ] `index.html` に CSP `connect-src 'self'` がある
- [ ] SW テンプレートを複製し、skipWaiting を入れていない
- [ ] `useServiceWorker` を配線した
- [ ] `npm run no-exfil` が clean を返す
- [ ] `npm run typecheck` が通る
- [ ] `npm test` が通る
- [ ] `ui-contract.ts` を作成した
