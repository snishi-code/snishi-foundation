// 移植元 v1 test/check.mjs の format-values helpers / text provenance セクション相当 (代表ケース)。

import { describe, expect, it } from 'vitest';
import {
  collectFormatItemIndicesWithData,
  commitDraftTextEntry,
  decidePresetToggle,
  formatItemKindChangeBlocked,
  formatValueHasInput,
  remapEffectOnData,
  remapFormatValuesSlot,
  remapPatientsFormatValues,
  mergeTagsAdd,
  mergeTagsRemove,
  normalizeTextEntry,
  readNumericEntry,
} from './formatValues';
import { makeDefaultPatient } from './normalize';

describe('値の正規化と入力判定', () => {
  it('readNumericEntry: 旧文字列も新オブジェクトも {value,note} に正規化', () => {
    expect(readNumericEntry('96')).toEqual({ value: '96', note: '' });
    expect(readNumericEntry({ value: '96', note: 'O2 2L' })).toEqual({ value: '96', note: 'O2 2L' });
    expect(readNumericEntry(null)).toEqual({ value: '', note: '' });
  });

  it('formatValueHasInput: 文字列/オブジェクト/空/スラッシュのみ を正しく判定', () => {
    expect(formatValueHasInput('96')).toBe(true);
    expect(formatValueHasInput('')).toBe(false);
    expect(formatValueHasInput('/')).toBe(false); // fraction 未入力
    expect(formatValueHasInput({ value: '', note: 'O2 2L' })).toBe(true);
    expect(formatValueHasInput({ value: '', note: '' })).toBe(false);
    expect(formatValueHasInput({ value: '120/53', note: '' })).toBe(true);
  });
});

describe('text provenance (Phase 6)', () => {
  it('normalizeTextEntry: source 明示は信頼 / legacy は現正常文で推論', () => {
    expect(normalizeTextEntry({ value: 'x', source: 'manual' }, 'x')).toEqual({
      value: 'x',
      source: 'manual',
    });
    expect(normalizeTextEntry('良好', '良好')).toEqual({ value: '良好', source: 'preset' });
    expect(normalizeTextEntry('独自メモ', '良好')).toEqual({ value: '独自メモ', source: 'manual' });
    expect(normalizeTextEntry('', '良好')).toEqual({ value: '', source: 'empty' });
  });

  it('decidePresetToggle: 空→write / preset一致→clear / manual・不一致→openEditor', () => {
    expect(decidePresetToggle('', '良好')).toEqual({
      action: 'write',
      value: { value: '良好', source: 'preset' },
    });
    expect(decidePresetToggle({ value: '良好', source: 'preset' }, '良好')).toEqual({
      action: 'clear',
      value: '',
    });
    expect(decidePresetToggle({ value: 'メモ', source: 'manual' }, '良好')).toEqual({
      action: 'openEditor',
    });
    // 正常文を変更済み (preset 値 ≠ 現 normal) も openEditor (黙って上書きしない)
    expect(decidePresetToggle({ value: '旧正常文', source: 'preset' }, '新正常文')).toEqual({
      action: 'openEditor',
    });
  });

  it('commitDraftTextEntry: 変化した item だけ manual 化 / 未変化は出所保持 / 空は ""', () => {
    const preset = { value: '良好', source: 'preset' };
    expect(commitDraftTextEntry(preset, '良好')).toBe(preset); // 未変更 → 出所保持
    expect(commitDraftTextEntry(preset, '悪化')).toEqual({ value: '悪化', source: 'manual' });
    expect(commitDraftTextEntry(preset, '')).toBe('');
  });
});

describe('タグ delta merge', () => {
  it('mergeTagsAdd / mergeTagsRemove: 付与・除去 (手編集タグは保持・順序保持)', () => {
    expect(mergeTagsAdd(['a', 'b'], ['b', 'c'])).toEqual(['a', 'b', 'c']);
    expect(mergeTagsRemove(['a', 'b', 'c'], ['b'])).toEqual(['a', 'c']);
    expect(mergeTagsAdd(null, ['x'])).toEqual(['x']);
  });
});

describe('破壊防止判定 (fail-closed)', () => {
  it('collectFormatItemIndicesWithData: 入力がある item index を患者横断で収集', () => {
    const p1 = makeDefaultPatient();
    p1.formatValues = { f1: { 0: '96', 2: '' } };
    const p2 = makeDefaultPatient();
    p2.formatValues = { f1: { 1: { value: '', note: 'メモ' } }, f2: { 5: 'x' } };
    const got = collectFormatItemIndicesWithData([p1, p2], 'f1');
    expect([...got].sort()).toEqual([0, 1]);
  });

  it('kind 変更: 不明 (null) は fail-closed でブロック / 入力済み index もブロック', () => {
    expect(formatItemKindChangeBlocked(null, 0)).toBe(true);
    const ds = new Set([2]);
    expect(formatItemKindChangeBlocked(ds, 2)).toBe(true);
    expect(formatItemKindChangeBlocked(ds, 1)).toBe(false);
  });
});

describe('項目の並び替え/削除に伴う保存値の同時変換 (remap)', () => {
  it('remapFormatValuesSlot: mapping[new]=old で値を移し、削除分は落とす', () => {
    const slot = { 0: '肺音の値', 1: '心音の値', 2: { value: '120/80', note: '' } };
    // 0↔1 入替 + 2 を削除 + 末尾に新規 (-1)
    expect(remapFormatValuesSlot(slot, [1, 0, -1])).toEqual({
      0: '心音の値',
      1: '肺音の値',
    });
  });

  it('remapEffectOnData: 移動と削除を入力済み index に対して判定する', () => {
    const data = new Set([0, 2]);
    // 並び替えのみ (0→1)
    expect(remapEffectOnData([1, 0, 2], data)).toEqual({ moved: true, removed: [] });
    // index 2 を削除
    expect(remapEffectOnData([0, 1], data)).toEqual({ moved: false, removed: [2] });
    // 無変換
    expect(remapEffectOnData([0, 1, 2], data)).toEqual({ moved: false, removed: [] });
  });

  it('remapPatientsFormatValues: 全患者の該当 slot を同じ移動で組み替える', () => {
    const p1 = makeDefaultPatient();
    p1.formatValues = { f1: { 0: 'A', 1: 'B' } };
    const p2 = makeDefaultPatient();
    p2.formatValues = { f1: { 1: 'C' }, f2: { 0: 'keep' } };
    const p3 = makeDefaultPatient(); // 値なし → 触らない
    const changed = remapPatientsFormatValues([p1, p2, p3], 'f1', [1, 0]);
    expect(changed).toBe(2);
    expect(p1.formatValues.f1).toEqual({ 0: 'B', 1: 'A' });
    expect(p2.formatValues.f1).toEqual({ 0: 'C' });
    expect(p2.formatValues.f2).toEqual({ 0: 'keep' }); // 他フォーマットは不変
  });
});

