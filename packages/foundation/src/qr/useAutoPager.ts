// 複数ページ (分割 QR 等) を一定間隔で自動送りする表示専用ページャ。
//
// 「動的 QR (アニメーション QR)」の本体: 送信側はページを一定間隔でループ表示し、
// 受信側は順不同で全ページ揃うまで貯める (受信側の組み立ては qr/useQrFlow が担う)。
// この hook は **表示の index 制御だけ** を持ち、QR の生成・暗号化・受信 authority
// (useQrFlow / protocol / crypto) には一切関与しない。
//
// - active && playing && pageCount > 1 のときだけタイマーが回る
// - 手動 next/prev は自動送りを一時停止する (= 明るさ/距離で自動が不安定な時の逃げ道)
// - pageCount が変わったら index=0・playing=true にリセット (新しい送信の先頭から)
//
// 外部送信なし・タイマーのみ (no-exfil とは無関係)。

import { useCallback, useEffect, useRef, useState } from 'react';

export interface AutoPager {
  /** 現在表示するページ index (0-based)。常に 0..max(0,pageCount-1) に収まる */
  index: number;
  /** 自動送り中か */
  playing: boolean;
  /** 自動送りの再生/一時停止トグル */
  toggle(): void;
  /** 1 つ進む (手動操作 = 自動送りを止める) */
  next(): void;
  /** 1 つ戻る (手動操作 = 自動送りを止める) */
  prev(): void;
}

export interface AutoPagerOptions {
  /** 自動送り間隔 (ms)。既定 900 (スマホカメラ + jsQR が取りこぼしにくい範囲) */
  intervalMs?: number;
  /** タイマーを動かす条件 (QR 表示中だけ true 等)。既定 true */
  active?: boolean;
}

export function useAutoPager(pageCount: number, opts: AutoPagerOptions = {}): AutoPager {
  const intervalMs = opts.intervalMs ?? 900;
  const active = opts.active ?? true;
  const count = Math.max(0, Math.floor(pageCount) || 0);

  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(true);

  // pageCount が変わったら先頭に戻し自動送りを再開する (新しい送信の頭から見せる)。
  const lastCountRef = useRef(count);
  useEffect(() => {
    if (lastCountRef.current !== count) {
      lastCountRef.current = count;
      setIndex(0);
      setPlaying(true);
    }
  }, [count]);

  // 自動送り: active && playing && 複数ページ のときだけループで index を進める。
  useEffect(() => {
    if (!active || !playing || count <= 1) return;
    const id = setInterval(() => {
      setIndex((i) => (i + 1) % count);
    }, intervalMs);
    return () => clearInterval(id);
  }, [active, playing, count, intervalMs]);

  // index が範囲外 (pageCount 縮小) なら丸める。
  const safeIndex = count > 0 ? Math.min(index, count - 1) : 0;

  const next = useCallback(() => {
    setPlaying(false); // 手動操作は自動送りを止める
    setIndex((i) => {
      const max = Math.max(0, count - 1);
      return Math.min(i + 1, max);
    });
  }, [count]);

  const prev = useCallback(() => {
    setPlaying(false);
    setIndex((i) => Math.max(0, i - 1));
  }, []);

  const toggle = useCallback(() => setPlaying((p) => !p), []);

  return { index: safeIndex, playing, toggle, next, prev };
}
