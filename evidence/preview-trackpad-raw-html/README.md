# Pinch zoom в raw HTML preview

Этот патч дополняет прототип общей preview camera из issue get-bb/bb#4805. Воспроизведение относится к форку на основе BB 0.45.0; текущий upstream main отдельно не проверялся.

Причина: registerFileRoutes регистрирует storageFile раньше registerThreadRoutes. Первый обработчик отдаёт HTML без bridge, второй обработчик с bridge недостижим. У других raw файловых маршрутов контракты также не объявляют optional camera token.

Решение: общий serveRootedFile внедряет bridge для HTML при валидном UUID, сохраняет обычный streaming без токена, ограничивает HTML пятью МиБ и сохраняет sandbox/no-store/nosniff. Контракты принимают токен; дублирующая регистрация удалена. Общая камера поддерживает WebKit gesture для children и подавляет одновременный ctrl-wheel.

Проверки: file-content-routes 14/14 (включая revisionFile), preview-camera 11/11, typecheck четырёх пакетов. Полный server suite: 3321 passed, 1 skipped, 1 queued-command timeout в public-project-clone-sources; повторы этого файла интермиттентны. Два contract-теста падают и на чистом исходном HEAD. Эти проверки не заявляются полностью зелёными.

Изолированный Chromium/CDP с opaque iframe: wheel 2→2.44, pinch 2.44→3.49, focal delta 0 px в центре и четырёх углах, обычный scroll, input, selection, link, pan, Fit и persist. Физический трекпад и настоящий Safari не проверены.

Личная история checkout и пользовательские документы в эту ветку не включены.

> AGENT GENERATED
