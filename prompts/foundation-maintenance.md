# foundation 変更時の手順書

このドキュメントはエージェントおよび開発者向け。`packages/foundation/` を変更する際の不変条件と手順を定義する。

---

## 原則

- foundation の変更は **両アプリ(HR-v2 + SL-v2)に影響する**。変更後は必ず両アプリのテストを確認する。
- foundation に鍵・アプリ固有の識別子・ドメイン知識を入れない。アプリから注入する設計を維持する。
- wire format の正本は `qr/protocol.ts`(transport 層)と アプリの `qr/wire.ts`(ドメイン層)。foundation は transport 層のみ持つ。

---

## 1. 両アプリのテスト確認

foundation を変更したら必ず:

```sh
npm test
```

3 パッケージすべて(foundation / hospital-rounds-v2 / simple-ledger-v2)が pass することを確認する。

型チェックも実施:
```sh
npm run typecheck
```

---

## 2. wire format bump ルール

`qr/protocol.ts` の transport 層(ページヘッダー書式・MAX_BYTES・HEADER_BUDGET)を変更する場合:

**bump 必須の変更**:
- ヘッダー書式(`RND_<KIND> #<batchId> N/M\n<本文>`)の変更
- MAX_BYTES / HEADER_BUDGET の変更(既存端末で生成された multi-page QR が読めなくなる)
- crypto prefix の追加(既存端末が新 prefix を認識できない)

**bump 不要の変更**:
- 内部実装の最適化(外部インターフェースが変わらない)
- 新しいヘルパー関数の追加

transport の bump は **v1 端末との QR 互換を破壊する**。HR-v2 はアプリの wire 層(WIRE_V)で v1 互換を維持しているが、transport 層の変更はさらに根本的な互換破壊になる。慎重に判断すること。

アプリ側の WIRE_V(`apps/hospital-rounds-v2/src/qr/wire.ts`)の bump ルールは同ファイルの冒頭コメントを参照。

---

## 3. SW テンプレートの変更禁止事項

`packages/foundation/src/pwa/sw.template.js` を変更する場合の絶対禁止事項:

- `skipWaiting()` を追加しない
- `clients.claim()` を追加しない
- 登録フック側(`pwa/useServiceWorker.ts`)に `registration.update()` / `updatefound` を追加しない
- 自動更新プロンプトを追加しない

これらを追加すると凍結更新ポリシーの保証が壊れる。保証内容は同ファイルの不変性ブロックコメントを参照。

テンプレートを変更した場合は、既存アプリの `apps/*/public/sw.js` を同期して更新する。

---

## 4. 依存追加の supply-chain 手順

`packages/foundation/package.json` の runtime deps を変更する場合:

1. **追加の正当性を確認**: 自前実装が困難か。ライセンス(MIT/ISC/Apache-2.0 を優先)。postInstall スクリプトなし。外部送信なし。
2. **exact バージョンで追加**: `npm install --save-exact <pkg>@<version> -w packages/foundation`
3. **no-exfil を実行**: `npm run no-exfil`
4. **テストを実行**: `npm test`
5. **lockfile をコミット**: `package-lock.json` をコミットに含める
6. **`docs/supply-chain-security.md` を更新**: runtime 依存一覧を更新する

vendor に追加する場合(`packages/foundation/src/qr/vendor/`):
- ライセンス表記をファイル先頭に保持する
- npm deps を使わず直接バンドルしていることをコメントに明記する

---

## 5. UI コンポーネントの変更

foundation の UI コンポーネント(`packages/foundation/src/ui/`)を変更する際:

- `tokens.css` の CSS 変数名を変更する場合は、両アプリが上書きしている変数(特に `--primary`)への影響を確認する。
- `contract.ts`(`uiAttr`)のインターフェースを変更する場合は、両アプリの `ui-contract.ts` を更新する。
- `Modal` / `ConfirmDialog` / `toast` などの共有コンポーネントの props を変更する場合は、両アプリの呼び出し箇所を確認する。

---

## 6. i18n モジュールの変更

`i18n/createI18n` のインターフェースを変更する場合:
- 両アプリの i18n 初期化箇所(`src/i18n/`)を確認する。
- `createI18n` の型シグネチャ変更は型チェックで検出できるが、実行時挙動の変化は手動確認が必要。

---

## チェックリスト

- [ ] `npm test` が全 3 パッケージで pass する
- [ ] `npm run typecheck` が通る
- [ ] `npm run no-exfil` が clean を返す
- [ ] SW テンプレートに skipWaiting 等を追加していない
- [ ] wire format を変更した場合は互換影響を評価した
- [ ] 依存を追加した場合は `docs/supply-chain-security.md` を更新した
- [ ] `package-lock.json` をコミットに含めた
