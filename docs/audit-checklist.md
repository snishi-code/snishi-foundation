# 監査チェックリスト

コードレビュー・セキュリティ監査の担当者向け。各項目の grep コマンドはリポルートから実行する。

---

## 1. 外部送信ゼロ

```sh
# no-exfil-guard を直接実行する(ソース + dist スキャン)
npm run no-exfil
```

期待: `OK no-exfil-guard: clean (送信系・外部読込なし)`

手動確認:
```sh
# network-ok 承認済み行の一覧(正規の SW キャッシュ取得のみであることを確認)
grep -rn 'network-ok:' apps/ packages/ --include='*.ts' --include='*.tsx' --include='*.js' --include='*.html'
```

承認されるべき箇所: `apps/*/public/sw.js` の fetch 行(同一オリジン キャッシュ取得)のみ。

---

## 2. DB 名 / localStorage prefix の識別子分離

```sh
# v1 の識別子がコードに出現しないことを確認
grep -rn "hospital-rounds'" apps/hospital-rounds-v2/ packages/ \
  --include='*.ts' --include='*.tsx' --include='*.js'
# 期待: 0件(constants.ts の v1 識別子コメントを除く)

grep -rn "'simple-ledger'" apps/simple-ledger-v2/ packages/ \
  --include='*.ts' --include='*.tsx' --include='*.js'
# 期待: 0件(constants.ts のコメントを除く)

grep -rn "hospital_rounds_" apps/hospital-rounds-v2/ packages/ \
  --include='*.ts' --include='*.tsx' --include='*.js'
# 期待: 0件

# v2 識別子が constants.ts 以外に散らばっていないことを確認
grep -rn "hospital-rounds-v2" apps/hospital-rounds-v2/src/ \
  --include='*.ts' --include='*.tsx' | grep -v constants.ts
# 期待: 0件(UI 表示文字列を除く)
```

---

## 3. QR kind / WIRE_V

```sh
# HR-v2 の WIRE_V 定数が v1 実装値と一致することを確認
grep -A8 'export const WIRE_V' apps/hospital-rounds-v2/src/qr/wire.ts
```

期待値: `HM: 3, MM: 3, SH: 3, ST: 6, FMT: 3, FS: 2`

```sh
# appKey.ts が 1 箇所のみに存在することを確認(foundation には鍵がないこと)
find . -name 'appKey.ts' -not -path '*/node_modules/*'
# 期待: apps/hospital-rounds-v2/src/qr/appKey.ts のみ
```

---

## 4. schema version / appId

```sh
# ledger v2 の appId が v1 と分離されていることを確認
grep -n 'APP_ID\|appId\|simple-ledger' apps/simple-ledger-v2/src/data/constants.ts
# 期待: 'snishi-code.simple-ledger-v2' のみ

# SCHEMA_VERSION が 1 であることを確認(v2 はレガシー migration なしで 1 起点)
grep -n 'SCHEMA_VERSION' apps/simple-ledger-v2/src/data/constants.ts
# 期待: SCHEMA_VERSION = 1
```

---

## 5. no-exfil-guard の実行確認

```sh
# pre-commit フックが設定されていることを確認
cat .githooks/pre-commit | head -5
git config core.hooksPath
# 期待: .githooks
```

---

## 6. SW に skipWaiting がないことの確認

```sh
# 全 SW ファイルに skipWaiting が含まれていないことを確認
grep -n 'skipWaiting' apps/*/public/sw.js packages/foundation/src/pwa/sw.template.js
# 期待: 0件

grep -n 'clients.claim' apps/*/public/sw.js packages/foundation/src/pwa/sw.template.js
# 期待: 0件

# 登録側フックも確認
grep -n 'registration.update\|updatefound\|skipWaiting' \
  packages/foundation/src/pwa/useServiceWorker.ts
# 期待: 0件
```

---

## 7. CSP の確認

```sh
# 全 index.html に CSP が設定されていることを確認
grep -n 'Content-Security-Policy' apps/*/index.html
# 期待: 各アプリで 1 行

# connect-src 'self' が含まれることを確認
grep -n "connect-src 'self'" apps/*/index.html
# 期待: 各アプリで 1 行
```

---

## 8. 依存ツリーの確認

```sh
# runtime deps が exact 固定であることを確認
cat packages/foundation/package.json | grep -A10 '"dependencies"'
# 期待: react/react-dom/zod/jsqr が正確なバージョン番号で固定(^ や ~ なし)

# postInstall スクリプトが runtime deps にないことを確認
npm ls --json 2>/dev/null | python3 -c "
import sys, json
d = json.load(sys.stdin)
for name, pkg in d.get('dependencies',{}).items():
    scripts = pkg.get('scripts',{})
    if 'postinstall' in scripts:
        print(f'FOUND postinstall: {name}')
"
```

---

## 9. テスト合格の確認

```sh
npm test
# 期待:
#   @snishi/foundation: 185 tests passed
#   hospital-rounds-v2: 120 tests passed
#   simple-ledger-v2:   314 tests passed
```

---

## 10. 型チェック / lint

```sh
npm run typecheck
npm run lint
# 期待: エラー 0
```

---

## Not Verified(このチェックリストで検証できない項目)

- 実機(iOS Safari / Android Chrome)でのカメラスキャン動作
- CompressionStream の動作確認(実機ブラウザ。chromium e2e の SW/QR 経路では動作確認済み)
- PWA インストール後の凍結 SW 動作確認(実機。chromium e2e で SW 登録・非 claim・オフライン起動は確認済み)
- マルチページ QR の実カメラ読取(e2e はページ表記・組み立てロジックまで)

なお Playwright E2E(chromium)と 3 サイズ(390/820/1280)の visual check は `apps/*/e2e/` で実施済み(`npm run test:e2e -w apps/hospital-rounds-v2` / `-w apps/simple-ledger-v2`)。
