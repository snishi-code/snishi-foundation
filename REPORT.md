# 実装レポート

## Security Summary

**Conditional Pass**(2026-06-11 §19 最終検証済み)

§19 検証スイートはすべて実施し、機械検証可能な項目は全件 Pass(下記 Evidence): 外部送信ゼロ(no-exfil + CSP テンプレ一致)・識別子分離・SW 凍結ポリシー(静的 + e2e)・fail-closed import・QR 暗号化/平文マトリクス・依存最小(runtime 5 パッケージ・install スクリプトなし)。

条件付きとする理由は、配信前の人間判断事項が `docs/questions.md` の「Recommended before deploy」に残存しているため: origin 確定(Q1)・GitHub 保護設定(Q3)・アイコン視覚差別化(Q4 — v1 とバイト同一を md5 で確認)・HR 操作ガイド移植(Q5)。実機(iOS Safari 等)依存の項目は Not Verified として明示した。

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

### テスト数(2026-06-11 最終検証・実測)

| パッケージ | テストファイル数 | テスト数 | 結果 |
|---|---|---|---|
| `@snishi/foundation`(unit) | 22 | 185 | all pass |
| `hospital-rounds-v2`(unit) | 15 | 131 | all pass |
| `simple-ledger-v2`(unit) | 20 | 314 | all pass |
| **unit 合計** | **57** | **630** | **all pass** |
| `hospital-rounds-v2`(e2e, chromium) | 3 spec | 12 | all pass |
| `simple-ledger-v2`(e2e, chromium) | 3 spec | 10 | all pass |
| **e2e 合計** | **6 spec** | **22** | **all pass** |

### §19 検証スイート実行結果(2026-06-11)

| # | 項目 | コマンド / 手段 | 結果 |
|---|---|---|---|
| 1 | typecheck | `npm run typecheck` | Pass(エラー 0) |
| 1 | lint | `npm run lint` | Pass(初回 9 エラー → 軽微修正後 0。Findings 参照) |
| 1 | unit 全件 | `npm test` | Pass(630/630) |
| 1 | build | `npm run build` | Pass(両アプリ dist 生成) |
| 1 | no-exfil(dist 込み) | `npm run no-exfil` | Pass(`OK no-exfil-guard: clean`、dist 9 files スキャン) |
| 2 | QR roundtrip / 750B split / page 異常系 / wrong key / 暗号化 | unit(下記テスト名列挙) | Pass |
| 3 | plaintext EHR QR | e2e `hr.spec.ts`「detail の電子カルテ転記 QR: 平文ペイロードのまま表示される」+ 静的確認(`DetailQrDialog.tsx` は `qr/crypto` を import しない) | Pass |
| 4 | redistribution restricted/free | unit `apps/hospital-rounds-v2/src/qr/wire.test.ts` | Pass |
| 5 | IndexedDB fail-closed / snapshot restore undo | unit(下記所在) | Pass |
| 6 | PWA offline / SW update policy | e2e `pwa.spec.ts`(両アプリ)+ 静的 grep | Pass |
| 7 | CSP check | 両 `index.html` + dist + scaffold テンプレの diff | Pass(完全一致) |
| 8 | dependency / license review | `npm ls --omit=dev --all` / `npm query` | Pass |
| 9 | mobile/tablet/desktop visual check | e2e `visual.spec.ts`(3 サイズ × 主要画面、横スクロール検査 + screenshot) | Pass |

### §19-2: QR プロトコル/暗号の unit テスト(主要なもの)

`packages/foundation/src/qr/protocol.test.ts`:
- 「v1 互換歩哨: ページヘッダは RND_<KIND> #<batchId> N/M\n」
- 「MAX_BYTES=750 / HEADER_BUDGET=50 (v1 固定値)」
- 「750B 超 payload は複数ページに分割され、各ページ ≤ 750B・ヘッダ ≤ 50B」
- 「改行なしマルチバイト payload もコードポイント境界で分割して復元できる」
- assemblePages: 「順不同・重複を許容」「欠落は null」「totalPages 不一致 (バッチ混在) は null」

`packages/foundation/src/qr/crypto.test.ts`:
- E2: 「pack→unpack roundtrip」「v1 互換歩哨: "E2:" prefix + base64url + iv 12B + GCM tag 16B」
- 「wrong key で unpack が throw (fail-closed)」「改ざん (1 byte 反転) で throw」
- 「鍵なしの encrypt は throw (平文 QR を出させない)」
- E1: 「CompressionStream 不可なら packPayload は E1 に fallback」「手組みした E1 を復号できる — v1 端末との互換」「E1 も wrong key で throw」

`packages/foundation/src/qr/useQrFlow.test.ts`(page 異常系):
- 「kind 違いは wrongKind / consumed:false」「2/3 受信は progress、欠落のままでは complete しない」
- 「復号失敗 (wrong key) は throw し onApply に到達しない (fail-closed)」
- 「ヘッダ矛盾 (pageNum > totalPages) は拒否して組み立て不能に陥らない」

### §19-4: redistribution restricted/free(unit 所在)

`apps/hospital-rounds-v2/src/qr/wire.test.ts`:
- 「HM restricted: origin=external を空スロット化し、末尾連続空をトリム (v1 実出力)」
- 「HM free: external 患者も載る (v1 実出力)」

### §19-5: IndexedDB fail-closed / snapshot restore undo(unit 所在)

- `packages/foundation/src/storage/idb.test.ts`: 「runWrite の途中 throw で両ストアとも未反映」「リクエストエラーでも両ストアとも未反映」
- `apps/hospital-rounds-v2/src/data/storage.test.ts`: 「fail-closed: put 失敗で saveBundle は throw する」
- `apps/hospital-rounds-v2/src/data/store.test.ts`: 「persistActiveOrThrow は保存失敗で throw」「IDB 不可 (no-op 保存) も失敗扱い」「importArchive: IDB 不可なら何も作らず throw」
- `packages/foundation/src/snapshot/snapshots.test.ts`: 「restore: 復元前に restore_undo を積み、apply には複製データが渡る」「apply が throw したら ok:false で undo は先に積まれている」
- `apps/hospital-rounds-v2/src/domain/patientUndo.test.ts`: 「persist 失敗時は live をロールバックし ok:false (fail-closed)」
- `apps/simple-ledger-v2/tests/exportImport.test.ts`: 「別アプリのファイルは not-our-file」「v1 アプリのファイルは not-our-file(識別子分離)」「revision-conflict、force で上書き」

### §19-6: SW 凍結ポリシー(静的検証 + e2e)

静的 grep: `apps/*/public/sw.js`・`apps/*/dist/sw.js`・`packages/foundation/src/pwa/sw.template.js`・`pwa/useServiceWorker.ts` に `skipWaiting` / `clients.claim` / `registration.update` / `updatefound` の**呼び出しが存在しない**(コメントでの言及のみ)。

e2e(両アプリ `e2e/pwa.spec.ts`):
- SW が登録・activate される。**初回ロードのページは claim されない**(`navigator.serviceWorker.controller === null` を明示 assert)= 凍結ポリシーの挙動検証
- `context.setOffline(true)` → reload 後も app shell が起動(cache-first)
- manifest が installable(name/start_url/display=standalone/192・512 アイコン)

補足: SW 登録は `data-env='prod'` ゲートのため localhost preview では発火しない。e2e は `addInitScript` の MutationObserver で `data-env` を 'prod' へ強制して実 SW を検証した(アプリ側コードは無改変)。

### §19-7: CSP check

両アプリの `index.html` の CSP meta は scaffold 正本テンプレ(`snishi-code.com/scaffold/pwa/head.template.html`)と**完全一致**(diff 0)。dist にも同一内容が伝搬。内容: `default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; media-src 'self' blob:; worker-src 'self'; manifest-src 'self'; frame-src 'self'; child-src 'self'; form-action 'self'; base-uri 'self'; object-src 'none'`。

### §19-8: dependency / license review

`npm ls --omit=dev --all` の全ツリー(runtime、dedupe 後 5 パッケージのみ):

| パッケージ | バージョン | ライセンス |
|---|---|---|
| react | 19.2.7(exact) | MIT |
| react-dom | 19.2.7(exact) | MIT |
| scheduler(react-dom の依存) | 0.27.0 | MIT |
| zod | 4.4.3(exact) | MIT |
| jsqr | 1.4.0 | Apache-2.0 |

install スクリプト監査: `npm query ':attr(scripts, [postinstall])'` / `[preinstall]` / `[install]` がいずれも **空配列**(devDeps 含む全 node_modules に install フックなし)。

### §19-9: visual check(3 サイズ × 主要画面)

`e2e/visual.spec.ts`(両アプリ)が 390x844 / 820x1180 / 1280x800 で主要画面を撮影し、`document.scrollingElement` の `scrollWidth - clientWidth ≤ 1px`(横スクロールなし)を機械検証。代表スクリーンショットの目視確認でも重なり・破綻なし。

スクリーンショット保存先(計 21 枚):
- `apps/simple-ledger-v2/test-results/screenshots/ledger-{dashboard,journal,entrysheet,settings}-{mobile-390x844,tablet-820x1180,desktop-1280x800}.png`(12 枚)
- `apps/hospital-rounds-v2/test-results/screenshots/hr-{home,detail,settings}-{mobile-390x844,tablet-820x1180,desktop-1280x800}.png`(9 枚)

### e2e 実行方法

```bash
npx playwright install chromium   # 初回のみ
npm run test:e2e -w apps/simple-ledger-v2     # 10 tests
npm run test:e2e -w apps/hospital-rounds-v2   # 12 tests
```

いずれも本番ビルドを `vite preview` で配信して検証(playwright.config.ts の webServer が build + preview を起動)。セレクタは ui-contract(`data-ui`)のみ使用。

---

## Findings

### 確認済み(検証済み)

- **外部送信ゼロ**: `npm run no-exfil` が clean を返す。ソーススキャン + dist スキャン(9 files)を実施。
- **識別子分離**: v2 の `constants.ts` が v1 識別子を使っていないことをコードレビュー + unit(「v1 アプリのファイルは not-our-file」)で確認。
- **SW 凍結ポリシー**: 全 SW ファイル(public/dist/テンプレ/登録フック)に skipWaiting / clients.claim / registration.update / updatefound の呼び出しが存在しないことを grep で確認。e2e で「初回ページ非 claim + オフライン cache-first 起動」の実挙動も確認。
- **fail-closed import**: foundation `createImportPipeline` の 7 段階パイプライン(unit)+ e2e(不正ファイル投入 → not-our-file トースト)で確認。
- **v1 互換 WIRE_V**: `apps/hospital-rounds-v2/src/qr/wire.ts` の WIRE_V 値を v1 実装と照合済み(unit「kind 別 WIRE_V は現行 v1 実装値と一致する」)。
- **テスト合格**: unit 630 + e2e 22(chromium)が全 pass(2026-06-11 最終検証)。
- **CSP テンプレ準拠**: 両 index.html・dist とも scaffold 正本テンプレと完全一致。
- **依存最小・install フックなし**: runtime 5 パッケージ(MIT ×4 / Apache-2.0 ×1)、全 node_modules に postinstall/preinstall/install なし。
- **レイアウト**: 390/820/1280 の 3 サイズ × 主要 7 画面で横スクロールなし(機械検証)+ スクリーンショット目視で重なりなし。

### 最終検証(§19)で見つけて直したもの(軽微修正)

1. **lint エラー 9 件**: `apps/*/public/sw.js` の `/* global */` コメントが eslint 設定(`globals.serviceworker`)と二重定義になり no-redeclare ×8 — コメント行を削除(SW ロジック無変更)。`apps/simple-ledger-v2/tests/ui.smoke.test.tsx` の未使用 import `screen` ×1 — 削除。
2. **HR-v2 unit の flaky テスト**: `tests/pickers.test.tsx`「ユーザー作成 → ヘッダーのユーザー名が変わる」が全体実行時にまれに fail(ヘッダー再描画は revision bump 経由の async なのに同期 assert していた)— `waitFor` で待つよう修正(**テスト都合の修正**。アプリ側のバグではない: store 状態の assert は常に pass しており、描画も bump 後に正しく更新される)。修正後 5 回連続全 pass。
3. **vitest が e2e を誤って拾う**: `apps/*/e2e/*.spec.ts` 追加に伴い vitest の include に該当 — 両アプリの `vitest.config.ts` に `exclude: e2e/**` を追加(e2e 整備の付随変更)。

アプリ本体のバグは検証では見つからなかった(コード無変更。修正はすべて lint/テスト/設定の範疇)。

### 未確認(Not Verified)— 最終確定

- **実機 iOS Safari / Android Chrome でのカメラスキャン動作**: `qr/scan.ts` は getUserMedia 依存。CI/ローカルの headless 環境ではカメラ実機がなく検証不能。unit(jsdom)+ 貼り付け受信経路のみ検証済み。
- **実機ブラウザの CompressionStream(E2 圧縮暗号)**: vitest(jsdom)では CompressionStream 未実装のため E1 fallback 経路を検証。chromium(e2e 経由のページ実行)には実装があるが、**実機 iOS Safari** での E2 動作は未確認。
- **PWA インストール後の凍結 SW 動作(実機)**: ホーム画面追加 → 再起動 → 旧版維持の実機確認は配信 origin が未確定のため実施不能。chromium e2e で SW 登録・非 claim・オフライン起動までは確認済み。
- **マルチページ QR の実カメラ読取**: ページ分割・組み立て・ページ表記は unit + e2e で検証済みだが、実カメラでの連続読取(照明・ピント条件)は実機がなく未確認。
- **本番 origin での hostname 判定**: `data-env` 判定は本番 origin 未確定のため実 URL では未検証(localhost が 'test' に倒れることは e2e で間接確認)。
- **SL-v2 の revision インクリメント運用**: `meta.revision` の +1 タイミングの仕様化は未了(`docs/questions.md` Q9、データ設計の未決事項)。

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
