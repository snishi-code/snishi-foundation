# 未決事項(§18)

仕様 §18 の分類に従い、未解決の事項を列挙する。

---

## Blocking(配信を止めるもの)

現時点で Blocking の未決事項はない。

---

## Recommended before deploy(配信前に解決推奨)

### Q1. 配信 origin の確定

- **内容**: HR-v2 / SL-v2 の本番・テスト origin が未確定。`docs/deployment.md` に例示した `hrv2.snishi-code.com` / `slv2.snishi-code.com` は仮案。
- **担当**: 人間判断(インフラ設定)
- **カテゴリ**: §18 — インフラ

### Q2. no-exfil-guard の apex upstream 提案

- **内容**: `tools/no-exfil-guard.sh` は apex リポの派生に EXT-1(ts/tsx/jsx 追加)・EXT-2(dist スキャン)を加えた版。これらの拡張を apex 正本へ upstream する価値があるか。
- **担当**: 人間判断(apex リポとの調整)
- **カテゴリ**: §18 — 保守

### Q3. GitHub branch protection / CI / 2FA 設定

- **内容**: main ブランチ保護(PR 必須・status check 必須)・GitHub Actions(型チェック/lint/no-exfil/テスト)・アカウント 2FA が未設定。`docs/supply-chain-security.md` の「未確認事項」にも記載。
- **担当**: 人間判断(リポ管理設定)
- **カテゴリ**: §18 — セキュリティ

### Q4. アイコンの v2 視覚差別化

- **内容**: 両アプリとも manifest / icons(192・512、HR-v2 は apple-touch-icon も)は作成済みで installability 要件は満たす(e2e で検証済み)。ただし icon ファイルは v1 と**バイト同一**(md5 照合: HR-v2 icon-192 = v1 `hospital-rounds/public/icons/icon-192.png`、SL-v2 icon-192 = v1 `simple-ledger-src` の icon-192)。同一端末に v1 と v2 を両方インストールした場合に見分けがつかない。
- **担当**: 人間判断(デザイン)
- **カテゴリ**: §18 — UX

### Q5. HR-v2 操作ガイド(docs-bundle)の移植

- **内容**: v1 `hospital-rounds` には `docs-bundle.js` として操作ガイドが同梱されていた。HR-v2 には未移植。オフライン動作の説明・機能説明が欠ける。配信前に移植が必要かどうかは人間判断。
- **担当**: 人間判断(コンテンツ移植)
- **カテゴリ**: §18 — 機能

---

## Can decide later(後回し可能)

### Q6. zod / React のアップデート方針

- **内容**: runtime deps を exact 固定しているため、アップデートは手動で行う必要がある。定期更新のポリシー(周期・レビュー手順)を策定していない。
- **カテゴリ**: §18 — 保守

### Q7. E2E テストの拡充

- **内容**: Playwright e2e は整備済み(chromium・両アプリ計 22 テスト: コアフロー / dirty guard / import 拒否 / 凍結 SW・オフライン / 3 サイズ visual check)。残課題は WebKit/Firefox プロジェクトの追加と、実機でのカメラスキャン・PWA インストール確認(これらは手動のみ)。
- **カテゴリ**: §18 — テスト

### Q8. Navigation API への移行

- **内容**: `createAppHistory` は `history.pushState` / `popstate` ベース。Navigation API(Chrome 102+)に移行すると戻る制御が簡潔になる可能性があるが、Safari の対応状況と要件を確認してから判断する。
- **カテゴリ**: §18 — アーキテクチャ

### Q9. SL-v2 の revision フィールド運用

- **内容**: foundation `createImportPipeline` は revision 衝突を検出する仕組みを持つ。SL-v2 は `meta.revision` を export に載せているが、revision のインクリメント運用(どの操作で +1 するか)を仕様化していない。
- **カテゴリ**: §18 — データ設計
