// 移植元: snishi-code-medical/hospital-rounds/src/strings.ja.json (UI コアで使用する分のみ)
//
// foundation createI18n に載せる型安全辞書。キー名は v1 と同一に保つ
// (settings / pickers を実装する後続エージェントが v1 キーをそのまま足せるように)。

import { createI18n } from '@snishi/foundation/i18n/createI18n';

export const STRINGS_JA = {
  'app.title': '回診',

  // パネル名
  'panel.problem': 'プロブレムリスト',
  'panel.S': 'S',
  'panel.O': 'O',
  'panel.A': 'A',
  'panel.P': 'P',
  'panel.shared': '共有',

  // 共通
  'common.save': '保存',
  'common.cancel': 'キャンセル',
  'common.close': '閉じる',
  'common.delete': '削除',
  'common.edit': '編集',
  'common.normal': '正常',
  'save.failed': '保存に失敗しました。端末の空き容量をご確認ください',

  // ヘッダー / ナビ
  'header.home': 'ホーム',
  'header.memo': 'プロブレムリスト',
  'header.shared': '共有',
  'header.settings': '設定',
  'header.menu': 'メニュー',
  'header.user.tooltip': 'ユーザーを切替',
  'header.ws.tooltip': '病棟を切替',
  'app.exit.confirm.title': 'アプリを終了しますか？',
  'app.exit.confirm.body': '「戻る」でアプリから離れます。よろしいですか？',
  'app.exit.confirm.ok': '終了する',

  // ホーム
  'home.start.btn': '診察開始',
  'home.start.tooltip': '新しい診察を開始（記録をクリア）',
  'home.start.confirm':
    '新しい診察を開始します。前回の記録をクリアしてよろしいですか？\n（クリアする項目は設定画面で選べます）',
  'home.qr.show': 'ホームQR表示',
  'home.countChip': '緑: {n} / {total}',
  'home.empty': '患者がいません',

  // ステータス
  'status.picker.title': 'ステータスを選択',
  'tagStatus.none': '白',
  'tagStatus.yellow': '黄',
  'tagStatus.green': '緑',
  'tagStatus.gray': '灰',
  'tagStatus.blue': '青',
  'patient.status.aria': '{label} のステータスを変更',

  // 患者ヘッダ / 編集
  'patientSheet.title': '患者',
  'patientSheet.editAria': '{label}（タップして患者情報を編集）',
  'patientSheet.status': 'ステータス',
  'patientSheet.room': '部屋番号',
  'patientSheet.name': '氏名',
  'detail.nav.prev': '前の患者',
  'detail.nav.next': '次の患者',

  // 患者管理 (転棟)
  'patient.lifecycle.actions.title': '患者管理',
  'patient.move': '転棟',
  'move.title': '他の病棟へ移動',
  'move.hint': '移動先の病棟を選んでください。元の病棟には「(移)」マークで履歴が残ります。',
  'move.confirm': '「{patient}」を「{dest}」へ移動します。元の病棟には移動済マークで残ります。よろしいですか？',
  'move.list.empty': '他の病棟がありません',
  'move.newWs.row': '＋ 新しい病棟へ移動',
  'move.newWs.prompt': '新しい病棟名を入力してください',
  'move.newWs.default': '新規',
  'move.already.transferred': 'この患者は既に「{dest}」へ移動済みです。同じ患者を複数の病棟に置くことはできません。',
  'move.failed': '移動に失敗しました',
  'move.done': '「{dest}」へ移動しました',
  'move.banner': '{dest} へ転棟済 ({date})',
  'move.namePrefix': '(移)',

  // Undo / Redo
  'undo.aria': '戻す（直前の入力を取り消し）',
  'redo.aria': '進む（取り消した入力をやり直し）',
  'undo.done': '戻しました：{name} の{kind}',
  'redo.done': 'やり直しました：{name} の{kind}',
  'undo.kind.format': '入力',

  // フォーマット入力
  'format.input.clear': '消去',
  'format.cell.edit.aria': '{label} を入力',
  'format.chip.input.title': '{name} を入力',
  'format.sheet.patientChanged': '患者が変わったため保存しませんでした',
  'format.normal.tooltip.has': '正常文 を入力: {value}',
  'format.normal.tooltip.empty': '正常文が設定されていません',
  'format.normal.tooltip.clear': '正常文を解除（空欄に戻す）',
  'format.normal.tooltip.edit': '入力済み（タップで編集）',
  'format.placeholder.memo': '備考',
  'format.launcher.aria': 'フォーマットを選ぶ',
  'format.launcher.empty': '追加で開けるフォーマットはありません',

  // メモ / 共有一覧
  'memo.edit.tooltip': '編集',
  'memo.qr.show': 'プロブレムリストQR表示',
  'memo.row.empty': '（タップして入力）',
  'memo.row.openAria': 'プロブレムリストを編集（患者画面を開く）',
  'shared.edit.tooltip': '編集',
  'shared.qr.show': 'QR表示',
  'shared.row.empty': '（タップして入力）',
  'shared.row.openAria': '共有を編集（患者画面を開く）',

  // 受信ボックス
  'recv.label': '受信ボックス',
  'recv.hint':
    '他の端末から受け取った内容がここに表示されます。必要な部分を患者の欄にコピーしてください。この内容は保存され、「消去する」を押すまで残ります。',
  'recv.open': '受信ボックスを開く',
  'recv.clear': '消去する',
  'recv.clear.confirm': '受信ボックスの内容を消去しますか？元に戻せません。',

  // QR 共通
  'qr.prev.tooltip': '前',
  'qr.next.tooltip': '次',
  'qr.scan.tooltip': 'カメラで QR を読む',
  'qr.scan.head': 'QR スキャン',
  'qr.scan.hint.stream': 'QR を順に読み取ってください',
  'qr.scanner.unsupported': 'このブラウザはカメラ非対応',
  'qr.recv.text.placeholder': 'RND_… で始まる QR の中身',
  'qr.recv.text.read': 'QR として読む',
  'qr.recv.text.empty': 'QR の中身を貼り付けてください',
  'qr.recv.unknownFormat': 'QR 形式が認識できません',
  'qr.recv.wrongKind': 'これは {label} ではありません（kind={got}）',
  'qr.recv.duplicate': '重複: {got}/{total} 受信済',
  'qr.recv.progress': '{got}/{total} 受信',
  'qr.recv.complete': '全 {total} ページ受信完了',
  'qr.recv.parse.failed': '受信データの解析に失敗しました: {message}',
  'qr.render.failed': 'QR を描画できませんでした',
  'qr.kind.home': 'ホームQR',
  'qr.kind.memo': 'プロブレムリストQR',
  'qr.kind.shared': '共有QR',
  'qr.import.empty.home': '取込内容が空でした。',
  'qr.import.empty.shared': '取込対象のエントリがありません。',

  // ホームQR 受信 (新規病棟として取込)
  'home.qrImport.newWs.label': '受信 {ts}',
  'home.qrImport.newWs.confirm':
    '{count} 件の名簿を「{label}」として新規病棟に作成して切り替えますか？\n（現在の病棟には影響しません）',
  'home.qrImport.newWs.done': '「{label}」({count} 件) を作成して切り替えました。',
  'io.ws.switch.failed': '病棟切替に失敗しました',

  // 患者画面 QR (電子カルテ転記用・平文)
  'detail.qr.show': '電子カルテ転記用のQRを表示',
  'detail.qr.dialogAria': '電子カルテ転記用QR',
  'detail.qr.preview.summary': '本文を確認',
  'detail.qr.tooLong': '分割してもQRに入りません（1文字でも不可）',

  // 設定 / ピッカー (スタブ)
  'settings.stub.body': '設定画面は後続実装です。',
  'picker.stub.body': 'ピッカーは後続実装です。',
} as const;

export type StringKey = keyof typeof STRINGS_JA;

const i18n = createI18n(STRINGS_JA);

/** アプリ全体で使う t()。文言の正本は STRINGS_JA (v1 strings.ja.json 由来)。 */
export const t = i18n.t;
