// QR wire の v1 互換歩哨テスト。
//
// EXPECTED_* の fixture は **移植元 v1 実装 (snishi-code-medical/hospital-rounds) を
// Node で実行して生成した正本** (qr-protocol.js / qr-patient-list.js / qr-settings.js /
// qr-format.js / qr-set.js の実出力)。v2 のエンコード結果がこれと 1 フィールドでも
// ずれたら v1 端末との QR 互換が壊れている。**このテストを直すために fixture を
// 書き換えてはならない** (直すのは実装の方)。

import { describe, expect, it } from 'vitest';
import type { Format, FormatGroup, Patient, Settings } from '../domain/types';
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
import { decodeFormatPayload, encodeFormatPayload } from './formatQr';
import { decodeSetPayload, encodeSetPayload } from './setQr';

// ============================
// 固定入力 (fixture 生成スクリプトと同一)
// ============================

const tagDict = ['内科', '外科', '要フォロー'];

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

const fmtProblem: Format = {
  id: 'fmt_c',
  name: 'プロブレムリスト',
  panel: 'problem',
  joiner: '\n',
  labelSep: '',
  titleWrap: '',
  tags: [],
  items: [
    { label: '#', kind: 'number', unit: '' },
    { label: '', kind: 'text', normal: '' },
  ],
};

const group: FormatGroup = {
  id: 'grp_x',
  name: '標準',
  isDefault: true,
  formatIds: ['fmt_a', 'fmt_b', 'fmt_c', 'fmt_missing'],
  defaultFormatIds: ['fmt_b'],
  expandFormatIds: ['fmt_a', 'fmt_c'],
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
  p: 2,
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
  p: 2,
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
  p: 2,
  j: '\n',
  ls: '：',
  i: [
    { l: 'General', k: 0, nm: '良好' },
    { l: '', k: 0, nm: '特になし' },
  ],
};

const EXPECTED_GROUP = { n: '標準', d: 1, fi: [1, 2, 3], df: [2], xf: [1, 3] };

const EXPECTED_PATIENT = {
  r: '203',
  n: 'テスト太郎',
  t: [1, 3],
  c: '本日|気分\n良好',
};

const EXPECTED_WIRE_FORMATS = [
  EXPECTED_FORMAT_DICT,
  EXPECTED_FORMAT_TEXT,
  {
    n: 'プロブレムリスト',
    p: 0,
    j: '\n',
    ls: '',
    i: [
      { l: '#', k: 1 },
      { l: '', k: 0 },
    ],
  },
];

const EXPECTED_ST = {
  v: 6,
  td: tagDict,
  f: EXPECTED_WIRE_FORMATS,
  fg: [EXPECTED_GROUP],
  ct: {
    problem: false,
    S: true,
    O: true,
    A: false,
    P: false,
    shared: false,
    statusYellow: true,
    statusGreen: true,
    statusGray: true,
    statusBlue: false,
  },
};

const EXPECTED_FMT = { v: 3, f: EXPECTED_FORMAT_NODICT };

const EXPECTED_FS = {
  v: 2,
  td: tagDict,
  f: EXPECTED_WIRE_FORMATS,
  g: { n: '標準', fi: [1, 2, 3], df: [2], xf: [1, 3] },
};

// ============================
// enum 表と WIRE_V (ここを変える = v1 端末との互換を破壊する)
// ============================

describe('wire enum tables / WIRE_V (v1 互換)', () => {
  it('PANEL_BY_INDEX / KIND_BY_INDEX は v1 と同一 (追加・並び替えは WIRE_V bump)', () => {
    expect(PANEL_BY_INDEX).toEqual(['problem', 'S', 'O', 'A', 'P', 'shared']);
    expect(KIND_BY_INDEX).toEqual(['text', 'number', 'fraction']);
  });

  it('kind 別 WIRE_V は現行 v1 実装値と一致する', () => {
    expect(WIRE_V).toEqual({ HM: 3, MM: 3, SH: 3, ST: 6, FMT: 3, FS: 2 });
  });
});

// ============================
// formatToWire / formatGroupToWire / patientToWire (v1 実出力との一致)
// ============================

describe('format/group/patient wire 歩哨 (v1 実出力 fixture)', () => {
  it('formatToWire (tag dict あり): 既知タグは 1-based index、未知タグは除外', () => {
    expect(formatToWire(fmtVitals, tagDict)).toEqual(EXPECTED_FORMAT_DICT);
  });

  it('formatToWire (dict=null、FMT 用): タグは文字列のまま inline', () => {
    expect(formatToWire(fmtVitals, null)).toEqual(EXPECTED_FORMAT_NODICT);
  });

  it('formatToWire: default joiner ", " は省略 / 非 default joiner は j に載る', () => {
    expect(formatToWire(fmtFindings, tagDict)).toEqual(EXPECTED_FORMAT_TEXT);
  });

  it('formatGroupToWire: f 配列への 1-based index 参照。解決できない ID は除外', () => {
    const idToIndex = (id: string) => ({ fmt_a: 1, fmt_b: 2, fmt_c: 3 })[id as 'fmt_a'];
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
// HM/MM/SH (qr-patient-list v3)
// ============================

describe('encodePatientList / decodePatientList (HM/MM/SH v3)', () => {
  const patients: Patient[] = [
    makePatient({ pid: 'p1', status: 'yellow', name: 'テスト太郎', room: '203', tags: ['内科'] }),
    makePatient({ pid: 'p2' }),
    makePatient({
      pid: 'p3',
      status: 'green',
      name: '外部花子',
      room: '204',
      tags: ['外科'],
      origin: 'external',
    }),
    makePatient({ pid: 'p4' }),
  ];

  it('HM restricted: origin=external を空スロット化し、末尾連続空をトリム (v1 実出力)', () => {
    const settings = settingsWith({ tags: tagDict.slice() });
    settings.qrRedistribution = { ...settings.qrRedistribution, HM: 'restricted' };
    const out = JSON.parse(encodePatientList(patients, settings, { kind: 'HM', includeEmpty: true }));
    expect(out).toEqual({
      v: 3,
      td: tagDict,
      p: [{ r: '203', n: 'テスト太郎', t: [1] }],
    });
  });

  it('HM free: external 患者も載る (v1 実出力)', () => {
    const settings = settingsWith({ tags: tagDict.slice() });
    settings.qrRedistribution = { ...settings.qrRedistribution, HM: 'free' };
    const out = JSON.parse(encodePatientList(patients, settings, { kind: 'HM', includeEmpty: true }));
    expect(out).toEqual({
      v: 3,
      td: tagDict,
      p: [{ r: '203', n: 'テスト太郎', t: [1] }, {}, { r: '204', n: '外部花子', t: [2] }],
    });
  });

  it('MM (contentOf 注入): content がある患者だけを列挙 (v1 実出力)', () => {
    const settings = settingsWith({ tags: tagDict.slice() });
    // MM は既定 restricted → external の外部花子は除外される
    const out = JSON.parse(
      encodePatientList(patients, settings, {
        kind: 'MM',
        includeEmpty: false,
        contentOf: (p) => (p.name ? `内容:${p.name}` : ''),
      }),
    );
    expect(out).toEqual({
      v: 3,
      td: tagDict,
      p: [{ r: '203', n: 'テスト太郎', t: [1], c: '内容:テスト太郎' }],
    });
  });

  it('decode round-trip: tagIdxs (sender 辞書 1-based) と content を復元', () => {
    const settings = settingsWith({ tags: tagDict.slice() });
    settings.qrRedistribution = { ...settings.qrRedistribution, HM: 'free' };
    const payload = encodePatientList(patients, settings, { kind: 'HM', includeEmpty: true });
    const decoded = decodePatientList(payload);
    expect(decoded.tagNames).toEqual(tagDict);
    expect(decoded.patients).toEqual([
      { room: '203', name: 'テスト太郎', tagIdxs: [1], content: '' },
      { room: '', name: '', tagIdxs: [], content: '' },
      { room: '204', name: '外部花子', tagIdxs: [2], content: '' },
    ]);
  });

  it('version 不一致は明示エラーで弾く (fail-closed)', () => {
    expect(() => decodePatientList(JSON.stringify({ v: 2, td: [], p: [] }))).toThrow(/version/);
  });
});

// ============================
// ST v6 / FMT v3 / FS v2 (envelope の v1 実出力一致 + round-trip)
// ============================

describe('settingsQr (ST v6)', () => {
  it('encodeSettingsPayload は v1 実出力と一致する', () => {
    const settings = settingsWith({
      tags: tagDict.slice(),
      formats: [fmtVitals, fmtFindings, fmtProblem],
      formatGroups: [group],
    });
    expect(JSON.parse(encodeSettingsPayload(settings))).toEqual(EXPECTED_ST);
  });

  it('decode round-trip: formats 新 ID 採番 + groups がその ID を参照', () => {
    const settings = settingsWith({
      tags: tagDict.slice(),
      formats: [fmtVitals, fmtFindings, fmtProblem],
      formatGroups: [group],
    });
    const out = decodeSettingsPayload(encodeSettingsPayload(settings));
    expect(out.tags).toEqual(tagDict);
    expect(out.formats).toHaveLength(3);
    expect(out.formats?.[0]?.name).toBe('バイタル');
    expect(out.formats?.[0]?.id).toMatch(/^fmt_/);
    expect(out.formats?.[0]?.id).not.toBe('fmt_a'); // 新 ID 採番
    const ids = (out.formats ?? []).map((f) => f.id);
    expect(out.formatGroups?.[0]?.formatIds).toEqual(ids);
    expect(out.formatGroups?.[0]?.defaultFormatIds).toEqual([ids[1]]);
    expect(out.formatGroups?.[0]?.expandFormatIds).toEqual([ids[0], ids[2]]);
    expect(out.formatGroups?.[0]?.isDefault).toBe(true);
    expect(out.clearTargets).toEqual(EXPECTED_ST.ct);
  });

  it('td は空でも常に載る (タグ消去も伝わる「設定全体」の意味論)', () => {
    const settings = settingsWith({ tags: [], formats: [fmtVitals], formatGroups: [] });
    const out = JSON.parse(encodeSettingsPayload(settings));
    expect(out.td).toEqual([]);
    expect(decodeSettingsPayload(JSON.stringify(out)).tags).toEqual([]);
  });

  it('旧版 (v5 以前) payload は明示エラーで弾く', () => {
    expect(() => decodeSettingsPayload(JSON.stringify({ v: 5, td: [] }))).toThrow(/version/);
  });
});

describe('formatQr (FMT v3)', () => {
  it('encodeFormatPayload は v1 実出力と一致する (tags は文字列 inline)', () => {
    expect(JSON.parse(encodeFormatPayload(fmtVitals))).toEqual(EXPECTED_FMT);
  });

  it('decode round-trip + name 欠落は throw', () => {
    const fmt = decodeFormatPayload(encodeFormatPayload(fmtVitals));
    expect(fmt.name).toBe('バイタル');
    expect(fmt.tags).toEqual(['内科', '未知タグ']); // 未登録タグの除外は apply 側の責務
    expect(() =>
      decodeFormatPayload(JSON.stringify({ v: 3, f: { n: '', p: 2, i: [] } })),
    ).toThrow(/name/);
  });

  it('null フォーマットは空ペイロード (QR 非表示)', () => {
    expect(encodeFormatPayload(null)).toBe('');
  });
});

describe('setQr (FS v2)', () => {
  it('encodeSetPayload は v1 実出力と一致する (isDefault は wire に載せない)', () => {
    const payload = encodeSetPayload(group, [fmtVitals, fmtFindings, fmtProblem], tagDict);
    expect(JSON.parse(payload)).toEqual(EXPECTED_FS);
  });

  it('tagDict が空なら td を載せずタグ文字列 inline (v1 実出力)', () => {
    const payload = encodeSetPayload(group, [fmtVitals, fmtFindings, fmtProblem], []);
    const out = JSON.parse(payload);
    expect(out.td).toBeUndefined();
    expect(out.f[0].t).toEqual(['内科', '未知タグ']);
  });

  it('decode round-trip: formats 新 ID + group 参照解決 + 常に isDefault=false', () => {
    const payload = encodeSetPayload(group, [fmtVitals, fmtFindings, fmtProblem], tagDict);
    const out = decodeSetPayload(payload);
    expect(out.formats).toHaveLength(3);
    const ids = out.formats.map((f) => f.id);
    expect(out.group.isDefault).toBe(false);
    expect(out.group.formatIds).toEqual(ids);
    expect(out.group.defaultFormatIds).toEqual([ids[1]]);
    expect(out.group.expandFormatIds).toEqual([ids[0], ids[2]]);
  });

  it('旧版 (v1) payload は明示エラーで弾く', () => {
    expect(() => decodeSetPayload(JSON.stringify({ v: 1, g: {} }))).toThrow(/version/);
  });
});
