// ============================================================
// このファイルは旧スキーマからの一回限り移行専用。
//
// 背景: settings.tags が string[] から TagDef[] へ変更された際に
// 既存の保存データ (旧スキーマ) を安全に読み込むため、このファイルに
// 移行ロジックを隔離した。
//
// 削除タイミング: 開発者端末・テスト端末のデータがすべて新スキーマ
// (TagDef[]) で保存し直された後は、このファイルごと削除し、
// normalize.ts の tags 正規化を素通し (`out.tags = raw.tags as TagDef[]`
// のような単純な代入 + validation) に戻すこと。
// ============================================================

import type { TagDef } from './types';

/**
 * 旧 string[] 形式または新 TagDef[] 形式の raw tags を TagDef[] に正規化する。
 * - 旧形式 (string 要素): { name: trim済み, clearOnStart: false } に変換
 * - 新形式 (オブジェクト要素): name (string・trim非空) / clearOnStart (boolean・既定false) を validation
 * - 不正要素 (空文字列・型不正・name 非文字列 等) は捨てる
 * - 重複 name は先勝ち
 */
export function migrateLegacyTagList(raw: unknown): TagDef[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: TagDef[] = [];
  for (const item of raw) {
    if (typeof item === 'string') {
      const name = item.trim();
      if (!name) continue;
      if (seen.has(name)) continue;
      seen.add(name);
      out.push({ name, clearOnStart: false });
    } else if (item && typeof item === 'object' && !Array.isArray(item)) {
      const rec = item as Record<string, unknown>;
      if (typeof rec.name !== 'string') continue;
      const name = rec.name.trim();
      if (!name) continue;
      if (seen.has(name)) continue;
      seen.add(name);
      const clearOnStart = typeof rec.clearOnStart === 'boolean' ? rec.clearOnStart : false;
      out.push({ name, clearOnStart });
    }
    // その他の型 (数値・null 等) は捨てる
  }
  return out;
}
