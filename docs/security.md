# セキュリティ仕様(§12)

## §12.1 守るもの

- **端末内の利用者データ**: 患者情報(HR-v2)・家計情報(SL-v2)
- **偶発的な外部流出からの保護**: 意図しない送信・トラッキング
- **コード改ざん後の波及防止**: install 後の端末を既存配信の変更から守る

## §12.2 守らないもの(脅威モデル外)

- 物理的な端末アクセス(端末ロック解除済みの操作)
- アプリをインストールしたユーザー自身によるデータ抽出
- QR 鍵を入手した(= バンドル JS を取得した)意図的な攻撃者による QR 解読
- ブラウザ自体の脆弱性・OS 脆弱性
- 端末暗号化が施されていない状態での端末紛失

## §12.3 脅威モデル

| 脅威 | 対応状況 |
|---|---|
| アプリが外部サーバへデータを送信する | 防御済み(3層、下記 §12.4) |
| 第三者が普通の QR スキャナで医療情報を即読取 | 軽減済み(固定鍵による難読化、後述) |
| 配信元アカウント乗っ取り後の既存端末への悪性コード配布 | 防御済み(凍結 SW ポリシー) |
| v2 アプリが v1 のデータを誤って破壊/混線 | 防御済み(識別子完全分離) |
| 悪意ある import ファイルによるデータ上書き | 軽減済み(7段階 fail-closed import) |

## §12.4 防御策

### 外部送信ゼロ — 3 層防御

**第 1 層: CSP(実行時防壁)**
```
connect-src 'self'
```
全アプリの `index.html` に Content-Security-Policy として配置。ブラウザが外部への fetch/XHR/WebSocket を実行時に遮断する。

`script-src 'unsafe-inline'` を含む点に注意: インライン `<script>` の eval は許可されているが、これは env 判定スクリプトのためであり、ユーザーデータへのアクセス経路とはなっていない。外部送信の防壁としての `connect-src 'self'` の強度は保たれる。

**第 2 層: no-exfil-guard.sh(静的解析)**

`tools/no-exfil-guard.sh` がソースと dist の両方をスキャンする(正本は apex リポの派生、スキャン拡張は EXT-1/EXT-2 として明記)。

- ソーススキャン: `fetch / XMLHttpRequest / WebSocket / EventSource / sendBeacon` が `// network-ok: <理由>` なしに出現すれば CI 失敗。
- dist スキャン([EXT-2]): minify でコメントが消えるため `// network-ok:` 方式は dist では成立しない。よって dist では `sendBeacon / new WebSocket / new EventSource` をコメントに関わらずハードフェイルとする。`fetch` については、dist は minify 後のバンドルであり react/zod/jsqr のいずれも fetch を持たないため、実質的に出現しない。ただし fetch が dist に現れた場合の防壁は CSP `connect-src 'self'` が担う(dist スキャンの限界 — §12.6 残るリスク参照)。

pre-commit フック(`.githooks/pre-commit`)で自動実行される。`git config core.hooksPath .githooks` でセットアップが必要。

**第 3 層: 依存ゼロ(供給網最小化)**

runtime deps は react/react-dom/zod/jsqr の 4 パッケージのみ。いずれも外部送信プリミティブを持たないことを確認済み。外部 CDN 不使用。

### Service Worker 凍結更新ポリシー

`public/sw.js`(移植元: `hospital-rounds/public/sw.js`)の設計:
- `skipWaiting()` を呼ばない → 新しい SW は 'waiting' に留まり発火しない
- `clients.claim()` を呼ばない → 既存インストールは古い SW を使い続ける
- `index.html` は cache-first → アプリコードは install 時点で凍結
- 登録側(`pwa/useServiceWorker.ts`)も `registration.update()` / `updatefound` を配線していない

**根拠**: 配信元が信頼できるのは「install の瞬間」だけと割り切る。install 後に(a)コード瑕疵が自動修正されて端末の挙動が変わる、(b)デプロイ環境が乗っ取られて悪性コードが既存端末へ波及する、のどちらも起こさない。

**v1 からの差分 — ledger 現行との違い**: `simple-ledger-src/src/pwa/useServiceWorker.ts`(v1)は `updatefound` / skipWaiting 方式でユーザーに更新を促す実装だったが、v2 では不採用。凍結ポリシーを両アプリで統一した。

### IndexedDB アクセス制御

- 同一 origin の js のみアクセス可能(ブラウザのオリジン分離)。
- v2 は v1 と IDB 名・localStorage prefix が完全分離しているため、同一 origin に同居しても混線しない(ただし同一 origin 共存は非推奨 — `docs/deployment.md` 参照)。

### Import の fail-closed

7 段階パイプライン(foundation `createImportPipeline`): ①parse ②封筒確認 ③migration ④完全検証 ⑤revision衝突確認 ⑥スナップショット ⑦原子置換。⑦が成功するまで既存データを変更しない。スナップショット撮影失敗時も置換に進まない。

## §12.5 残るリスク

- **QR 固定鍵**: バンドル JS を取得した攻撃者は鍵を抽出して暗号化 QR を解読できる。ソース埋め込み鍵に厳密な秘匿性はない(§12.8 開発者向け 参照)。
- **IndexedDB 平文保存**: データは端末内 IndexedDB に平文で保存される。端末暗号化(FileVault/Android 暗号化等)が前提。端末アクセスを得た第三者はブラウザ DevTools から読取可能。
- **dist スキャンの fetch 不検出**: no-exfil-guard の dist スキャンは sendBeacon/WebSocket/EventSource をハードフェイルするが、minify 後の fetch 呼び出しを直接検出しない。防壁は CSP `connect-src 'self'` が担う。
- **正規の修正が届かない**: 凍結 SW ポリシーにより、セキュリティ修正を含む更新も既存インストール端末には自動で届かない。更新はアンインストール → 再インストールのみ。
- **`unsafe-inline` の存在**: CSP に `script-src 'unsafe-inline'` を含む。XSS が起きた場合のインラインスクリプト実行を防がない。アプリはサーバーサイドレンダリングを行わず、ユーザー入力を innerHTML に展開していないため XSS は低リスクと評価しているが、未検証。

## §12.6 利用者向け

- データはすべて端末内にのみ保存されます。外部サーバーへの送信は一切ありません。
- 端末の画面ロック・暗号化を有効にしてください。ロック解除済みの端末へのアクセスはこのアプリでは防げません。
- QR コードは関係者以外に見せないでください。暗号化 QR でも、バンドル JS を取得できる相手には解読される可能性があります。
- データのバックアップはアプリの「エクスポート」機能を使って定期的に行ってください。アプリのアンインストール・ブラウザデータ削除でデータが失われます。
- アプリを最新版に更新するには、現在インストールされているアプリをアンインストールし、再インストールしてください(PWA の自動更新は意図的に無効化されています)。

## §12.7 管理者向け

- **配信前に必ず** `docs/questions.md` の「Recommended before deploy」をすべて解決してください。
- `npm run no-exfil` を実行して外部送信ゼロを確認してください。
- Content-Security-Policy ヘッダーをサーバー側(Cloudflare Pages の `_headers` 等)でも設定することを推奨します(`index.html` の `<meta>` だけでは Service Worker 内は対象外)。
- GitHub の branch protection と 2FA は未設定(既知課題 — `docs/questions.md` 参照)。本番配信前に設定してください。
- iOS Safari はブラウザデータ削除で PWA の IndexedDB が消去されます。利用者にバックアップを案内してください。

## §12.8 開発者向け

- **`// network-ok:` 注釈なしに fetch 等を追加しない**。追加する場合は pre-commit が失敗するので理由を添えて承認する。
- **QR 鍵はソース埋め込みであり秘匿性は偶発的スキャン防止のみ**。HR-v2 の鍵(`apps/hospital-rounds-v2/src/qr/appKey.ts`)は v1 との QR 互換維持のため変更できない。新規アプリに別鍵を与えることは可能。
- **SW テンプレートに skipWaiting / clients.claim / registration.update を追加しない**。凍結ポリシーの保証が壊れる。変更禁止事項は `packages/foundation/src/pwa/sw.template.js` 冒頭の不変性ブロックが正本。
- **`no-exfil-guard.sh` の dist スキャン([EXT-2])**: minify でコメント承認が成立しない理由と CSP が実行時防壁である理由は `tools/no-exfil-guard.sh` の [EXT-2] コメントを参照。
- 依存を追加する際は `docs/supply-chain-security.md` の手順に従う。
