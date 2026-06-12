// 移植元: snishi-code-medical/hospital-rounds/src/features/qr-patient-list.js (純関数化)
//
// 患者リスト QR ペイロード (HM)。wire format の詳細は qr/wire.ts の
// Wire Format Authority コメントを参照。ここでは「患者配列 + タグ辞書」のエンベロープを
// 組み立てる。
//
// 形式 (v4):
//   {
//     "v": 4,
//     "td": ["内科","外科"],          // tag dictionary (settings.tags のスナップショット)
//     "p": [
//       {},                            ← HM の空 slot
//       {"r":"203","n":"テスト太郎","t":[1,3]},
//       {"r":"204","n":"テスト次郎","t":[2]}
//     ]
//   }
//
// - HM (ホーム): 全 slot をその順で並べる。末尾の空はトリム可。content (c) は使わない
//
// MM/SH (プロブレムリスト共有 QR / 共有欄 QR) は機能撤去済み。
//
// v1 との差分: live binding (appState/settings) 直読みをやめ、patients / settings を引数で
// 受ける純関数にした。decode のエラーは i18n キーでなく英語メッセージで throw する
// (UI 層が catch して i18n 表示に変換する)。

import type { Patient, Settings } from '../domain/types';
import { WIRE_V, buildTagDict, patientFromWire, patientToWire, type WirePatient } from './wire';

const PATIENT_LIST_WIRE_V = WIRE_V.HM; // HM (v4)

// HM のみ: content (c) は使わない (null 固定)、全 slot を並べる。
export interface EncodePatientListConfig {
  /** QR 種別。現在は "HM" のみ */
  kind: string;
  /** 任意フィルタ。指定があれば該当患者だけを対象に */
  matchesFilter?: (p: Patient) => boolean;
}

export function encodePatientList(
  patients: readonly Patient[],
  settings: Settings,
  cfg: EncodePatientListConfig,
): string {
  const matchesFilter = cfg.matchesFilter || (() => true);
  const tagDict = buildTagDict(settings);

  // HM: 全 slot をその順で並べる。
  const patientArr: WirePatient[] = [];
  for (const p of patients) {
    if (!matchesFilter(p)) {
      patientArr.push({});
      continue;
    }
    // HM: content は null (c キーを出さない)
    patientArr.push(patientToWire(p, tagDict, null));
  }

  // HM の末尾連続空を削る (受信側は p.length までを反映、残りはデフォルト)
  while (patientArr.length > 0) {
    const last = patientArr[patientArr.length - 1];
    if (last && Object.keys(last).length === 0) patientArr.pop();
    else break;
  }

  const out = {
    v: PATIENT_LIST_WIRE_V,
    td: tagDict,
    p: patientArr,
  };
  return JSON.stringify(out);
}

export interface DecodedPatientListEntry {
  room: string;
  name: string;
  /** sender 辞書に対する 1-based index (v1 互換の受信側形) */
  tagIdxs: number[];
  content: string;
}

export interface DecodedPatientList {
  tagNames: string[];
  patients: DecodedPatientListEntry[];
}

export function decodePatientList(payload: string): DecodedPatientList {
  const obj: unknown = JSON.parse(String(payload || ''));
  if (!obj || typeof obj !== 'object') {
    throw new Error('qr patient list: invalid payload');
  }
  const rec = obj as Record<string, unknown>;
  if (rec.v !== PATIENT_LIST_WIRE_V) {
    throw new Error(
      `qr patient list: version mismatch (got ${String(rec.v)}, expected ${PATIENT_LIST_WIRE_V})`,
    );
  }
  const tagDict = Array.isArray(rec.td)
    ? rec.td.filter((x): x is string => typeof x === 'string')
    : [];
  const rawList = Array.isArray(rec.p) ? (rec.p as WirePatient[]) : [];
  // 呼び出し側は { tagNames, patients:[{room,name,tagIdxs,content}] } を期待 (v1 互換)。
  const patients = rawList.map((entry) => {
    const decoded = patientFromWire(entry, tagDict);
    // tagIdxs は「sender 辞書に対する 1-based index」を期待する呼び出し用に再構築
    const tagIdxs = decoded.tags.map((name) => tagDict.indexOf(name) + 1).filter((i) => i > 0);
    return {
      room: decoded.room,
      name: decoded.name,
      tagIdxs,
      content: decoded.content,
    };
  });
  return { tagNames: tagDict, patients };
}
