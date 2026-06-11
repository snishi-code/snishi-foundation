// patientUndo: undo/redo / redo 枝破棄 / MAX 50 / タグ delta / persist 失敗時ロールバック。
// (移植元 v1 patient-undo.js の挙動仕様。v2 は patient 引数注入の UI 非依存 API)

import { describe, expect, it, vi } from 'vitest';
import { makeDefaultPatient } from './normalize';
import { PATIENT_UNDO_MAX, createPatientUndo } from './patientUndo';
import type { Patient } from './types';

function patientWith(values: Record<string, unknown>): Patient {
  const p = makeDefaultPatient();
  p.formatValues = { f1: { ...values } };
  return p;
}

function okPersist() {
  return vi.fn(async () => {});
}

describe('createPatientUndo', () => {
  it('undo で対象フィールドだけ戻り、識別情報 (name/room/status) には触れない', async () => {
    const persist = okPersist();
    const u = createPatientUndo({ persist, now: () => 1111 });
    const p = patientWith({ 0: 'before' });
    p.name = '太郎';

    u.capture(p); // 変更直前に撮る
    p.formatValues = { f1: { 0: 'after' } };
    p.name = '太郎(改名)'; // undo 対象外の編集

    const res = await u.undo(p);
    expect(res).toEqual({ ok: true, label: 'format' });
    expect(p.formatValues).toEqual({ f1: { 0: 'before' } });
    expect(p.name).toBe('太郎(改名)'); // 識別情報は巻き戻らない (PII 巻き戻り防止)
    expect(p.updatedAt).toBe(1111); // markUpdated 相当
    expect(persist).toHaveBeenCalledTimes(1);
  });

  it('undo → redo の往復 (カーソル方式)', async () => {
    const u = createPatientUndo({ persist: okPersist() });
    const p = patientWith({ 0: 'v1' });
    u.capture(p);
    p.formatValues = { f1: { 0: 'v2' } };

    await u.undo(p);
    expect(p.formatValues).toEqual({ f1: { 0: 'v1' } });
    expect(u.canRedo(p)).toBe(true);
    await u.redo(p);
    expect(p.formatValues).toEqual({ f1: { 0: 'v2' } });
    expect(u.canUndo(p)).toBe(true);
    expect(u.canRedo(p)).toBe(false);
  });

  it('新規編集 (capture) で redo 枝を破棄する', async () => {
    const u = createPatientUndo({ persist: okPersist() });
    const p = patientWith({ 0: 'v1' });
    u.capture(p);
    p.formatValues = { f1: { 0: 'v2' } };
    await u.undo(p);
    expect(u.canRedo(p)).toBe(true);

    u.capture(p); // 新規編集の起点
    p.formatValues = { f1: { 0: 'v3' } };
    expect(u.canRedo(p)).toBe(false); // redo 枝破棄
  });

  it('スタックは患者 (pid) ごとに閉じる', async () => {
    const u = createPatientUndo({ persist: okPersist() });
    const a = patientWith({ 0: 'a1' });
    const b = patientWith({ 0: 'b1' });
    u.capture(a);
    a.formatValues = { f1: { 0: 'a2' } };
    expect(u.canUndo(a)).toBe(true);
    expect(u.canUndo(b)).toBe(false); // 別患者には影響しない
    await u.undo(a);
    expect(b.formatValues).toEqual({ f1: { 0: 'b1' } });
  });

  it('MAX 50 を超えると古いものから捨てる', async () => {
    const u = createPatientUndo({ persist: okPersist() });
    const p = patientWith({ 0: 'v0' });
    for (let i = 1; i <= PATIENT_UNDO_MAX + 5; i++) {
      u.capture(p);
      p.formatValues = { f1: { 0: `v${i}` } };
    }
    let undone = 0;
    while (u.canUndo(p)) {
      await u.undo(p);
      undone++;
    }
    expect(undone).toBe(PATIENT_UNDO_MAX);
    // 最古の 5 件は捨てられている → v5 まで戻る (v0 には戻らない)
    expect(p.formatValues).toEqual({ f1: { 0: 'v5' } });
  });

  it('タグ delta: undo で自動付与タグだけ除去、手編集タグは保持。redo で再付与', async () => {
    const u = createPatientUndo({ persist: okPersist() });
    const p = patientWith({ 0: '' });
    p.tags = ['既存'];

    // フォーマット入力で「内科」が自動付与される操作
    u.capture(p, 'format', { tagsAdded: ['内科'] });
    p.formatValues = { f1: { 0: '値' } };
    p.tags = ['既存', '内科'];
    // その後ユーザーが手編集でタグ追加
    p.tags = [...p.tags, '手編集'];

    await u.undo(p);
    expect(p.tags).toEqual(['既存', '手編集']); // delta (内科) だけ除去
    await u.redo(p);
    expect(p.tags).toEqual(['既存', '手編集', '内科']); // delta 再付与
  });

  it('persist 失敗時は live をロールバックし ok:false (fail-closed)。履歴は失われない', async () => {
    const persist = vi.fn<() => Promise<void>>(async () => {
      throw new Error('quota exceeded');
    });
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const u = createPatientUndo({ persist });
    const p = patientWith({ 0: 'before' });
    p.tags = ['既存'];
    u.capture(p, 'format', { tagsAdded: ['内科'] });
    p.formatValues = { f1: { 0: 'after' } };
    p.tags = ['既存', '内科'];

    const res = await u.undo(p);
    expect(res.ok).toBe(false);
    // 画面と durable を一致させる: live は undo 前の状態のまま
    expect(p.formatValues).toEqual({ f1: { 0: 'after' } });
    expect(p.tags).toEqual(['既存', '内科']);
    // 履歴エントリは戻されている → 保存が直れば再 undo できる
    expect(u.canUndo(p)).toBe(true);
    persist.mockImplementation(async () => {});
    const retry = await u.undo(p);
    expect(retry.ok).toBe(true);
    expect(p.formatValues).toEqual({ f1: { 0: 'before' } });
    errSpy.mockRestore();
  });

  it('pid の無い患者では capture は no-op', () => {
    const u = createPatientUndo({ persist: okPersist() });
    const p = patientWith({});
    (p as Record<string, unknown>).pid = '';
    u.capture(p);
    expect(u.canUndo(p)).toBe(false);
  });

  it('onApplied が undo/redo 成功時に呼ばれる (UI 再描画フック)', async () => {
    const onApplied = vi.fn();
    const u = createPatientUndo({ persist: okPersist(), onApplied });
    const p = patientWith({ 0: 'v1' });
    u.capture(p);
    p.formatValues = { f1: { 0: 'v2' } };
    await u.undo(p);
    expect(onApplied).toHaveBeenCalledWith(p, 'undo', 'format');
  });
});
