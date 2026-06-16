// ============================================================================
// QR Policy Authority — kind / use-case ごとの QR 方針の正本
//
// QR を「画面ごとの個別判断」から「use-case ごとのデータ側 policy」へ寄せる。
// HM / ST / 患者詳細 (TAB) の各 QR は本ファイルの policy を参照し、暗号化・順序・
// 静的/動的・再配布・鍵 profile を screen 側で個別に決めない。
//
// policy はコード内固定値であり、ユーザー設定 UI には出さない (v1 v7.1+ と同方針。
// セキュリティ軸を設定に晒さない = normalizeSettings が qrEncryption / qrRedistribution
// を Settings から排除しているのと同じ理由)。
//
// ── 4 軸 (+ 鍵 profile) ──
//   order        : ordered     = ページ順固定 (電子カルテ標準カメラで順に読む TAB)
//                  unordered   = 順不同受信を許容 (動的 QR をカメラで貯める HM/ST)
//   protection   : plain       = 平文 (qr/crypto を通さない)
//                  encrypted   = AES-GCM 固定鍵 (E1/E2 prefix)
//   presentationDefault : static  = 表示開始時は自動送りを止める (手動送り前提の TAB)
//                         dynamic = 表示開始時から自動送り (アニメーション QR)
//   redistribution : allowed    = 受信データの再配布を許容
//                    prohibited = 名簿 (PII) の再配布を抑止 (HM)
//   keyProfile   : app-fixed   = アプリ固定鍵 (現状唯一。将来ユーザー鍵を足す余地)
//
// ── wire 短キー方針 (将来の HM payload 拡張に向けた明文化) ──
//
//   domain / apply / UI 側は読みやすい名前 (redistribution, presentationDefault,
//   keyProfile, rosterAuthorityId, rosterWardId, rosterPatientId 等) を使う。
//   短縮するのは QR payload に載せる **wire 境界だけ** (src/qr/wire.ts の責務)。
//   UI や apply 処理に短縮キーを直書きしない。HM v5 で実装済みの短縮キー:
//     redistribution      -> rd    (HM v5 m.rd)
//     rosterAuthorityId   -> aid   (HM v5 m.wn と並ぶ m.aid)
//     rosterWardId        -> wid   (HM v5 m.wid)
//     rosterPatientId     -> rpid  (HM v5 p[].rpid)
//   ※ presentationDefault / keyProfile は code 固定 policy であり QR には載せない
//      (将来ユーザー鍵 profile を足しても鍵そのものは載せない)。
//   ※ HM payload への正本 ID (aid/wid/rpid) は第二段階で実装済み
//      (src/qr/wire.ts WIRE_V.HM=5)。localRole は載せない。鍵は載せない。
// ============================================================================

import { APP_KEY_BYTES } from './appKey';

export type QrOrder = 'ordered' | 'unordered';
export type QrProtection = 'plain' | 'encrypted';
export type QrPresentationDefault = 'static' | 'dynamic';
export type QrRedistribution = 'allowed' | 'prohibited';
export type QrKeyProfile = 'app-fixed';

/** QR の use-case。HM=患者名簿 / ST=設定 / TAB=電子カルテ転記用患者詳細。 */
export type QrUseCase = 'HM' | 'ST' | 'TAB';

export interface QrPolicy {
  order: QrOrder;
  protection: QrProtection;
  presentationDefault: QrPresentationDefault;
  redistribution: QrRedistribution;
  keyProfile: QrKeyProfile;
}

// use-case ごとの policy 正本。新 use-case を足す時はここに 1 行追加する。
const QR_POLICY: Readonly<Record<QrUseCase, QrPolicy>> = Object.freeze({
  // 電子カルテ貼付用患者詳細 QR。平文・順固定・静的・再配布可。
  TAB: Object.freeze({
    order: 'ordered',
    protection: 'plain',
    presentationDefault: 'static',
    redistribution: 'allowed',
    keyProfile: 'app-fixed',
  }),
  // 患者名簿 QR。暗号化・順不同・動的・再配布禁止 (PII)。
  HM: Object.freeze({
    order: 'unordered',
    protection: 'encrypted',
    presentationDefault: 'dynamic',
    redistribution: 'prohibited',
    keyProfile: 'app-fixed',
  }),
  // 設定 QR。暗号化・順不同・動的・再配布可。
  ST: Object.freeze({
    order: 'unordered',
    protection: 'encrypted',
    presentationDefault: 'dynamic',
    redistribution: 'allowed',
    keyProfile: 'app-fixed',
  }),
});

/** use-case の policy 全体を取得する。 */
export function getQrPolicy(useCase: QrUseCase): QrPolicy {
  return QR_POLICY[useCase];
}

/** 送信時に暗号化するか (protection === 'encrypted')。 */
export function shouldEncryptQr(useCase: QrUseCase): boolean {
  return QR_POLICY[useCase].protection === 'encrypted';
}

/** 表示開始時の静的/動的 (static = 止めて開く / dynamic = 自動送りで開く)。 */
export function getQrPresentationDefault(useCase: QrUseCase): QrPresentationDefault {
  return QR_POLICY[useCase].presentationDefault;
}

// keyProfile → 鍵 bytes の解決テーブル。将来ユーザー鍵 profile を足す時はここに 1 行
// 追加する (UI は今回作らない)。鍵そのものは QR payload に決して載せない。
const KEY_PROFILE_BYTES: Readonly<Record<QrKeyProfile, Uint8Array>> = Object.freeze({
  'app-fixed': APP_KEY_BYTES,
});

/**
 * policy の keyProfile から鍵 bytes を解決する。keyProfile 未指定は app-fixed 扱い。
 * 未知 profile も安全側でアプリ固定鍵に倒す (鍵不在で送受信不能にしない)。
 */
export function resolveQrKeyBytes(policy: { keyProfile?: QrKeyProfile }): Uint8Array {
  const profile = policy.keyProfile ?? 'app-fixed';
  return KEY_PROFILE_BYTES[profile] ?? APP_KEY_BYTES;
}

/** use-case の policy から鍵 bytes を解決する (packPayload / unpackPayload へ注入)。 */
export function getQrKeyBytes(useCase: QrUseCase): Uint8Array {
  return resolveQrKeyBytes(QR_POLICY[useCase]);
}
