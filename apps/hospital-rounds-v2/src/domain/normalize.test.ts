// 移植元 v1 test/check.mjs の正規化系ケース相当 + 仕様の「不正データ→デフォルト /
// 未知フィールド温存 roundtrip」検査。
// Phase P3: formatGroups 全廃。Format.display テストを追加。

import { describe, expect, it } from 'vitest';
import {
  defaultSettings,
  isPatientEmpty,
  makeDefaultPatient,
  normalizeFormat,
  normalizeFormatItem,
  normalizeLoaded,
  normalizePatientArray,
  normalizeSettings,
} from './normalize';
import { migrateLegacyTagList } from './legacyMigrate';
import { FORMAT_PANELS, STATUS } from './types';
import type { TagDef } from './types';

describe('defaultSettings (cold boot)', () => {
  it('S/O/A/P 全パネルに既定フォーマットを持つ', () => {
    const s = defaultSettings();
    const panels = new Set(s.formats.map((f) => f.panel));
    for (const p of FORMAT_PANELS) expect(panels.has(p)).toBe(true);
  });

  it('全フォーマットが display フィールドを持つ (expand|quick)', () => {
    const s = defaultSettings();
    for (const f of s.formats) {
      expect(['expand', 'quick']).toContain(f.display);
    }
  });

  it('formatGroups フィールドは存在しない (P3: FormatGroup 全廃)', () => {
    const s = defaultSettings();
    expect('formatGroups' in s).toBe(false);
  });

  it('qrEncryption / qrRedistribution は Settings に含まれない (QR_ENCRYPT 固定定数に移行)', () => {
    const s = defaultSettings();
    expect('qrEncryption' in s).toBe(false);
    expect('qrRedistribution' in s).toBe(false);
  });
});

describe('normalizeSettings', () => {
  it('不正データ (非 object / null) はデフォルトに倒す', () => {
    for (const raw of [null, undefined, 42, 'x', []]) {
      const s = normalizeSettings(raw);
      expect(s.formats.length).toBeGreaterThan(0);
      // 全フォーマットが display を持つ
      for (const f of s.formats) {
        expect(['expand', 'quick']).toContain(f.display);
      }
    }
  });

  it('未知フィールドは破棄される (後方互換不要の v2 設計)', () => {
    const raw = {
      ...defaultSettings(),
      futureFeature: { nested: [1, 2, 3] },
      tagGroups: ['旧 v7.6 の撤去済みフィールド'],
    };
    const s1 = normalizeSettings(raw);
    expect('futureFeature' in s1).toBe(false);
    expect('tagGroups' in s1).toBe(false);
  });

  it('clearTargets: 型不一致キーは既定値、boolean は尊重', () => {
    const s = normalizeSettings({ clearTargets: { S: false, O: 'yes', statusYellow: false } });
    expect(s.clearTargets.S).toBe(false); // 明示 false を尊重
    expect(s.clearTargets.O).toBe(true); // 型不一致 → 既定 true
    expect(s.clearTargets.statusYellow).toBe(false);
    expect(s.clearTargets.statusGray).toBe(true); // 未指定 → 既定
  });

  it('clearTargets: tagGray と tagAmber が既定値で含まれる', () => {
    const s = normalizeSettings({});
    expect(typeof s.clearTargets.tagGray).toBe('boolean');
    expect(typeof s.clearTargets.tagAmber).toBe('boolean');
    // defaults.json の既定値
    expect(s.clearTargets.tagGray).toBe(false);
    expect(s.clearTargets.tagAmber).toBe(true);
  });

  it('clearTargets: tagGray/tagAmber の明示 boolean を尊重する', () => {
    const s = normalizeSettings({ clearTargets: { tagGray: true, tagAmber: false } });
    expect(s.clearTargets.tagGray).toBe(true);
    expect(s.clearTargets.tagAmber).toBe(false);
  });

  it('formats が空配列ならデフォルト formats を採用する', () => {
    const s = normalizeSettings({ formats: [] });
    expect(s.formats.length).toBeGreaterThan(0);
  });

  it('既存設定にも O 欄のシンプル所見 (_backfillAlways) を補填する', () => {
    // O パネルを持つが「所見」が無い設定 → backfill が追加する
    const custom = {
      formats: [
        {
          id: 'f1',
          name: 'カスタムO',
          panel: 'O',
          joiner: ', ',
          labelSep: '：',
          titleWrap: '',
          tags: [],
          display: 'expand',
          items: [{ label: '', kind: 'text', normal: 'x' }],
        },
      ],
    };
    const s = normalizeSettings(custom);
    expect(s.formats.some((f) => f.panel === 'O' && f.name === '所見')).toBe(true);
    // 各パネル (S/O/A/P) が埋まる
    const panels = new Set(s.formats.map((f) => f.panel));
    for (const p of FORMAT_PANELS) expect(panels.has(p)).toBe(true);
  });

  it('formatGroups を持つ旧データを読んでも settings に formatGroups は残らない', () => {
    const s = normalizeSettings({
      formats: [
        {
          id: 'f1',
          name: 'A',
          panel: 'S',
          items: [{ label: '', kind: 'text', normal: '' }],
        },
      ],
      formatGroups: [
        { id: 'g1', name: 'G1', isDefault: false, formatIds: ['f1'], defaultFormatIds: ['f1'], expandFormatIds: ['f1'] },
      ],
    });
    expect('formatGroups' in s).toBe(false);
    // formats は存在する
    expect(s.formats.length).toBeGreaterThan(0);
  });

  it('旧 formatGroups から display が移行導出される', () => {
    const s = normalizeSettings({
      formats: [
        { id: 'f1', name: 'S1', panel: 'S', joiner: ', ', items: [{ label: '', kind: 'text', normal: '' }] },
        { id: 'f2', name: 'O1', panel: 'O', joiner: ', ', items: [{ label: '', kind: 'text', normal: '' }] },
      ],
      formatGroups: [
        {
          id: 'g1',
          name: '標準',
          isDefault: true,
          formatIds: ['f1', 'f2'],
          defaultFormatIds: [],
          expandFormatIds: ['f1'], // f1=expand、f2=quick
        },
      ],
    });
    const f1 = s.formats.find((f) => f.id === 'f1');
    const f2 = s.formats.find((f) => f.id === 'f2');
    expect(f1?.display).toBe('expand');
    expect(f2?.display).toBe('quick');
  });

  it('qrEncryption / qrRedistribution: 旧データに残っていても破棄される (QR_ENCRYPT 固定定数に移行)', () => {
    const s = normalizeSettings({
      qrEncryption: { HM: false, XX: true, ST: 'yes' },
      qrRedistribution: { HM: 'free', ST: 'restricted' },
    });
    expect('qrEncryption' in s).toBe(false);
    expect('qrRedistribution' in s).toBe(false);
  });
});

describe('normalizeFormatItem', () => {
  it('旧 "date" kind は fraction に移行する', () => {
    const it1 = normalizeFormatItem({ label: '入院日', kind: 'date' }, 'O', 'x');
    expect(it1?.kind).toBe('fraction');
  });

  it('fraction の fracMode: 明示は尊重 / 未指定は安全側 text / 既定バイタル BP だけ numeric 補正', () => {
    expect(
      normalizeFormatItem({ label: 'BP', kind: 'fraction', unit: 'mmHg' }, 'O', 'バイタル')?.fracMode,
    ).toBe('numeric');
    expect(
      normalizeFormatItem({ label: 'BP', kind: 'fraction', unit: 'mmHg', fracMode: 'text' }, 'O', 'バイタル')
        ?.fracMode,
    ).toBe('text');
    expect(normalizeFormatItem({ label: '抗菌薬', kind: 'fraction', unit: '' }, 'O', 'x')?.fracMode).toBe(
      'text',
    );
  });

  it('number は label 必須 (空は null)。text は label 任意', () => {
    expect(normalizeFormatItem({ label: '', kind: 'number' }, 'O', 'x')).toBeNull();
    expect(normalizeFormatItem({ label: '', kind: 'text', normal: 'n' }, 'O', 'x')).toEqual({
      label: '',
      kind: 'text',
      normal: 'n',
    });
  });
});

describe('normalizeFormat', () => {
  it('name 必須・panel 不正は O・labelSep は items から推定', () => {
    expect(normalizeFormat({ name: '' }, null)).toBeNull();
    const f = normalizeFormat({
      name: 'X',
      panel: 'ZZZ',
      items: [
        { label: 'a', kind: 'text', normal: '' },
        { label: 'b', kind: 'text', normal: '' },
      ],
    }, null);
    expect(f?.panel).toBe('O');
    expect(f?.labelSep).toBe('：'); // 全 text → "："
    const f2 = normalizeFormat({ name: 'Y', items: [{ label: 'n', kind: 'number' }] }, null);
    expect(f2?.labelSep).toBe(' ');
  });

  it('display: expand/quick を解決し、未指定はデフォルト expand', () => {
    const expand = normalizeFormat({ name: 'X', panel: 'S', display: 'expand', items: [] }, null);
    expect(expand?.display).toBe('expand');
    const quick = normalizeFormat({ name: 'X', panel: 'S', display: 'quick', items: [] }, null);
    expect(quick?.display).toBe('quick');
    const dflt = normalizeFormat({ name: 'X', panel: 'S', items: [] }, null);
    expect(dflt?.display).toBe('expand'); // 未指定 → 既定 expand
  });

  it('displayMap が渡された場合は map の値を使う (raw.display 優先)', () => {
    const map = new Map([['fid1', 'quick' as const]]);
    const fromMap = normalizeFormat({ id: 'fid1', name: 'X', panel: 'S', items: [] }, map);
    expect(fromMap?.display).toBe('quick'); // map から
    // raw.display が明示されていれば map より優先
    const overridden = normalizeFormat({ id: 'fid1', name: 'X', panel: 'S', display: 'expand', items: [] }, map);
    expect(overridden?.display).toBe('expand'); // raw.display 優先
  });
});

describe('normalizePatientArray / normalizeLoaded', () => {
  it('null → DEFAULT_PATIENT_COUNT (50) 件のデフォルト患者', () => {
    const arr = normalizePatientArray(null);
    expect(arr).toHaveLength(50);
    expect(arr.every((p) => typeof p.pid === 'string' && p.pid.length > 0)).toBe(true);
    expect(arr.every((p) => p.status === STATUS.NONE)).toBe(true);
  });

  it('型不一致フィールドはデフォルトに倒す', () => {
    const [p] = normalizePatientArray([
      {
        pid: 123, // 不正 → 新発番
        status: 'purple', // 不正 → none
        name: 42, // 不正 → ''
        room: '203',
        tags: ['a', '', 7, ' '], // 文字列かつ非空白のみ
        updatedAt: 'yesterday', // 不正 → 0
        formatValues: 'broken', // 不正 → {}
      },
    ]);
    expect(typeof p?.pid).toBe('string');
    expect(p?.pid).not.toBe('123');
    expect(p?.status).toBe('none');
    expect(p?.name).toBe('');
    expect(p?.room).toBe('203');
    expect(p?.tags).toEqual(['a']);
    expect(p?.updatedAt).toBe(0);
    expect('origin' in (p ?? {})).toBe(false);
    expect(p?.formatValues).toEqual({});
  });

  it('未知フィールドは破棄される (後方互換不要の v2 設計)', () => {
    const [p1] = normalizePatientArray([
      { pid: 'p1', name: 'A', futureFlag: true, nested: { a: 1 } },
    ]);
    expect('futureFlag' in (p1 ?? {})).toBe(false);
    expect('nested' in (p1 ?? {})).toBe(false);
    expect(p1?.name).toBe('A');
  });

  it('normalizeLoaded: bundle / 配列 / {patients} を appState 形に正規化', () => {
    const fromArr = normalizeLoaded([{ pid: 'x', name: 'N' }]);
    expect(fromArr.v).toBe(3);
    expect(fromArr.patients[0]?.name).toBe('N');
    expect(fromArr.title).toBe('回診');
    const fromObj = normalizeLoaded({
      title: 'T',
      patients: [{ pid: 'y' }],
    });
    expect(fromObj.title).toBe('T');
    expect(fromObj.patients[0]?.pid).toBe('y');
  });
});

describe('isPatientEmpty', () => {
  it('デフォルト患者 (status NONE・全初期値) は空', () => {
    expect(isPatientEmpty(makeDefaultPatient())).toBe(true);
  });

  it('status NONE でも name/room/tags/移動マーカー/削除マーカーがあれば空ではない', () => {
    expect(isPatientEmpty({ ...makeDefaultPatient(), name: 'A' })).toBe(false);
    expect(isPatientEmpty({ ...makeDefaultPatient(), room: '203' })).toBe(false);
    expect(isPatientEmpty({ ...makeDefaultPatient(), tags: ['内科'] })).toBe(false);
    expect(isPatientEmpty({ ...makeDefaultPatient(), transferredAt: 123 })).toBe(false);
    expect(isPatientEmpty({ ...makeDefaultPatient(), deletedAt: 123 })).toBe(false);
  });

  it('YELLOW/GREEN/GRAY/BLUE は他フィールドが空でも空ではない (GRAY=終了マーカー保護)', () => {
    for (const status of ['yellow', 'green', 'gray', 'blue'] as const) {
      expect(isPatientEmpty({ ...makeDefaultPatient(), status })).toBe(false);
    }
  });

  it('formatValues: 旧文字列値 / {value,note} / 注記だけ → 非空。全空オブジェクトは空', () => {
    const base = makeDefaultPatient();
    expect(isPatientEmpty({ ...base, formatValues: { f1: { 0: '96' } } })).toBe(false);
    expect(isPatientEmpty({ ...base, formatValues: { f1: { 0: { value: '96', note: '' } } } })).toBe(
      false,
    );
    expect(isPatientEmpty({ ...base, formatValues: { f1: { 0: { value: '', note: 'O2 2L' } } } })).toBe(
      false,
    );
    expect(isPatientEmpty({ ...base, formatValues: { f1: { 0: { value: '', note: '' }, 1: '' } } })).toBe(
      true,
    );
    // fraction の "/" だけは入力なし扱い
    expect(isPatientEmpty({ ...base, formatValues: { f1: { 0: '/' } } })).toBe(true);
  });
});

describe('migrateLegacyTagList (旧 string[] → TagDef[] 移行・色タグ対応)', () => {
  it('旧形式 (string 要素) → { name, color: gray }', () => {
    const result = migrateLegacyTagList(['内科', '外科', '要フォロー']);
    expect(result).toEqual([
      { name: '内科', color: 'gray' },
      { name: '外科', color: 'gray' },
      { name: '要フォロー', color: 'gray' },
    ]);
  });

  it('新形式 (TagDef color 付き) は素通しで validation', () => {
    const input: TagDef[] = [
      { name: '内科', color: 'amber' },
      { name: '外科', color: 'gray' },
    ];
    expect(migrateLegacyTagList(input)).toEqual(input);
  });

  it('空文字・trim 後空は捨てる', () => {
    expect(migrateLegacyTagList(['', '  ', '内科'])).toEqual([{ name: '内科', color: 'gray' }]);
  });

  it('不正要素 (数値・null・boolean・配列) は捨てる', () => {
    expect(migrateLegacyTagList([42, null, true, [], '内科'])).toEqual([
      { name: '内科', color: 'gray' },
    ]);
  });

  it('重複 name は先勝ち (string と object が混在しても)', () => {
    const result = migrateLegacyTagList(['内科', '内科', { name: '内科', color: 'amber' }]);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ name: '内科', color: 'gray' }); // 先勝ち = string 由来 → gray
  });

  it('name が非文字列のオブジェクトは捨てる', () => {
    expect(migrateLegacyTagList([{ name: 123, color: 'gray' }, { name: '内科', color: 'gray' }])).toEqual([
      { name: '内科', color: 'gray' },
    ]);
  });

  it('旧形式 clearOnStart: true → color: amber に変換される', () => {
    expect(migrateLegacyTagList([{ name: '内科', clearOnStart: true }])).toEqual([
      { name: '内科', color: 'amber' },
    ]);
  });

  it('旧形式 clearOnStart: false → color: gray に変換される', () => {
    expect(migrateLegacyTagList([{ name: '内科', clearOnStart: false }])).toEqual([
      { name: '内科', color: 'gray' },
    ]);
  });

  it('非配列入力は空配列を返す', () => {
    expect(migrateLegacyTagList(null)).toEqual([]);
    expect(migrateLegacyTagList(undefined)).toEqual([]);
    expect(migrateLegacyTagList('内科')).toEqual([]);
  });
});

describe('normalizeSettings: tags の TagDef 移行 (旧 string[] / 新形式 / 2回通し冪等)', () => {
  it('旧 string[] → normalizeSettings が TagDef[] に変換する', () => {
    const s = normalizeSettings({ tags: ['内科', '外科'] });
    expect(s.tags).toEqual([
      { name: '内科', color: 'gray' },
      { name: '外科', color: 'gray' },
    ]);
  });

  it('新形式 (TagDef color 付き) はそのまま素通し', () => {
    const tags: TagDef[] = [
      { name: '内科', color: 'amber' },
      { name: '外科', color: 'gray' },
    ];
    const s = normalizeSettings({ tags });
    expect(s.tags).toEqual(tags);
  });

  it('2回通して冪等 (再保存→再読み込み経路で変化しない)', () => {
    const raw = { tags: ['内科', '外科'] };
    const s1 = normalizeSettings(raw);
    const s2 = normalizeSettings(JSON.parse(JSON.stringify(s1)));
    expect(s2.tags).toEqual(s1.tags);
    expect(s2.tags).toEqual([
      { name: '内科', color: 'gray' },
      { name: '外科', color: 'gray' },
    ]);
  });
});
