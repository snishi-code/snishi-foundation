# QR セキュリティ

## Wire Format Authority の正本

transport 層の仕様は `packages/foundation/src/qr/protocol.ts` の冒頭 doc comment が正本。ドメイン wire 変換(短キー定義・WIRE_V・enum テーブル)は `apps/hospital-rounds-v2/src/qr/wire.ts` 冒頭が正本。各アプリの種別モジュールは必ずこれらを経由し、独自 format を定義しない。

---

## transport 仕様

### ページ書式(共通ヘッダー)

```
RND_<KIND> #<batchId> N/M\n<本文>
```

- KIND: 2文字以上の大文字(HM / MM / SH / ST / FMT / FS)
- batchId: `Date.now().toString(36)` で生成
- N/M: ページ番号 / 総ページ数

1 QR あたりの上限: 750 bytes。ヘッダー予算 50 bytes を差し引いた 700 bytes が本文の上限。

### transport prefix(crypto 層)

| prefix | 形式 | 利用場面 |
|---|---|---|
| なし(平文) | `<payload>` | 後方互換。受信は平文も受け付ける |
| `C1:` | `C1:<base64url(deflate-raw(plain))>` | 圧縮のみ(v8.11+) |
| `E1:` | `E1:<base64url(iv ‖ AES-GCM(plain))>` | 暗号のみ(v7.1.x、受信互換) |
| `E2:` | `E2:<base64url(iv ‖ AES-GCM(deflate-raw(plain))))>` | 圧縮+暗号(v7.2.0+、現行送信形式) |

暗号化: AES-GCM 256bit(WebCrypto)。IV 12 bytes をメッセージごとに `getRandomValues`、認証タグ 16 bytes(改ざん検知)。

foundation `qr/crypto` は鍵を持たない設計。アプリが `packPayload(plain, { encrypt: true, keyBytes })` で注入する。

### multi-page

750 bytes を超えるペイロードは複数ページに分割。`assemblePages` は全ページが揃うまで(かつ totalPages が一致するまで)null を返す(fail-closed: 欠けたまま復号させない)。

---

## v1 互換維持の判断

HR-v2 は v1 端末と QR を交換できる必要がある(v1 端末と v2 端末が混在する移行期)。

**同一鍵の必然**: 暗号化 QR(E1/E2)を相互に読み合うには両者が同一の AES-GCM 鍵を持つ必要がある。1 byte でも変えると v1↔v2 の暗号化 QR 交換が全て復号エラーになる。

**同一 wire format**: WIRE_V(HM3/MM3/SH3/ST6/FMT3/FS2)は v1 実装値と完全一致させる。ここを変える = v1 との QR 互換破壊。

鍵の格納場所: `apps/hospital-rounds-v2/src/qr/appKey.ts` のみ。foundation に置かない(全アプリ共有を防ぐため)。

---

## 固定鍵の限界(脅威モデルへの明記)

- ソース埋め込み鍵なので、バンドルされた JS から抽出可能。**厳密な秘匿性はない**。
- 脅威モデルは「第三者が普通の QR スキャナで偶発的に読み取った時に、医療情報が即座に平文で流出するのを防ぐ」ことのみ。
- アプリを入手した者(= バンドル JS にアクセスできる者)には秘匿不能。
- したがって暗号化 ON でも QR の取り扱い(画面を見せる相手・距離)の運用注意は不要にならない。

---

## QR 再配布制限(qrRedistribution / origin:external)

HR-v2 は `qrRedistribution`(受け取った QR の再送信禁止)と `origin:external` を QR ペイロードに含める。受信側は origin が external の QR を再配布しない(実装はアプリ側の責務)。foundation は この制限を wire format として transport するだけで、ポリシー適用はアプリ側。

---

## plaintext EHR QR の必要性とリスク

**必要性**: 電子カルテ(EHR)等の外部システムが生成した QR は暗号化されていない平文 QR の場合がある。電子カルテ転記のユースケースでは平文 QR も受信できる必要がある(後方互換の plain 受信)。

**リスク**: 平文 QR は肩越しスキャン(shoulder surfing)で内容が読取可能。暗号化 QR に比べてプライバシーリスクが高い。

**対策**: アプリは QR 種別(plain / 暗号化)を受信時に識別し、平文 QR の受信は必要なユースケースに限定する(アプリ側の責務)。

---

## fail-closed の原則

- parse 失敗・decrypt 失敗・改ざん検知は throw。握って成功扱いにしない。
- `decodePage` がヘッダー形式に合わなければ null。
- `assemblePages` が全ページ未揃いなら null。
- `unpackPayload` の復号失敗は throw(fail-closed)。
- QR 取込(save)が失敗したら in-memory をロールバックして中断。成功表示へ進めない。
