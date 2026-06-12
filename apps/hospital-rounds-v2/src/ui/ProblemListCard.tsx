// プロブレムリスト (患者ごとの独立データ) のカード。
//
// 仕様 (2026-06 指示書):
//   - デフォルトで空の `#1` 入力欄を 1 つ表示する。番号は配列順から自動付与。
//   - 入力欄は改行可能で、内容に応じて縦に伸びる。
//   - 下部の追加ボタンで末尾に空行を増やす。
//   - 行削除: 空なら確認なし / 入力ありは確認ポップアップ。全行削除後は空 `#1` が残る
//     (= problems を空配列にして表示側で 1 行補う)。
//   - フォーマット/設定とは無関係。設定画面からの一括編集は作らない。
//
// 書き込みは inline 編集と同じ write-through (markUpdated + scheduleSave)。患者は
// pid で handler 内に引き直す (並び替え/患者切替で別患者へ書かない)。Undo は
// 'problem' スコープ (patient.problems のみ巻き戻す)。

import { useRef, useState } from 'react';
import { Icon } from '@snishi/foundation/ui/Icon';
import { IconButton } from '@snishi/foundation/ui/IconButton';
import { ConfirmDialog } from '@snishi/foundation/ui/ConfirmDialog';
import type { Patient } from '../domain/types';
import { readProblems } from '../domain/problems';
import type { AppRuntime } from './appRuntime';
import { OverlayBinding } from './registries';
import { hapticTick } from './feedback';
import { t } from '../i18n/strings';
import { UI } from '../ui-contract';

/** 内容に応じて textarea を縦に伸ばす (field-sizing 未対応ブラウザ向けの JS フォールバック)。 */
function autosize(el: HTMLTextAreaElement): void {
  el.style.height = 'auto';
  el.style.height = `${el.scrollHeight}px`;
}

export function ProblemListCard({
  runtime,
  patient,
  patientNo,
}: {
  runtime: AppRuntime;
  patient: Patient;
  /** 1-based 患者番号 (markUpdated 用) */
  patientNo: number;
}) {
  const { store } = runtime;
  const pid = patient.pid;
  const [deleteIdx, setDeleteIdx] = useState<number | null>(null);
  // テキスト編集の Undo 起点はフォーカスセッションごとに 1 回 (inline 編集と同じ考え方)
  const editSessionRef = useRef<{ pid: string; orig: string[]; captured: boolean } | null>(null);

  const live = () => store.getAppState().patients.find((x) => x.pid === pid) ?? null;

  const problems = readProblems(patient);
  // 表示行: 0 行でも空の #1 入力欄を必ず出す (保存値は空配列のまま)
  const rows = problems.length ? problems : [''];

  function writeRow(i: number, value: string): void {
    const p = live();
    if (!p) return;
    const arr = readProblems(p);
    while (arr.length <= i) arr.push('');
    // フォーカスセッション内の最初の実変更で 1 回だけ Undo 起点を積む
    const session = editSessionRef.current;
    if (session && session.pid === pid && !session.captured && value !== (session.orig[i] ?? '')) {
      runtime.undo.capture(p, 'problem', { preFields: { problems: session.orig.slice() } });
      session.captured = true;
    }
    arr[i] = value;
    p.problems = arr;
    store.markUpdated(patientNo);
    store.scheduleSave();
  }

  function addRow(): void {
    const p = live();
    if (!p) return;
    runtime.undo.capture(p, 'problem');
    const arr = readProblems(p);
    // 0 行のときに見えている仮想 #1 行を実体化してから #2 を足す (見た目と番号を一致させる)
    if (!arr.length) arr.push('');
    arr.push('');
    p.problems = arr;
    store.markUpdated(patientNo);
    store.scheduleSave();
    runtime.bump();
  }

  function deleteRow(i: number): void {
    const p = live();
    if (!p) return;
    const arr = readProblems(p);
    if (i >= arr.length) {
      // 仮想行 (保存値なし) の削除は何もしない
      setDeleteIdx(null);
      return;
    }
    runtime.undo.capture(p, 'problem');
    arr.splice(i, 1); // 下の行が詰まり、表示番号は自動で再採番される
    p.problems = arr;
    store.markUpdated(patientNo);
    store.scheduleSave();
    hapticTick();
    runtime.bump();
  }

  function requestDelete(i: number): void {
    const text = String(rows[i] ?? '').trim();
    if (!text) {
      deleteRow(i); // 空行は確認なしで削除
      return;
    }
    setDeleteIdx(i);
  }

  return (
    <section className="card panelCard problemCard" aria-label={t('panel.problem')} data-ui={UI.problem.card}>
      <div className="panelCardHead">
        <div className="panelLabel">{t('panel.problem')}</div>
      </div>
      <div className="problemList" data-ui={UI.problem.list}>
        {rows.map((text, i) => (
          <div key={i} className="problemRow" data-ui={UI.problem.row}>
            <span className="problemRowNo" aria-hidden="true">{`#${i + 1}`}</span>
            <textarea
              className="textarea problemRowInput"
              rows={1}
              value={text}
              placeholder={t('problem.placeholder')}
              aria-label={t('problem.input.aria', { n: i + 1 })}
              data-ui={UI.problem.input}
              onFocus={(e) => {
                const p = live();
                editSessionRef.current = p ? { pid, orig: readProblems(p), captured: false } : null;
                autosize(e.currentTarget);
              }}
              onChange={(e) => {
                writeRow(i, e.target.value);
                autosize(e.currentTarget);
              }}
            />
            <IconButton
              label={t('problem.delete.aria', { n: i + 1 })}
              dataUi={UI.problem.delete}
              onClick={() => requestDelete(i)}
            >
              <Icon name="close" size={16} />
            </IconButton>
          </div>
        ))}
        <button type="button" className="problemAddBtn" data-ui={UI.problem.add} onClick={addRow}>
          <Icon name="add" size={16} />
          <span>{t('problem.add')}</span>
        </button>
      </div>

      {deleteIdx != null ? <OverlayBinding onClose={() => setDeleteIdx(null)} /> : null}
      {deleteIdx != null ? (
        <ConfirmDialog
          title={t('common.delete')}
          body={t('problem.delete.confirm', { text: String(rows[deleteIdx] ?? '').trim() })}
          confirmLabel={t('common.delete')}
          cancelLabel={t('common.cancel')}
          danger
          onCancel={() => setDeleteIdx(null)}
          onConfirm={() => {
            const idx = deleteIdx;
            setDeleteIdx(null);
            if (idx != null) deleteRow(idx);
          }}
        />
      ) : null}
    </section>
  );
}
