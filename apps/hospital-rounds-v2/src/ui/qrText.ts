// 移植元: snishi-code-medical/hospital-rounds/src/views/detail.js の splitTextToFitQr
//
// 患者画面 QR (電子カルテ転記用・常に平文) のページ分割。1 ページ MAX_BYTES (750B)。
// ページ番号はペイロードに埋め込まない (貼り付けた本文に混ざらないように)。
// v1 は qrcodegen.encodeText での収まり検証も行っていたが、750B は QR (ECC LOW) の
// 容量 (~2.9KB) に対し十分小さいため、v2 はバイト長のみで分割する。

import { MAX_BYTES, utf8ByteLength } from '@snishi/foundation/qr/protocol';
import { t } from '../i18n/strings';

export function splitTextToFitQr(raw: string): string[] {
  const s = String(raw ?? '');
  if (utf8ByteLength(s) <= MAX_BYTES) return [s];

  const cps = Array.from(s); // サロゲートペアを割らない
  const pages: string[] = [];
  let pos = 0;
  while (pos < cps.length) {
    let lo = pos + 1;
    let hi = cps.length;
    let best = -1;
    while (lo <= hi) {
      const mid = Math.floor((lo + hi) / 2);
      const chunk = cps.slice(pos, mid).join('');
      if (utf8ByteLength(chunk) > MAX_BYTES) {
        hi = mid - 1;
      } else {
        best = mid;
        lo = mid + 1;
      }
    }
    if (best <= pos) throw new Error(t('detail.qr.tooLong'));
    pages.push(cps.slice(pos, best).join(''));
    pos = best;
  }
  return pages;
}
