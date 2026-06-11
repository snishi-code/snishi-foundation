# snishi-foundation

完全オフライン・外部送信ゼロ・監査しやすい PWA アプリ作成基盤と、その実証となる v2 試作アプリ。

- `packages/foundation/` — React + TypeScript strict の共通基盤(storage / snapshot / import-export / QR / dialog / dirty guard / app history / i18n / design tokens / eventlog / PWA)
- `apps/hospital-rounds-v2/` — 回診管理 v2(医療カテゴリ)。現行 `snishi-code-medical/hospital-rounds` のフル機能を React へ移植
- `apps/simple-ledger-v2/` — 家計簿 v2(個人カテゴリ)。現行 `snishi-code-personal/simple-ledger-src` のフル機能を移植
- `docs/` — architecture / security / supply-chain-security / qr-security / deployment / audit-checklist / questions
- `prompts/` — foundation から新アプリを作る / 保守する際のエージェント向け指示書

**既存公開版の置き換え・配信導線の追加は行わない**(v2 は旧版と storage / SW scope / appId を完全分離)。

## セットアップ

```sh
npm install
git config core.hooksPath .githooks   # pre-commit で no-exfil guard を必須化
```

## スクリプト

| コマンド | 内容 |
|---|---|
| `npm run typecheck` | TypeScript strict 全体チェック |
| `npm run lint` | ESLint |
| `npm test` | 全ワークスペースの unit テスト(vitest) |
| `npm run build` | 全アプリのビルド |
| `npm run no-exfil` | 外部送信ゼロ機械ガード(ソース + dist) |

## 不変条件(詳細は docs/)

- **外部送信ゼロ・例外なし**: fetch / XHR / WebSocket / EventSource / sendBeacon 禁止。同一オリジン SW キャッシュのみ `// network-ok:` 注釈で承認。
- **IndexedDB が runtime truth**。localStorage は短い同期ポインタのみ。
- **保存・削除・復元・import は fail-closed**。
- **SW は凍結更新ポリシー**(skipWaiting / clients.claim / 自動 update なし)。
- **v1 のデータを読まない・書かない・消さない**(識別子は全て v2 系)。
