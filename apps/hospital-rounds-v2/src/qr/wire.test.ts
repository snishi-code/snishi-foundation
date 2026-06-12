// QR wire の v2 自己一致歩哨テスト。
//
// v1 互換は正式終了 (2026-06)。EXPECTED_* は v2 の実装値と一致する正本。
// このアプリの新旧バージョン間でのみ互換を保証する。

import { describe, expect, it } from 'vitest';
import type { Format, FormatGroup, Patient, Settings, TagDef } from '../domain/types';
import { defaultSettings, makeDefaultPatient } from '../domain/normalize';
import {
  KIND_BY_INDEX,
  PANEL_BY_INDEX,
  WIRE_V,
  formatFromWire,
  formatGroupFromWire,
  formatGroupToWire,
  formatToWire,
  patientFromWire,
  patientToWire,
} from './wire';
import { decodePatientList, encodePatientList } from './patientList';
import { decodeSettingsPayload, encodeSettingsPayload } from './settingsQr';

// ============================
// 固定入力 (fixture 生成スクリプトと同一)
// ============================

const tagDict = ['内科', '外科', '要フォロー'];
/** tagDict を TagDef[] に変換するヘルパ (wire テスト用。clearOnStart は false 固定) */
function tagDefsFrom(names: string[]): TagDef[] {
  return names.map((name) => ({ name, clearOnStart: false }));
}

const fmtVitals: Format = {
  id: 'fmt_a',
  name: 'バイタル',
  panel: 'O',
  joiner: ', ',
  labelSep: ' ',
  titleWrap: '（）',
  tags: ['内科', '未知タグ'],
  items: [
    { label: 'BP', kind: 'fraction', unit: 'mmHg', fracMode: 'numeric' },
    { label: 'P', kind: 'number', unit: 'bpm' },
    { label: 'SpO2', kind: 'number', unit: '%' },
  ],
};

const fmtFindings: Format = {
  id: 'fmt_b',
  name: '身体所見',
  panel: 'O',
  joiner: '\n',
  labelSep: '：',
  titleWrap: '',
  tags: [],
  items: [
    { label: 'General', kind: 'text', normal: '良好' },
    { label: '', kind: 'text', normal: '特になし' },
  ],
};

const group: FormatGroup = {
  id: 'grp_x',
  name: '標準',
  isDefault: true,
  formatIds: ['fmt_a', 'fmt_b', 'fmt_missing'],
  defaultFormatIds: ['fmt_b'],
  expandFormatIds: ['fmt_a'],
};

function makePatient(over: Partial<Patient>): Patient {
  return { ...makeDefaultPatient(), ...over };
}

function settingsWith(over: Partial<Settings>): Settings {
  return { ...defaultSettings(), ...over };
}

// ============================
// v1 実出力 fixture (正本)
// ============================

const EXPECTED_FORMAT_DICT = {
  n: 'バイタル',
  p: 1,
  ls: ' ',
  tw: '（）',
  t: [1],
  i: [
    { l: 'BP', k: 2, u: 'mmHg', fm: 1 },
    { l: 'P', k: 1, u: 'bpm' },
    { l: 'SpO2', k: 1, u: '%' },
  ],
};

const EXPECTED_FORMAT_NODICT = {
  n: 'バイタル',
  p: 1,
  ls: ' ',
  tw: '（）',
  t: ['内科', '未知タグ'],
  i: [
    { l: 'BP', k: 2, u: 'mmHg', fm: 1 },
    { l: 'P', k: 1, u: 'bpm' },
    { l: 'SpO2', k: 1, u: '%' },
  ],
};

const EXPECTED_FORMAT_TEXT = {
  n: '身体所見',
  p: 1,
  j: '\n',
  ls: '：',
  i: [
    { l: 'General', k: 0, nm: '良好' },
    { l: '', k: 0, nm: '特になし' },
  ],
};

const EXPECTED_GROUP = { n: '標準', d: 1, fi: [1, 2], df: [2], xf: [1] };

const EXPECTED_PATIENT = {
  r: '203',
  n: 'テスト太郎',
  t: [1, 3],
  c: '本日|気分\n良好',
};

const EXPECTED_WIRE_FORMATS = [
  EXPECTED_FORMAT_DICT,
  EXPECTED_FORMAT_TEXT,
];

const EXPECTED_ST = {
  v: 7,
  td: tagDict,
  f: EXPECTED_WIRE_FORMATS,
  fg: [EXPECTED_GROUP],
  ct: {
    S: true,
    O: true,
    A: false,
    P: true,
    statusYellow: true,
    statusGreen: true,
    statusGray: true,
    statusBlue: false,
  },
};

// ============================
// enum 表と WIRE_V (v2 自己一致歩哨)
// ============================

describe('wire enum tables / WIRE_V (v2 自己一致)', () => {
  it('PANEL_BY_INDEX は FORMAT_PANELS と一致する (S/O/A/P の4パネル)', () => {
    expect(PANEL_BY_INDEX).toEqual(['S', 'O', 'A', 'P']);
    expect(KIND_BY_INDEX).toEqual(['text', 'number', 'fraction']);
  });

  it('kind 別 WIRE_V は v2 バンプ後の期待値と一致する', () => {
    expect(WIRE_V).toEqual({ HM: 4, ST: 7 });
  });
});

// ============================
// formatToWire / formatGroupToWire / patientToWire (v1 実出力との一致)
// ============================

describe('format/group/patient wire 歩哨 (v1 実出力 fixture)', () => {
  it('formatToWire (tag dict あり): 既知タグは 1-based index、未知タグは除外', () => {
    expect(formatToWire(fmtVitals, tagDict)).toEqual(EXPECTED_FORMAT_DICT);
  });

  it('formatToWire (dict=null): タグは文字列のまま inline', () => {
    expect(formatToWire(fmtVitals, null)).toEqual(EXPECTED_FORMAT_NODICT);
  });

  it('formatToWire: default joiner ", " は省略 / 非 default joiner は j に載る', () => {
    expect(formatToWire(fmtFindings, tagDict)).toEqual(EXPECTED_FORMAT_TEXT);
  });

  it('formatGroupToWire: f 配列への 1-based index 参照。解決できない ID は除外', () => {
    const idToIndex = (id: string) => ({ fmt_a: 1, fmt_b: 2 })[id as 'fmt_a'];
    expect(formatGroupToWire(group, idToIndex)).toEqual(EXPECTED_GROUP);
  });

  it('patientToWire: 既知タグのみ 1-based index、content は trim して c に載る', () => {
    const p = makePatient({ room: '203', name: 'テスト太郎', tags: ['内科', '未知タグ', '要フォロー'] });
    expect(patientToWire(p, tagDict, '本日|気分\n良好')).toEqual(EXPECTED_PATIENT);
  });

  it('patientToWire: content=null (HM) かつ空患者 → {} (空スロット)', () => {
    const p = makePatient({});
    expect(patientToWire(p, tagDict, null)).toEqual({});
  });

  it('formatFromWire round-trip: fracMode (numeric) と未指定→text 安全側を保持', () => {
    const back = formatFromWire(formatToWire(fmtVitals, tagDict), tagDict);
    expect(back.name).toBe('バイタル');
    expect(back.panel).toBe('O');
    expect(back.joiner).toBe(', ');
    expect(back.labelSep).toBe(' ');
    expect(back.titleWrap).toBe('（）');
    expect(back.tags).toEqual(['内科']); // 未知タグは送信時に落ちている
    expect(back.items[0]).toEqual({ label: 'BP', kind: 'fraction', unit: 'mmHg', fracMode: 'numeric' });
    expect(back.items[1]).toEqual({ label: 'P', kind: 'number', unit: 'bpm' });
    // fm 無しの fraction は安全側 text
    expect(formatFromWire({ n: 'x', p: 2, i: [{ l: 'd', k: 2 }] }, null).items[0]?.fracMode).toBe(
      'text',
    );
  });

  it('formatGroupFromWire round-trip: index → 新 ID 解決、範囲外 index は除外', () => {
    const formats = [{ id: 'new_1' }, { id: 'new_2' }, { id: 'new_3' }];
    const g = formatGroupFromWire({ n: '標準', d: 1, fi: [1, 3, 9], df: [3], xf: [1] }, formats);
    expect(g).toEqual({
      name: '標準',
      isDefault: true,
      formatIds: ['new_1', 'new_3'],
      defaultFormatIds: ['new_3'],
      expandFormatIds: ['new_1'],
    });
  });

  it('patientFromWire: 数値は dict から、文字列はそのまま (互換受信)', () => {
    expect(patientFromWire({ r: '203', n: 'A', t: [1, 'インライン', 99], c: 'x' }, tagDict)).toEqual({
      room: '203',
      name: 'A',
      tags: ['内科', 'インライン'],
      content: 'x',
    });
  });
});

// ============================
// HM (qr-patient-list v4)
// ============================

describe('encodePatientList / decodePatientList (HM v4)', () => {
  const patients = [
    makePatient({ pid: 'p1', status: 'yellow', name: 'テスト太郎', room: '203', tags: ['内科'] }),
    makePatient({ pid: 'p2' }),
    makePatient({ pid: 'p3', status: 'green', name: '花子', room: '204', tags: ['外科'] }),
    makePatient({ pid: 'p4' }),
  ];

  it('HM: 末尾連続空をトリムして全患者を載せる', () => {
    const settings = settingsWith({ tags: tagDefsFrom(tagDict) });
    const out = JSON.parse(encodePatientList(patients, settings, { kind: 'HM' }));
    expect(out).toEqual({
      v: 4,
      td: tagDict,
      p: [{ r: '203', n: 'テスト太郎', t: [1] }, {}, { r: '204', n: '花子', t: [2] }],
    });
  });

  it('decode round-trip: tagIdxs (sender 辞書 1-based) を復元', () => {
    const settings = settingsWith({ tags: tagDefsFrom(tagDict) });
    const payload = encodePatientList(patients, settings, { kind: 'HM' });
    const decoded = decodePatientList(payload);
    expect(decoded.tagNames).toEqual(tagDict);
    expect(decoded.patients).toEqual([
      { room: '203', name: 'テスト太郎', tagIdxs: [1], content: '' },
      { room: '', name: '', tagIdxs: [], content: '' },
      { room: '204', name: '花子', tagIdxs: [2], content: '' },
    ]);
  });

  it('version 不一致は明示エラーで弾く (fail-closed)', () => {
    expect(() => decodePatientList(JSON.stringify({ v: 3, td: [], p: [] }))).toThrow(/version/);
  });
});

// ============================
// ST v7 (envelope の v2 自己一致 + round-trip)
// ============================

describe('settingsQr (ST v7)', () => {
  it('encodeSettingsPayload は v2 期待値と一致する (clearOnStart=false のタグは tc 省略)', () => {
    const settings = settingsWith({
      tags: tagDefsFrom(tagDict),
      formats: [fmtVitals, fmtFindings],
      formatGroups: [group],
    });
    expect(JSON.parse(encodeSettingsPayload(settings))).toEqual(EXPECTED_ST);
  });

  it('decode round-trip: formats 新 ID 採番 + groups がその ID を参照', () => {
    const settings = settingsWith({
      tags: tagDefsFrom(tagDict),
      formats: [fmtVitals, fmtFindings],
      formatGroups: [group],
    });
    const out = decodeSettingsPayload(encodeSettingsPayload(settings));
    expect(out.tags).toEqual(tagDefsFrom(tagDict));
    expect(out.formats).toHaveLength(2);
    expect(out.formats?.[0]?.name).toBe('バイタル');
    expect(out.formats?.[0]?.id).toMatch(/^fmt_/);
    expect(out.formats?.[0]?.id).not.toBe('fmt_a'); // 新 ID 採番
    const ids = (out.formats ?? []).map((f) => f.id);
    expect(out.formatGroups?.[0]?.formatIds).toEqual(ids);
    expect(out.formatGroups?.[0]?.defaultFormatIds).toEqual([ids[1]]);
    expect(out.formatGroups?.[0]?.expandFormatIds).toEqual([ids[0]]);
    expect(out.formatGroups?.[0]?.isDefault).toBe(true);
    expect(out.clearTargets).toEqual(EXPECTED_ST.ct);
  });

  it('tc encode/decode round-trip: clearOnStart=true のタグ索引が tc に載り、decode で復元される', () => {
    const tags: TagDef[] = [
      { name: '内科', clearOnStart: false },
      { name: '外科', clearOnStart: true },
      { name: '要フォロー', clearOnStart: true },
    ];
    const settings = settingsWith({ tags, formats: [fmtVitals], formatGroups: [] });
    const raw = JSON.parse(encodeSettingsPayload(settings)) as Record<string, unknown>;
    // tc: 2-based (外科=2, 要フォロー=3)
    expect(raw.tc).toEqual([2, 3]);
    // decode で TagDef[] として復元
    const decoded = decodeSettingsPayload(JSON.stringify(raw));
    expect(decoded.tags).toEqual(tags);
  });

  it('td は空でも常に載る (タグ消去も伝わる「設定全体」の意味論)', () => {
    const settings = settingsWith({ tags: [], formats: [fmtVitals], formatGroups: [] });
    const out = JSON.parse(encodeSettingsPayload(settings));
    expect(out.td).toEqual([]);
    expect(decodeSettingsPayload(JSON.stringify(out)).tags).toEqual([]);
  });

  it('旧版 (v6 以前) payload は明示エラーで弾く', () => {
    expect(() => decodeSettingsPayload(JSON.stringify({ v: 6, td: [] }))).toThrow(/version/);
  });
});

