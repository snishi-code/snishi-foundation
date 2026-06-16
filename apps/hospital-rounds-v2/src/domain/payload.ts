// 移植元: snishi-code-medical/hospital-rounds/src/payload.js
//          + features/formats.js の composeExpandedForPanel / formatsForPanel
//
// 患者画面 QR (電子カルテ転記用) の出力本文合成。UI 非依存にするため、v1 の live binding
// (appState/settings) 直読みをやめて patient / settings を引数で受ける純関数に変えた。
// 合成ロジック自体は v1 と同一。

import type { Format, FormatPanel, Patient, Settings } from './types';
import { composeFormatFromValues } from './formatValues';
import { composeProblemsText } from './problems';

// v1 では payload.js に utf8ByteLength があったが、v2 は foundation qr/protocol の
// utf8ByteLength を使う (重複定義しない)。

export function formatsForPanel(panel: FormatPanel, settings: Settings): Format[] {
  if (!Array.isArray(settings.formats)) return [];
  return settings.formats.filter((f) => f.panel === panel);
}

/**
 * パネル内の全フォーマット (settings.formats が正本・グループ非依存) について、値が入った
 * フォーマットの出力テキストを改行連結する。
 * 注: v1 の composeExpandedForPanel は group 引数を受けるが未使用 (_group)。出力対象は
 * 「値が入っているフォーマット」であり、展開/クイックの区別なく可視化する (v1 修正2)。
 * v2 では未使用引数を落とした。
 */
export function composeExpandedForPanel(
  panel: FormatPanel,
  formatValues: Patient['formatValues'] | null | undefined,
  settings: Settings,
): string {
  const fv = formatValues && typeof formatValues === 'object' ? formatValues : {};
  const pieces: string[] = [];
  for (const f of formatsForPanel(panel, settings)) {
    const { text, hasValue } = composeFormatFromValues(f, fv[f.id] || {});
    if (hasValue) pieces.push(text);
  }
  return pieces.join('\n');
}

/**
 * パネル出力 = 「値が入ったフォーマット」(formatValues) の合成のみ。
 * 出力されるのは「ユーザーがタップ/入力したもの」だけ (空欄パネルは QR でも空。
 * 規定文による空欄 fallback は v1 で撤去済み)。
 */
export function buildPanelOut(
  patient: Patient | null | undefined,
  panel: FormatPanel,
  settings: Settings,
): string {
  const aText = composeExpandedForPanel(panel, patient?.formatValues || {}, settings);
  return aText && aText.trim() ? aText.trim() : '';
}

export interface SoapParts {
  sOut: string;
  oOut: string;
  aOut: string;
  pOut: string;
}

export function buildSoapParts(patient: Patient | null | undefined, settings: Settings): SoapParts {
  return {
    sOut: buildPanelOut(patient, 'S', settings),
    oOut: buildPanelOut(patient, 'O', settings),
    aOut: buildPanelOut(patient, 'A', settings),
    pOut: buildPanelOut(patient, 'P', settings),
  };
}

/**
 * 患者画面 QR の本文 = プロブレムリスト + S/O/A/P。
 * 先頭に patient.problems (`#n 本文`・空行スキップ)、続けて S/O/A/P。
 * 自由記述 (patient.freeText) は QR には含めない (電子カルテ転記対象外)。
 */
export function buildTabPayload(patient: Patient | null | undefined, settings: Settings): string {
  const problemOut = composeProblemsText(patient?.problems);
  const { sOut, oOut, aOut, pOut } = buildSoapParts(patient, settings);

  const parts: string[] = [];
  if (problemOut) {
    parts.push(problemOut);
    parts.push('――');
  }
  parts.push('(S)');
  parts.push(sOut);
  parts.push('――');
  parts.push('(O)');
  parts.push(oOut);
  parts.push('――');
  parts.push('(A)');
  parts.push(aOut);
  parts.push('――');
  parts.push('(P)');
  parts.push(pOut);
  return parts.join('\n');
}

