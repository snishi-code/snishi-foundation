// bundle: rosterMeta の projection / parse 正規化 (HM 名簿 QR 下地)。
// 旧 bundle (rosterMeta 無し) は unmanaged 既定へ倒す = forward compat。

import { describe, expect, it } from 'vitest';
import { parseBundle, projectBundle, BUNDLE_FORMAT, SECTION } from './bundle';
import { defaultSettings, normalizePatientArray } from '../domain/normalize';
import { defaultRosterMeta, type RosterMeta } from '../domain/roster';

function baseArgs() {
  return {
    appState: { title: 'T', patients: normalizePatientArray(null) },
    settings: defaultSettings(),
    sections: [SECTION.META, SECTION.PATIENTS],
  };
}

describe('projectBundle rosterMeta', () => {
  it('rosterMeta 未指定は unmanaged 既定を入れる', () => {
    const b = projectBundle(baseArgs());
    expect(b.rosterMeta).toEqual(defaultRosterMeta());
    expect(b.rosterMeta.managed).toBe(false);
    expect(b.rosterMeta.localRole).toBe('none');
  });

  it('指定した rosterMeta を保持する (managed recipient)', () => {
    const meta: RosterMeta = {
      managed: true,
      localRole: 'recipient',
      rosterAuthorityId: 'ra_x',
      rosterWardId: 'rw_y',
      wardName: '3階東',
      receivedAt: '2026-06-16T00:00:00.000Z',
      redistribution: 'prohibited',
    };
    const b = projectBundle({ ...baseArgs(), rosterMeta: meta });
    expect(b.rosterMeta).toEqual(meta);
  });
});

describe('parseBundle rosterMeta (forward compat)', () => {
  it('旧 bundle (rosterMeta 無し) は unmanaged 既定へ正規化される', () => {
    const legacy = {
      format: BUNDLE_FORMAT,
      schema: 1,
      sections: { [SECTION.META]: { title: 'T' }, [SECTION.PATIENTS]: [] },
    };
    const b = parseBundle(legacy);
    expect(b.rosterMeta).toEqual(defaultRosterMeta());
  });

  it('project → JSON → parse の round-trip で rosterMeta が保持される', () => {
    const meta: RosterMeta = {
      managed: true,
      localRole: 'authority',
      rosterAuthorityId: 'ra_1',
      rosterWardId: 'rw_1',
      wardName: '内科',
      receivedAt: '',
      redistribution: 'prohibited',
    };
    const b = projectBundle({ ...baseArgs(), rosterMeta: meta });
    const roundTripped = parseBundle(JSON.parse(JSON.stringify(b)));
    expect(roundTripped.rosterMeta).toEqual(meta);
  });
});
