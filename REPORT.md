# 実装レポート

## Security Summary

**Conditional Pass**

配信前の人間判断事項が `docs/questions.md` の「Recommended before deploy」に残存しているため、現時点では条件付き合格とする。機械検証可能な外部送信ゼロ・識別子分離・SW 凍結ポリシーは確認済み。未解決は origin 確定・GitHub 保護設定・アイコン差別化・HR 操作ガイド移植。

---

## 実装判断(§20)

### SW 凍結 vs ledger v1 現行

**採用**: 凍結更新ポリシー統一(両アプリ)。

**不採用**: `simple-ledger-src`(v1)の `useServiceWorker.ts` が持つ `updatefound` / skipWaiting 方式。

**理由**: v1 ledger はユーザー操作で skipWaiting を呼ぶ「自動更新プロンプト」方式を採用していた。v2 では「配信元が信用できるのは install の瞬間だけ」と割り切り、install 後の端末を配信元変更から守る設計を選んだ。これは `hospital-rounds`(医療カテゴリ)がもともと採用していた凍結ポリシーを全アプリに統一したもの。

**v1 差分**: v2 の `pwa/useServiceWorker.ts` は `registration.update()` / `updatefound` / skipWaiting の 3 点を持たない。

**残リスク**: 正規のセキュリティ修正・バグ修正も既存端末には自動で届かない。更新はアンインストール → 再インストールのみ。

### zod 4.4.3 / React 19.2.7

**採用**: zod 4(API 面で大きな変更あり)および React 19.2.7。exact 固定。

**理由**: foundation のスキーマ検証(createImportPipeline の envelope / 各アプリの domain schema)が zod に依存する。zod 4 は zod 3 と API 互換がないため、意図しないメジャーアップグレードを防ぐために exact 固定とした。React 19 は concurrent features 前提の依存が foundation になかったため採用コストは低かったが、exact で固定して dependency drift を防ぐ。

### revision フィールド化

**採用**: `ledger-v2` の export envelope に `revision` フィールドを含め、foundation `createImportPipeline` の衝突検出を使う。

**理由**: 複数デバイス運用で同じデータセットの旧版を誤って import して上書きするリスクを軽減する。

### migration 撤去

**採用**: v2 はレガシー migration を持たない。`simple-ledger-v2` は SCHEMA_VERSION=1 を起点とし、v1(schemaVersion 16相当)のファイルは `unsupported-version` で fail-closed に拒否する。

**理由**: v2 は新規 IDB を使い v1 データを読まない設計のため、v1 → v2 の自動 migration は不要。migration コードは複雑性とバグリスクが高い。ユーザーが v2 に v1 ファイルを import しようとした場合は `not-our-file`(appId 不一致)または `unsupported-version` でエラーを返す。

### HR 書込 no-op 撤去 → throw

**採用**: v2 の書込(saveBundle 等)は IDB open 失敗時も throw する。v1 は IDB 不可の no-op 保存を黙って成功扱いにしていたが、v2 ではこれを撤去した。

**理由**: 「保存できていない事実」を成功扱いにすると臨床データが失われる。fail-closed 原則の徹底。

**v1 差分**: v1 `hospital-rounds/src/storage.js` は `isStorageAvailable()` が false の場合、書込を no-op で通過させていた。v2 は `isStorageAvailable()` が false なら persistActiveOrThrow が throw する。

### WIRE_V 指示書誤り → 移植元準拠

実装時に指示書と v1 実装値の間に差異があった。foundation の仕様書が示す WIRE_V 値ではなく、`snishi-code-medical/hospital-rounds/src/features/qr-protocol.js` の現行実装値を正として採用した(HM:3/MM:3/SH:3/ST:6/FMT:3/FS:2)。

**理由**: WIRE_V は v1 端末との QR 互換の核心。実際に稼働している v1 実装が正本。

### dist スキャンの限界

no-exfil-guard の dist スキャン([EXT-2])は sendBeacon/WebSocket/EventSource をハードフェイルするが、minify 後の `fetch` 呼び出しを直接検出しない。fetch の実行時防壁は CSP `connect-src 'self'` が担う(`docs/security.md` §12.4 参照)。

---

## Evidence

### コミット履歴

| コミット | 日時 | 内容 |
|---|---|---|
| `da7a47f` | 2026-06-11 18:22 | scaffold: npm workspaces monorepo + tooling + no-exfil guard |
| `9decaab` | 2026-06-11 19:08 | foundation: 全12モジュール実装 |
| `cfddbb6` | 2026-06-11 19:41 | apps: 両アプリのドメイン/データ/QR 層を移植 |
| `b3587ca` | 2026-06-11 20:28 | apps UI: ledger-v2 全画面移植 + HR-v2 UI コア(React 化) |

### テスト数(2026-06-11 時点)

| パッケージ | テストファイル数 | テスト数 |
|---|---|---|
| `@snishi/foundation` | 22 | 185 |
| `hospital-rounds-v2` | 12 | 120 |
| `simple-ledger-v2` | 20 | 314 |
| **合計** | **54** | **619** |

最終数値はタスク9(検証スイート実行)で更新する。

---

## Findings

### 確認済み(検証済み)

- **外部送信ゼロ**: `npm run no-exfil` が clean を返す。ソーススキャン + dist スキャンを実施。
- **識別子分離**: v2 の `constants.ts` が v1 識別子を使っていないことをコードレビューで確認。
- **SW 凍結ポリシー**: 全 SW ファイルに skipWaiting / clients.claim が存在しないことを確認。
- **fail-closed import**: foundation `createImportPipeline` の 7 段階パイプラインをコードレビューで確認。
- **v1 互換 WIRE_V**: `apps/hospital-rounds-v2/src/qr/wire.ts` の WIRE_V 値を v1 実装と照合済み。
- **テスト合格**: 全 619 テストが pass(2026-06-11 時点)。

### 未確認(Not Verified)

- **実機 iOS Safari でのカメラスキャン動作**: jsdom 環境でのユニットテストのみ。実機未確認。
- **CompressionStream の動作**: vitest 環境では CompressionStream が未実装のため E1 fallback。実機ブラウザでの E2 動作は未確認。
- **PWA インストール後の凍結 SW 動作確認**: 実機インストール後の挙動未確認。
- **E2E テスト**: Playwright を devDeps に含むが未実施。
- **HR-v2 の視覚確認**: UI コンポーネントは実装済みだが、実際のレイアウト・操作感の視覚確認未了。
- **SL-v2 の revision インクリメント運用**: `meta.revision` フィールドが存在するが、どの操作で +1 するかの仕様化未了。

---

## Residual Risks

1. **QR 固定鍵の秘匿性なし**: バンドル JS からの鍵抽出が可能。意図的な攻撃者には無力。偶発的スキャン防止のみ(脅威モデルに明記済み)。
2. **IndexedDB 平文保存**: 端末暗号化が前提。端末アクセスを得た第三者はデータを読取可能。
3. **正規修正の不到達**: 凍結 SW により、セキュリティ修正も既存端末には自動で届かない。
4. **dist スキャンの fetch 不検出**: CSP が実行時防壁だが、SW 内リクエストは `<meta>` CSP の対象外(サーバーサイドヘッダーが必要)。
5. **GitHub 保護未設定**: branch protection / CI / 2FA が未設定(配信前対応が必要)。

---

## User Questions

未決事項の詳細は `docs/questions.md` を参照。特に「Recommended before deploy」は配信前に解決が必要:

- Q1. 配信 origin の確定
- Q2. no-exfil-guard の apex upstream 提案
- Q3. GitHub branch protection / CI / 2FA 設定
- Q4. アイコンの v2 視覚差別化
- Q5. HR-v2 操作ガイド(docs-bundle)の移植
