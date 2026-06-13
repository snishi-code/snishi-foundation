// 画面スリープ抑止 (Screen Wake Lock API)。QR をかざして読み取らせている間など、
// 無操作で画面が消えると転送が止まるのを防ぐ。
//
// - active が true の間だけ wake lock を取得し、false / unmount で解放する
// - タブが背面化すると lock は OS により解放されるため、visible 復帰で再取得する
// - 非対応環境 (iOS の一部・古い WebView 等) は no-op (best-effort)
// - navigator.wakeLock はローカル API。外部送信ではない (no-exfil とは無関係)

import { useEffect } from 'react';

type WakeLockSentinelLike = { release(): Promise<void> } | null;

interface WakeLockNavigator {
  wakeLock?: { request(type: 'screen'): Promise<{ release(): Promise<void> }> };
}

export function useWakeLock(active: boolean): void {
  useEffect(() => {
    if (!active) return;
    if (typeof navigator === 'undefined') return;
    const wl = (navigator as Navigator & WakeLockNavigator).wakeLock;
    if (!wl || typeof wl.request !== 'function') return;

    let sentinel: WakeLockSentinelLike = null;
    let cancelled = false;

    const request = async (): Promise<void> => {
      try {
        const s = await wl.request('screen');
        if (cancelled) {
          // 取得完了前に解放要求が来ていたら即座に手放す
          try {
            await s.release();
          } catch {
            /* best-effort */
          }
          return;
        }
        sentinel = s;
      } catch {
        // 権限拒否・非対応・background など。抑止は補助なので握り潰す
      }
    };

    const onVisibility = (): void => {
      if (document.visibilityState === 'visible' && !sentinel) void request();
    };

    void request();
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisibility);
      const s = sentinel;
      sentinel = null;
      if (s) {
        void s.release().catch(() => {
          /* best-effort */
        });
      }
    };
  }, [active]);
}
