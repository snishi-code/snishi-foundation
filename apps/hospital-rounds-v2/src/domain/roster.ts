// HM 名簿 QR の「正本 (authority) / 受信 (recipient)」を表すドメイン型と正規化。
//
// ── 概念 ──
//   rosterAuthorityId : 名簿正本 PC / 正本データの安定 ID。病棟ごとではなく、この PWA
//                       インストール (= 正本端末) 側の安定 ID を病棟へコピーする。
//                       端末固有値なので ST QR には載せない (settings.deviceId / wire と分離)。
//   rosterWardId      : 正本側の病棟 ID。
//   rosterPatientId   : 正本側の入院エピソード ID。病棟 ID に従属させない (転棟しても同じ
//                       患者として維持できる。再入院は原則別 ID)。ローカル pid とは別概念。
//   localRole         : この端末/病棟の役割。ローカル UI 制御専用で **HM QR payload に載せない**
//                       (受信端末がさらに正本になるのを防ぐ)。
//                       - 'authority' : 正本側。氏名・部屋番号を編集でき、HM QR を出せる。
//                                       ただし正本判定は localRole だけでなく「ローカル端末の
//                                       正本 ID と rosterAuthorityId の一致」も必要。
//                       - 'recipient' : HM QR で受け取った側。氏名・部屋番号は正本由来なので
//                                       編集不可。HM QR 再配布も不可。
//                       - 'none'      : 通常手作成・空・既存 (unmanaged) 病棟。
//   redistribution    : policy 由来の協調的 UI 制御 (署名ではない)。HM (名簿=PII) は prohibited。
//
// ID は内部保存では連結文字列にしない。照合時に rosterAuthorityId + rosterWardId +
// rosterPatientId を組み合わせて見る (QR 上も aid/wid は病棟メタに 1 回、患者は rpid だけ)。

export type RosterLocalRole = 'none' | 'authority' | 'recipient';
export type RosterRedistribution = 'allowed' | 'prohibited';

export interface RosterMeta {
  /** 名簿管理下の病棟か (unmanaged = 通常病棟)。 */
  managed: boolean;
  /** ローカル UI 制御用の役割 (QR には載せない)。 */
  localRole: RosterLocalRole;
  /** 名簿正本端末/正本データの安定 ID (端末固有値・ST QR には載せない)。 */
  rosterAuthorityId: string;
  /** 正本側の病棟 ID。 */
  rosterWardId: string;
  /** 病棟の表示名 (受信側で参照する正本側ラベル)。 */
  wardName: string;
  /** 受信端末がこの名簿を受け取った時刻 (ISO)。正本側は空。 */
  receivedAt: string;
  /** 再配布の協調的 UI 制御 (HM は prohibited)。 */
  redistribution: RosterRedistribution;
}

/** unmanaged 既定 (既存データ・通常手作成病棟・空病棟)。 */
export function defaultRosterMeta(): RosterMeta {
  return {
    managed: false,
    localRole: 'none',
    rosterAuthorityId: '',
    rosterWardId: '',
    wardName: '',
    receivedAt: '',
    redistribution: 'allowed',
  };
}

// ============================
// ID 採番 (crypto.randomUUID 優先・なければ既存スタイルへフォールバック)
// prefix で種類を分ける: ra_ (authority) / rw_ (ward) / rp_ (patient)。
// ============================
function newRosterId(prefix: string): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return prefix + crypto.randomUUID();
  return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}

export function newRosterAuthorityId(): string {
  return newRosterId('ra_');
}
export function newRosterWardId(): string {
  return newRosterId('rw_');
}
export function newRosterPatientId(): string {
  return newRosterId('rp_');
}

const VALID_ROLES: readonly string[] = ['none', 'authority', 'recipient'];

/**
 * 旧 bundle / archive など rosterMeta が無い・壊れた入力を unmanaged 既定へ倒して正規化する。
 * 型不一致フィールドは既定値に倒す (normalize 全体の方針と同じ)。
 */
export function normalizeRosterMeta(raw: unknown): RosterMeta {
  const d = defaultRosterMeta();
  if (!raw || typeof raw !== 'object') return d;
  const r = raw as Record<string, unknown>;
  const localRole =
    typeof r.localRole === 'string' && VALID_ROLES.includes(r.localRole)
      ? (r.localRole as RosterLocalRole)
      : d.localRole;
  // redistribution は 'prohibited' を明示した時だけ prohibited、それ以外は allowed (unmanaged 既定)。
  const redistribution: RosterRedistribution = r.redistribution === 'prohibited' ? 'prohibited' : 'allowed';
  return {
    managed: typeof r.managed === 'boolean' ? r.managed : d.managed,
    localRole,
    rosterAuthorityId: typeof r.rosterAuthorityId === 'string' ? r.rosterAuthorityId : '',
    rosterWardId: typeof r.rosterWardId === 'string' ? r.rosterWardId : '',
    wardName: typeof r.wardName === 'string' ? r.wardName : '',
    receivedAt: typeof r.receivedAt === 'string' ? r.receivedAt : '',
    redistribution,
  };
}
