// 移植元: snishi-code-medical/hospital-rounds/src/features/qr-format.js の encode/decode 部
//
// フォーマット 1 つだけを QR で共有 (FMT)。
//
// 受信ポリシー (v1 で合意済み・apply は UI 層が実装):
//   - ID: 常に新発番 (修正版の上書きを避ける)
//   - 同名: 末尾に "(2)", "(3)"... と自動付与で常に追加成功 (foundation qr/protocol の uniqueName)
//   - tags: 受信側に未登録のタグは無視 (タグ辞書を勝手に増やさない)
//
// FMT は単独フォーマット QR なので tag dict のオーバーヘッドを避けるため
// tags は文字列のまま wire に乗せる (formatToWire に tagDict=null を渡す)。
//
// v1 Phase 7: panel enum 拡張のため WIRE_V を 2→3 に bump 済み。旧版は明示エラーで弾く。

import type { Format } from '../domain/types';
import { WIRE_V, formatFromWire, formatToWire, type WireFormat } from './wire';

export const FORMAT_WIRE_V = WIRE_V.FMT;

/** format → FMT payload 文字列 (純関数)。format が null なら空文字 (= QR を表示しない)。 */
export function encodeFormatPayload(format: Format | null | undefined): string {
  if (!format) return '';
  return JSON.stringify({ v: FORMAT_WIRE_V, f: formatToWire(format, null) });
}

/**
 * FMT payload 文字列 → format オブジェクト (id なし。受信側で新発番する)。
 * name 欠落・version 不一致は throw (fail-closed)。
 */
export function decodeFormatPayload(payload: string): Omit<Format, 'id'> {
  const obj: unknown = JSON.parse(String(payload || ''));
  if (!obj || typeof obj !== 'object') throw new Error('qr format: invalid payload');
  const rec = obj as Record<string, unknown>;
  if (rec.v !== FORMAT_WIRE_V) {
    throw new Error(`qr format: version mismatch (got ${String(rec.v)}, expected ${FORMAT_WIRE_V})`);
  }
  if (!rec.f || typeof rec.f !== 'object') throw new Error('qr format: missing format');
  const fmt = formatFromWire(rec.f as WireFormat, null);
  if (!fmt.name) throw new Error('qr format: missing name');
  return fmt;
}
