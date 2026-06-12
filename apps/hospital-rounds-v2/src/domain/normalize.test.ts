// 移植元 v1 test/check.mjs の正規化系ケース相当 + 仕様の「不正データ→デフォルト /
// 未知フィールド温存 roundtrip」検査。

import { describe, expect, it } from 'vitest';
import {
  defaultSettings,
  ensureOneDefaultGroup,
  isPatientEmpty,
  makeDefaultPatient,
  normalizeFormat,
  normalizeFormatItem,
  normalizeLoaded,
  normalizePatientArray,
  normalizeSettings,
} from './normalize';
import { FORMAT_PANELS, STATUS } from './types';
import type { FormatGroup } from './types';

// problem / shared は機能撤去済みのため、既定フォーマットを置かない (既存データは温存)。
const PANELS_WITH_DEFAULT_FORMATS = FORMAT_PANELS.filter((p) => p !== 'problem' && p !== 'shared');

describe('defaultSettings (cold boot)', () => {
  it('S/O/A/P に既定フォーマットを持つ (problem / shared は対象外)', () => {
    const s = defaultSettings();
    const panels = new Set(s.formats.map((f) => f.panel));
    for (const p of PANELS_WITH_DEFAULT_FORMATS) expect(panels.has(p)).toBe(true);
    expect(panels.has('problem')).toBe(false);
    expect(panels.has('shared')).toBe(false);
  });

  it('デフォルトグループがちょうど 1 つ存在し、全 format を展開に持つ', () => {
    const s = defaultSettings();
    const defs = s.formatGroups.filter((g) => g.isDefault);
    expect(defs).toHaveLength(1);
    const def = defs[0]!;
    // defaults.json: 標準グループは全 formats を formatIndexes + expandFormatIndexes に持つ
    expect(def.formatIds.length).toBeGreaterThan(0);
    expect(def.expandFormatIds).toEqual(def.formatIds);
  });

  it('qrEncryption / qrRedistribution の既定値 (MM/SH/FMT/FS は機能撤去済み)', () => {
    const s = defaultSettings();
    expect(s.qrEncryption).toEqual({ HM: true, ST: true });
    expect(s.qrRedistribution).toEqual({
      HM: 'restricted',
      ST: 'free',
    });
  });
});

describe('normalizeSettings', () => {
  it('不正データ (非 object / null) はデフォルトに倒す', () => {
    for (const raw of [null, undefined, 42, 'x', []]) {
      const s = normalizeSettings(raw);
      expect(s.formats.length).toBeGreaterThan(0);
      expect(s.formatGroups.filter((g) => g.isDefault)).toHaveLength(1);
    }
  });

  it('未知フィールドを温存する (forward compat roundtrip)', () => {
    const raw = {
      ...defaultSettings(),
      futureFeature: { nested: [1, 2, 3] },
      tagGroups: ['旧 v7.6 の撤去済みフィールド'],
    };
    const s1 = normalizeSettings(raw);
    expect(s1.futureFeature).toEqual({ nested: [1, 2, 3] });
    expect(s1.tagGroups).toEqual(['旧 v7.6 の撤去済みフィールド']);
    // 再正規化 (読み戻し→再保存経路) でも消えない
    const s2 = normalizeSettings(JSON.parse(JSON.stringify(s1)));
    expect(s2.futureFeature).toEqual({ nested: [1, 2, 3] });
  });

  it('clearTargets: 型不一致キーは既定値、boolean は尊重', () => {
    const s = normalizeSettings({ clearTargets: { S: false, O: 'yes', statusYellow: false } });
    expect(s.clearTargets.S).toBe(false); // 明示 false を尊重
    expect(s.clearTargets.O).toBe(true); // 型不一致 → 既定 true
    expect(s.clearTargets.statusYellow).toBe(false);
    expect(s.clearTargets.statusGray).toBe(true); // 未指定 → 既定
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
          items: [{ label: '', kind: 'text', normal: 'x' }],
        },
      ],
    };
    const s = normalizeSettings(custom);
    expect(s.formats.some((f) => f.panel === 'O' && f.name === '所見')).toBe(true);
    // 各パネル (problem 以外) が埋まる
    const panels = new Set(s.formats.map((f) => f.panel));
    for (const p of PANELS_WITH_DEFAULT_FORMATS) expect(panels.has(p)).toBe(true);
  });

  it('formatGroups: malformed を除外し「ちょうど 1 つ default」を担保。df/xf は部分集合に正規化', () => {
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
        { id: 'g1', name: 'G1', isDefault: false, formatIds: ['f1'], defaultFormatIds: ['f1', 'zz'], expandFormatIds: ['zz'] },
        { id: 'g2', name: 'G2', isDefault: false, formatIds: [], defaultFormatIds: [], expandFormatIds: [] },
        { notAnId: true },
      ],
    });
    expect(s.formatGroups.map((g) => g.id)).toEqual(['g1', 'g2']);
    expect(s.formatGroups.filter((g) => g.isDefault)).toHaveLength(1);
    expect(s.formatGroups[0]?.isDefault).toBe(true); // 先頭昇格
    const g1 = s.formatGroups[0]!;
    expect(g1.defaultFormatIds).toEqual(['f1']); // 'zz' は formatIds 非所属で除外
    // backfill が欠けたパネルの既定フォーマットをデフォルトグループ (g1) に補填し、
    // 修正1 が「含む全パネルに expand あり」を担保する (f1 = S パネルも expand に昇格)
    expect(g1.expandFormatIds).toContain('f1');
    const panels = new Set(s.formats.map((f) => f.panel));
    for (const p of PANELS_WITH_DEFAULT_FORMATS) expect(panels.has(p)).toBe(true);
    expect(
      g1.expandFormatIds.every((id) => g1.formatIds.includes(id)),
    ).toBe(true);
  });

  it('qrEncryption / qrRedistribution: 保存値に関わらずコード内固定値へ正規化する (v1 authority)', () => {
    // 旧 UI 由来の値が保存に残っていても、常にデフォルト (全 kind 暗号化 ON /
    // HM のみ再配布制限) で動作する。ユーザー設定としては露出しない。
    const s = normalizeSettings({
      qrEncryption: { HM: false, XX: true, ST: 'yes' },
      qrRedistribution: { HM: 'free', ST: 'restricted' },
    });
    expect(s.qrEncryption.HM).toBe(true);
    expect(s.qrEncryption.ST).toBe(true);
    expect(s.qrRedistribution.HM).toBe('restricted');
    expect(s.qrRedistribution.ST).toBe('free');
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
    expect(normalizeFormat({ name: '' })).toBeNull();
    const f = normalizeFormat({
      name: 'X',
      panel: 'ZZZ',
      items: [
        { label: 'a', kind: 'text', normal: '' },
        { label: 'b', kind: 'text', normal: '' },
      ],
    });
    expect(f?.panel).toBe('O');
    expect(f?.labelSep).toBe('：'); // 全 text → "："
    const f2 = normalizeFormat({ name: 'Y', items: [{ label: 'n', kind: 'number' }] });
    expect(f2?.labelSep).toBe(' ');
  });
});

describe('ensureOneDefaultGroup', () => {
  const g = (id: string, isDefault: boolean): FormatGroup => ({
    id,
    name: id,
    isDefault,
    formatIds: [],
    defaultFormatIds: [],
    expandFormatIds: [],
  });

  it('複数 default → 最初の 1 つだけ残す / 0 個 → 先頭昇格 / 空配列はそのまま', () => {
    const multi = ensureOneDefaultGroup([g('a', true), g('b', true)]);
    expect(multi.map((x) => x.isDefault)).toEqual([true, false]);
    const none = ensureOneDefaultGroup([g('a', false), g('b', false)]);
    expect(none.map((x) => x.isDefault)).toEqual([true, false]);
    expect(ensureOneDefaultGroup([])).toEqual([]);
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
        origin: 'somewhere', // 'external' 以外 → ''
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
    expect(p?.origin).toBe('');
    expect(p?.formatValues).toEqual({});
  });

  it('未知フィールドを温存する (forward compat roundtrip)', () => {
    const [p1] = normalizePatientArray([
      { pid: 'p1', name: 'A', futureFlag: true, nested: { a: 1 } },
    ]);
    expect(p1?.futureFlag).toBe(true);
    expect(p1?.nested).toEqual({ a: 1 });
    // 再正規化でも消えない
    const [p2] = normalizePatientArray([JSON.parse(JSON.stringify(p1))]);
    expect(p2?.futureFlag).toBe(true);
    expect(p2?.name).toBe('A');
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
