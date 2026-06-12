// ============================================================
// このファイルは旧スキーマからの一回限り移行専用。
//
// 背景 1 (Phase P1): settings.tags が string[] から TagDef[] へ変更された際に
// 既存の保存データ (旧スキーマ) を安全に読み込むため、このファイルに
// 移行ロジックを隔離した。
//
// 背景 2 (Phase P3): Format.display (expand|quick) の追加に伴い、旧 formatGroups
// の expandFormatIds からの一回限りの導出をここで行う。
//
// 背景 3 (色タグ): TagDef.clearOnStart → TagDef.color へのスキーマ変更。
// 旧形式 { name, clearOnStart } を { name, color } に移行する。
//   - clearOnStart === true → color = 'amber'
//   - clearOnStart === false / 未定義 → color = 'gray'
// color フィールドを既に持つ場合は素通し。
//
// 削除タイミング: 開発者端末・テスト端末のデータがすべて新スキーマで保存し直された後は、
// このファイルごと削除し、normalize.ts の移行ロジックを素通しに戻すこと。
// ============================================================

import { TAG_COLORS, type FormatDisplay, type TagColor, type TagDef } from './types';

/**
 * 旧 string[] 形式または旧 TagDef(clearOnStart) 形式、または新 TagDef(color) 形式の raw tags を
 * 新 TagDef[] (color 付き) に正規化する一回限り移行関数。
 * - 旧形式 (string 要素): { name: trim済み, color: 'gray' } に変換
 * - 旧 TagDef (clearOnStart フィールドあり・color なし):
 *     clearOnStart === true → color = 'amber'、それ以外 → color = 'gray'
 * - 新 TagDef (color フィールドあり):
 *     color が TAG_COLORS に含まれればそれを使う。含まれなければ 'gray' に倒す
 * - 不正要素 (空文字列・型不正・name 非文字列 等) は捨てる
 * - 重複 name は先勝ち
 */
export function migrateLegacyTagList(raw: unknown): TagDef[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: TagDef[] = [];
  for (const item of raw) {
    if (typeof item === 'string') {
      // 旧 string 形式 → gray (ニュートラル)
      const name = item.trim();
      if (!name) continue;
      if (seen.has(name)) continue;
      seen.add(name);
      out.push({ name, color: 'gray' });
    } else if (item && typeof item === 'object' && !Array.isArray(item)) {
      const rec = item as Record<string, unknown>;
      if (typeof rec.name !== 'string') continue;
      const name = rec.name.trim();
      if (!name) continue;
      if (seen.has(name)) continue;
      seen.add(name);
      let color: TagColor;
      if (typeof rec.color === 'string' && (TAG_COLORS as readonly string[]).includes(rec.color)) {
        // 新形式: color フィールドが正規値 → そのまま使う
        color = rec.color as TagColor;
      } else if (typeof rec.clearOnStart === 'boolean') {
        // 旧形式: clearOnStart → amber/gray に変換
        color = rec.clearOnStart ? 'amber' : 'gray';
      } else {
        // 未知形式 → gray に倒す (fail-safe)
        color = 'gray';
      }
      out.push({ name, color });
    }
    // その他の型 (数値・null 等) は捨てる
  }
  return out;
}

/**
 * 旧 formatGroups (expandFormatIds ベース) から各フォーマットの display を導出するマップを返す。
 *
 * 検出条件 (旧データ):
 *   - raw.formatGroups が非空配列
 *   - かつ raw.formats のうち display フィールドを持たないものがある
 * どちらかが欠ける場合は null を返す (移行不要)。
 *
 * 導出ルール:
 *   - デフォルトグループ = isDefault===true の先頭。無ければ先頭グループ。
 *   - 各 formatId について expandFormatIds に含まれる → 'expand'、それ以外 → 'quick'。
 *   - グループの formatIds に含まれないフォーマット → 'quick' (safe default)。
 */
export function deriveLegacyDisplayMap(raw: unknown): Map<string, FormatDisplay> | null {
  if (!raw || typeof raw !== 'object') return null;
  const rec = raw as Record<string, unknown>;

  // 旧データ判定: formatGroups が非空配列
  const groups = Array.isArray(rec.formatGroups) ? rec.formatGroups : [];
  if (!groups.length) return null;

  // raw.formats のうち display を持たないものがあるか判定
  const formats = Array.isArray(rec.formats) ? rec.formats : [];
  const hasFormatWithoutDisplay = formats.some((f: unknown) => {
    if (!f || typeof f !== 'object') return false;
    const fRec = f as Record<string, unknown>;
    return fRec.display !== 'expand' && fRec.display !== 'quick';
  });
  if (!hasFormatWithoutDisplay) return null; // 全フォーマットが display 済み = 移行不要

  // デフォルトグループを選ぶ
  const validGroups = groups.filter(
    (g: unknown): g is Record<string, unknown> =>
      !!g && typeof g === 'object' && !Array.isArray(g),
  );
  const defaultGroup =
    validGroups.find((g) => !!g.isDefault) ?? validGroups[0] ?? null;
  if (!defaultGroup) return null;

  const expandSet = new Set<string>(
    Array.isArray(defaultGroup.expandFormatIds)
      ? (defaultGroup.expandFormatIds as unknown[]).filter(
          (x): x is string => typeof x === 'string',
        )
      : [],
  );

  const map = new Map<string, FormatDisplay>();
  for (const f of formats) {
    if (!f || typeof f !== 'object') continue;
    const fRec = f as Record<string, unknown>;
    if (typeof fRec.id !== 'string' || !fRec.id) continue;
    const display: FormatDisplay = expandSet.has(fRec.id) ? 'expand' : 'quick';
    map.set(fRec.id, display);
  }
  return map;
}

/**
 * raw settings が旧スキーマで、normalize 結果をディスクへ保存し直すべきか。
 * 「読むだけでは保存されない」と display/tags の移行が毎回再導出になり、
 * 本ファイルを削除した瞬間に旧データの表示方式が失われるため、initStore /
 * switchUser / import の再保存トリガに必ず含める。
 *   - 旧 string タグが混ざっている
 *   - clearOnStart フィールドを持つ (color を持たない) タグ混入
 *   - 旧 formatGroups からの display 導出が必要 (deriveLegacyDisplayMap が非 null)
 */
export function needsLegacyResave(raw: unknown): boolean {
  if (!raw || typeof raw !== 'object') return false;
  const rec = raw as Record<string, unknown>;
  if (Array.isArray(rec.tags)) {
    for (const t of rec.tags) {
      if (typeof t === 'string') return true;
      if (t && typeof t === 'object' && !Array.isArray(t)) {
        const r = t as Record<string, unknown>;
        // clearOnStart フィールドがある (旧形式) = resave が必要
        if ('clearOnStart' in r) return true;
      }
    }
  }
  return deriveLegacyDisplayMap(raw) !== null;
}
