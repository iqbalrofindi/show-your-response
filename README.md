# ShowYourResponse

A simple app that **accepts any request from other applications**, stores it in **SQLite**, and shows it in a login-protected history dashboard.

Useful for debugging webhooks, inspecting payloads sent by other apps, or simply logging incoming data.

## Features

- A `/api/receive` endpoint that accepts **any method** (GET, POST, PUT, PATCH, DELETE, etc.) and **any body** (JSON, form, text, XML, binary).
- Stores the method, path, query, headers, content type, body, body size, sender IP, and timestamp.
- History dashboard: search, method filter, pagination, auto refresh, request details, copy body, delete one or all records.
- Login with a session cookie (passwords hashed with scrypt).
- Change password (sessions on other devices are signed out automatically).
- Optional API key protection for the receive endpoint.
- Ready to deploy with Docker / Docker Compose.

## Tech Stack

- Node.js 24 + Express 5
- SQLite via the built-in `node:sqlite` module (no native dependencies)
- Plain HTML + CSS + vanilla JS frontend (no build step)

## Project Structure

```
ShowYourResponse/
├── src/
│   ├── server.js      # Express setup, receive endpoint, history API
│   ├── auth.js        # Login, logout, sessions, change password
│   ├── db.js          # SQLite connection, schema, default user seed
│   └── password.js    # Password hashing & verification (scrypt)
├── public/
│   ├── login.html     # Login page
│   ├── index.html     # History page
│   └── assets/        # app.js, login.js, style.css
├── data/              # SQLite database (created automatically, not committed)
├── .env.example       # Example configuration
├── Dockerfile
└── docker-compose.yml
```

## Running Locally

Requires Node.js 22.13 or newer (Node 24 recommended).

```bash
cp .env.example .env   # adjust if needed
npm install
npm start
```

Development mode (auto restart on file changes):

```bash
npm run dev
```

Open `http://localhost:3000/` and log in with the default user:

| Username       | Password   |
| -------------- | ---------- |
| `iqbalrofindi` | `12345678` |

Change the password right away using the **Ganti Password** button in the dashboard.

## Deploying with Docker

```bash
cp .env.example .env   # adjust for your server
docker compose up -d --build
```

- The database is stored in the `syr-data` Docker volume, so data and passwords survive container rebuilds.
- The host port follows `PORT` in `.env` (default `3000`). Inside the container the app always listens on port `3000`.

Common commands:

```bash
docker compose logs -f          # view logs
docker compose restart          # restart
docker compose down             # stop (data stays in the volume)
```

Without Docker Compose:

```bash
docker build -t show-your-response .
docker run -d --name show-your-response -p 3000:3000 \
  --env-file .env -e DATA_DIR=/app/data \
  -v syr-data:/app/data show-your-response
```

## Configuration (`.env`)

| Variable           | Default        | Description |
| ------------------ | -------------- | ----------- |
| `PORT`             | `3000`         | App port. With Docker: the host port. |
| `DATA_DIR`         | `./data`       | SQLite database folder. Always `/app/data` in Docker. |
| `DEFAULT_USERNAME` | `iqbalrofindi` | Initial user, only used when the database is empty. |
| `DEFAULT_PASSWORD` | `12345678`     | Initial password, only used when the database is empty. |
| `RECEIVE_API_KEY`  | (empty)        | If set, requests to `/api/receive` must include the `x-api-key` header. |
| `BODY_LIMIT`       | `10mb`         | Maximum accepted body size. |
| `COOKIE_SECURE`    | `false`        | Set to `true` when the app is served over HTTPS. |
| `TRUST_PROXY`      | `false`        | Set to `true` behind a reverse proxy (nginx, traefik, etc.) so the real client IP is recorded. |

Note: changing `DEFAULT_PASSWORD` after the database has been created does **not** change the password. Use the change password menu in the dashboard instead.

## Sending Data

Send requests to `/api/receive` or any sub-path under it, for example `/api/receive/webhook/order`.

```bash
# JSON
curl -X POST http://localhost:3000/api/receive \
  -H 'Content-Type: application/json' \
  -d '{"order_id": 123, "status": "paid"}'

# Form
curl -X PUT "http://localhost:3000/api/receive/orders/42?source=app" \
  -d 'name=Budi&qty=2'

# Text / XML
curl -X POST http://localhost:3000/api/receive/xml \
  -H 'Content-Type: application/xml' \
  -d '<order><id>1</id></order>'

# GET with query string
curl "http://localhost:3000/api/receive/ping?foo=bar"

# When RECEIVE_API_KEY is set
curl -X POST http://localhost:3000/api/receive \
  -H 'x-api-key: your-secret' \
  -H 'Content-Type: application/json' \
  -d '{"hello": "world"}'
```

Successful response:

```json
{ "ok": true, "id": 1 }
```

Notes:
- Binary bodies are stored as base64.
- The `x-api-key` header value is masked (`***`) when stored.
- CORS is enabled, so web apps on other domains can send data directly.

## Endpoints

### Public

| Method | Path             | Description |
| ------ | ---------------- | ----------- |
| ANY    | `/api/receive`   | Accepts and stores the request. |
| ANY    | `/api/receive/*` | Same as above, with any sub-path. |
| GET    | `/health`        | Health check. |
| GET    | `/login`         | Login page. |
| POST   | `/auth/login`    | Log in. JSON body: `{ "username", "password" }`. |

### Login Required

| Method | Path                      | Description |
| ------ | ------------------------- | ----------- |
| GET    | `/`                       | History page. |
| GET    | `/auth/me`                | Current user info. |
| POST   | `/auth/logout`            | Log out. |
| POST   | `/auth/change-password`   | JSON body: `{ "currentPassword", "newPassword" }` (min. 8 characters). |
| GET    | `/admin/api/requests`     | List history. Query: `page`, `limit` (max 200), `q` (search), `method`. |
| GET    | `/admin/api/requests/:id` | Request details. |
| DELETE | `/admin/api/requests/:id` | Delete one request. |
| DELETE | `/admin/api/requests`     | Delete all requests. |

## Database

The database file is `data/app.db` (local) or lives in the `syr-data` volume (Docker). Tables:

- `requests`: all received data.
- `users`: users and password hashes.
- `sessions`: active login sessions (valid for 7 days).

SQLite runs in WAL mode, so it is normal to see `app.db-wal` and `app.db-shm` next to `app.db`.

Back up the database from Docker (stop first so the WAL contents are merged into `app.db`):

```bash
docker compose stop
docker compose cp show-your-response:/app/data ./backup-data
docker compose start
```

## Security

- Change the default password right after deploying.
- Set `RECEIVE_API_KEY` if the receive endpoint should not be open to everyone.
- Use HTTPS in production and set `COOKIE_SECURE=true`.
- Login is temporarily blocked (15 minutes) after 10 failed attempts from the same IP.
- `.env` and the `data/` folder are excluded from git and from the Docker image.
