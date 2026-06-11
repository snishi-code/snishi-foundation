// 戻る (popstate) 制御のためのモジュールレベル登録簿。
//
// foundation history/useAppHistory の closeTopOverlay / isEditing / exitEdit に
// 配線するため、開いている一時 overlay と編集モードをここで一元追跡する
// (v1 main.js の closeTransientPopups / cancelInlineFormatEdit / exitAllEdits 相当)。
//
// - overlay: 最前面 (= 最後に開いたもの) を 1 つだけ閉じる。
// - editing: inline 編集 / memo・shared の編集モード。Back 1 回 = 編集解除のみ
//   (view 遷移と同時に未保存ドラフトを黙って消さない — v1 HR 修正#3)。

import { useEffect, useRef } from 'react';

interface OverlayEntry {
  close: () => void;
}

interface EditorEntry {
  exit: () => void;
}

const overlays: OverlayEntry[] = [];
const editors: EditorEntry[] = [];

/** 最前面の一時 overlay を 1 つ閉じる。閉じたら true (useAppHistory の契約)。 */
export function closeTopOverlay(): boolean {
  const top = overlays[overlays.length - 1];
  if (!top) return false;
  top.close();
  return true;
}

export function isEditingActive(): boolean {
  return editors.length > 0;
}

/** 最前面の編集モードを 1 つ解除する (view 遷移はしない)。 */
export function exitTopEditing(): void {
  const top = editors[editors.length - 1];
  if (top) top.exit();
}

/** テスト間の残留防止 (unmount 漏れがあっても次のテストを壊さない)。 */
export function _resetRegistriesForTests(): void {
  overlays.length = 0;
  editors.length = 0;
}

/**
 * 一時 overlay (Modal / Popup) のマウント中だけ登録する。onClose は最新を参照
 * (stale closure 回避)。条件レンダリングしている overlay コンポーネントの先頭で呼ぶ。
 */
export function useRegisterOverlay(onClose: () => void): void {
  const ref = useRef(onClose);
  useEffect(() => {
    ref.current = onClose;
  });
  useEffect(() => {
    const entry: OverlayEntry = { close: () => ref.current() };
    overlays.push(entry);
    return () => {
      const i = overlays.indexOf(entry);
      if (i >= 0) overlays.splice(i, 1);
    };
  }, []);
}

/**
 * overlay 登録だけを行う null コンポーネント。foundation の ConfirmDialog / Menu のように
 * 自前で登録できない overlay の隣に置く (`<OverlayBinding onClose={...} />`)。
 * これで端末の「戻る」が最前面の確認ダイアログ等を 1 つずつ閉じる (v1 popup 規約)。
 */
export function OverlayBinding({ onClose }: { onClose: () => void }): null {
  useRegisterOverlay(onClose);
  return null;
}

/** 編集モード (inline 編集 / 一覧編集) を active の間だけ登録する。 */
export function useRegisterEditing(active: boolean, exit: () => void): void {
  const ref = useRef(exit);
  useEffect(() => {
    ref.current = exit;
  });
  useEffect(() => {
    if (!active) return;
    const entry: EditorEntry = { exit: () => ref.current() };
    editors.push(entry);
    return () => {
      const i = editors.indexOf(entry);
      if (i >= 0) editors.splice(i, 1);
    };
  }, [active]);
}

/**
 * 編集セッションを命令的に登録する (inline 編集のように ref で持つ状態用)。
 * 返り値の unregister をセッション終了時に必ず呼ぶ。
 */
export function registerEditingSession(exit: () => void): () => void {
  const entry: EditorEntry = { exit };
  editors.push(entry);
  return () => {
    const i = editors.indexOf(entry);
    if (i >= 0) editors.splice(i, 1);
  };
}
