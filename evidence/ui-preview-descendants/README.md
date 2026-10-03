# Изолированные исходники двух UI-прототипов

`zoom.patch` содержит локальную preview camera, HTML bridge, tab persistence и native desktop menu router с тестами. `indicator.patch` содержит отдельный счётчик работающих потомков и меню перехода с тестами.

Патчи показывают точную разницу ограниченного списка source-путей относительно task base. Они предназначены для review; это не обещание чистого применения на актуальном upstream main. В публичную evidence ветку не переносится приватная история source checkout, локальный канон, QA-стенды, пользовательские снимки и идентификаторы.

Изолированная проверка выполнена на macOS 26.6.1, BB source 0.44.0, Electron 44.3.0. Targeted native tests: desktop 3 и app 9; typecheck 6/6; конечный Turbo build desktop/app 52/52. Thread-list: 456 tests. Production renderer проверен в headless Chromium на 260/390 с настоящими title/icon/status; SDK context и navigation — fixtures. Native Cmd+/−/0 доказаны программной Cocoa dispatch до focused production camera, не физической клавиатурой. Installed desktop shell этим не проверен.

`selection.json` фиксирует пути, размеры и SHA256. Source SHA в нём относится к локальному принятым срезу; публичные permalinks адресуются только этой evidence ветке.
