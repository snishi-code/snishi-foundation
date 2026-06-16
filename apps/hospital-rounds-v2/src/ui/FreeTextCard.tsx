// 自由記述欄 (患者ごとの独立 textarea)。フォーマット/設定とは別構造。
//
// 仕様:
//   - patient.freeText = string。患者ごとの自由記述 (改行可)。内容に応じて縦に伸びる。
//   - 入力は write-through (input ごとに markUpdated + scheduleSave で保存予約)。
//   - 患者ページ下部、S/O/A/P の後・患者管理の前に置く。
//   - QR には含めない (payload.ts 参照)。旧 shared パネル / FORMAT_PANELS への復活はしない。
//   - 患者は pid で捕捉する (前後ナビ・並び替えで別患者へ書かないため)。

import type { Patient } from '../domain/types';
import type { AppRuntime } from './appRuntime';
import { t } from '../i18n/strings';
import { UI } from '../ui-contract';

/** 内容に応じて textarea を縦に伸ばす (field-sizing 未対応ブラウザ向けの JS フォールバック)。 */
function autosize(el: HTMLTextAreaElement): void {
  el.style.height = 'auto';
  el.style.height = `${el.scrollHeight}px`;
}

export function FreeTextCard({ runtime, patient }: { runtime: AppRuntime; patient: Patient }) {
  const { store } = runtime;
  const pid = patient.pid;

  const live = () => store.getAppState().patients.find((x) => x.pid === pid) ?? null;
  // markUpdated は 1-based の患者番号を取る (store: patients[no - 1])。
  const liveNo = () => store.getAppState().patients.findIndex((x) => x.pid === pid) + 1;

  const value = typeof patient.freeText === 'string' ? patient.freeText : '';

  function write(next: string): void {
    const p = live();
    if (!p) return;
    p.freeText = next;
    store.markUpdated(liveNo());
    store.scheduleSave();
  }

  return (
    <section className="card panelCard freeTextCard" aria-label={t('panel.freeText')} data-ui={UI.freeText.card}>
      <div className="panelCardHead">
        <div className="panelLabel">{t('panel.freeText')}</div>
      </div>
      <textarea
        className="textarea freeTextInput"
        rows={2}
        value={value}
        placeholder={t('freeText.placeholder')}
        aria-label={t('panel.freeText')}
        data-ui={UI.freeText.input}
        onFocus={(e) => autosize(e.currentTarget)}
        onChange={(e) => {
          write(e.target.value);
          autosize(e.currentTarget);
        }}
      />
    </section>
  );
}
