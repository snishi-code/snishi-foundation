// 移植元: snishi-code-medical/hospital-rounds/src/features/qr-patient-list.js (純関数化)
//
// 患者リスト QR ペイロード (HM)。wire format の詳細は qr/wire.ts の
// Wire Format Authority コメントを参照。ここでは「正本メタ + 患者配列 + タグ辞書」の
// エンベロープを組み立てる。
//
// 形式 (v5):
//   {
//     "v": 5,
//     "td": ["内科","外科"],          // tag dictionary (settings.tags のスナップショット)
//     "m": {                           // 正本メタ (managed な病棟のみ。short key は wire.ts)
//       "aid":"ra_xxx","wid":"rw_xxx","wn":"3階東","rd":"prohibited","ga":"2026-..."
//     },
//     "p": [
//       {},                                                ← HM の空 slot
//       {"r":"203","n":"テスト太郎","t":[1,3],"rpid":"rp_xxx"},
//       {"r":"204","n":"テスト次郎","t":[2]}
//     ]
//   }
//
// - HM (ホーム): 全 slot をその順で並べる。末尾の空はトリム可。content (c) は使わない
// - v4 (m なし・rpid なし) は受信互換で読む。unmanaged として復元する。
// - localRole / 鍵は QR に載せない (wire.ts / domain/roster.ts 参照)。
//
// MM/SH (プロブレムリスト共有 QR / 共有欄 QR) は機能撤去済み。
//
// v1 との差分: live binding (appState/settings) 直読みをやめ、patients / settings を引数で
// 受ける純関数にした。decode のエラーは i18n キーでなく英語メッセージで throw する
// (UI 層が catch して i18n 表示に変換する)。

import type { Patient, Settings } from '../domain/types';
import type { RosterMeta } from '../domain/roster';
import {
  WIRE_V,
  buildTagDict,
  patientFromWire,
  patientToWire,
  rosterMetaFromWire,
  rosterMetaToWire,
  type DecodedRosterMeta,
  type WirePatient,
  type WireRosterMeta,
} from './wire';

const PATIENT_LIST_WIRE_V = WIRE_V.HM; // HM (v5)
/** 受信互換で読む過去バージョン (unmanaged 扱い)。 */
const PATIENT_LIST_COMPAT_V: readonly number[] = [4];

function nowIso(): string {
  try {
    return new Date().toISOString();
  } catch {
    return '';
  }
}

// HM のみ: content (c) は使わない (null 固定)、全 slot を並べる。
export interface EncodePatientListConfig {
  /** QR 種別。現在は "HM" のみ */
  kind: string;
  /** 任意フィルタ。指定があれば該当患者だけを対象に */
  matchesFilter?: (p: Patient) => boolean;
  /** 病棟の正本メタ。managed の時だけ m を載せる (localRole は載せない)。 */
  rosterMeta?: RosterMeta | null;
  /** 送信時刻 (m.ga)。省略時は現在時刻。テスト決定性のため引数化。 */
  generatedAt?: string;
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
    // HM: content は null (c キーを出さない)。rpid は patientToWire が p から載せる。
    patientArr.push(patientToWire(p, tagDict, null));
  }

  // HM の末尾連続空を削る (受信側は p.length までを反映、残りはデフォルト)
  while (patientArr.length > 0) {
    const last = patientArr[patientArr.length - 1];
    if (last && Object.keys(last).length === 0) patientArr.pop();
    else break;
  }

  const out: { v: number; td: string[]; m?: WireRosterMeta; p: WirePatient[] } = {
    v: PATIENT_LIST_WIRE_V,
    td: tagDict,
    p: patientArr,
  };
  // 正本メタは managed な病棟のみ載せる (unmanaged は m なし = v4 と同じ受信挙動)。
  const rm = cfg.rosterMeta;
  if (rm && rm.managed) {
    out.m = rosterMetaToWire(rm, cfg.generatedAt ?? nowIso());
  }
  return JSON.stringify(out);
}

export interface DecodedPatientListEntry {
  room: string;
  name: string;
  /** sender 辞書に対する 1-based index (受信側の呼び出し形式) */
  tagIdxs: number[];
  content: string;
  /** 正本側入院エピソード ID (v4 / 空スロットは '')。 */
  rosterPatientId: string;
  /** rosterPatientId を持つ患者か。 */
  rosterManaged: boolean;
}

export interface DecodedPatientList {
  /** 正本メタ (v4 / m なしは null = unmanaged)。 */
  rosterMeta: DecodedRosterMeta | null;
  tagNames: string[];
  patients: DecodedPatientListEntry[];
}

export function decodePatientList(payload: string): DecodedPatientList {
  const obj: unknown = JSON.parse(String(payload || ''));
  if (!obj || typeof obj !== 'object') {
    throw new Error('qr patient list: invalid payload');
  }
  const rec = obj as Record<string, unknown>;
  const v = rec.v;
  if (v !== PATIENT_LIST_WIRE_V && !(typeof v === 'number' && PATIENT_LIST_COMPAT_V.includes(v))) {
    throw new Error(
      `qr patient list: version mismatch (got ${String(v)}, expected ${PATIENT_LIST_WIRE_V})`,
    );
  }
  const tagDict = Array.isArray(rec.td)
    ? rec.td.filter((x): x is string => typeof x === 'string')
    : [];
  // 正本メタ: v5 の m のみ。v4 や m 欠落は null (unmanaged 扱い)。
  const rosterMeta = v === PATIENT_LIST_WIRE_V ? rosterMetaFromWire(rec.m) : null;
  // fail-closed: m を載せる managed payload は aid / wid 必須。不完全な managed payload を
  // 「正本不明の managed recipient」として受け入れると、照合不能なゴミ病棟になり次タスクの
  // 差分更新も壊れる。aid/wid のどちらかが空なら受信全体を reject する。
  if (rosterMeta && (!rosterMeta.rosterAuthorityId || !rosterMeta.rosterWardId)) {
    throw new Error('qr patient list: managed payload missing roster authority/ward id');
  }
  const rawList = Array.isArray(rec.p) ? (rec.p as WirePatient[]) : [];
  // 呼び出し側は { rosterMeta, tagNames, patients:[{room,name,tagIdxs,content,rpid...}] } を期待する。
  const patients = rawList.map((entry) => {
    const decoded = patientFromWire(entry, tagDict);
    // tagIdxs は「sender 辞書に対する 1-based index」を期待する呼び出し用に再構築
    const tagIdxs = decoded.tags.map((name) => tagDict.indexOf(name) + 1).filter((i) => i > 0);
    return {
      room: decoded.room,
      name: decoded.name,
      tagIdxs,
      content: decoded.content,
      rosterPatientId: decoded.rosterPatientId,
      rosterManaged: !!decoded.rosterPatientId,
    };
  });
  return { rosterMeta, tagNames: tagDict, patients };
}
