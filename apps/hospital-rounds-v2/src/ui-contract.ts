// UI contract — テスト (Testing Library / Playwright) が依存してよい data-ui 安定名の名簿。
//
// 規約 (foundation ui/contract.ts):
//   - 第一選択はロール/アクセシブルネーム。data-ui は文言変更で壊れない補助名。
//   - 値は `領域.対象[.動作]`。リテラルを散らさず必ずこの名簿経由で参照する。
//   - settings / pickers の名前は後続エージェントがこの名簿に追記する。

export const UI = {
  nav: {
    home: 'nav.home',
    menu: 'nav.menu',
    user: 'nav.user',
    ws: 'nav.ws',
    menuMemo: 'nav.menu.memo',
    menuShared: 'nav.menu.shared',
    menuSettings: 'nav.menu.settings',
  },
  home: {
    start: 'home.start',
    grid: 'home.grid',
  },
  patient: {
    card: 'patient.card',
    status: 'patient.status',
    statusOption: 'patient.status.option',
    move: 'patient.move',
    editPopup: 'patient.edit.popup',
    name: 'patient.edit.name',
    room: 'patient.edit.room',
  },
  detail: {
    prev: 'detail.prev',
    next: 'detail.next',
    meta: 'detail.meta',
    qrShow: 'detail.qr.show',
    qrDialog: 'detail.qr.dialog',
  },
  undo: {
    btn: 'undo.btn',
    redoBtn: 'redo.btn',
  },
  format: {
    cell: 'format.cell',
    cellInput: 'format.cell.input',
    normalBtn: 'format.normal',
    chip: 'format.chip',
    launcher: 'format.launcher',
    sheet: 'format.sheet',
    sheetApply: 'format.sheet.apply',
    sheetCancel: 'format.sheet.cancel',
    sheetClear: 'format.sheet.clear',
  },
  qr: {
    show: 'qr.show',
    card: 'qr.card',
    canvas: 'qr.canvas',
    pageMeta: 'qr.pageMeta',
    prev: 'qr.prev',
    next: 'qr.next',
    scan: 'qr.scan',
    recvText: 'qr.recv.text',
    recvRead: 'qr.recv.read',
    recvStatus: 'qr.recv.status',
  },
  recv: {
    open: 'recv.open',
    box: 'recv.box',
    area: 'recv.area',
    clear: 'recv.clear',
  },
  list: {
    editToggle: 'list.editToggle',
    row: 'list.row',
    rowBody: 'list.rowBody',
  },
  move: {
    dialog: 'move.dialog',
    rowPrefix: 'move.row',
    newWs: 'move.newWs',
  },
  exit: {
    confirm: 'exit.confirm',
  },
} as const;
