// 移植元: snishi-code-medical/hospital-rounds/src/features/crypto-payload.js の APP_KEY_BYTES
//
// ============================================================================
// なぜ v1 と同一の鍵をコピーするのか (QR 互換の必須条件)
//
// QR transport の暗号化 (E1/E2 prefix、foundation qr/crypto の packPayload/unpackPayload)
// は AES-GCM 256bit の固定鍵で行う。**現行 v1 アプリ (hospital-rounds) の端末と v2 端末が
// 混在する期間に互いの暗号化 QR を読み合うには、両者が同一鍵である必要がある**。
// 1 byte でも変えると v1↔v2 の暗号化 QR 交換が全て復号エラーになる。
//
// この鍵の限界 (v1 から変わらない・正しく理解して使うこと):
//   - ソース埋め込み鍵なので、バンドルされた JS から抽出可能。**厳密な秘匿性は無い**。
//   - 脅威モデルは「第三者が普通の QR スキャナで偶発的に読み取った時に、医療情報が
//     即座に平文で流出するのを防ぐ」ことのみ。意図的な攻撃者には無力。
//   - したがって暗号化 ON でも QR の取り扱い (画面を見せる相手・距離) の運用注意は不要に
//     ならない。
//
// foundation qr/crypto は鍵を持たない設計 (アプリ毎の鍵分離のため)。このアプリ固有の
// 鍵はここ 1 箇所にだけ置き、packPayload/unpackPayload 呼び出し時に注入する。
// ============================================================================

/** アプリ固定鍵 (32 byte = 256 bit)。v1 crypto-payload.js と完全一致 (変更厳禁)。 */
export const APP_KEY_BYTES = new Uint8Array([
  0x47, 0xa5, 0x1c, 0x9b, 0x38, 0x6d, 0x2e, 0x71, 0xf4, 0x83, 0x05, 0xcc, 0x9a, 0x4d, 0x62, 0x18,
  0xb7, 0x29, 0x5a, 0xe0, 0x3c, 0x91, 0x8f, 0x46, 0xd2, 0x57, 0x6a, 0x0b, 0xfd, 0xe5, 0x18, 0x73,
]);
