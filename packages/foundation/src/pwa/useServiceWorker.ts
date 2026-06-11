// 移植元: snishi-code-personal/simple-ledger-src/src/pwa/useServiceWorker.ts (※updateReady/skipWaiting 方式は不採用)
import { useEffect } from 'react';
import { getEnv } from './env';

function isLocalhost(hostname: string): boolean {
  return (
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '[::1]' ||
    hostname.endsWith('.localhost')
  );
}

// 本番判定: data-env='prod'、または https かつ非 localhost。判定不能は登録しない側に倒す。
function isProdContext(): boolean {
  if (getEnv() === 'prod') return true;
  return location.protocol === 'https:' && !isLocalhost(location.hostname);
}

/**
 * 凍結 SW ポリシー (仕様§10) の登録専用フック。本番のみ register し、dev/test では no-op。
 *
 * ledger 現行 (simple-ledger-src/src/pwa/useServiceWorker.ts) と異なり、
 * update() / skipWaiting / 「更新あり」リロード促しは実装しない:
 * install 後のアプリは origin から配信される内容に影響されない設計
 * (理由と変更禁止事項は sw.template.js 冒頭の不変性ブロックが正本)。
 */
export function useServiceWorker(swUrl: string = './sw.js'): void {
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    if (!isProdContext()) return;
    // 登録失敗は握る: SW はオフライン強化の付加機能で、本体動作の前提にしない。
    navigator.serviceWorker.register(swUrl).catch(() => undefined);
  }, [swUrl]);
}
