// Phase P3: deriveLegacyDisplayMap のテスト
// (a) 旧グループから display 導出
// (b) isDefault が無い/複数ある縮退
// (c) expandFormatIds が formatIds の部分集合でないデータ
// (d) formats に display 混在 (部分移行) 時は raw.display 優先
// (e) 新形式 raw では null を返し素通し
// (f) normalizeSettings を2回通して安定 (冪等)

import { describe, expect, it } from 'vitest';
import { deriveLegacyDisplayMap, needsLegacyResave } from './legacyMigrate';
import { normalizeSettings } from './normalize';

// ── helpers ──

function makeOldRaw(overrides: {
  formats?: Array<Record<string, unknown>>;
  formatGroups?: Array<Record<string, unknown>>;
}) {
  return {
    formats: overrides.formats ?? [
      { id: 'f1', name: 'S1', panel: 'S', joiner: ', ', items: [] },
      { id: 'f2', name: 'O1', panel: 'O', joiner: ', ', items: [] },
      { id: 'f3', name: 'O2', panel: 'O', joiner: ', ', items: [] },
    ],
    formatGroups: overrides.formatGroups ?? [
      {
        id: 'g1',
        name: '標準',
        isDefault: true,
        formatIds: ['f1', 'f2', 'f3'],
        defaultFormatIds: [],
        expandFormatIds: ['f1', 'f2'],
      },
    ],
  };
}

// ────────────────────────────────────────────────

describe('deriveLegacyDisplayMap', () => {
  it('(a) 旧グループから display を正しく導出する', () => {
    const raw = makeOldRaw({});
    const map = deriveLegacyDisplayMap(raw);
    expect(map).not.toBeNull();
    expect(map!.get('f1')).toBe('expand');
    expect(map!.get('f2')).toBe('expand');
    expect(map!.get('f3')).toBe('quick'); // expandFormatIds に含まれない
  });

  it('(b) isDefault が無い場合は先頭グループを使う', () => {
    const raw = makeOldRaw({
      formatGroups: [
        {
          id: 'g1',
          name: 'グループA',
          isDefault: false,
          formatIds: ['f1', 'f2', 'f3'],
          defaultFormatIds: [],
          expandFormatIds: ['f3'], // f3 だけ展開
        },
      ],
    });
    const map = deriveLegacyDisplayMap(raw);
    expect(map).not.toBeNull();
    expect(map!.get('f1')).toBe('quick');
    expect(map!.get('f2')).toBe('quick');
    expect(map!.get('f3')).toBe('expand');
  });

  it('(b) isDefault が複数ある場合は先頭 isDefault=true のものを使う', () => {
    const raw = makeOldRaw({
      formatGroups: [
        {
          id: 'g1',
          name: 'グループA',
          isDefault: true,
          formatIds: ['f1'],
          defaultFormatIds: [],
          expandFormatIds: ['f1'],
        },
        {
          id: 'g2',
          name: 'グループB',
          isDefault: true,
          formatIds: ['f2'],
          defaultFormatIds: [],
          expandFormatIds: ['f2'],
        },
      ],
    });
    const map = deriveLegacyDisplayMap(raw);
    expect(map).not.toBeNull();
    // g1 が先頭デフォルトなので g1 の expandFormatIds を使う
    expect(map!.get('f1')).toBe('expand');
    // f2 は g1 の expandFormatIds に含まれないので quick
    expect(map!.get('f2')).toBe('quick');
  });

  it('(c) expandFormatIds が formatIds の部分集合でないデータでも動く (safe fallback)', () => {
    // expandFormatIds に f_unknown が混入 (formatIds 外)
    const raw = makeOldRaw({
      formatGroups: [
        {
          id: 'g1',
          name: '標準',
          isDefault: true,
          formatIds: ['f1', 'f2'],
          defaultFormatIds: [],
          expandFormatIds: ['f1', 'f_unknown'], // f_unknown は formats に存在しない
        },
      ],
    });
    const map = deriveLegacyDisplayMap(raw);
    expect(map).not.toBeNull();
    expect(map!.get('f1')).toBe('expand');
    expect(map!.get('f2')).toBe('quick');
    // f_unknown はそもそも formats に無いのでマップに含まれない
    expect(map!.has('f_unknown')).toBe(false);
  });

  it('(d) formats に display 混在 (部分移行) 時: deriveLegacyDisplayMap は null → normalizeFormat で raw.display 優先', () => {
    // f1 だけ display 付き (新形式) → 全フォーマットが display 済みにならないため旧データ扱い
    const raw = {
      formats: [
        { id: 'f1', name: 'S1', panel: 'S', joiner: ', ', display: 'quick', items: [] },
        { id: 'f2', name: 'O1', panel: 'O', joiner: ', ', items: [] }, // display なし
      ],
      formatGroups: [
        {
          id: 'g1',
          name: '標準',
          isDefault: true,
          formatIds: ['f1', 'f2'],
          defaultFormatIds: [],
          expandFormatIds: ['f2'], // f2=expand、f1=quick (グループ上)
        },
      ],
    };
    const map = deriveLegacyDisplayMap(raw);
    // f2 が display なしなので旧データ判定
    expect(map).not.toBeNull();
    // normalizeFormat は raw.display が 'quick'|'expand' ならそれ優先
    // → f1 の display='quick' は raw.display 優先
    // → f2 は map から 'expand'
    expect(map!.get('f1')).toBe('quick'); // expandFormatIds に f1 無いので quick
    expect(map!.get('f2')).toBe('expand');
  });

  it('(e) 新形式 raw (全フォーマットが display 持つ) では null を返す', () => {
    const raw = {
      formats: [
        { id: 'f1', name: 'S1', panel: 'S', joiner: ', ', display: 'expand', items: [] },
        { id: 'f2', name: 'O1', panel: 'O', joiner: ', ', display: 'quick', items: [] },
      ],
      // formatGroups があっても全フォーマットが display 付きなら null
      formatGroups: [
        { id: 'g1', name: '標準', isDefault: true, formatIds: ['f1', 'f2'], expandFormatIds: ['f1'] },
      ],
    };
    const map = deriveLegacyDisplayMap(raw);
    expect(map).toBeNull();
  });

  it('(e) formatGroups が空配列なら null を返す', () => {
    const raw = makeOldRaw({ formatGroups: [] });
    expect(deriveLegacyDisplayMap(raw)).toBeNull();
  });

  it('(e) formatGroups が無いなら null を返す', () => {
    const raw = { formats: [{ id: 'f1', name: 'A', panel: 'S', joiner: ', ', items: [] }] };
    expect(deriveLegacyDisplayMap(raw)).toBeNull();
  });
});

describe('normalizeSettings 冪等性 (f)', () => {
  it('(f) 旧データを normalizeSettings に2回通しても結果が安定する', () => {
    const oldRaw = {
      formats: [
        { id: 'f1', name: '自覚症状', panel: 'S', joiner: ', ', items: [{ label: '', kind: 'text', normal: '特になし' }] },
        { id: 'f2', name: 'バイタル', panel: 'O', joiner: ', ', labelSep: ' ', titleWrap: '（）', items: [{ label: 'BP', kind: 'fraction', unit: 'mmHg' }] },
      ],
      formatGroups: [
        {
          id: 'g1',
          name: '標準',
          isDefault: true,
          formatIds: ['f1', 'f2'],
          defaultFormatIds: [],
          expandFormatIds: ['f1'],
        },
      ],
      clearTargets: { S: true, O: true, A: false, P: true, statusYellow: true, statusGreen: true, statusGray: true, statusBlue: false },
      tags: [],
    };

    const first = normalizeSettings(oldRaw);
    // 1回目: f1 → expand (expandFormatIds に含む)、f2 → quick
    const f1 = first.formats.find((f) => f.name === '自覚症状');
    const f2 = first.formats.find((f) => f.name === 'バイタル');
    expect(f1?.display).toBe('expand');
    expect(f2?.display).toBe('quick');

    // 2回目: 正規化済みオブジェクトを再度 normalizeSettings に通す (冪等)
    const second = normalizeSettings(first as unknown as Record<string, unknown>);
    const f1b = second.formats.find((f) => f.name === '自覚症状');
    const f2b = second.formats.find((f) => f.name === 'バイタル');
    expect(f1b?.display).toBe('expand'); // 保持
    expect(f2b?.display).toBe('quick');  // 保持
  });
});

describe('needsLegacyResave', () => {
  it('旧 formatGroups (display なし formats) があれば true', () => {
    const raw = {
      formats: [{ id: 'f1', name: 'S1', panel: 'S', joiner: ', ', items: [] }],
      formatGroups: [
        { id: 'g1', name: '標準', isDefault: true, formatIds: ['f1'], defaultFormatIds: [], expandFormatIds: ['f1'] },
      ],
      tags: [],
    };
    expect(needsLegacyResave(raw)).toBe(true);
  });

  it('旧 string タグが混ざっていれば true', () => {
    expect(needsLegacyResave({ tags: ['血液', { name: '主治医', clearOnStart: false }] })).toBe(true);
  });

  it('新形式 (TagDef タグ + display 付き formats + formatGroups なし) は false', () => {
    const raw = {
      formats: [{ id: 'f1', name: 'S1', panel: 'S', joiner: ', ', items: [], display: 'expand' }],
      tags: [{ name: '主治医', clearOnStart: false }],
    };
    expect(needsLegacyResave(raw)).toBe(false);
  });

  it('normalizeSettings の出力を再判定すると false (再保存ループしない)', () => {
    const old = {
      formats: [{ id: 'f1', name: 'S1', panel: 'S', joiner: ', ', items: [] }],
      formatGroups: [
        { id: 'g1', name: '標準', isDefault: true, formatIds: ['f1'], defaultFormatIds: [], expandFormatIds: [] },
      ],
      tags: ['血液'],
    };
    expect(needsLegacyResave(old)).toBe(true);
    const normalized = normalizeSettings(old);
    expect(needsLegacyResave(normalized as unknown as Record<string, unknown>)).toBe(false);
  });
});
