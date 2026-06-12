// プロブレムリスト (患者ごとの独立データ) の純データロジック。
//
// 仕様 (2026-06 指示書):
//   - patient.problems = string[] (病名・問題名)。フォーマット/設定とは完全に別領域。
//   - `#1` 等の番号はユーザー入力でも保存値でもなく、配列順から表示時に自動付与する。
//     行を削除したら下の行が詰まり、番号は表示順で再採番される。
//   - QR 出力では空行を出さず、`#1 HF` のように表示番号 + 本文で合成する。
//   - S/O/A/P からの参照・挿入、プロブレム別サブフォーマットは今回の対象外 (将来候補)。

import type { Patient } from './types';

/** 保存値から正規化したプロブレム配列を読む (不正値は除外)。 */
export function readProblems(patient: Patient | null | undefined): string[] {
  const arr = patient && Array.isArray(patient.problems) ? patient.problems : [];
  return arr.filter((x): x is string => typeof x === 'string');
}

/** 1 行でも実入力 (空白以外) があるか。空患者判定・QR 出力判定に使う。 */
export function problemsHaveInput(problems: readonly unknown[] | null | undefined): boolean {
  return Array.isArray(problems) && problems.some((x) => String(x ?? '').trim() !== '');
}

/**
 * QR / 一覧出力用の合成テキスト。表示番号 (配列 index + 1) を付け、空行はスキップする。
 * 例: ["HF", "", "DM"] → "#1 HF\n#3 DM" (番号は表示順 = UI に出ている番号と一致)。
 */
export function composeProblemsText(problems: readonly unknown[] | null | undefined): string {
  const arr = Array.isArray(problems) ? problems : [];
  const lines: string[] = [];
  arr.forEach((v, i) => {
    const text = String(v ?? '').trim();
    if (!text) return;
    lines.push(`#${i + 1} ${text}`);
  });
  return lines.join('\n');
}
