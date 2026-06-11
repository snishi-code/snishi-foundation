# デプロイ手順

**v2 は現時点で配信しない前提**。このドキュメントは人間が後で実施するための手順書。実施前に `docs/questions.md` の「Recommended before deploy」をすべて解決すること。

---

## origin 選定(§6 推奨)

v2 は v1 と storage / SW scope を分離するため、**アプリ別 origin が推奨**。同一 origin に同居させると IDB 名・localStorage prefix の分離は維持されるが、SW scope の分離が困難になる。

推奨 origin 例:

| アプリ | 本番 origin | テスト origin |
|---|---|---|
| hospital-rounds-v2 | `hrv2.snishi-code.com`(未確定) | `hrv2-dev.snishi-code.com` |
| simple-ledger-v2 | `slv2.snishi-code.com`(未確定) | `slv2-dev.snishi-code.com` |

origin は `docs/questions.md` の「Recommended before deploy」として人間判断を要する。特定 origin を コードに直書きしない(env 判定は hostname 規約で行う)。

---

## Cloudflare Pages 設定

1. **リポジトリ接続**: GitHub リポを Cloudflare Pages に接続する。
2. **ビルド設定(アプリごとに設定)**:
   - ビルドコマンド: `npm run build -w apps/hospital-rounds-v2`(または simple-ledger-v2)
   - 出力ディレクトリ: `apps/hospital-rounds-v2/dist`
3. **カスタムドメイン**: 選定した origin を設定する。
4. **`_headers` ファイル**: `apps/*/public/_headers` に CSP / Permissions-Policy を配置する(オプション)。meta タグの CSP はサービスワーカー内リクエストをカバーしないため、サーバーサイドの `Content-Security-Policy` ヘッダーも設定することを推奨する。
5. **`_redirects` ファイル**: SPA の `404 → index.html` リダイレクト。変更不可(`/*  /index.html  200`)。

`dist/` はコミットしない(Cloudflare Pages がビルドする)。

---

## index.html テンプレ(manifest/data-env 切替)

`index.html` の `<script>` ブロックが env を判定する。変更不要(ホスト名規約で自動判定):

```js
var isTest =
  /(^|[.-])dev\./.test(host) ||
  /\.pages\.dev$/.test(host) ||
  host === 'localhost' ||
  host === '127.0.0.1' ||
  /\.local$/.test(host);
document.documentElement.dataset.env = isTest ? 'test' : 'prod';
```

`data-env='prod'` の時だけ SW が登録される(`pwa/useServiceWorker.ts`)。テスト origin(`.pages.dev`)では SW は動作しない。

---

## PWA リソースの整備状況(2026-06-11 検証時点)

両アプリとも PWA リソースは作成済みで、追加作業なしで配備できる:

| リソース | hospital-rounds-v2 | simple-ledger-v2 |
|---|---|---|
| `public/manifest.json` | あり(name/start_url/scope/display/icons) | あり |
| `public/icons/` | icon-192 / icon-512 / apple-touch-icon | icon-192 / icon-512 / icon.svg |
| `public/sw.js`(凍結 SW) | あり | あり |

installability(manifest 内容・192/512 アイコン・standalone)は Playwright e2e(`apps/*/e2e/pwa.spec.ts`)で検証済み。ただしアイコン画像は v1 とバイト同一のため、視覚差別化は未解決(`docs/questions.md` Q4)。

---

## v1 併存確認チェック(同一 origin に v1 を残す場合)

v2 を v1 と同一 origin に配備する場合、以下を確認する。

### ストレージ分離の確認

ブラウザの DevTools → Application → Storage で確認:

```
IndexedDB:
  hospital-rounds     ← v1 のまま
  hospital-rounds-v2  ← v2 が作成(分離されている)

localStorage:
  hospital_rounds_*   ← v1 のまま
  hrv2.*              ← v2 が作成(分離されている)
```

### SW scope 分離の確認

v1 と v2 を別パスに配備した場合(例: `/hospital-rounds/` vs `/hospital-rounds-v2/`)、Service Worker のスコープが重複しないことを確認する。

DevTools → Application → Service Workers で:
- v1 の SW scope: `/hospital-rounds/`
- v2 の SW scope: `/hospital-rounds-v2/`

これらが重複しないこと。重複すると SW の制御ページが意図せず切り替わる。

**推奨**: 上記リスクを避けるためアプリ別 origin を使う。

### v2 が v1 データを読まないことの確認

v2 を起動して、v1 の IDB / localStorage が変更されていないことを DevTools で確認する。定量チェックは `docs/audit-checklist.md` 参照。
