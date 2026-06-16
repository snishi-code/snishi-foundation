// QR wire の v2 自己一致歩哨テスト。
//
// v1 互換は正式終了 (2026-06)。EXPECTED_* は v2 の実装値と一致する正本。
// このアプリの新旧バージョン間でのみ互換を保証する。

import { describe, expect, it } from 'vitest';
import type { Format, Patient, Settings, TagDef } from '../domain/types';
import { defaultSettings, makeDefaultPatient } from '../domain/normalize';
import {
  KIND_BY_INDEX,
  PANEL_BY_INDEX,
  WIRE_V,
  formatFromWire,
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
/** tagDict を TagDef[] に変換するヘルパ (wire テスト用。color は gray 固定) */
function tagDefsFrom(names: string[]): TagDef[] {
  return names.map((name) => ({ name, color: 'gray' as const }));
}

const fmtVitals: Format = {
  id: 'fmt_a',
  name: 'バイタル',
  panel: 'O',
  display: 'expand',
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
  display: 'quick',
  joiner: '\n',
  labelSep: '：',
  titleWrap: '',
  tags: [],
  items: [
    { label: 'General', kind: 'text', normal: '良好' },
    { label: '', kind: 'text', normal: '特になし' },
  ],
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
// display=expand なので q は省略

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
  q: 1,
  j: '\n',
  ls: '：',
  i: [
    { l: 'General', k: 0, nm: '良好' },
    { l: '', k: 0, nm: '特になし' },
  ],
};
// display=quick なので q:1 が付く

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

// ST v8 最終形: formats(q付き) + tags + clearTargets (fg なし・tgc なし=全gray)
const EXPECTED_ST = {
  v: 8,
  td: tagDict,
  f: EXPECTED_WIRE_FORMATS,
  ct: {
    S: true,
    O: true,
    A: false,
    P: true,
    statusYellow: true,
    statusGreen: true,
    statusGray: true,
    statusBlue: false,
    tagGray: false,
    tagAmber: true,
    problems: false,
    freeText: false,
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
    expect(WIRE_V).toEqual({ HM: 5, ST: 8 });
  });
});

// ============================
// formatToWire / patientToWire (v1 実出力との一致)
// ============================

describe('format/patient wire 歩哨 (v1 実出力 fixture)', () => {
  it('formatToWire (tag dict あり, expand): q なし・既知タグは 1-based index', () => {
    expect(formatToWire(fmtVitals, tagDict)).toEqual(EXPECTED_FORMAT_DICT);
  });

  it('formatToWire (dict=null): タグは文字列のまま inline', () => {
    expect(formatToWire(fmtVitals, null)).toEqual(EXPECTED_FORMAT_NODICT);
  });

  it('formatToWire (quick): q:1 が付く / default joiner ", " は省略', () => {
    expect(formatToWire(fmtFindings, tagDict)).toEqual(EXPECTED_FORMAT_TEXT);
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
    expect(back.display).toBe('expand'); // q 省略 → expand
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

  it('q:1 round-trip: display=quick は q:1 でエンコードされ、decode で quick に復元', () => {
    const wire = formatToWire(fmtFindings, tagDict);
    expect(wire.q).toBe(1);
    const back = formatFromWire(wire, tagDict);
    expect(back.display).toBe('quick');
  });

  it('q 省略 round-trip: display=expand は q を持たず、decode で expand に復元', () => {
    const wire = formatToWire(fmtVitals, tagDict);
    expect(wire.q).toBeUndefined();
    const back = formatFromWire(wire, tagDict);
    expect(back.display).toBe('expand');
  });

  it('patientFromWire: 数値は dict から、文字列はそのまま (互換受信)', () => {
    expect(patientFromWire({ r: '203', n: 'A', t: [1, 'インライン', 99], c: 'x' }, tagDict)).toEqual({
      room: '203',
      name: 'A',
      tags: ['内科', 'インライン'],
      content: 'x',
      rosterPatientId: '',
    });
  });

  it('patientToWire/FromWire: rosterPatientId は rpid として round-trip する', () => {
    const p = makePatient({ room: '301', name: '名簿太郎', rosterPatientId: 'rp_abc', rosterManaged: true });
    const wire = patientToWire(p, tagDict, null);
    expect(wire.rpid).toBe('rp_abc');
    expect(patientFromWire(wire, tagDict).rosterPatientId).toBe('rp_abc');
    // 空スロットには rpid を載せない (rosterPatientId があっても name/room が空なら {})。
    const empty = makePatient({ rosterPatientId: 'rp_should_not_leak' });
    expect(patientToWire(empty, tagDict, null)).toEqual({});
  });
});

// ============================
// HM (qr-patient-list v5 + v4 受信互換)
// ============================

describe('encodePatientList / decodePatientList (HM v5)', () => {
  const patients = [
    makePatient({ pid: 'p1', status: 'yellow', name: 'テスト太郎', room: '203', tags: ['内科'] }),
    makePatient({ pid: 'p2' }),
    makePatient({ pid: 'p3', status: 'green', name: '花子', room: '204', tags: ['外科'] }),
    makePatient({ pid: 'p4' }),
  ];

  it('HM: 末尾連続空をトリムして全患者を載せる (unmanaged は m なし)', () => {
    const settings = settingsWith({ tags: tagDefsFrom(tagDict) });
    const out = JSON.parse(encodePatientList(patients, settings, { kind: 'HM' }));
    expect(out).toEqual({
      v: 5,
      td: tagDict,
      p: [{ r: '203', n: 'テスト太郎', t: [1] }, {}, { r: '204', n: '花子', t: [2] }],
    });
    // unmanaged (rosterMeta 未指定) は m を載せない
    expect(out.m).toBeUndefined();
  });

  it('decode round-trip: tagIdxs (sender 辞書 1-based) を復元・rosterMeta は null', () => {
    const settings = settingsWith({ tags: tagDefsFrom(tagDict) });
    const payload = encodePatientList(patients, settings, { kind: 'HM' });
    const decoded = decodePatientList(payload);
    expect(decoded.rosterMeta).toBeNull();
    expect(decoded.tagNames).toEqual(tagDict);
    expect(decoded.patients).toEqual([
      { room: '203', name: 'テスト太郎', tagIdxs: [1], content: '', rosterPatientId: '', rosterManaged: false },
      { room: '', name: '', tagIdxs: [], content: '', rosterPatientId: '', rosterManaged: false },
      { room: '204', name: '花子', tagIdxs: [2], content: '', rosterPatientId: '', rosterManaged: false },
    ]);
  });

  it('managed: m.aid/m.wid と p[].rpid が載り、decode で readable に復元される', () => {
    const settings = settingsWith({ tags: tagDefsFrom(tagDict) });
    const managedPatients = [
      makePatient({ pid: 'p1', name: '名簿太郎', room: '301', rosterPatientId: 'rp_1', rosterManaged: true }),
      makePatient({ pid: 'p2' }), // 空スロット → rpid なし
    ];
    const rosterMeta = {
      managed: true,
      localRole: 'authority' as const,
      rosterAuthorityId: 'ra_x',
      rosterWardId: 'rw_y',
      wardName: '3階東',
      receivedAt: '',
      redistribution: 'prohibited' as const,
    };
    const raw = JSON.parse(
      encodePatientList(managedPatients, settings, {
        kind: 'HM',
        rosterMeta,
        generatedAt: '2026-06-16T00:00:00.000Z',
      }),
    );
    // wire 上は短縮キー (m.aid/m.wid/m.wn/m.rd/m.ga, p[].rpid)。localRole は載らない。
    expect(raw.v).toBe(5);
    expect(raw.m).toEqual({ aid: 'ra_x', wid: 'rw_y', wn: '3階東', rd: 'prohibited', ga: '2026-06-16T00:00:00.000Z' });
    expect(raw.m.localRole).toBeUndefined();
    expect(raw.p[0].rpid).toBe('rp_1');
    // decode 後は短縮キーを隠した readable な rosterMeta / rosterPatientId
    const decoded = decodePatientList(JSON.stringify(raw));
    expect(decoded.rosterMeta).toEqual({
      rosterAuthorityId: 'ra_x',
      rosterWardId: 'rw_y',
      wardName: '3階東',
      redistribution: 'prohibited',
      generatedAt: '2026-06-16T00:00:00.000Z',
    });
    expect(decoded.patients[0]).toMatchObject({ name: '名簿太郎', rosterPatientId: 'rp_1', rosterManaged: true });
    // 末尾の空スロットはトリムされる (rpid を持たないので名簿には載らない)
    expect(decoded.patients).toHaveLength(1);
  });

  it('v4 payload は unmanaged として decode できる (受信互換)', () => {
    const v4 = { v: 4, td: tagDict, p: [{ r: '203', n: 'テスト太郎', t: [1] }] };
    const decoded = decodePatientList(JSON.stringify(v4));
    expect(decoded.rosterMeta).toBeNull();
    expect(decoded.patients[0]).toEqual({
      room: '203',
      name: 'テスト太郎',
      tagIdxs: [1],
      content: '',
      rosterPatientId: '',
      rosterManaged: false,
    });
  });

  it('managed payload (m あり) で aid / wid が空なら reject する (fail-closed)', () => {
    const noAid = { v: 5, td: [], m: { aid: '', wid: 'rw_x', wn: '', rd: 'prohibited', ga: '' }, p: [] };
    expect(() => decodePatientList(JSON.stringify(noAid))).toThrow(/roster authority\/ward id/);
    const noWid = { v: 5, td: [], m: { aid: 'ra_x', wid: '', wn: '', rd: 'prohibited', ga: '' }, p: [] };
    expect(() => decodePatientList(JSON.stringify(noWid))).toThrow(/roster authority\/ward id/);
  });

  it('version 不一致は明示エラーで弾く (fail-closed)', () => {
    expect(() => decodePatientList(JSON.stringify({ v: 3, td: [], p: [] }))).toThrow(/version/);
  });
});

// ============================
// ST v8 (envelope の v2 自己一致 + round-trip)
// ============================

describe('settingsQr (ST v8)', () => {
  it('encodeSettingsPayload は v2 期待値と一致する (fg なし・q フラグ付き・tgc なし=全gray)', () => {
    const settings = settingsWith({
      tags: tagDefsFrom(tagDict),
      formats: [fmtVitals, fmtFindings],
    });
    const parsed = JSON.parse(encodeSettingsPayload(settings));
    expect(parsed).toEqual(EXPECTED_ST);
    // fg / tc が含まれないことを確認 (ST v8 最終形)
    expect(parsed.fg).toBeUndefined();
    expect(parsed.tc).toBeUndefined();
    // 全 gray なので tgc も省略
    expect(parsed.tgc).toBeUndefined();
  });

  it('decode round-trip: formats 新 ID 採番 + display が復元される', () => {
    const settings = settingsWith({
      tags: tagDefsFrom(tagDict),
      formats: [fmtVitals, fmtFindings],
    });
    const out = decodeSettingsPayload(encodeSettingsPayload(settings));
    expect(out.tags).toEqual(tagDefsFrom(tagDict));
    expect(out.formats).toHaveLength(2);
    expect(out.formats?.[0]?.name).toBe('バイタル');
    expect(out.formats?.[0]?.id).toMatch(/^fmt_/);
    expect(out.formats?.[0]?.id).not.toBe('fmt_a'); // 新 ID 採番
    expect(out.formats?.[0]?.display).toBe('expand');
    expect(out.formats?.[1]?.display).toBe('quick');
    expect(out.clearTargets).toEqual(EXPECTED_ST.ct);
    // formatGroups は存在しない
    expect((out as unknown as Record<string, unknown>).formatGroups).toBeUndefined();
  });

  it('tgc encode/decode round-trip: amber タグの color index が tgc に載り decode で復元される', () => {
    const tags: TagDef[] = [
      { name: '内科', color: 'gray' },
      { name: '外科', color: 'amber' },
      { name: '要フォロー', color: 'amber' },
    ];
    const settings = settingsWith({ tags, formats: [fmtVitals] });
    const raw = JSON.parse(encodeSettingsPayload(settings)) as Record<string, unknown>;
    // tgc: [0, 1, 1] (gray=0, amber=1)
    expect(raw.tgc).toEqual([0, 1, 1]);
    // decode で TagDef[] として復元
    const decoded = decodeSettingsPayload(JSON.stringify(raw));
    expect(decoded.tags).toEqual(tags);
  });

  it('tgc 全 gray は省略される', () => {
    const tags: TagDef[] = [
      { name: '内科', color: 'gray' },
      { name: '外科', color: 'gray' },
    ];
    const settings = settingsWith({ tags, formats: [fmtVitals] });
    const raw = JSON.parse(encodeSettingsPayload(settings)) as Record<string, unknown>;
    expect(raw.tgc).toBeUndefined();
    // decode でも全 gray として復元
    const decoded = decodeSettingsPayload(JSON.stringify(raw));
    expect(decoded.tags).toEqual(tags);
  });

  it('tgc 範囲外 index は gray に倒す (fail-safe decode)', () => {
    const raw = { v: 8, td: ['血液'], tgc: [99], f: [], ct: {} };
    const decoded = decodeSettingsPayload(JSON.stringify(raw));
    expect(decoded.tags[0]?.color).toBe('gray');
  });

  it('td は空でも常に載る (タグ消去も伝わる「設定全体」の意味論)', () => {
    const settings = settingsWith({ tags: [], formats: [fmtVitals] });
    const out = JSON.parse(encodeSettingsPayload(settings));
    expect(out.td).toEqual([]);
    expect(decodeSettingsPayload(JSON.stringify(out)).tags).toEqual([]);
  });

  it('旧版 (v6 以前) payload は明示エラーで弾く', () => {
    expect(() => decodeSettingsPayload(JSON.stringify({ v: 6, td: [] }))).toThrow(/version/);
  });
});
