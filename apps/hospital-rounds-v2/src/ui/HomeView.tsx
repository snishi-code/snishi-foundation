// 移植元: snishi-code-medical/hospital-rounds/src/views/home.js + features/qr-home.js
//          + main.js の clearAllBtn (診察開始)
//
// ホーム: 患者グリッド (タップで詳細へ / ステータスバッジ / 転棟メニュー)、
// 診察開始 (= 記録クリア: snapshot → clear → fail-closed 保存 → rollback)、
// HM QR カード (送信 = 名簿 / 受信 = 確認なしで自動展開。常に新規病棟として作成 + 切替)。

import { useEffect, useState } from 'react';
import { Button } from '@snishi/foundation/ui/Button';
import { IconButton } from '@snishi/foundation/ui/IconButton';
import { Icon } from '@snishi/foundation/ui/Icon';
import { ConfirmDialog } from '@snishi/foundation/ui/ConfirmDialog';
import { useToast } from '@snishi/foundation/ui/toast';
import { useQrFlow } from '@snishi/foundation/qr/useQrFlow';
import {
  FORMAT_PANELS,
  STATUS,
  TAG_COLORS,
  clone,
  tagClearKey,
  DEFAULT_PATIENT_COUNT,
  type AppState,
  type Patient,
  type Settings,
} from '../domain/types';
import { makeDefaultPatient } from '../domain/normalize';
import {
  ROSTER_UNLISTED_TAG,
  defaultRosterMeta,
  newRosterPatientId,
  newRosterWardId,
  normalizeRosterMeta,
  type RosterMeta,
} from '../domain/roster';
import { clearPanelClinicalInput } from '../domain/formatValues';
import { SECTION, projectBundle } from '../data/bundle';
import { REASON, countActivePatients } from '../data/snapshots';
import { EVENT } from '../data/eventlog';
import {
  encodePatientList,
  decodePatientList,
  type DecodedPatientList,
  type DecodedPatientListEntry,
} from '../qr/patientList';
import { getQrKeyBytes, shouldEncryptQr, getQrPresentationDefault } from '../qr/policy';
import { useRevision, type AppRuntime } from './appRuntime';
import {
  ensureRoomOrder,
  formatPatientLabel,
  isPatientTransferred,
  statusClass,
  STATUS_MARK,
} from './patientDisplay';
import { QrDialog } from './QrCard';
import { DetailQrDialog } from './DetailQrDialog';
import { PatientEditPopup } from './PatientEditPopup';
import { StatusPickerPopup } from './StatusPicker';
import { TagFilterPicker } from './TagPicker';
import { patientMatchesTagFilter } from './tags';
import { isPatientDeleted, isTrashActive } from './patientLifecycle';
import { OverlayBinding } from './registries';
import { t } from '../i18n/strings';
import { UI } from '../ui-contract';

function formatRecvLabel(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const ts = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  return t('home.qrImport.newWs.label', { ts });
}

/** decode 済み患者の tagIdxs (sender 辞書 1-based) を sender タグ名へ復元する。 */
function decodeWireTags(tagIdxs: readonly number[] | undefined, senderTagNames: readonly string[]): string[] {
  return (tagIdxs || []).map((idx) => senderTagNames[idx - 1]).filter((x): x is string => !!x);
}

/** 既存タグに受信タグを union する (置換しない・既存順を保つ)。 */
function unionTags(existing: readonly string[], incoming: readonly string[]): string[] {
  const out = existing.slice();
  for (const tag of incoming) if (!out.includes(tag)) out.push(tag);
  return out;
}

/** 送信側タグ (+ 必要なら未掲載タグ) を受信側 settings に追加する (色は安全な既定 gray)。 */
function ensureRosterTags(settings: Settings, senderTagNames: readonly string[], includeUnlisted: boolean): void {
  for (const tag of senderTagNames) {
    if (!settings.tags.some((x) => x.name === tag)) settings.tags.push({ name: tag, color: 'gray' });
  }
  if (includeUnlisted && !settings.tags.some((x) => x.name === ROSTER_UNLISTED_TAG)) {
    settings.tags.push({ name: ROSTER_UNLISTED_TAG, color: 'gray' });
  }
}

/** 受信病棟の名簿メタ (managed recipient)。aid/wid は正本由来、wn/受信時刻は受信ごとに更新。 */
function buildRecipientMeta(
  srcMeta: NonNullable<DecodedPatientList['rosterMeta']>,
  receivedAt: string,
): RosterMeta {
  return {
    managed: true,
    localRole: 'recipient',
    rosterAuthorityId: srcMeta.rosterAuthorityId,
    rosterWardId: srcMeta.rosterWardId,
    wardName: srcMeta.wardName,
    // 受信側は再配布不可 (payload の rd によらず recipient は常に prohibited)。
    redistribution: 'prohibited',
    receivedAt,
  };
}

/** 病棟メタが受信メタ (同一 aid/wid) の更新対象 recipient 病棟か。authority は対象外。 */
function isRecipientWardMatch(
  meta: RosterMeta,
  srcMeta: NonNullable<DecodedPatientList['rosterMeta']>,
): boolean {
  return (
    meta.localRole === 'recipient' &&
    meta.rosterAuthorityId === srcMeta.rosterAuthorityId &&
    meta.rosterWardId === srcMeta.rosterWardId
  );
}

/**
 * 受信スナップショットを既存 recipient 病棟の患者配列へ非破壊マージする (照合は rosterPatientId
 * のみ。氏名・部屋番号では照合しない)。base は呼び出し側が clone 済みの配列を渡すこと
 * (in-place で更新・追記する)。
 *   - rpid 一致の既存患者: pid とローカル記録 (status/problems/freeText/formatValues/
 *     transferred/deleted) を保持し、正本由来の room/name のみ更新、tags は union。
 *   - 新規 rpid: makeDefaultPatient で末尾追加 (room/name/tags/rpid/managed を受信値から)。
 *   - スナップショットから消えた既存 managed 患者: 削除・転棟させず status=BLUE + 未掲載タグを
 *     付与する安全側フォールバック (将来の転棟/退院ログ実装までの暫定)。
 */
function buildMergedRosterPatients(
  base: Patient[],
  decoded: DecodedPatientList,
): { patients: Patient[]; usedUnlistedTag: boolean } {
  const senderTagNames = decoded.tagNames;
  const incoming = decoded.patients.filter((r) => r.rosterManaged && !!r.rosterPatientId);
  const incomingByRpid = new Map<string, DecodedPatientListEntry>();
  for (const r of incoming) incomingByRpid.set(r.rosterPatientId, r);
  const baseByRpid = new Map<string, Patient>();
  for (const p of base) if (p.rosterManaged && p.rosterPatientId) baseByRpid.set(p.rosterPatientId, p);

  let usedUnlistedTag = false;
  // 1) 既存 managed 患者を in-place 更新 / 未掲載化 (順序・ローカル記録を保持)。
  for (const p of base) {
    if (!p.rosterManaged || !p.rosterPatientId) continue; // 空スロット・unmanaged はそのまま
    const inc = incomingByRpid.get(p.rosterPatientId);
    if (inc) {
      p.room = inc.room || '';
      p.name = inc.name || '';
      // 受信タグを union しつつ、system 注入の未掲載マーカーは外す (再掲載)。このタグは消失時
      // にのみ付く reserved 名なので、名簿に存在する患者へ残すと実態と矛盾する (clinician の
      // ローカル注記ではないので除去は仕様の「tags 保持」に反しない)。status は区別不能なので
      // 触らない (未掲載由来か clinician 意図か判別できず、盲目的に戻すと意図的 status を壊す)。
      p.tags = unionTags(p.tags, decodeWireTags(inc.tagIdxs, senderTagNames)).filter(
        (tg) => tg !== ROSTER_UNLISTED_TAG,
      );
      p.rosterManaged = true;
    } else if (!isPatientTransferred(p) && !isPatientDeleted(p)) {
      // スナップショットから消えた = 未掲載 (非破壊フラグ)。working status は moot として BLUE。
      // ただし既に転棟(移)/削除(Trash)済みの患者は終端ローカル状態なので触らない
      // (転棟・退院マーカーを未掲載で上書きしない = 仕様「転棟・退院にも動かさない」)。
      p.status = STATUS.BLUE;
      p.tags = unionTags(p.tags, [ROSTER_UNLISTED_TAG]);
      usedUnlistedTag = true;
    }
  }
  // 2) base に無い rpid を末尾追加 (受信順)。
  for (const r of incoming) {
    if (baseByRpid.has(r.rosterPatientId)) continue;
    const np = makeDefaultPatient();
    np.room = r.room || '';
    np.name = r.name || '';
    np.tags = decodeWireTags(r.tagIdxs, senderTagNames);
    np.rosterPatientId = r.rosterPatientId;
    np.rosterManaged = true;
    base.push(np);
  }
  return { patients: base, usedUnlistedTag };
}

export function HomeView({
  runtime,
  onOpenPatient,
}: {
  runtime: AppRuntime;
  onOpenPatient: (no: number) => void;
}) {
  const toast = useToast();
  const revision = useRevision(runtime);
  const { store } = runtime;
  const appState = store.getAppState();

  // 描画前の自動部屋番号順ソート (v1 ensureRoomOrder。in-place・冪等。表示中は動かさない)
  ensureRoomOrder(appState.patients);

  const [clearConfirm, setClearConfirm] = useState(false);
  // 患者追加直後に開く編集ポップアップの対象 (部屋番号入力でソートされても取り違えない
  // よう index でなく pid で捕捉する — v1 add-patient.js の patient取り違え防止)
  const [addPid, setAddPid] = useState<string | null>(null);
  // 患者カード右端の埋め込み QR ボタンで開く電子カルテ転記 QR の対象 (pid 捕捉)
  const [qrPid, setQrPid] = useState<string | null>(null);
  // ホーム左端ステータスボタンで開くステータス変更ポップアップの対象 (pid 捕捉)
  const [statusPid, setStatusPid] = useState<string | null>(null);

  const trash = isTrashActive(store);
  // 受信端末 (recipient) は名簿を再配布しない。ただし「次の名簿更新を受信」する導線は
  // 同じ QR ダイアログ内なので、ボタンは無効化せず、送信 (QR ページ生成) だけ止める。
  const hmRecipient = store.getActiveRosterMeta().localRole === 'recipient';

  const flow = useQrFlow<DecodedPatientList>({
    kind: 'HM',
    kindLabel: t('qr.kind.home'),
    keyBytes: getQrKeyBytes('HM'),
    encodePayload: () => {
      // recipient (受信端末) は名簿を再配布しない: 空 payload → QR ページを生成しない。
      // ダイアログ自体は開いて受信導線 (カメラ) を残す (= 次の名簿更新を受け取れる)。
      if (store.getActiveRosterMeta().localRole === 'recipient') return '';
      // ensureAuthorityForHmQr() が表示前に managed/正本 ID を確定させている。
      return encodePatientList(store.getAppState().patients, store.getSettings(), {
        kind: 'HM',
        rosterMeta: store.getActiveRosterMeta(),
      });
    },
    decodePayload: (plain) => decodePatientList(plain),
    shouldEncrypt: () => shouldEncryptQr('HM'),
    onApply(decoded, ctrl) {
      if (!decoded.patients.length) {
        toast.show(t('qr.import.empty.home'), 'error');
        return;
      }
      // 確認なしで自動展開 (HM は非破壊の新規病棟作成。fail-closed は applyRoster 側)
      void applyRoster(decoded, ctrl.close);
    },
  });

  // データ変更で開いている QR を最新化 (v1 refreshHomeQrIfActive)。refresh は useCallback 安定。
  const refreshQr = flow.refresh;
  useEffect(() => {
    void refreshQr();
  }, [revision, refreshQr]);

  // 受信名簿の自動展開。
  //   v5 (managed) で「同じ正本 ID + 同じ病棟 ID」の受信済み recipient 病棟があれば、その病棟を
  //   更新して切り替える (新規病棟を増やさない)。無ければ従来通り新規 recipient 病棟を作る。
  //   v4 / m なし (srcMeta=null) は常に unmanaged 新規病棟 (照合しない)。fail-closed は各経路で実施。
  async function applyRoster(decoded: DecodedPatientList, close: () => void): Promise<void> {
    const srcMeta = decoded.rosterMeta;
    // v5 managed: 既存 recipient 病棟 (同一 aid/wid) を探す。見つかれば更新経路へ。
    if (srcMeta) {
      let matchId: string | null;
      try {
        matchId = await findMatchingRecipientWardId(srcMeta);
      } catch (e) {
        // 候補病棟の読み込みに失敗 = 一致の有無を確認できない。重複 recipient 病棟を作らない
        // よう中断する (fail-closed)。
        console.error('qr import: recipient ward scan failed:', e);
        toast.show(t('io.ws.switch.failed'), 'error');
        return;
      }
      if (matchId) {
        await updateExistingRecipientWard(matchId, decoded, srcMeta, close);
        return;
      }
    }
    await createNewRosterWard(decoded, srcMeta, close);
  }

  // 受信名簿を新規病棟として作成 + 切替 (v7.6+ 統一。上書き事故ゼロ)。
  // v5 (managed) は managed recipient として保存する (再配布・氏名/部屋編集を抑止)。
  async function createNewRosterWard(
    decoded: DecodedPatientList,
    srcMeta: DecodedPatientList['rosterMeta'],
    close: () => void,
  ): Promise<void> {
    const { tagNames: senderTagNames, patients: roster } = decoded;
    const label = formatRecvLabel();
    const slotCount = Math.max(DEFAULT_PATIENT_COUNT, roster.length);
    const newPatients = [];
    for (let i = 0; i < slotCount; i++) {
      const p = makeDefaultPatient();
      const r = roster[i];
      if (r) {
        p.room = r.room || '';
        p.name = r.name || '';
        p.tags = decodeWireTags(r.tagIdxs, senderTagNames);
        // 患者は新しいローカル pid を発番済み (makeDefaultPatient)。pid と rosterPatientId は
        // 混ぜない。正本由来の rosterPatientId だけ受け継ぎ managed にする。
        if (srcMeta && r.rosterManaged && r.rosterPatientId) {
          p.rosterPatientId = r.rosterPatientId;
          p.rosterManaged = true;
        }
      }
      newPatients.push(p);
    }
    // 送信側タグを union (rollback できるよう旧値を控える)
    const liveSettings = store.getSettings();
    const prevTags = liveSettings.tags.slice();
    ensureRosterTags(liveSettings, senderTagNames, false);
    const newAppState: AppState = {
      v: 3,
      title: store.getAppState().title,
      patients: newPatients,
    };
    // 受信病棟の名簿メタ: payload にメタがあれば managed recipient、無ければ unmanaged。
    const wardRosterMeta: RosterMeta = srcMeta
      ? buildRecipientMeta(srcMeta, new Date().toISOString())
      : defaultRosterMeta();
    const bundle = projectBundle({
      appState: newAppState,
      settings: liveSettings,
      rosterMeta: wardRosterMeta,
      sections: [SECTION.META, SECTION.PATIENTS],
    });
    try {
      const newId = await store.storage.createWorkspaceRecord(label, bundle);
      // switchWorkspace は切替前に現病棟 + 設定 (タグ union 込み) を fail-closed 保存する。
      // 注: 厳密な all-or-nothing ではない。createWorkspaceRecord 成功後に switchWorkspace
      // が失敗すると新病棟レコードだけ残り得る (= 非破壊の孤児病棟。既存データは無傷で、
      // ユーザーは病棟一覧から削除できる)。可視状態 (close/成功 toast) は durable 書込の
      // 後にしか進めないので fail-closed の本質 (可視状態を先に進めない) は保つ。
      await store.switchWorkspace(newId);
    } catch (e) {
      console.error('qr import: create/switch new ws failed:', e);
      liveSettings.tags = prevTags; // タグ union をロールバック
      toast.show(t('io.ws.switch.failed'), 'error');
      runtime.bump();
      return;
    }
    close();
    toast.show(t('home.qrImport.newWs.done', { count: roster.length, label }));
  }

  // 「同じ正本 ID + 同じ病棟 ID」の受信済み recipient 病棟を探す (無ければ null)。
  // 正本側 (authority) は対象外 — 正本を QR 受信で上書きしない。
  // active 病棟を最優先で判定する: 旧実装は受信ごとに新規病棟を作っていたため、同じ aid/wid の
  // recipient 病棟が端末に複数残っている場合がある。listBundles 順の先頭一致を返すと、いま開い
  // ている病棟ではなく古い重複病棟を更新して切り替えてしまう。active が一致するならそれを使う
  // (live メタを権威に — 未保存のメタ編集も含む)。
  // 候補 bundle の読み込みに失敗したら throw (照合の有無を確認できないまま重複を作らない)。
  async function findMatchingRecipientWardId(
    srcMeta: NonNullable<DecodedPatientList['rosterMeta']>,
  ): Promise<string | null> {
    const activeId = store.storage.getActiveWorkspaceId();
    if (isRecipientWardMatch(store.getActiveRosterMeta(), srcMeta)) return activeId;
    // active が非一致のときだけ他病棟を走査する (保存済み bundle の rosterMeta を見る)。
    // 残った非 active の重複は legacy 由来 (重複統合 UI は非ゴール)。最初の一致を返す。
    for (const w of await store.storage.listBundles()) {
      if (w.id === activeId) continue; // active は判定済み
      const b = await store.storage.loadBundle(w.id);
      if (!b) throw new Error(`recipient ward scan: load failed: ${w.id}`);
      if (isRecipientWardMatch(normalizeRosterMeta(b.rosterMeta), srcMeta)) return w.id;
    }
    return null;
  }

  // 一致した recipient 病棟を更新する (新規病棟を増やさない)。
  // active 以外なら先に切替えて live をマージ対象に揃える (単一の fail-closed 保存経路に集約)。
  // マージは live 患者 (未保存編集を含む) を base にし、rosterPatientId で照合する。
  async function updateExistingRecipientWard(
    matchId: string,
    decoded: DecodedPatientList,
    srcMeta: NonNullable<DecodedPatientList['rosterMeta']>,
    close: () => void,
  ): Promise<void> {
    if (matchId !== store.storage.getActiveWorkspaceId()) {
      // 切替前に読込可能か確認 (読めない病棟へ切替えると live が空になりマージで既存記録を失う)。
      const check = await store.storage.loadBundle(matchId);
      if (!check) {
        toast.show(t('io.ws.switch.failed'), 'error');
        return;
      }
      try {
        // switchWorkspace は現 active + 設定を fail-closed 保存してから matchId を live へ読む。
        await store.switchWorkspace(matchId);
      } catch (e) {
        console.error('qr import: switch to recipient ward failed:', e);
        toast.show(t('io.ws.switch.failed'), 'error');
        runtime.bump();
        return;
      }
    }
    // matchId が active になった。live 患者を base にマージする (clone してロールバック可能に)。
    const originalState = store.getAppState();
    const base = originalState.patients.map(clone);
    const { patients: merged, usedUnlistedTag } = buildMergedRosterPatients(base, decoded);
    const liveSettings = store.getSettings();
    const prevTags = liveSettings.tags.slice();
    ensureRosterTags(liveSettings, decoded.tagNames, usedUnlistedTag);
    const prevMeta = store.getActiveRosterMeta();
    store.setAppState({ ...originalState, patients: merged });
    store.setActiveRosterMeta(buildRecipientMeta(srcMeta, new Date().toISOString()));
    try {
      await store.persistActiveOrThrow();
    } catch (e) {
      // 保存できなければ可視状態を進めない。live (患者・タグ・メタ) を元へ戻す。
      console.error('qr import: update recipient ward persist failed:', e);
      store.setAppState(originalState);
      liveSettings.tags = prevTags;
      store.setActiveRosterMeta(prevMeta);
      runtime.bump();
      toast.show(t('save.failed'), 'error');
      return;
    }
    close();
    runtime.bump();
    const count = decoded.patients.filter((r) => r.rosterManaged && !!r.rosterPatientId).length;
    toast.show(t('home.qrImport.updateWs.done', { count }));
  }

  // 「実患者」(= 空スロットでない名簿対象)。HM QR に載る非空 wire 患者と揃える。
  function isRealRosterPatient(p: { name: string; room: string }): boolean {
    return !!(p.name && p.name.trim()) || !!(p.room && p.room.trim());
  }

  // 正本側 HM QR を出す前に、正本 ID / 病棟 ID / 患者 ID を確保して保存する (fail-closed)。
  // 戻り値 false = QR を出さない (recipient・別正本・保存失敗)。
  async function ensureAuthorityForHmQr(): Promise<boolean> {
    const prevMeta = store.getActiveRosterMeta();
    // 受信端末 (recipient) は名簿を再配布できない。
    if (prevMeta.localRole === 'recipient') {
      toast.show(t('home.qr.redistributionBlocked'), 'error');
      return false;
    }
    // ローカル端末の正本 ID を確保 (初回はここで生成 + 永続化)。
    const localAuthId = store.storage.ensureRosterAuthorityId();
    // localRole:'authority' なのに rosterAuthorityId がローカル正本 ID と一致しない =
    // 別正本から受け取ったデータ。誤って再配布しないよう fail-closed で出さない。
    if (prevMeta.rosterAuthorityId && prevMeta.rosterAuthorityId !== localAuthId) {
      toast.show(t('home.qr.redistributionBlocked'), 'error');
      return false;
    }

    // 病棟表示名 (wn) は病棟ラベルから解決する (listBundles 失敗時は既存値を温存)。
    const activeId = store.storage.getActiveWorkspaceId();
    let wardName = prevMeta.wardName;
    try {
      const list = await store.storage.listBundles();
      const w = list.find((x) => x.id === activeId);
      if (w) wardName = w.label || w.title || wardName;
    } catch {
      /* 列挙失敗は致命的でない (既存 wardName を使う) */
    }

    const nextMeta: RosterMeta = {
      managed: true,
      localRole: 'authority',
      rosterAuthorityId: prevMeta.rosterAuthorityId || localAuthId,
      rosterWardId: prevMeta.rosterWardId || newRosterWardId(),
      wardName,
      receivedAt: prevMeta.receivedAt,
      redistribution: 'prohibited',
    };

    // 実患者に rosterPatientId を発番 (空スロットには付けない)。rollback 用に旧値を控える。
    const patients = store.getAppState().patients;
    const backup = patients.map((p) => ({
      rosterPatientId: p.rosterPatientId,
      rosterManaged: p.rosterManaged,
    }));
    for (const p of patients) {
      if (!isRealRosterPatient(p)) continue;
      if (!p.rosterPatientId) p.rosterPatientId = newRosterPatientId();
      p.rosterManaged = true;
    }
    store.setActiveRosterMeta(nextMeta);

    // ID 確保後は保存してから QR を出す。保存できなければ live を戻して QR を出さない。
    try {
      await store.persistActiveOrThrow();
    } catch (e) {
      console.error('hm qr: ensure authority persist failed:', e);
      patients.forEach((p, i) => {
        p.rosterPatientId = backup[i]!.rosterPatientId;
        p.rosterManaged = backup[i]!.rosterManaged;
      });
      store.setActiveRosterMeta(prevMeta);
      toast.show(t('save.failed'), 'error');
      return false;
    }
    return true;
  }

  // 診察開始 (= 記録クリア)。fail-closed: 保存できなければ live を戻して中断。
  async function runClear(): Promise<void> {
    setClearConfirm(false);
    const state = store.getAppState();
    await runtime.snapshots.capture(
      REASON.CLEAR,
      store.storage.getActiveWorkspaceId(),
      { title: state.title, patients: state.patients },
      String(countActivePatients(state.patients)),
    );
    const live = store.getSettings();
    const ct = live.clearTargets;
    const now = Date.now();
    const backup = state.patients.map((p) => clone(p));
    // clearTargets で ON の色のタグを全患者から外す
    const dropColors = new Set(TAG_COLORS.filter((c) => !!ct?.[tagClearKey(c)]));
    const drop = new Set(live.tags.filter((t) => dropColors.has(t.color)).map((t) => t.name));
    for (const p of state.patients) {
      for (const panel of FORMAT_PANELS) {
        if (ct[panel]) clearPanelClinicalInput(p, panel, live.formats);
      }
      if (p.status === STATUS.YELLOW && ct.statusYellow) p.status = STATUS.NONE;
      else if (p.status === STATUS.GREEN && ct.statusGreen) p.status = STATUS.NONE;
      else if (p.status === STATUS.GRAY && ct.statusGray) p.status = STATUS.NONE;
      else if (p.status === STATUS.BLUE && ct.statusBlue) p.status = STATUS.NONE;
      if (drop.size) p.tags = p.tags.filter((tg) => !drop.has(tg));
      // プロブレムリスト / 自由記述 (既定では両方 false = 残す)。
      if (ct.problems) p.problems = [];
      if (ct.freeText) p.freeText = '';
      p.updatedAt = now;
    }
    try {
      await store.persistActiveOrThrow();
    } catch (e) {
      console.error('clear: save failed, rolling back:', e);
      state.patients = backup; // live state を破壊前へ戻す
      runtime.bump();
      toast.show(t('save.failed'), 'error');
      return; // 成功表示・event log へ進めない (fail-closed)
    }
    runtime.eventlog.log(EVENT.CLEAR);
    runtime.bump();
  }

  return (
    <section aria-label={t('header.home')}>
      <div className="viewToolbar">
        <Button onClick={() => setClearConfirm(true)} title={t('home.start.tooltip')} dataUi={UI.home.start}>
          {t('home.start.btn')}
        </Button>
        <TagFilterPicker store={store} onChange={() => runtime.bump()} />
        <span className="viewToolbarSpacer" />
        <IconButton
          label={t('home.qr.show')}
          dataUi={UI.qr.show}
          onClick={() => {
            if (flow.isActive) {
              flow.close();
              return;
            }
            runtime.eventlog.log(EVENT.QR_SHOW, { kind: 'HM' });
            void (async () => {
              // recipient は再配布しない (QR ページは出さない) が、受信のためダイアログは開く。
              if (!hmRecipient) {
                // 正本 ID / 病棟 ID / 患者 ID を確保 + 保存してから開く (fail-closed)。
                const ok = await ensureAuthorityForHmQr();
                if (!ok) return;
                runtime.bump(); // roster ID 発番を UI へ反映
              }
              try {
                await flow.open();
              } catch (e) {
                // 暗号化失敗 = QR を出さない (fail-closed)。握らず可視化。
                console.error('qr open failed:', e);
                toast.show(t('qr.render.failed'), 'error');
              }
            })();
          }}
        >
          <Icon name="qr" size={18} />
        </IconButton>
      </div>

      {flow.isActive ? (
        <QrDialog
          flow={flow}
          kindLabel={t('qr.kind.home')}
          presentationDefault={getQrPresentationDefault('HM')}
          notice={hmRecipient ? t('home.qr.recipientReceiveOnly') : undefined}
          onClose={flow.close}
        />
      ) : null}

      {trash ? <div className="banner trashBanner">{t('trash.banner')}</div> : null}

      <div className="grid" data-ui={UI.home.grid}>
        {appState.patients.map((p, idx) => {
          // Trash では削除患者だけを出す (空スロットの inflate 分は隠す)
          if (trash && !isPatientDeleted(p)) return null;
          if (!patientMatchesTagFilter(p)) return null;
          const no = idx + 1;
          const label = formatPatientLabel(p, String(no));
          const cls = statusClass(p.status);
          return (
            <div key={p.pid} className="patientCardRow">
              {/* 左端: ステータスボタン (44px 正方。Trash / 転棟済は QR ボタンと同様の扱い) */}
              {!trash ? (
                <button
                  type="button"
                  className={`patientStatusBtn ${cls || 'status-none'}`}
                  aria-label={t('home.statusBtn.aria', { label })}
                  data-ui={UI.home.statusZone}
                  onClick={(e) => {
                    e.stopPropagation();
                    setStatusPid(p.pid);
                  }}
                >
                  <span aria-hidden="true">{STATUS_MARK[p.status]}</span>
                </button>
              ) : null}
              {/* 中央: 患者ボタン (部屋 + 氏名 + タグ。ステータスマークは左端ボタンに移したので除去) */}
              <button
                type="button"
                className={`patientBtn ${cls}`}
                aria-label={label}
                data-ui={UI.patient.card}
                onClick={() => onOpenPatient(no)}
              >
                {label}
              </button>
              {/* 右端: 埋め込み QR (ホームから直接その患者の電子カルテ転記 QR を出す) */}
              {!trash ? (
                <button
                  type="button"
                  className="patientQrBtn"
                  title={t('home.patientQr.title')}
                  aria-label={t('home.patientQr.aria', { label })}
                  data-ui={UI.home.patientQr}
                  onClick={(e) => {
                    e.stopPropagation();
                    runtime.eventlog.log(EVENT.QR_SHOW, { kind: 'TAB' });
                    setQrPid(p.pid);
                  }}
                >
                  <Icon name="qr" size={22} />
                </button>
              ) : null}
            </div>
          );
        })}
        {trash && !appState.patients.some(isPatientDeleted) ? (
          <p className="muted trashEmpty">{t('trash.empty')}</p>
        ) : null}
        {!trash ? (
          <button
            type="button"
            className="addPatientBtn"
            title={t('patient.add.title')}
            aria-label={t('patient.add.aria')}
            data-ui={UI.home.addPatient}
            onClick={() => {
              // 末尾に空患者を追加 → 保存予約 → すぐ患者編集を開く (pid で捕捉)
              const p = makeDefaultPatient();
              store.getAppState().patients.push(p);
              store.scheduleSave();
              setAddPid(p.pid);
              runtime.bump();
            }}
          >
            <Icon name="add" size={20} />
            <span className="addPatientBtnLabel">{t('patient.add')}</span>
          </button>
        ) : null}
      </div>

      {clearConfirm ? (
        <OverlayBinding onClose={() => setClearConfirm(false)} />
      ) : null}
      {clearConfirm ? (
        <ConfirmDialog
          title={t('home.start.btn')}
          body={t('home.start.confirm')}
          confirmLabel={t('home.start.btn')}
          cancelLabel={t('common.cancel')}
          danger
          onCancel={() => setClearConfirm(false)}
          onConfirm={() => void runClear()}
        />
      ) : null}

      {qrPid != null
        ? (() => {
            // 患者は pid で引き直す (並び替えで別患者の QR を出さない)
            const target = appState.patients.find((x) => x.pid === qrPid);
            if (!target) return null;
            return (
              <DetailQrDialog patient={target} settings={store.getSettings()} onClose={() => setQrPid(null)} />
            );
          })()
        : null}

      {addPid != null
        ? (() => {
            // 部屋番号入力で並びが変わるため、描画ごとに pid → 現 index を解決する
            const no = appState.patients.findIndex((p) => p.pid === addPid) + 1;
            if (no <= 0) return null;
            return <PatientEditPopup patientNo={no} runtime={runtime} onClose={() => setAddPid(null)} />;
          })()
        : null}

      {statusPid != null
        ? (() => {
            // pid で引き直す (並び替えで別患者を操作しない)
            const target = appState.patients.find((x) => x.pid === statusPid);
            if (!target) return null;
            return (
              <StatusPickerPopup
                value={target.status}
                onSelect={(status) => {
                  target.status = status;
                  const no = appState.patients.indexOf(target) + 1;
                  store.markUpdated(no);
                  store.scheduleSave();
                  runtime.eventlog.log(EVENT.PATIENT_EDIT);
                  runtime.bump();
                }}
                onClose={() => setStatusPid(null)}
                dataUi={UI.patient.statusPopup}
              />
            );
          })()
        : null}
    </section>
  );
}
