// 移植元: snishi-code-medical/hospital-rounds/src/strings.ja.json (UI コアで使用する分のみ)
//
// foundation createI18n に載せる型安全辞書。キー名は v1 と同一に保つ
// (settings / pickers を実装する後続エージェントが v1 キーをそのまま足せるように)。

import { createI18n } from '@snishi/foundation/i18n/createI18n';

export const STRINGS_JA = {
  'app.title': '回診',

  // パネル名
  'panel.S': 'S',
  'panel.O': 'O',
  'panel.A': 'A',
  'panel.P': 'P',

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
  'header.settings': '設定',
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
  'home.patientQr.title': 'この患者の電子カルテ転記用QRを表示',
  'home.patientQr.aria': '{label} の電子カルテ転記用QRを表示',

  // ステータス
  'tagStatus.none': '白',
  'tagStatus.yellow': '黄',
  'tagStatus.green': '緑',
  'tagStatus.gray': '灰',
  'tagStatus.blue': '青',

  // 患者ヘッダ / 編集
  'patientSheet.title': '患者',
  'patientSheet.editAria': '{label}（タップして患者情報を編集）',
  'patientSheet.status': 'ステータス',
  'patientSheet.room': '部屋番号',
  'patientSheet.name': '氏名',
  'detail.nav.prev': '前の患者',
  'detail.nav.next': '次の患者',
  'detail.edit.bottomAria': '患者情報を編集',

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

  // フォーマット入力
  'format.input.clear': '消去',
  'format.cell.edit.aria': '{label} を入力',
  'format.chip.input.title': '{name} を入力',
  'format.sheet.patientChanged': '患者が変わったため保存しませんでした',
  'format.normal.tooltip.has': '長押しで正常文を入力: {value}',
  'format.normal.tooltip.empty': '正常文が設定されていません',
  'format.normal.tooltip.clear': '長押しで正常文を解除（未入力に戻す）',
  'format.normal.tooltip.edit': '入力済み（長押しで編集）',
  'format.placeholder.memo': '備考',
  'format.note.title': '備考',
  'format.note.aria': '{label} の備考を編集',
  'format.launcher.aria': 'フォーマットを選ぶ',
  'format.launcher.empty': '追加で開けるフォーマットはありません',

  // QR 共通
  'qr.prev.tooltip': '前',
  'qr.next.tooltip': '次',
  'qr.scan.tooltip': 'カメラで QR を読む',
  'qr.scan.head': 'QR スキャン',
  'qr.scan.hint.stream': 'QR を順に読み取ってください',
  'qr.scanner.unsupported': 'このブラウザはカメラ非対応',
  'qr.recv.unknownFormat': 'QR 形式が認識できません',
  'qr.recv.wrongKind': 'これは {label} ではありません（kind={got}）',
  'qr.recv.duplicate': '重複: {got}/{total} 受信済',
  'qr.recv.progress': '{got}/{total} 受信',
  'qr.recv.complete': '全 {total} ページ受信完了',
  'qr.recv.parse.failed': '受信データの解析に失敗しました: {message}',
  'qr.render.failed': 'QR を描画できませんでした',
  'qr.kind.home': 'ホームQR',
  'qr.import.empty.home': '取込内容が空でした。',

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

  // 共通 (settings/pickers 追加分)
  'common.import': '取込',

  // 患者ライフサイクル (削除 / 復元 / 完全削除)
  'patient.add': '患者を追加する',
  'patient.add.aria': '患者を追加する',
  'patient.add.title': '新しい患者を追加して部屋番号・氏名を入力する',
  'patient.delete': '削除',
  'patient.delete.toTrash.confirm':
    'この患者を削除済みに移動します。30日以内なら復元できます。よろしいですか？',
  'patient.delete.permanent.confirm': 'この患者を完全に削除します。元に戻せません。よろしいですか？',
  'patient.delete.emptySlot.confirm': 'この空の患者枠を削除します。よろしいですか？',
  'patient.delete.failed': '削除に失敗しました',
  'patient.delete.permanentBtn': '完全削除',
  'patient.restore': '転棟して復元',
  'patient.restore.failed': '復元に失敗しました',
  'trash.workspace.label': '削除済み',
  'trash.banner': '削除済みの患者は30日後に自動で完全削除されます。ここから転棟すると復元できます。',
  'trash.empty': '削除済みの患者はいません',
  'trash.detail.note': '削除済みの患者です。転棟して復元するか、完全削除できます。',
  'patient.restore.title': '復元先の病棟を選ぶ',

  // タグ (選択 / フィルタ / 管理)
  'patientSheet.tags': 'タグ',
  'tag.add.title': '新規タグ',
  'tag.add.aria': '新規タグ',
  'tag.sheet.filterTitle': 'タグで絞り込む',
  'tag.placeholder': 'タグ名',
  'tag.filter.empty': 'タグが登録されていません',
  'tag.filter.clear.label': 'タグ選択をクリア',
  'tag.filter.clear.aria': '選択をすべて解除',
  'settings.title.tags': 'タグ',
  'settings.tag.placeholder': 'タグ名',
  'settings.tag.name.duplicate': '同じ名前のタグが既にあります',
  'settings.tag.delete.confirm':
    'タグ「{name}」を削除します。よろしいですか？\n（このタグが付いている患者のタグも一緒に外れます）',
  'settings.tag.delete.aria': 'タグ「{name}」を削除',
  'settings.tag.clearOnStart.label': '診察開始で外す',
  'settings.tagGroup.name.empty': '(無名)',

  // 設定: クリア対象
  'clear.section.title': '診察開始でクリアする項目',
  'clear.section.hint':
    'ホームの「診察開始」を押すと、ここで選んだ項目が消えます。患者ごとの記録を残したい項目は外してください。',
  'settings.clear.statusYellow': 'ステータス：黄（保留）',
  'settings.clear.statusGreen': 'ステータス：緑（済）',
  'settings.clear.statusGray': 'ステータス：灰（完了）',
  'settings.clear.statusBlue': 'ステータス：青（追記）',

  // 設定: フォーマット CRUD
  'format.editTitle.new': '{panel} のフォーマット 新規作成',
  'format.editTitle.edit': '{panel} のフォーマット 編集',
  'format.panelSection': '{panel}',
  'format.field.name': '名前',
  'format.field.tags': '付与タグ',
  'format.field.joiner': '区切り',
  'format.field.items': '項目',
  'format.field.showTitle': 'タイトルを出す',
  'format.joiner.newline': '改行',
  'format.joiner.comma': 'コンマ',
  'format.placeholder.name': '例: バイタル',
  'format.placeholder.label': 'ラベル',
  'format.placeholder.unit': '単位',
  'format.placeholder.normal': '正常文',
  'format.addItem': '＋ 項目追加',
  'format.deleteItem.aria': 'この項目を削除',
  'format.itemDelete.blocked':
    'この項目には入力済みデータがあります。削除する場合は項目の × から削除してください',
  'format.itemDelete.withData.confirm':
    '項目「{label}」には入力済みの患者がいます。保存すると、全患者のこの項目の入力値も一緒に削除されます。よろしいですか？',
  'format.itemGuard.unknown':
    '入力済みデータを確認できないため、項目の削除・並び替えはできません',
  'format.remap.failed': '保存に失敗したため、フォーマットの変更を適用しませんでした',
  'format.itemKind.blocked': 'この項目には入力済みデータがあるため種類を変更できません',
  'format.reorderItem.up': '上へ移動',
  'format.reorderItem.down': '下へ移動',
  'format.itemKind.text': 'Aa',
  'format.itemKind.number': '123',
  'format.itemKind.fraction': 'a/b',
  'format.itemKind.title': '様式を選ぶ',
  'format.itemKind.aria': '様式を選ぶ',
  'format.fracMode.numeric': '数字',
  'format.fracMode.text': '文字',
  'format.fracMode.title': '分数の入力方式（数字 / 文字）',
  'format.fracMode.aria': '分数の入力方式を選ぶ（数字 / 文字）',
  'format.name.required': 'フォーマット名を入力してください。',
  'format.name.duplicate': '既に同名のフォーマットがあります。別の名前にしてください。',
  'format.delete.confirm': 'フォーマット「{name}」を削除します。よろしいですか？',
  'format.delete.soleExpandBlocked':
    'このフォーマットはどこかのセットで S/O/A/P の最後の入力カードなので削除できません。先に別のフォーマットをそのパネルの入力カードに設定してください。',
  'settings.format.list.empty': '未登録。右上の + から追加してください。',
  'settings.addFormat.aria': 'フォーマット追加',

  // 設定: カード表示の構成編集 (デフォルトグループのみ。複数セット運用 UI は撤去済み)
  'formatGroup.section.title': 'カード表示',
  'formatGroup.mode.expand': '展開',
  'formatGroup.mode.expand.title': '本文上に入力カードを常時展開する',
  'formatGroup.mode.quick': 'クイック',
  'formatGroup.mode.quick.title': 'ヘッダーにチップで出す。タップで入力モーダル',
  'formatGroup.edit.title.edit': 'カード表示の編集',
  'formatGroup.edit.formatsLabel': '含めるフォーマット',
  'formatGroup.edit.noFormats': 'まずフォーマットを 1 つ以上登録してください。',
  'formatGroup.expand.lastBlocked':
    '{panel} の最後の入力カードなので、セットから外せません。先に別のフォーマットを {panel} の入力カードに設定してください。',

  // QR (ST)
  'qr.kind.settings': '設定QR',
  'settings.qr.show': '設定QR表示',
  'qrSettings.summary.tags': 'タグ {n} 件',
  'qrSettings.summary.formats': 'フォーマット {n} 件',
  'qrSettings.summary.sets': 'セット {n} 件',
  'qrSettings.summary.clearTargets': 'クリア対象',
  'qrSettings.import.confirm':
    '現在の設定 {summary} を上書きします。\n端末固有設定 (deviceId 等) は維持されます。よろしいですか？',
  'qrSettings.imported.alert': '設定を取り込みました。',
  'qrReceive.open': '設定を受け取る',
  'qrReceive.hint':
    '他の端末の設定QR（フォーマット・セット・タグなど）を読み取って取り込みます。',
  'qrReceive.title': '設定を受け取る',
  'qrReceive.overlayHint.st':
    'カメラで設定QRを読み取ります。複数ページのときは 1 つずつ読み込みます。',
  'qr.recv.router.notAllowed':
    'この入口では設定QR（ST）のみ読めます（kind={got}）',
  'qr.recv.save.failed':
    '保存に失敗したため取り込みを中断しました。空き容量を確認してもう一度お試しください。',

  // 設定: データの保存と復元 (アーカイブ / 端末まるごと / ログ)
  'settings.title.workspaces': '病棟管理',
  'settings.io.section': 'データの保存と復元',
  'settings.workspace.hint':
    '病棟の切替・名前変更・削除・追加は上の「病棟管理」でできます。ここでは JSON 取込/保存ができます。',
  'io.json.import.label': 'JSON 取り込み',
  'io.json.export.label': 'JSON 書き出し',
  'settings.device.section': '端末まるごと',
  'settings.device.hint':
    '全ユーザーをまとめてバックアップ/復元します。研究用の端末交換・移行向け。通常の JSON 取込/書出（病棟）は現在のユーザー分のみです。',
  'io.device.import.label': '端末まるごと取込',
  'io.device.export.label': '端末まるごと書出',
  'export.saved': 'JSON を保存しました',
  'export.failed': 'データの出力に失敗しました。',
  'import.parse.failed': 'ファイル形式を認識できません。別のJSONファイルをお試しください。',
  'import.read.failed': 'ファイルの読み込みに失敗しました。正しいJSONファイルか確認してください。',
  'import.archive.confirm':
    'バックアップから {n} 個の病棟と設定を取り込みます。既存の病棟は消えず、取り込み分が追加されます。よろしいですか？',
  'import.archive.done': '{n} 個の病棟を取り込みました',
  'import.device.confirm':
    '端末まるごとバックアップから {n} 人のユーザーを取り込みます。同名ユーザーには合流し、既存データは消えません。よろしいですか？',
  'import.device.done': '{users} 人・{n} 個の病棟を取り込みました',

  // 設定: 巻き戻し (スナップショット復元)
  'settings.restore.section': '巻き戻し',
  'settings.restore.hint':
    '「診察開始」・患者の移動・取り込みの直前と、画面を切り替えた時の状態を自動で控えておきます。各行の「戻す」でその時点に戻せます。患者データを含むため14日で自動的に消えます。',
  'settings.restore.empty': '戻せる控えはまだありません',
  'settings.restore.action': '戻す',
  'settings.restore.confirm': 'この時点の状態に戻しますか？（今の状態も自動で控えるので、やり直せます）',
  'settings.restore.failed': '巻き戻しに失敗しました',
  'settings.restore.count': '患者 {n} 名',
  'settings.restore.reason.clear': '「診察開始」を押す直前',
  'settings.restore.reason.move': '患者を移動する直前',
  'settings.restore.reason.patientDelete': '患者を削除する直前',
  'settings.restore.reason.delete': '病棟を削除する直前',
  'settings.restore.reason.import': '取り込みの直前',
  'settings.restore.reason.nav': '画面を切り替えた時',
  'settings.restore.reason.undo': '巻き戻しの直前',

  // 設定: 研究ログ
  'settings.log.section': '研究ログ',
  'settings.log.hint':
    'アプリの利用状況（起動・切替・操作の時刻など）を無記名で端末内に記録します。患者名は含みません。外部には一切送信されません。',
  'io.log.export.label': 'ログ書出',
  'io.log.clear.label': 'ログ消去',
  'io.log.clear.confirm': '記録済みの利用ログをすべて消去しますか？元に戻せません。',
  'io.log.clear.done': 'ログを消去しました',

  // 設定: ユーザー管理
  'settings.user.section': 'ユーザー',
  'settings.user.hint':
    'ユーザーの切替・新規作成はヘッダーのユーザー名をタップ。ここでは名前変更・削除・切替ができます。ユーザーごとに病棟と設定が分かれます。',
  'io.user.list.empty': '登録されたユーザーはありません',
  'io.user.untitled': '(無名)',
  'io.user.create.placeholder': '例: 田中',
  'io.user.create.action': 'ユーザーを追加',
  'io.user.create.failed': 'ユーザー作成に失敗しました',
  'io.user.switch.failed': 'ユーザー切替に失敗しました',
  'io.user.rename.failed': 'ユーザー名の変更に失敗しました',
  'io.user.delete.confirm':
    'ユーザー「{name}」と、その全データ（病棟・設定）を削除しますか？元に戻せません。',
  'io.user.delete.failed': 'ユーザー削除に失敗しました',
  'io.user.name.duplicate': '同じ名前のユーザーが既にあります',
  'io.snapshot.purge.deferred':
    '巻き戻し履歴の一部を今すぐ消せませんでした（他のタブが開いている可能性があります）。次回の起動時に自動で消去を再試行します。',

  // 設定: 病棟 (一覧・切替・改名・削除・追加をこの場で直接行う)
  'settings.ward.hint':
    '病棟の一覧です。タップで切り替え、鉛筆で名前を変更、ゴミ箱で削除（現在の病棟は削除不可）、下のボタンで追加できます。',
  'settings.ward.current': '現在の病棟',

  // 病棟ピッカー (rename/delete を含む)
  'wsPicker.title': '病棟',
  'io.ws.list.empty': '登録された病棟はありません',
  'io.ws.untitled': '(無題)',
  'io.ws.create.placeholder': '例: 病棟A',
  'io.ws.create.action': '病棟を追加',
  'io.ws.rename.title': '病棟名を編集',
  'io.ws.rename.failed': '病棟名の変更に失敗しました',
  'io.ws.delete.confirm': '病棟「{name}」を削除しますか？',
  'io.ws.delete.failed': '削除に失敗しました',
  'io.ws.create.failed': '病棟作成に失敗しました',

  // 設定: 開発者向けセクション
  'settings.dev.section': '開発者向け',
  'settings.dev.hint': '通常の運用では使いません。',

  // 操作ガイド (docs-bundle は v2 では未移植 — 配信前に人間判断)
  'settings.guide.section': '操作ガイド',
  'settings.guide.pending': '操作ガイドは準備中です。',
} as const;

export type StringKey = keyof typeof STRINGS_JA;

const i18n = createI18n(STRINGS_JA);

/** アプリ全体で使う t()。文言の正本は STRINGS_JA (v1 strings.ja.json 由来)。 */
export const t = i18n.t;
