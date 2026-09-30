# AI Router MVP

Self-hosted сайт для нескольких пользователей и их аккаунтов OpenAI Codex / Google Antigravity. Центральный сервис хранит пользователей, чаты, маршрутизацию и статусы квот провайдеров. CLI, входы в провайдеров и рабочие файлы живут в контейнерах исполнителей на устройствах пользователей. Angular, Node.js/TypeScript, Socket.IO и Docker Compose.

Проект не использует API-ключи пользователей, внутренние web endpoints или cookies провайдеров. Исполнитель подключается к сайту исходящим соединением; публиковать порт контейнера не нужно.

## Запуск сайта

Нужны Docker и Docker Compose. В корне проекта:

```bash
cp .env.example .env
```

Задайте в `.env` собственные `ADMIN_PASSWORD` (от 12 символов) и `SESSION_SECRET` (от 32 символов). Затем:

```bash
docker compose up --build -d
```

Откройте **http://localhost:8080**. Можно войти как `ADMIN_USER` или зарегистрировать отдельного пользователя. `ALLOW_SIGNUP=false` закрывает регистрацию. Данные сайта хранятся в volume `router_data`, включая веб-сессии. По умолчанию сайт доступен только на localhost.

Для остановки: `docker compose down`. Эта команда сохраняет данные. Логи: `docker compose logs -f backend`.

## Подключение исполнителя на устройстве пользователя

1. Войдите на сайт и откройте **Исполнители**. Укажите имя устройства и нажмите **Получить код**. Код действует 10 минут и используется один раз.
2. Скопируйте каталог `runner/` на устройство с Docker. В этом каталоге выполните `cp .env.example .env`, укажите `ROUTER_SERVER_URL=https://ваш-сайт` и одноразовый `ROUTER_PAIRING_CODE`.
3. Запустите контейнер из каталога `runner/`: `docker compose up -d`. Compose скачает готовый образ с Chromium. После успешной привязки исполнитель сохраняет секрет устройства в локальном Docker volume. Код из `.env` можно удалить. На сайте появится статус **В сети**.
4. На экране **Подключения** добавьте аккаунт Codex или Antigravity и назначьте свой исполнитель. Количество аккаунтов и исполнителей в интерфейсе не ограничено фиксированным числом. Каждому аккаунту выделяется отдельный каталог HOME внутри volume исполнителя.

При работе через интернет нужен HTTPS. `ROUTER_ALLOW_INSECURE=true` допустим только в локальной тестовой сети. Для публичного сайта разместите TLS reverse proxy перед frontend и задайте `COOKIE_SECURE=true` на сервере.

### Проверка на одном компьютере

Можно подключить демонстрационный исполнитель в том же Compose проекте. Получите код на сайте, запишите его в корневой `.env` как `ROUTER_PAIRING_CODE`, затем:

```bash
docker compose --profile local-runner up --build -d
```

Исполнитель в этом режиме использует `http://frontend` внутри сети Compose. Оба контейнера имеют **разные** volume. `MOCK_MODE=true` даёт демонстрационный ответ, если CLI в образе исполнителя не установлен. Этот режим позволяет проверить полный путь сайт → исполнитель → поток ответа без входа в провайдеров.

### Вход в провайдеров

Сборка образа runner устанавливает Codex CLI версии 0.159.0. Для собственной сборки задайте `INSTALL_CODEX_CLI=true` в `.env` **исполнителя** и выполните `docker compose -f compose.yaml -f compose.build.yaml up -d --build` из каталога `runner/`. Затем скопируйте команду входа с карточки аккаунта и выполните её на устройстве исполнителя:

```bash
docker compose exec runner /app/scripts/provider-login.sh codex <account-id>
```

Скрипт запускает официальный `codex login --device-auth` с отдельным `CODEX_HOME`. Для каждого аккаунта повторите вход с его ID. Для Antigravity задайте `INSTALL_AGY_CLI=true` в `runner/.env`, соберите образ той же командой с `compose.build.yaml` и выполните `/app/scripts/provider-login.sh antigravity <account-id>`. Команда запускает официальный `agy` с отдельным `HOME`. В headless Linux окружении Antigravity может потребовать работающий D-Bus и системный keyring для сохранения входа; это отдельное требование CLI, которое нужно проверить на вашем хосте. Проверка авторизации происходит при запуске задачи.

### Управление runner через сайт

Для каждого runner можно включить **отдельный сервис управления**. Его пароль находится только в `runner/.env` на устройстве владельца; backend не сохраняет пароль. В браузере пароль используется для одноразового подтверждения каждой команды. Сервис управления подключается к сайту исходящим WebSocket-соединением, как и runner.

1. На вкладке **Исполнители** нажмите **Настройки** → **Получить код управления**. Код действует 10 минут.
2. В `runner/.env` задайте `RUNNER_MANAGER_PAIRING_CODE=<код>` и уникальный `RUNNER_MANAGER_PASSWORD=<пароль от 16 символов>`. Убедитесь, что `ROUTER_SERVER_URL` указывает на ваш сайт. Для собственного образа с Codex или Antigravity задайте `INSTALL_CODEX_CLI=true` или `INSTALL_AGY_CLI=true` и используйте `compose.build.yaml`.
3. В каталоге с проектом выполните `docker compose -f runner/compose.yaml --profile management up -d`. Для собственной сборки добавьте `-f runner/compose.build.yaml` перед `--profile` и `--build` после `up`. Если runner развёрнут через Portainer, задайте в переменных **существующего** Git-стека `COMPOSE_PROFILES=management`, пароль и код управления, затем обновите этот стек. Не создавайте второй runner с новым volume.
4. Обновите вкладку **Исполнители**. Откройте шестерню и введите пароль управления.

Сервис управления хранит собственный секрет подключения и закрытые SSH-ключи в отдельном `manager_data` volume. Он не передаёт закрытые ключи runner: для GitHub runner использует SSH-agent через отдельный Unix socket. Публичный ключ скопируйте из панели в GitHub → Settings → SSH and GPG keys, затем используйте SSH-адрес репозитория. В разделе «MCP-серверы и браузер» можно добавить свой HTTPS или локальный MCP-сервер для аккаунта Codex или Antigravity. Кнопка «Подключить браузер» добавляет Playwright MCP с headless Chromium внутри runner; браузерный профиль изолирован от сессии ChatGPT. Новые настройки Codex подхватываются перед следующей задачей. Для этого нужен обновлённый образ runner. Сервис также позволяет запускать вход Codex по device code в браузере. Вход Google Antigravity по-прежнему выполняется через интерактивный терминал runner, поскольку официальный CLI использует TTY и системный keyring.

В панели Docker доступны просмотр, запуск, остановка, перезапуск и удаление остановленных контейнеров. Можно пересоздать контейнер с другим образом, переменными окружения и томами; прежний контейнер остаётся остановленной резервной копией. Менеджер старается откатить изменения, если новый контейнер не запустился. Контейнеры Compose и Portainer могут вернуться к настройкам стека при следующем деплое. **Доступ к Docker socket даёт полномочия администратора Docker-хоста**; он смонтирован только в отдельный сервис управления, а не в контейнер выполнения LLM. Включайте профиль `management` только на своём доверенном хосте.

### Импорт сохранённых профилей Codex

Поддерживается JSON-архив `codex-profiles-archive` версии 1 (`.codexprofile.json`, поле `authJSONString`). Импорт выполняется **на устройстве с контейнером исполнителя**, после его привязки к сайту. Готовый образ содержит Codex CLI; при собственной сборке задайте `INSTALL_CODEX_CLI=true` и используйте `compose.build.yaml`. Затем из корня проекта выполните:

```bash
./runner/import-profiles.sh ~/Desktop/*.codexprofile.json
```

Можно перечислить пути к файлам вручную. Каждый профиль получает отдельный аккаунт на сайте и отдельный `CODEX_HOME` в постоянном volume исполнителя. Сайт получает только название и хэш идентификатора профиля для защиты от дублей; `authJSONString` и токены не покидают устройство. Повторный импорт сохраняет уже существующий `auth.json`, чтобы не заменить обновлённые CLI токены старой копией. Чтобы заменить сессию, запустите `docker compose -f runner/compose.yaml exec -T runner node /app/dist/import-profiles.js --replace < файл.codexprofile.json`.

По [документации OpenAI](https://learn.chatgpt.com/docs/auth) Codex CLI автоматически обновляет токены ChatGPT при работе и хранит их в `CODEX_HOME/auth.json` при файловом хранении. Если сессия отозвана или обновление перестало работать, войдите снова через `codex login --device-auth`. Относитесь к файлам `.codexprofile.json` как к паролям: не загружайте их на сайт и не добавляйте в Git.

В карточке сайта команда дана для запуска из **корня репозитория**: `docker compose -f runner/compose.yaml exec runner ...`. Если на устройстве находится только каталог `runner/`, используйте короткую команду выше.

## Работа маршрутизатора

- `Auto` начинает со следующего аккаунта по кругу. Если исполнитель отключён, аккаунт временно ограничен самим провайдером, требуется вход или CLI вернул ошибку до первого текста или действия, сервис пробует следующий аккаунт.
- Для подтверждённого `rate_limit` в проекте выполняется продолжение на следующем аккаунте в той же папке. Для обычной ошибки после текста или вызова инструмента автоматического повтора нет: повтор мог бы продублировать часть выполненной задачи.
- Каждый запрос запускает отдельный процесс CLI; по завершении, отмене, тайм-ауту или потере связи процесс останавливается. Сам исполнитель остаётся включённым и переподключается к сайту. Для чата тайм-аут по умолчанию 180 секунд (`CLI_TIMEOUT_SECONDS`), для задачи — 3600 секунд (`CLI_TASK_TIMEOUT_SECONDS`). Сайт и runner должны использовать одинаковые значения. Незавершённые изменения файлов и checkpoint сохраняются на runner.
- Лимит запросов локально не имитируется: источником квоты является аккаунт провайдера. Codex CLI передаёт окна 5 часов и недели; для Google Antigravity runner раз в минуту вызывает официальный `agy -p /usage` в каталоге выбранного аккаунта и считывает окна Gemini. Если CLI не вернул квоту, интерфейс показывает, что она недоступна. После ответа провайдера о превышении квоты ставится только короткий cooldown для Auto.
- `default` выбирает модель, настроенную в CLI. Для Codex список моделей и доступные reasoning effort запрашиваются у официального `codex app-server` для конкретного входа, поэтому в интерфейсе показываются только совместимые варианты выбранного аккаунта. В `Auto` маршрутизатор выбирает аккаунт, который поддерживает и выбранную модель, и reasoning. Если CLI не отвечает, остаётся безопасный список из конфигурации сайта.
- Чат запускает Codex в `read-only`, Antigravity в `plan`. Режим задачи использует `danger-full-access` для Codex и `accept-edits --dangerously-skip-permissions` для Antigravity: headless CLI не умеет запрашивать разрешения во время работы. В режиме задачи Antigravity автоматически подтверждает все инструменты внутри контейнера runner, поэтому запускайте только доверенные задачи и не размещайте в этом контейнере чужие учётные данные. В режиме чата автоматического подтверждения нет. CLI-процессы не наследуют `NODE_ENV=production` от runner, чтобы `npm ci` устанавливал инструменты сборки из `devDependencies`.

### Проекты, папки и общий runner

После ответа рядом с именем провайдера и временем отображается расход токенов за запрос, например `Codex 21:58 200K tokens`. Счётчик включает вход и выход всех шагов запроса, сохраняется в истории и суммирует расход при передаче между аккаунтами. Наведение показывает точное число и доступную разбивку. Если провайдер не передал статистику или ответ создан до обновления, отображается `— tokens`.

Проект создаётся в боковой панели. У проекта есть выбранный runner, а чаты отображаются вложенными под ним как папка. Все аккаунты, назначенные этому runner, получают один и тот же рабочий каталог проекта внутри его volume: изменения файлов, сделанные первым аккаунтом, доступны следующему аккаунту. В рамках проекта `Auto` перебирает только аккаунты этого runner.

История сообщений, список проектов и маршрутизация хранятся в центральном backend volume. Рабочие файлы и локальные сессии CLI остаются на runner. Поэтому история видна в web app, а файлы доступны всем аккаунтам конкретного runner без передачи токенов на сайт.

Если провайдер возвращает исчерпанную квоту во время задачи, runner передаёт это как `rate_limit`. В режиме `Auto` маршрутизатор сохраняет checkpoint в `.ai-router/tasks/<task-id>/checkpoint.json` и короткую инструкцию в `HANDOFF.md`, показывает уведомление и запускает продолжение на следующем аккаунте того же runner в том же каталоге проекта. Если уже были изменены файлы, следующий аккаунт сначала читает checkpoint и проверяет текущее состояние каталога. Для явно выбранного аккаунта автоматическая передача не выполняется. Codex runner по умолчанию держит тёплый App Server на аккаунт и переиспользует thread, поэтому продолжение не требует полного холодного запуска.

В чате проекта доступна кнопка **Прикрепить файл**. Файл до 20 МБ передаётся через backend в runner и сохраняется в корне общей папки проекта. Токены и содержимое файла не сохраняются в backend volume; все аккаунты этого runner видят файл локально.

Результаты работы ИИ доступны через кнопку **Файлы** в задаче в виде дерева каталогов с возможностью сворачивания папок, поиском и индикацией размеров. Кнопка **Скачать** сразу создаёт ссылку со случайным 48-символьным секретом и начинает загрузку; кнопка **Ссылка** копирует такой адрес для передачи другому человеку. Ссылка действует 7 дней, открывается без входа и требует, чтобы исполнитель был в сети. Файлы до 100 МБ передаются через backend порциями; скрытые файлы, служебные папки и символические ссылки не выдаются. Если файл изменится после создания ссылки, создайте новую.

Для файлового обмена обновите каждый ранее подключённый runner: в каталоге `ai-router` выполните `git pull`, затем в `runner/` — `docker compose up --build -d`.

В обычном Docker-контейнере вложенная песочница Codex может не разрешить запись файлов. Поэтому режим «Задача» по умолчанию использует `CODEX_TASK_SANDBOX=danger-full-access` **внутри runner-контейнера**; режим «Чат» остаётся без записи. Codex в задаче может менять любые файлы, доступные runner, включая локальные профили аккаунтов, поэтому запускайте runner только на доверенном устройстве, не монтируйте Docker socket и системные каталоги хоста. Если на хосте работает вложенная песочница Codex, укажите `CODEX_TASK_SANDBOX=workspace-write`.

Чаты и бизнес-логика хранятся на сайте. Учётные данные CLI и файлы работы остаются в volume исполнителя. Сайт получает текст запроса, события выполнения и ответ. Исполнитель получает текст текущей задачи и короткую историю беседы для контекста.

## Превью сайтов на runner

Собранный сайт можно открыть по временному адресу без загрузки файлов на сервер AI Router. В контейнере runner выполните:

```bash
deploy-preview /runner-data/projects/PROJECT_ID/dist [поддомен]
```

Команда выведет `https://<имя>.preview.s1m4.com`. Без имени создаётся свободный адрес `site-xxxxxxxx.preview.s1m4.com`. Для работающего dev-сервера, который слушает порт **внутри того же контейнера runner**:

```bash
deploy-preview --port 5173 [поддомен]
```

Трафик HTTP и WebSocket проходит через исходящее соединение runner с сервером. Статические файлы остаются в проекте или рабочем каталоге runner. Публикация действует 7 дней; повторный запуск продлевает срок. Вкладка **Сайты** на `ai.s1m4.com` показывает превью всех ваших runner и позволяет скрыть сайт (публичный адрес вернёт 404) или открыть снова. Остановка публикации: `deploy-preview --stop <поддомен>`.

Для статического сайта нужен `index.html` в выбранной папке. Допускаются только папки внутри `/runner-data/projects` и `/runner-data/workspaces`; скрытые файлы и ссылки за пределы папки не выдаются. Dev-сервер должен слушать `127.0.0.1` внутри контейнера runner, а не на хосте Docker.

### Wildcard HTTPS в Nginx Proxy Manager

Для `*.preview.s1m4.com` нужен отдельный wildcard SAN: сертификат только для `*.s1m4.com` не покрывает вложенный поддомен. На OVH сертификат выпущен через acme.sh и DNS API Name.com с обоими wildcard SAN. Стабильные файлы находятся в `/etc/ai-router/ssl/fullchain.pem` и `/etc/ai-router/ssl/privkey.pem`; acme.sh обновляет их по root cron. Скрипт `ops/sync-npm-wildcard.sh` после продления копирует обновлённый сертификат в уже импортированный Custom SSL NPM и перезагружает Nginx.

Первый импорт выполняется в NPM вручную: **Certificates → Add SSL Certificate → Custom**, имя `s1m4.com wildcard`, сертификат из `fullchain.pem`, ключ из `privkey.pem`. Чтобы перенести файлы на свой компьютер без вывода ключа в чат:

```bash
umask 077
ssh ovhserver 'sudo cat /etc/ai-router/ssl/fullchain.pem' > /tmp/s1m4-fullchain.pem
ssh ovhserver 'sudo cat /etc/ai-router/ssl/privkey.pem' > /tmp/s1m4-privkey.pem
```

В Name.com должна быть A-запись `*.preview` → `57.129.125.71`. На текущем OVH существующий Proxy Host `*.s1m4.com` уже передаёт запросы вложенного домена в `ai-router-web:80`, а обновлённый Custom SSL покрывает оба wildcard SAN, поэтому ещё один Proxy Host не требуется. При настройке NPM с нуля используйте `*.preview.s1m4.com` → `http://ai-router-web:80`, `Websockets Support=ON`, `Block Common Exploits=ON`, `Force SSL=ON`, `HTTP/2 Support=ON`. Отдельный Proxy Host `ai.s1m4.com` обслуживает сам AI Router. После импорта на сервере выполните `sudo /usr/local/sbin/sync-ai-router-wildcard`; этим проверяется, что автообновление видит импортированный сертификат. Удалите временные копии закрытого ключа на своём компьютере после импорта.

## Доступ и границы MVP

У каждого пользователя свои аккаунты, исполнители, чаты и веб-сессия. Привязка исполнителя одноразовая; его секрет хранится локально и на сайте сохраняется только хэш. Пользователь может отозвать доступ исполнителя на сайте. Задания приходят только по исходящему Socket.IO соединению с центральным сервисом; при разрыве соединения активные задания останавливаются. Локального API запуска заданий у контейнера нет.

Это не DRM: владелец своего устройства может использовать установленный CLI отдельно или изменить открытый код контейнера. Требование «исполнитель не работает без сайта» относится к заданиям **этого маршрутизатора**. Изоляция разных пользователей реализована на уровне приложения и отдельных контейнеров пользователей; аккаунты одного пользователя имеют разные HOME, но работают под одним системным пользователем его контейнера. Центральный сервис MVP рассчитан на один экземпляр backend и JSON-файлы в volume. Для большой публичной установки понадобятся база данных, очередь заданий и дополнительная защита инфраструктуры.

Браузерный API работает через HttpOnly cookie. Socket.IO передаёт нормализованные `ai:event`: `started`, `status`, `delta`, `tool`, `fallback`, `checkpoint`, `handoff_started`, `usage`, `completed`, `error`. История доступна через `/api/sessions`, подключения — через `/api/accounts`, исполнители — через `/api/runners`.

## Разработка

В `backend/`, `frontend/` и `runner/` выполните `npm ci` и `npm run build` для проверки сборки. Полный путь проще проверить через Compose. CLI запускается **внутри исполнителя**, поэтому установка на хосте или в backend не делает его доступным контейнеру.

CLI-адаптеры используют официальные потоки [Codex CLI](https://developers.openai.com/codex/cli/reference), [Codex authentication](https://developers.openai.com/codex/auth) и [Antigravity headless mode](https://antigravity.google/docs/cli/headless/).

## Публикация на OVH

Публичный репозиторий: [so-s1m4/ai-router](https://github.com/so-s1m4/ai-router). Производственный стек описан в `compose.prod.yaml` и управляется Portainer как Git-стек. Он слушает `127.0.0.1:18088` на сервере и доступен Nginx Proxy Manager через общую Docker-сеть `proxy` по имени `ai-router-web:80`. HTTPS для `ai.s1m4.com` завершается в reverse proxy.

GitHub Actions проверяет сборку backend, frontend и runner, публикует все три образа в GHCR с тегами `latest` и SHA коммита, затем вызывает GitOps webhook Portainer для сайта. Runner Git-стек из `runner/compose.yaml` использует готовый образ `ai-router-runner:latest` с Chromium и Codex CLI; `pull_policy: always` скачивает актуальный образ при обновлении стека. В стеке сайта включите **Re-pull image**. Для автоматического обновления runner задайте его GitOps webhook в секрете GitHub Actions `PORTAINER_RUNNER_WEBHOOK_URL`; при включённом GitOps polling стек также сможет обновляться по расписанию. Для приватных образов Portainer должен иметь доступ к registry `ghcr.io` с правом `read:packages`.

Для включения деплоя нужны переменная репозитория `DEPLOY_ENABLED=true` и секрет `PORTAINER_WEBHOOK_URL`; для немедленного обновления runner добавьте `PORTAINER_RUNNER_WEBHOOK_URL`. В Portainer стек сайта должен быть создан из этого Git-репозитория с compose path `compose.prod.yaml`, стек runner — с `runner/compose.yaml`. Пароли приложения задаются только в переменных окружения стека Portainer. SSH-ключ для GitHub Actions не нужен.

MCP и браузер в панели управления настраиваются глобально для всех аккаунтов Codex и Antigravity данного runner, включая новые. Каталог хранится в `RUNNER_DATA_DIR/global-mcp` и применяется перед запуском задач; ChatGPT Web не поддерживается. Прежние локальные MCP остаются локальными: добавьте нужные серверы в общий каталог. Глобальная запись с тем же именем заменяет локальную; удаление такой записи удаляет её из конфигураций аккаунтов при следующем запуске. Для этой функции обновите runner и сервис управления.

## Файлы, уточнения и уведомления

Раздел **Все файлы** объединяет рабочие папки проектов и самостоятельных диалогов. Файлы проекта показываются один раз. Можно искать по имени, фильтровать источник, открывать, скачивать, делиться ссылкой и удалять файл. Недоступный runner отображается как ошибка своей папки и не мешает другим папкам. Проектные чаты отображаются только внутри проекта, самостоятельные — в недавних диалогах.

Исходники и служебные файлы, отслеживаемые Git, а также каталоги `backend`, `frontend`, `runner`, `src`, `test`, `tests`, `scripts`, `dist`, `build`, `coverage` скрыты из файловых списков. Они также недоступны для просмотра, скачивания и удаления через файловый API. Загрузки и новые результаты остаются доступны; результаты, включая код, сохраняйте в `outputs/`, `output/`, `artifacts/` или `results/`. В этих каталогах доступны и файлы, добавленные в Git. Скрытые файлы и символические ссылки по-прежнему запрещены. Для применения фильтра обновите backend и runner. Backend также скрывает известные каталоги исходников и служебные файлы при подключении старого runner; фильтрация произвольных файлов, отслеживаемых Git, выполняется обновлённым runner.

В файловой панели чата и общем каталоге **Открыть** показывает изображения, PDF и исходный код в диалоге просмотра. Просмотр требует входа и проверки владельца; публичная ссылка не создаётся. Текст ограничен 1 МБ, изображения и PDF — 10 МБ. HTML и SVG показываются как текст. Остальные форматы можно скачать.

Пока Codex работает через App Server, в поле ввода можно написать уточнение и нажать **Уточнить текущую задачу** или Enter на компьютере. Используется официальный [turn/steer](https://developers.openai.com/codex/app-server): сообщение добавляется в активный turn без остановки. Кнопка становится доступной после подтверждения готовности runner; при завершении или передаче задачи она отключается. Уточнение сохраняется в истории после принятия и включается в checkpoint. Для Antigravity, ChatGPT Web и Codex exec steering пока недоступен. Обновите runner вместе с backend и frontend.

При чтении истории поток ответа сохраняет позицию прокрутки. Кнопка **К последнему сообщению** возвращает к текущему ответу и возобновляет автоматическую прокрутку.

В разделе **Уведомления** можно включить браузерные уведомления на текущую сессию и подключить Telegram. Создайте отдельного бота через BotFather, задайте в backend **TELEGRAM_BOT_TOKEN** и **PUBLIC_URL** (например https://ai.s1m4.com), затем перезапустите backend. Для этого бота не должен быть настроен webhook или другой getUpdates-процесс: backend использует long polling. Токен хранится только в переменной окружения сервера. Настройки Compose уже принимают эти переменные.

Пользователь нажимает **Подключить Telegram**, открывает одноразовую ссылку (10 минут), нажимает Start и проверяет подключение. Привязка принимается только из личного чата с ботом, сохраняется между перезапусками и может быть отключена. После успешного завершения задачи бот отправляет название чата и ссылку; текст ответа не передаётся. Ошибка доставки не меняет результат задачи и видна в настройках. Используются официальный [Telegram Bot API](https://core.telegram.org/bots/api) и [deep links](https://core.telegram.org/bots/features#deep-linking).

## Доступ для друзей

В **Подключениях → Поделиться доступом → Выдать доступ** укажите логин зарегистрированного друга, общий бюджет токенов и разрешённые модели. Доступ распространяется на все ваши подключения, включая добавленные позже; подходящее подключение выбирается автоматически. Приглашение появится у друга в том же разделе; после принятия модели доступны в его чатах, включая Auto. Бюджет общий для всех подключений и провайдеров. Существующие приглашения также используют общий пул, сохраняя лимит, расход и разрешённые модели.

Разовый бюджет не обновляется, месячный обновляется 1-го числа по UTC. Изменение бюджета не обнуляет расход. В карточке видны расход по моделям за текущий период и общий расход за всё время. Одновременно на одном выданном доступе выполняется одна задача. Повторные отчёты провайдера не списываются дважды; расход учитывается и при ошибке или отмене задачи. Последний запрос может превысить остаток. Если провайдер не сообщает токены, приложение не может их списать.

Друг не получает управление подключением, ключами или runner. Его история и рабочие папки задач отдельные; файловый API разрешает доступ только к его сессиям. Задачи выполняются на runner владельца с существующими правами CLI, поэтому выдавайте доступ доверенным друзьям, как и доступ к самому runner. **Отозвать доступ** запрещает новые запросы и останавливает текущую задачу. Бюджет, приглашения и статистика сохраняются в `DATA_DIR/access-grants.json`. Обновите backend и frontend; протокол runner не меняется.

## Shared projects across runners

When creating a project, enable **Shared project** and optionally enter registered usernames separated by commas. A shared project is also useful for one user with several runners. Members see it in **Projects**, share its workspace, and run tasks through their own connections or existing accepted AI access grants. Project membership does not share provider credentials, account management, or token budgets. Chats remain personal. The owner can add or remove members with **Members**; access checks apply to file operations and new tasks immediately after removal.

Shared projects select from all connections available to the requesting user. Before switching runners, the backend transfers a compressed snapshot of the current workspace in verified chunks. Sources, Git data, uploaded files and results are included; removed files also disappear on the destination. After every task, including failed tasks, and after file uploads/deletions, the latest snapshot is saved in `DATA_DIR/project-snapshots`. One task or file mutation at a time is allowed for a shared project. Existing private projects keep their single-runner behavior.

Sync supports up to **64 MB of file contents and 20,000 files**. Symbolic links are rejected. `.env` and `.env.*`, `node_modules`, `.ai-router`, `.codex`, `.ssh`, `.aws`, `.config`, `.cache`, `.next` and `.angular` are excluded at any depth. Dependencies and local environment configuration must be installed separately on each runner; existing local files in those excluded paths are preserved when importing a snapshot. Empty directories are recreated as needed. The previous destination workspace is kept beside the active directory as `<project-id>-previous` for recovery; it is replaced on the next import.

If the most recent runner is offline, work can continue from its last successfully saved snapshot. If there are unsaved changes, switching runners is blocked until that runner reconnects and synchronization succeeds. Previews and running development servers stay on the runner where they were started; synchronization transfers files, not running processes. Shared project metadata persists in `DATA_DIR/shared-projects.json`. Update **backend, frontend and every participating runner** together to enable project synchronization.

### Task queue and usage overview

The **Tasks and usage** section shows waiting and running tasks, their priority, elapsed time and recent activity. Every chat request enters a durable queue. Use **Add to queue** while a task runs to schedule another request; the arrow continues to send a clarification. Waiting tasks can be canceled or assigned High, Normal or Low priority. Tasks sharing a runner execute sequentially, and shared projects also respect the existing synchronization lock. Offline runners and provider cooldowns keep tasks waiting. Permissions, model availability and budgets are checked again before execution.

Queue state is stored in `DATA_DIR/task-queue.json`. After a backend restart, waiting tasks remain queued; previously running tasks are marked interrupted for review so commands are not automatically repeated. The usage overview groups provider-reported tokens by project and model, including reported consumption from unsuccessful attempts and account handoffs. Snapshots are recorded in `DATA_DIR/usage-ledger.json`; older successful requests are included from chat history. Requests without usage reports are excluded, and older model information is shown as unknown. Provider quotas and reset times remain live runner reports, while shared budgets use the existing persistent access-grant accounting.
