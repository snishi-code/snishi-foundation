// 移植元: snishi-code-medical/hospital-rounds/src/features/qr-settings.js の encode/decode 部
//
// 設定 QR (ST) — 設定全体 (formats + clearTargets + tags)。
// wire format の詳細は qr/wire.ts の Wire Format Authority コメントを参照。
//
// 形式 (v7):
//   {
//     "v": 7,
//     "td": ["内科","外科"],           // tag dictionary
//     "f":  [<formatToWire>, ...],     // formats (q:1 = quick / 省略 = expand)
//     "ct": {S:true,O:true,...}        // clearTargets
//   }
//
// v2: パネル縮小 (S/O/A/P のみ) のため WIRE_V を 6→7 に bump。
// v7 のみ受理し、それ以外は version mismatch エラー。
// 端末固有値 (deviceId 等) は wire に載せない。
//
// 受信フローの apply (confirm ダイアログ・saveSettingsOrThrow + ロールバック) は UI 層の
// 責務 (fail-closed: 保存が確認できてから閉じる/成功表示。失敗は in-memory を戻して中断)。

import { FORMAT_PANELS, type Format, type Settings, type TagDef } from '../domain/types';
import { newFormatId } from '../domain/normalize';
import {
  WIRE_V,
  formatFromWire,
  formatToWire,
  type WireFormat,
} from './wire';

export const SETTINGS_WIRE_V = WIRE_V.ST;

/** settings → ST payload 文字列 (純関数・テスト容易化のため export)。 */
export function encodeSettingsPayload(settings: Settings): string {
  const tagDefs = Array.isArray(settings.tags) ? settings.tags : [];
  const tagDict = tagDefs.map((t) => t.name);
  const formats = Array.isArray(settings.formats) ? settings.formats : [];

  const out: Record<string, unknown> = { v: SETTINGS_WIRE_V };
  // td は「設定全体のタグ辞書」。設定全体 QR なので空でも常に載せる
  // (= 受信側のタグを送信側に一致させる。0 個ならタグ消去も伝わる)。
  out.td = tagDict;
  // tc: clearOnStart=true のタグの 1-based index 配列。空なら省略。
  const tc = tagDefs
    .map((t, i) => (t.clearOnStart ? i + 1 : 0))
    .filter((i) => i > 0);
  if (tc.length) out.tc = tc;
  if (formats.length) out.f = formats.map((f) => formatToWire(f, tagDict));
  if (settings.clearTargets && typeof settings.clearTargets === 'object') {
    out.ct = settings.clearTargets;
  }
  return JSON.stringify(out);
}

/** 受信して適用可能な settings 断片。formats は ID 解決済み (= そのまま適用可)。 */
export interface DecodedSettingsPatch {
  tags: TagDef[];
  formats?: Format[];
  clearTargets?: Record<string, boolean>;
}

/**
 * ST payload 文字列 → 適用可能な settings 断片。
 * formats は新 ID 採番済み。
 */
export function decodeSettingsPayload(payload: string): DecodedSettingsPatch {
  const obj: unknown = JSON.parse(String(payload || ''));
  if (!obj || typeof obj !== 'object') throw new Error('qr settings: invalid payload');
  const rec = obj as Record<string, unknown>;
  const v = rec.v;
  if (v !== SETTINGS_WIRE_V) {
    throw new Error(`qr settings: version mismatch (got ${String(v)}, expected ${SETTINGS_WIRE_V})`);
  }

  const tagDict = Array.isArray(rec.td)
    ? rec.td.filter((s): s is string => typeof s === 'string')
    : [];
  // tc: clearOnStart=true のタグの 1-based index 配列 (新フィールド・旧版では省略)
  const clearOnStartSet = new Set<number>(
    Array.isArray(rec.tc)
      ? (rec.tc as unknown[]).filter((v): v is number => typeof v === 'number' && v >= 1)
      : [],
  );
  const decodedTags: TagDef[] = tagDict.map((name, i) => ({
    name,
    clearOnStart: clearOnStartSet.has(i + 1),
  }));
  const out: DecodedSettingsPatch = {
    // td は常に送る (設定全体) ので tags を常に適用 = 空配列ならタグ消去も反映。
    tags: decodedTags,
  };

  // formats: 新 ID 採番。
  if (Array.isArray(rec.f)) {
    out.formats = (rec.f as WireFormat[]).map((w) => ({
      id: newFormatId(),
      ...formatFromWire(w, tagDict),
    }));
  }

  if (rec.ct && typeof rec.ct === 'object') {
    // 適用先 (applySettingsPatch) は normalizeSettings を通さないため、ここで
    // 正規キー (S/O/A/P + statusXxx) 以外を落とす (旧版 QR の遺残キー混入防止)。
    const allowed = new Set<string>([...FORMAT_PANELS, 'statusYellow', 'statusGreen', 'statusGray', 'statusBlue']);
    out.clearTargets = {};
    for (const [k, val] of Object.entries(rec.ct as Record<string, unknown>)) {
      if (allowed.has(k) && typeof val === 'boolean') out.clearTargets[k] = val;
    }
  }
  // 未知フィールド (fg / tge / tgs / tga 等の v1 遺残) は無視する。
  return out;
}
