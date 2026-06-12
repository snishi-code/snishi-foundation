// 移植元 v1 test/check.mjs の payload SOAP compose ケース相当。

import { describe, expect, it } from 'vitest';
import type { Format, Settings } from './types';
import { defaultSettings, makeDefaultPatient } from './normalize';
import { buildSoapParts, buildTabPayload } from './payload';
import { composeFormatFromValues } from './formatValues';

function fmt(over: Partial<Format>): Format {
  return {
    id: 'f_x',
    name: 'X',
    panel: 'O',
    display: 'expand',
    joiner: ', ',
    labelSep: ' ',
    titleWrap: '',
    tags: [],
    items: [],
    ...over,
  };
}

function settingsWith(formats: Format[]): Settings {
  // defaults の formats を独自 formats に置き換える (backfill 済み defaults を使わず
  // 出力対象を制御するため、テストでは settings を直接構築する)
  return { ...defaultSettings(), formats };
}

const vitals = fmt({
  id: 'f_vit',
  name: 'バイタル',
  panel: 'O',
  labelSep: ' ',
  titleWrap: '（）',
  items: [
    { label: 'BP', kind: 'fraction', unit: 'mmHg', fracMode: 'numeric' },
    { label: 'SpO2', kind: 'number', unit: '%' },
  ],
});

const subjective = fmt({
  id: 'f_s',
  name: '自覚症状',
  panel: 'S',
  labelSep: '：',
  items: [{ label: '', kind: 'text', normal: '特になし' }],
});

describe('composeFormatFromValues (代表ケース)', () => {
  it('number の注記が末尾に付く (SpO2 96% O2 2L)、fraction は a/b + 単位', () => {
    const { text, hasValue } = composeFormatFromValues(vitals, {
      0: { value: '120/53', note: '' },
      1: { value: '96', note: 'O2 2L' },
    });
    expect(hasValue).toBe(true);
    expect(text).toBe('（バイタル）\nBP 120/53mmHg, SpO2 96% O2 2L');
  });

  it('値が空で注記だけの number は出力しない / 旧文字列値も読める', () => {
    const r1 = composeFormatFromValues(vitals, { 1: { value: '', note: 'O2 2L' } });
    expect(r1.hasValue).toBe(false);
    const r2 = composeFormatFromValues(vitals, { 1: '97' });
    expect(r2.text).toContain('SpO2 97%');
  });

  it('titleWrap 空ならタイトル行なし', () => {
    const f = fmt({ items: [{ label: '', kind: 'text', normal: '' }] });
    expect(composeFormatFromValues(f, { 0: 'メモ' }).text).toBe('メモ');
  });
});

describe('buildTabPayload / buildSoapParts', () => {
  const settings = settingsWith([subjective, vitals]);

  it('タップ (formatValues) した欄だけ出る / 未タップ欄は空', () => {
    const p = makeDefaultPatient();
    p.formatValues = {
      f_s: { 0: { value: '頭痛あり', source: 'manual' } },
      f_vit: { 1: { value: '96', note: '' } },
    };
    const parts = buildSoapParts(p, settings);
    expect(parts.sOut).toBe('頭痛あり');
    expect(parts.oOut).toBe('（バイタル）\nSpO2 96%');
    expect(parts.aOut).toBe('');
    expect(parts.pOut).toBe('');
    const payload = buildTabPayload(p, settings);
    expect(payload).toBe('(S)\n頭痛あり\n――\n(O)\n（バイタル）\nSpO2 96%\n――\n(A)\n\n――\n(P)\n');
  });

  it('formatValues が空なら全パネル出力が空文字', () => {
    const p = makeDefaultPatient();
    const result = buildTabPayload(p, settings);
    expect(result.startsWith('(S)')).toBe(true);
    expect(result).not.toContain('頭痛');
  });
});
