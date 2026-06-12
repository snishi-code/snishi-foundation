// number/fraction の備考 (患者ごとの短文注記。例: SpO2 の "O2 2L")。
//
// 使用頻度が低いため常時入力欄からは外し、行末の小さなボタン + ポップアップ編集に
// 分離する (「見たまま記入する」の例外 — 2026-06 フィードバック)。
// 備考があるボタンは on 表示になり、本文は呼び出し側が行下に小さく表示する。

import { useState } from 'react';
import { Popup } from '@snishi/foundation/ui/Popup';
import { Icon } from '@snishi/foundation/ui/Icon';
import { t } from '../i18n/strings';
import { useRegisterOverlay } from './registries';

function NotePopup({
  ariaLabel,
  note,
  onFocusSession,
  onChange,
  onClose,
}: {
  ariaLabel: string;
  note: string;
  onFocusSession: () => void;
  onChange: (note: string) => void;
  onClose: () => void;
}) {
  useRegisterOverlay(onClose);
  return (
    <Popup ariaLabel={ariaLabel} onClose={onClose}>
      <div className="noteEditSheet">
        <textarea
          className="textarea noteEditArea"
          rows={2}
          value={note}
          placeholder={t('format.placeholder.memo')}
          aria-label={ariaLabel}
          // 備考ボタンの明示タップで開く単一入力 (中央ルールの明示経路)
          autoFocus
          onFocus={onFocusSession}
          onChange={(e) => onChange(e.target.value)}
        />
      </div>
    </Popup>
  );
}

export function NoteButton({
  note,
  ariaLabel,
  onFocusSession,
  onChange,
}: {
  /** 現在の備考 (controlled — write-through 済みの値) */
  note: string;
  ariaLabel: string;
  /** 編集開始 (Undo セッションの起点を親側で張る) */
  onFocusSession: () => void;
  onChange: (note: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const has = note.trim() !== '';
  return (
    <>
      <button
        type="button"
        className={`noteBtn${has ? ' on' : ''}`}
        title={t('format.note.title')}
        aria-label={ariaLabel}
        aria-pressed={has}
        onClick={() => setOpen(true)}
      >
        <Icon name="memo" size={16} />
      </button>
      {open ? (
        <NotePopup
          ariaLabel={ariaLabel}
          note={note}
          onFocusSession={onFocusSession}
          onChange={onChange}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </>
  );
}
