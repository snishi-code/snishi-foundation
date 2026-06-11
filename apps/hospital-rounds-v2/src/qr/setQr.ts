// 移植元: snishi-code-medical/hospital-rounds/src/features/qr-set.js の encode/decode 部
//
// セット QR (FS) — フォーマットセット (formatGroup) 1 つ + 参照フォーマット一式。
// wire format は qr/wire.ts の formatToWire / formatGroupToWire に委譲
// (Wire Format Authority 参照)。セットは formats 配列への 1-based index 参照。
//
// 受信ポリシー (apply は UI 層が実装。常に新規追加):
//   - formats: 新 ID 採番で全件追加。同名は (2)/(3)… に rename (FMT と同等)
//   - セット : 新 ID・isDefault=false・新 format ID 参照で追加。同名セットは rename
//   - 取込後に repairGroupExpandInvariant で「含むパネルの展開 1 つ以上」を補修する
//
// v1 Phase 7: panel enum 拡張のため WIRE_V を 1→2 に bump 済み。旧版は明示エラーで弾く。

import type { Format, FormatGroup } from '../domain/types';
import { newFormatId } from '../domain/normalize';
import {
  WIRE_V,
  formatFromWire,
  formatGroupFromWire,
  formatGroupToWire,
  formatToWire,
  type WireFormat,
  type WireFormatGroup,
} from './wire';

export const SET_WIRE_V = WIRE_V.FS;

/**
 * セット + 参照 formats → FS payload 文字列 (純関数)。
 *   group      : formatGroup (null なら空文字 = QR を表示しない)
 *   allFormats : settings.formats 相当 (group.formatIds の解決元)
 *   tagDict    : settings.tags 相当 (空/未指定ならタグは文字列のまま inline)
 */
export function encodeSetPayload(
  group: FormatGroup | null | undefined,
  allFormats: readonly Format[],
  tagDict?: readonly string[],
): string {
  if (!group) return '';
  const formats = Array.isArray(allFormats) ? allFormats : [];
  // セットが参照する formats を formatIds 順に解決
  const refFormats = (Array.isArray(group.formatIds) ? group.formatIds : [])
    .map((id) => formats.find((f) => f.id === id))
    .filter((f): f is Format => !!f);
  const dict = Array.isArray(tagDict) && tagDict.length ? tagDict : null;

  const out: Record<string, unknown> = { v: SET_WIRE_V };
  if (dict) out.td = dict.slice();
  out.f = refFormats.map((f) => formatToWire(f, dict));
  // refFormats 内での 1-based index に解決
  const idToIndex = (id: string): number | undefined => {
    const i = refFormats.findIndex((f) => f.id === id);
    return i >= 0 ? i + 1 : undefined;
  };
  // FS は単体セット共有。受信側では常に非デフォルトで追加するので、wire に isDefault(d) は
  // 載せない (送信元のデフォルト状態を持ち込まない)。
  out.g = formatGroupToWire({ ...group, isDefault: false }, idToIndex);
  return JSON.stringify(out);
}

export interface DecodedSetPayload {
  /** 新 ID 採番済み */
  formats: Format[];
  /** formats の新 ID を参照済み (id は無し = 受信側で新発番) */
  group: Omit<FormatGroup, 'id'>;
}

/** FS payload 文字列 → { formats, group } (純関数)。 */
export function decodeSetPayload(payload: string): DecodedSetPayload {
  const obj: unknown = JSON.parse(String(payload || ''));
  if (!obj || typeof obj !== 'object') throw new Error('qr set: invalid payload');
  const rec = obj as Record<string, unknown>;
  if (rec.v !== SET_WIRE_V) {
    throw new Error(`qr set: version mismatch (got ${String(rec.v)}, expected ${SET_WIRE_V})`);
  }
  if (!rec.g || typeof rec.g !== 'object') throw new Error('qr set: missing set');
  const td = Array.isArray(rec.td)
    ? rec.td.filter((s): s is string => typeof s === 'string')
    : null;
  const formats: Format[] = (Array.isArray(rec.f) ? (rec.f as WireFormat[]) : []).map((w) => ({
    id: newFormatId(),
    ...formatFromWire(w, td),
  }));
  const group = formatGroupFromWire(rec.g as WireFormatGroup, formats);
  return { formats, group };
}
