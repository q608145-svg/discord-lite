# Деплой discord-lite: Render + LiveKit Cloud

Пошаговая инструкция, как поднять сервер в интернете бесплатно и подключить голос.
После этого шага у тебя будет постоянный адрес вида `https://discord-lite-xxxx.onrender.com`,
который на следующем шаге мы зашьём в Electron.

---

## Что где будет жить

| Часть | Где | Почему так |
|---|---|---|
| Веб-интерфейс, REST API, Socket.IO | **Render**, Web Service, план Free | нужен постоянный процесс и WebSocket |
| База данных (аккаунты, каналы, сообщения) | **Neon**, Postgres Free | Render Postgres Free умирает через 30 дней, Neon — нет |
| Голос и видео | **LiveKit Cloud**, план Build (free) | SFU, 5 000 минут WebRTC в месяц |

### Почему не Vercel

Vercel выполняет функции по запросу и **не держит постоянные WebSocket-соединения**
([документация Vercel](https://vercel.com/kb/guide/do-vercel-serverless-functions-support-websocket-connections)).
Наш чат живёт на Socket.IO, а он требует одного долгоживущего процесса — на Vercel он
просто не заработает без переписывания на сторонний realtime-сервис.

### Что важно знать про бесплатные тарифы

- Render Free: 0.1 CPU / 512 МБ, **засыпает через 15 минут** без трафика. Первый запрос
  после сна поднимает сервис за ~1 минуту. 750 часов инстанса в месяц.
- Neon Free: 0.5 ГБ, вычислительный узел засыпает после простоя (первый запрос ~0.5 с).
- LiveKit Build: 5 000 минут WebRTC в месяц, 100 одновременных подключений, 50 ГБ трафика.
  Минуты считаются по участникам: трое друзей по часу = 3 часа квоты.

---

## Шаг 0. Что понадобится

- Аккаунт GitHub (репозиторий с кодом).
- Аккаунт Render (вход через GitHub).
- Аккаунт Neon.
- Аккаунт LiveKit Cloud.
- Git на компьютере. Если нет:

```powershell
winget install --id Git.Git -e
```

---

## Шаг 1. Выложить код на GitHub

В папке проекта:

```powershell
cd "C:\Users\q6081\OneDrive\Документы\deepseek-harness\default-workspace\discord-lite"

git init
git add .
git status          # проверь, что нет .env, node_modules, tools, dist-desktop
git commit -m "discord-lite: web + voice + desktop client"
git branch -M main
```

Создай пустой репозиторий на GitHub (`discord-lite`, **без** README и .gitignore) и выполни:

```powershell
git remote add origin https://github.com/ТВОЙ_ЛОГИН/discord-lite.git
git push -u origin main
```

> `.gitignore` уже исключает `node_modules`, `.next`, `.env`, `tools/`, `dist-desktop/`,
> `.eb-cache/` и `data/`. Секреты в репозиторий не попадут.

Если Git ставить не хочется — используй GitHub Desktop: «Add local repository» →
«Publish repository» (сними галочку «Keep this code private», если нужен публичный).

---

## Шаг 2. База данных в Neon

1. Зайди на https://neon.tech и создай проект.
   - Name: `discord-lite`
   - Region: **AWS eu-central-1 (Frankfurt)** — ближе к Render во Франкфурте.
   - Postgres: 17.
2. На странице проекта нажми **Connect** и скопируй строку подключения.
   Бери **direct**-хост (без `-pooler`), вид:

   ```
   postgresql://neondb_owner:ПАРОЛЬ@ep-xxx.eu-central-1.aws.neon.tech/neondb?sslmode=require
   ```

3. Сохрани её — это будущий `DATABASE_URL`. Параметр `sslmode=require` обязателен.

Таблицы создавать вручную не нужно: команда `prisma db push` выполнится при сборке на Render.

---

## Шаг 3. LiveKit Cloud (голос)

1. https://cloud.livekit.io → **Create project**.
   - Name: `discord-lite`
   - Region: **Europe (Frankfurt)** — минимальная задержка для России и Европы.
2. В проекте открой **Settings → Keys → Create key**. Скопируй и сохрани:
   - **API Key** (короткий, вида `APIxxxxxxxx`)
   - **API Secret** (длинный)
3. Там же на странице проекта есть **WebSocket URL**, вид:

   ```
   wss://discord-lite-xxxxx.livekit.cloud
   ```

   Обрати внимание: именно `wss://`, не `https://` и не `ws://`.

3 значения (`LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`) пойдут в Render.

---

## Шаг 4. Сервис на Render

### Вариант А — через Blueprint (быстрее)

1. https://dashboard.render.com → **New → Blueprint**.
2. Подключи GitHub и выбери репозиторий `discord-lite`.
3. Render сам прочитает `render.yaml` и покажет сервис `discord-lite`.
4. Нажми **Apply**, затем заполни переменные, помеченные `sync: false`:
   - `DATABASE_URL` — строка из Neon;
   - `LIVEKIT_URL` — `wss://…livekit.cloud`;
   - `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`.
   `JWT_SECRET` Render сгенерирует сам.
5. **Create / Deploy**.

### Вариант Б — вручную

**New → Web Service** → репозиторий → заполни:

| Поле | Значение |
|---|---|
| Name | `discord-lite` |
| Region | Frankfurt (EU Central) |
| Branch | `main` |
| Runtime | Node |
| Build Command | `npm ci --include=dev && npx prisma db push --skip-generate && npm run build` |
| Start Command | `node server/index.js` |
| Instance Type | **Free** |
| Health Check Path | `/api/health` |

Затем **Environment → Add Environment Variable**:

| Переменная | Значение |
|---|---|
| `NODE_VERSION` | `22` |
| `NODE_ENV` | `production` |
| `JWT_SECRET` | длинная случайная строка (см. ниже) |
| `DATABASE_URL` | строка из Neon |
| `LIVEKIT_URL` | `wss://…livekit.cloud` |
| `LIVEKIT_API_KEY` | ключ LiveKit |
| `LIVEKIT_API_SECRET` | секрет LiveKit |

Сгенерировать `JWT_SECRET`:

```powershell
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

> `npm ci --include=dev` обязателен: Render выставляет `NODE_ENV=production`, и без
> флага npm не поставит `typescript` и `prisma`, нужные для `next build` и `db push`.

---

## Шаг 5. Первый деплой и проверка

В логах Render по порядку должно быть:

1. `npm ci` — установка зависимостей;
2. `prisma db push` — `🚀 Your database is now in sync with your Prisma schema`;
3. `next build` — `Route (app) … ○ /`;
4. `discord-lite → https://discord-lite-xxxx.onrender.com (порт 10000)`;
5. `LiveKit: wss://…livekit.cloud`;
6. Render показывает **Live**.

Проверки (можно с домашнего компьютера):

```powershell
# 1. Сервер жив и видит LiveKit
curl https://discord-lite-xxxx.onrender.com/api/health
# {"ok":true,"livekit":true}

# 2. Полный прогон API + WebSocket (21 проверка)
cd "C:\Users\q6081\OneDrive\Документы\deepseek-harness\default-workspace\discord-lite"
npm run smoke -- https://discord-lite-xxxx.onrender.com
```

Затем открой адрес в браузере:

1. Зарегистрируйся, создай сервер — должен появиться канал «общий» и голосовой.
2. Напиши сообщение — оно должно мгновенно появиться (Socket.IO работает).
3. Нажми на голосовой канал, разреши микрофон — в шапке будет «1 в комнате».
4. Зайди с телефона (или второго браузера) под другим аккаунтом в тот же канал —
   должны услышать друг друга. Это финальная проверка, что LiveKit Cloud работает
   из интернета, а не только на localhost.

---

## Частые ошибки

| Симптом | Причина | Что делать |
|---|---|---|
| Через 15 минут первый запрос висит ~минуту | Render Free засыпает | Это нормально; для друзей можно позже взять план Starter ($7) или пинговать сервис |
| `P1001: Can't reach database server` | нет `sslmode=require` или неверный хост Neon | взять строку подключения заново, direct-хост |
| `prisma: command not found` | `npm ci` без `--include=dev` | проверить Build Command |
| `{"ok":true,"livekit":false}` | пустые `LIVEKIT_*` | заполнить переменные и нажать **Manual Deploy → Clear build cache & deploy** |
| Голос: «could not establish signal connection» | `LIVEKIT_URL` начинается с `https://` или `ws://` | должно быть `wss://…livekit.cloud` |
| Сообщения не доходят, но API работает | сервис за прокси без WebSocket | Render поддерживает WS из коробки; проверь, что не включён «Static» тип сервиса |
| 502 сразу после деплоя | сервис ещё стартует | подождать 30–60 секунд |
| Долгий вход | bcrypt на 0.1 CPU | нормально для Free, не ошибка |

---

## Что дальше (шаг 2)

Когда адрес заработает и голос проверится с двух устройств:

1. Зашиваем `https://discord-lite-xxxx.onrender.com` в `desktop/main.js` как
   `BUNDLED_SERVER`, экран подключения больше не показываем.
2. Оставляем аварийный выход: `DISCORD_LITE_URL` и скрытое сочетание клавиш для смены
   сервера, чтобы можно было переехать без пересборки.
3. Пересобираем `discord-lite-setup-0.1.0.exe` и раздаём друзьям.

Пришли адрес сервиса и результат `npm run smoke` — перейдём к этому шагу.
