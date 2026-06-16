// QR policy 正本のテスト。4 軸 (order/protection/presentationDefault/redistribution)
// + 鍵 profile 解決が use-case ごとに正しく読めることを固定する。
import { describe, expect, it } from 'vitest';
import { APP_KEY_BYTES } from './appKey';
import {
  getQrPolicy,
  getQrKeyBytes,
  getQrPresentationDefault,
  resolveQrKeyBytes,
  shouldEncryptQr,
} from './policy';

describe('QR policy', () => {
  it('HM: encrypted / unordered / dynamic / redistribution prohibited', () => {
    const p = getQrPolicy('HM');
    expect(p.protection).toBe('encrypted');
    expect(p.order).toBe('unordered');
    expect(p.presentationDefault).toBe('dynamic');
    expect(p.redistribution).toBe('prohibited');
    // 補助関数経由でも一致
    expect(shouldEncryptQr('HM')).toBe(true);
    expect(getQrPresentationDefault('HM')).toBe('dynamic');
  });

  it('ST: encrypted / unordered / dynamic / redistribution allowed', () => {
    const p = getQrPolicy('ST');
    expect(p.protection).toBe('encrypted');
    expect(p.order).toBe('unordered');
    expect(p.presentationDefault).toBe('dynamic');
    expect(p.redistribution).toBe('allowed');
    expect(shouldEncryptQr('ST')).toBe(true);
    expect(getQrPresentationDefault('ST')).toBe('dynamic');
  });

  it('TAB: plain / ordered / static / redistribution allowed', () => {
    const p = getQrPolicy('TAB');
    expect(p.protection).toBe('plain');
    expect(p.order).toBe('ordered');
    expect(p.presentationDefault).toBe('static');
    expect(p.redistribution).toBe('allowed');
    expect(shouldEncryptQr('TAB')).toBe(false);
    expect(getQrPresentationDefault('TAB')).toBe('static');
  });

  it('keyProfile 未指定 / app-fixed は固定鍵を解決できる', () => {
    // 全 use-case は app-fixed → 同一のアプリ固定鍵
    expect(getQrKeyBytes('HM')).toBe(APP_KEY_BYTES);
    expect(getQrKeyBytes('ST')).toBe(APP_KEY_BYTES);
    expect(getQrKeyBytes('TAB')).toBe(APP_KEY_BYTES);
    // policy 直渡し: 未指定 / 'app-fixed' / 未知 profile はすべて固定鍵へ倒れる
    expect(resolveQrKeyBytes({})).toBe(APP_KEY_BYTES);
    expect(resolveQrKeyBytes({ keyProfile: 'app-fixed' })).toBe(APP_KEY_BYTES);
  });

  it('policy はすべて app-fixed (現状ユーザー鍵 profile は無い)', () => {
    for (const useCase of ['HM', 'ST', 'TAB'] as const) {
      expect(getQrPolicy(useCase).keyProfile).toBe('app-fixed');
    }
  });
});
