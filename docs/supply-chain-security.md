# 供給網セキュリティ(§15)

## 方針

依存追加ゼロを原則とする(供給網最小化)。foundation 候補として検討した `idb`(IndexedDB ラッパー)・`react-hook-form` 等も不採用。自前実装で対応した。

---

## runtime 依存(exact 固定)

| パッケージ | バージョン | ライセンス | 役割 | exact 固定の理由 |
|---|---|---|---|---|
| `react` | `19.2.7` | MIT | UI フレームワーク | パッチでも破壊的変更が混入しうる。依存間の一致も保証 |
| `react-dom` | `19.2.7` | MIT | React DOM レンダラ | react と版数を合わせる必要がある |
| `zod` | `4.4.3` | MIT | スキーマ検証 | zod4 は API 面で大きな変更があった。意図しない upgrade を防ぐ |
| `jsqr` | `1.4.0` | MIT | QR 解析(カメラ入力) | 画像解析ライブラリ。version 変更で decode 挙動が変わる可能性 |

上記 4 パッケージはいずれも `postInstall` スクリプトを持たない(確認済み)。

`@snishi/foundation` 自体は private パッケージ(npm registry に公開しない)。アプリからは npm workspaces の `"*"` 解決で参照する。

---

## vendor バンドル

`packages/foundation/src/qr/vendor/` に直接バンドルしたライブラリ:

| ファイル | 由来 | ライセンス | バージョン |
|---|---|---|---|
| `qrcodegen.js` | [Project Nayuki QR Code generator v1.7.0](https://github.com/nayuki/QR-Code-generator/releases/tag/v1.7.0) | MIT | v1.7.0 |
| `qrcodegen.d.ts` | 同上の型定義 | MIT | — |

外部 CDN ではなくリポジトリにコピーして使う。ライセンス表記をファイル先頭に保持する。

Lucide アイコン(`packages/foundation/src/ui/icons.ts`)は必要なパス定義のみ手動でコピーして使い、npm パッケージとしての依存は持たない。ISC ライセンス表記をファイル先頭に保持する。

---

## devDependencies 一覧

| パッケージ | 用途 |
|---|---|
| `typescript ^6.0.3` | strict 型チェック |
| `vite ^8.0.16` | バンドラ |
| `vitest ^4.1.8` | ユニットテスト |
| `@vitejs/plugin-react ^6.0.2` | Vite の React 変換プラグイン |
| `@types/react ^19.2.17` / `@types/react-dom ^19.2.3` | React 型定義 |
| `@types/node ^25.9.3` | Node.js 型定義(vite config 等) |
| `eslint ^10.4.1` / `@eslint/js ^10.0.1` / `typescript-eslint ^8.61.0` | Lint |
| `eslint-plugin-react-hooks ^7.1.1` | hooks ルール |
| `prettier ^3.8.4` | フォーマッタ |
| `@testing-library/react ^16.3.2` / `@testing-library/jest-dom ^6.9.1` / `@testing-library/user-event ^14.6.1` | コンポーネントテスト |
| `fake-indexeddb ^6.2.5` | テスト用 IDB モック |
| `jsdom ^29.1.1` | テスト用 DOM 環境 |
| `globals ^17.6.0` | ESLint 用グローバル定義 |
| `@playwright/test ^1.60.0` | E2E テスト(現時点未実施) |

---

## lockfile 方針

- `package-lock.json` をコミットする(意図しない依存変更を検出するため)。
- runtime deps は exact 固定(`"react": "19.2.7"` ではなく `"react": "19.2.7"`。`^` や `~` を付けない)。devDeps は semver range を許容する。

---

## 未確認事項

以下は現時点で実施・設定していない。本番配信前に実施することを推奨する(`docs/questions.md` の「Recommended before deploy」も参照)。

- **npm audit 定期実行**: 脆弱性スキャンの定期実行スケジュールを設定していない。
- **GitHub Actions**: CI パイプライン(型チェック・lint・no-exfil・テスト)の自動実行を設定していない。
- **branch protection**: main ブランチの保護(PR 必須・レビュー承認・status check 必須)を設定していない。既存メモに「main 保護未設定が既知課題」と記録済み。
- **2FA**: リポジトリへのアクセス権を持つアカウントへの二要素認証の確認を行っていない。
- **secret rotation**: GitHub の secret / Cloudflare API token 等のローテーション計画を策定していない。

---

## 依存追加手順(新規追加が必要になった場合)

1. runtime dep を追加する正当性を確認する(自前実装の可否、ライセンス、postInstall スクリプトの有無、外部送信の有無)。
2. exact バージョンで追加する(`npm install --save-exact <pkg>@<version>`)。
3. `npm run no-exfil` を実行して外部送信が混入していないことを確認する。
4. `package-lock.json` をコミットに含める。
5. このファイルの runtime 依存一覧を更新する。
