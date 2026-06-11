# アーキテクチャ

## monorepo 構成

```
snishi-foundation/
  packages/
    foundation/          @snishi/foundation — 共通基盤
  apps/
    hospital-rounds-v2/  回診管理 v2(医療カテゴリ)
    simple-ledger-v2/    家計簿 v2(個人カテゴリ)
  tools/
    no-exfil-guard.sh    外部送信ゼロ機械ガード
```

npm workspaces で管理。foundation は `"exports": {"./*": "./src/*"}` のサブパス import を正とし、`import '@snishi/foundation/storage/idb'` のように依存モジュールを明示する(バレル再エクスポートを持たない — 監査しやすさのため)。

---

## foundation モジュールマップ

| モジュール | 主要 API | 移植元 |
|---|---|---|
| `storage/idb` | `createDatabase` | `simple-ledger/src/data/db.ts`(汎用化) |
| `storage/pointers` | `createPointerStore` | 同上 |
| `snapshot/snapshots` | `createSnapshotStore` | `hospital-rounds/src/features/snapshots.js`(汎用化) |
| `exchange/importPipeline` | `createImportPipeline` | `simple-ledger/src/data/exportImport.ts`(7段階fail-closed部) |
| `exchange/migrations` | `createMigrationChain` | 同上 |
| `exchange/export` | `buildExportText` / `buildExportFileName` | 同上 |
| `qr/protocol` | `encodePages` / `decodePage` / `assemblePages` | `hospital-rounds/src/features/qr-protocol.js`(transport層) |
| `qr/crypto` | `packPayload` / `unpackPayload` | `hospital-rounds/src/features/crypto-payload.js`(鍵注入化) |
| `qr/render` | QR 描画(qrcodegen vendor) | — |
| `qr/scan` | `jsqr` ラッパ | — |
| `qr/useQrFlow` | スキャン/表示統合フック | `hospital-rounds/src/features/qr-flow.js`(汎用化) |
| `qr/receiverRegistry` | `registerReceiver` | `hospital-rounds/src/features/qr-receive.js`(汎用化) |
| `ui/*` | Modal / Button / Field / toast / useDirtyGuard / AppHeader / Icon | `hospital-rounds` ledger Modal 系(tokens.css / components.css 共通化) |
| `history/*` | `createAppHistory` / `useAppHistory` | `hospital-rounds/src/features/app-history.js`(hook 注入化) |
| `i18n/createI18n` | 型安全 key→文言 | — |
| `eventlog/*` | `createEventLog` | `hospital-rounds/src/features/eventlog.js`(汎用化) |
| `pwa/sw.template.js` | 凍結 SW テンプレート | `hospital-rounds/public/sw.js`(プレースホルダ化) |
| `pwa/useServiceWorker` | 登録専用フック | `simple-ledger/src/pwa/useServiceWorker.ts`(update 系削除) |
| `pwa/env` | `getEnv` | — |

---

## アプリ層の構成

両アプリとも `domain / data / qr / ui` の 4 層分離を採る。

```
src/
  domain/       純粋ロジック + zod スキーマ + 型定義(外部依存なし)
  data/         IndexedDB 操作・import/export・スナップショット(foundation 上に構築)
                constants.ts — 全識別子を一箇所に集約(監査用)
  qr/           QR エンコード/デコード(foundation qr/* 上に構築)
                hospital-rounds-v2 のみ: appKey.ts(鍵注入点)
  ui/           React コンポーネント + UI ロジック
  ui-contract.ts  テスト安定名定義(data-ui属性の名簿)
  main.tsx      エントリ(useServiceWorker 配線のみ)
  App.tsx       アプリシェル(store 初期化・view 管理・history 配線)
```

---

## データフロー

```
UI 操作
  ↓
store.ts(React state + saveNow/persistActiveOrThrow)
  ↓
data/storage.ts → createDatabase (foundation)
  ↓
IndexedDB  ← runtime truth(アプリデータ本体はここだけ)
  ↓
localStorage  ← PointerStore(LOCAL_PREFIX 配下の短い同期ポインタのみ)

保存 2 系統:
  - fail-closed 系統: saveBundle/saveGlobalSettings 等 → 失敗は throw
  - fire-and-forget 系統: autosave(saveNow) → 失敗は toast + warn に縮退

スナップショット(foundation snapshot/snapshots):
  - 破壊操作前に自動撮影 → TTL 14日 → 専用 IDB(SNAPSHOT_DB_NAME)
  - purgeForScopes: tombstone で追跡し取りこぼしなく削除

import/export(foundation exchange/*):
  - 7段階 fail-closed: ①parse ②封筒 ③migration ④完全検証 ⑤revision ⑥スナップショット ⑦原子置換
  - ⑦成功まで既存データを変更しない

QR フロー:
  - send: domain → wire 変換 → packPayload(crypto) → encodePages(protocol) → qrcodegen
  - recv: jsqr → decodePage → assemblePages → unpackPayload → normalize → apply(fail-closed)
```

---

## v1 → v2 識別子対応表

| 対象 | v1(読み取り専用参照) | v2 |
|---|---|---|
| HR IDB 名 | `hospital-rounds` | `hospital-rounds-v2` |
| HR snapshot IDB | `hospital-rounds-snapshots` | `hospital-rounds-v2-snapshots` |
| HR eventlog IDB | `hospital-rounds-eventlog` | `hospital-rounds-v2-eventlog` |
| HR localStorage prefix | `hospital_rounds_*` | `hrv2.*` |
| HR SW cache | `hospital-rounds-v11`(現行) | `hospital-rounds-v2-v1` |
| SL IDB 名 | `simple-ledger` | `simple-ledger-v2` |
| SL appId(封筒) | `snishi-code.simple-ledger` | `snishi-code.simple-ledger-v2` |
| SL localStorage prefix | `simple-ledger.*`(v1) | `slv2.*` |
| SL SW cache prefix | `simple-ledger-*` | `simple-ledger-v2-*` |

v2 はこれらを **絶対に使わない・書かない・消さない**。識別子は各アプリの `src/data/constants.ts` に一箇所集約し、コードに散らさない。

---

## 設計上の不変条件

- IndexedDB が runtime truth。localStorage はポインタのみ。
- 外部送信ゼロ: fetch/XHR 等は `// network-ok:` 注釈なしに禁止(tools/no-exfil-guard.sh がガード)。
- 保存・削除・復元・import は fail-closed。
- SW は凍結更新ポリシー: skipWaiting / clients.claim / registration.update を持たない。
- v1 データを読まない・書かない・消さない。
