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
  'home.empty': '患者がいません',

  // ステータス
  'status.picker.title': 'ステータスを選択',
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
  'patientSheet.formatSet': 'フォーマットセット',
  'patientSheet.formatSet.change': 'フォーマットセットを変更',
  'formatGroup.option.none.label': '(セットなし)',
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
  'format.normal.tooltip.clear': '正常文を解除（未入力に戻す）',
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
    '他の端末から受け取った内容がここに表示されます。必要な部分を患者の記録にコピーしてください。この内容は保存され、「消去する」を押すまで残ります。',
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

  // 共通 (settings/pickers 追加分)
  'common.add': '追加',
  'common.import': '取込',
  'common.export': '保存',
  'common.reset': '初期化',
  'common.name': '名前',

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
  'tag.sheet.title': 'タグを選ぶ',
  'tag.sheet.filterTitle': 'タグで絞り込む',
  'tag.placeholder': 'タグ名',
  'tag.filter.mode.and': 'AND（すべて満たす）',
  'tag.filter.mode.or': 'OR（いずれか満たす）',
  'tag.filter.clear.label': 'タグ選択をクリア',
  'tag.filter.clear.aria': '選択をすべて解除',
  'settings.title.tags': 'タグ',
  'settings.tag.placeholder': 'タグ名',
  'settings.tag.name.duplicate': '同じ名前のタグが既にあります',
  'settings.tag.delete.confirm':
    'タグ「{name}」を削除します。よろしいですか？\n（このタグが付いている患者のタグも一緒に外れます）',
  'settings.tag.delete.aria': 'タグ「{name}」を削除',
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
  'format.title': 'フォーマット',
  'format.new': '新規フォーマット',
  'format.new.aria': '新規フォーマット',
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
  'format.deleteItem.title': 'この項目を削除',
  'format.deleteItem.aria': 'この項目を削除',
  'format.itemDelete.blocked': 'この項目には入力済みデータがあるため削除できません',
  'format.itemDelete.blockedShift':
    'これより後の項目に入力済みデータがあるため削除できません（並び順がずれます）',
  'format.itemReorder.blocked': '入力済みデータがあるフォーマットでは項目の並び替えはできません',
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
  'format.tags.title': 'このフォーマットに付くタグ',
  'format.name.required': 'フォーマット名を入力してください。',
  'format.name.duplicate': '既に同名のフォーマットがあります。別の名前にしてください。',
  'format.delete.confirm': 'フォーマット「{name}」を削除します。よろしいですか？',
  'format.delete.soleExpandBlocked':
    'このフォーマットはどこかのセットで S/O/A/P の最後の入力カードなので削除できません。先に別のフォーマットをそのパネルの入力カードに設定してください。',
  'settings.format.list.empty': '未登録。右上の + から追加してください。',
  'settings.addFormat.title': 'フォーマット追加',
  'settings.addFormat.aria': 'フォーマット追加',

  // 設定: フォーマットセット CRUD
  'formatGroup.section.title': 'セット',
  'formatGroup.add': 'セット追加',
  'formatGroup.empty': '未登録。右上の + から追加してください。',
  'formatGroup.delete.confirm': 'セット「{name}」を削除します。よろしいですか？',
  'formatGroup.delete.defaultBlocked':
    'デフォルトセットは削除できません。先に別のセットをデフォルトにしてください。',
  'formatGroup.defaultBadge': 'デフォルト',
  'formatGroup.mode.expand': '展開',
  'formatGroup.mode.expand.title': '本文上に入力カードを常時展開する',
  'formatGroup.mode.quick': 'クイック',
  'formatGroup.mode.quick.title': 'ヘッダーにチップで出す。タップで入力モーダル',
  'formatGroup.edit.isDefault': 'このセットをデフォルトにする',
  'formatGroup.edit.isDefault.hint': 'デフォルトは患者でセット未選択のときに使われます。',
  'formatGroup.name.required': 'セット名を入力してください。',
  'formatGroup.name.duplicate': '既に同名のセットがあります。別の名前にしてください。',
  'formatGroup.edit.title.new': 'セット 新規作成',
  'formatGroup.edit.title.edit': 'セット 編集',
  'formatGroup.edit.namePlaceholder': '例: 発熱対応',
  'formatGroup.edit.formatsLabel': '含めるフォーマット',
  'formatGroup.edit.noFormats': 'まずフォーマットを 1 つ以上登録してください。',
  'formatGroup.expand.lastBlocked':
    '{panel} の最後の入力カードなので、セットから外せません。先に別のフォーマットを {panel} の入力カードに設定してください。',

  // QR (ST / FMT / FS)
  'qr.kind.settings': '設定QR',
  'qr.kind.format': 'フォーマットQR',
  'qr.kind.set': 'セットQR',
  'settings.qr.show': '設定QR表示',
  'qrFormat.share.title': 'このフォーマットを QR で共有',
  'qrSet.share.title': 'このセットを QR で共有',
  'qrFormat.untitled': '(無題)',
  'qrSet.untitled': '(無題セット)',
  'qrSettings.summary.tags': 'タグ {n} 件',
  'qrSettings.summary.formats': 'フォーマット {n} 件',
  'qrSettings.summary.sets': 'セット {n} 件',
  'qrSettings.summary.clearTargets': 'クリア対象',
  'qrSettings.import.confirm':
    '現在の設定 {summary} を上書きします。\n端末固有設定 (deviceId 等) は維持されます。よろしいですか？',
  'qrSettings.imported.alert': '設定を取り込みました。',
  'qrFormat.import.confirm': 'フォーマット「{name}」を追加します。{summary}\nよろしいですか？',
  'qrFormat.imported.alert': 'フォーマット「{name}」を追加しました',
  'qrFormat.summary.panel': '{panel}',
  'qrFormat.summary.items': '{n} 項目',
  'qrFormat.summary.tags': 'タグ {n} 個',
  'qrFormat.summary.droppedTags': '未登録タグ {n} 個は無視',
  'qrSet.summary.formats': 'フォーマット {n} 個',
  'qrSet.import.confirm': 'セット「{name}」を追加します。{summary}\nよろしいですか？',
  'qrSet.imported.alert': 'セット「{name}」を追加しました',
  'qrReceive.open': 'QR から追加',
  'qrReceive.hint':
    '他の端末で共有された QR（設定全体 / セット / フォーマット）を読み取って追加します。',
  'qrReceive.title': 'QR から追加',
  'qrReceive.overlayHint':
    'カメラで読み取るか、コピーした QR の中身を下に貼り付けて「QR として読む」を押してください。設定全体 / セット / フォーマット を自動で見分けます。複数ページのときは 1 つずつ読み込みます。',
  'qr.recv.router.notAllowed':
    'この入口では 設定 / セット / フォーマット の QR のみ読めます（kind={got}）',
  'qr.recv.save.failed':
    '保存に失敗したため取り込みを中断しました。空き容量を確認してもう一度お試しください。',

  // 設定: データの保存と復元 (アーカイブ / 端末まるごと / ログ)
  'settings.title.workspaces': '病棟管理',
  'settings.io.section': 'データの保存と復元',
  'settings.workspace.hint':
    '病棟の切替・新規作成・名前変更・削除はヘッダーの病棟名をタップ。ここでは JSON 取込/保存ができます。',
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

  // 操作ガイド (docs-bundle は v2 では未移植 — 配信前に人間判断)
  'settings.guide.section': '操作ガイド',
  'settings.guide.pending': '操作ガイドは準備中です。',
} as const;

export type StringKey = keyof typeof STRINGS_JA;

const i18n = createI18n(STRINGS_JA);

/** アプリ全体で使う t()。文言の正本は STRINGS_JA (v1 strings.ja.json 由来)。 */
export const t = i18n.t;
