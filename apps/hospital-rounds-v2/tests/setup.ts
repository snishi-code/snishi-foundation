/*
 * UI テスト共通セットアップ (各テストファイルが `import './setup'` で読み込む)。
 *  - fake-indexeddb / jest-dom は foundation の test-setup (vitest.config の setupFiles) が供給。
 *  - 各テスト前に IDB / localStorage / overlay 登録簿を初期化して状態を持ち越さない。
 *  - 各テスト後に RTL cleanup (App の unmount で history listener 等も解放される)。
 */
import { afterEach, beforeEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';
import { IDBFactory } from 'fake-indexeddb';
import { patchDialogIfNeeded } from '@snishi/foundation/ui/test-utils';
import { _resetRegistriesForTests } from '../src/ui/registries';

// jsdom が <dialog>.showModal 未実装の場合の最小 shim (foundation test-utils)
patchDialogIfNeeded();

// Node 22+ の組み込み localStorage が jsdom のものを隠すため in-memory stub に差し替える
function makeStorageStub(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (k: string) => map.get(k) ?? null,
    key: (i: number) => [...map.keys()][i] ?? null,
    removeItem: (k: string) => {
      map.delete(k);
    },
    setItem: (k: string, v: string) => {
      map.set(k, String(v));
    },
  };
}

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
  vi.stubGlobal('localStorage', makeStorageStub());
  _resetRegistriesForTests();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
