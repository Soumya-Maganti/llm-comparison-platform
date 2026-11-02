# LLM Comparison Platform

A full-stack assessment project for comparing two Gemini models. Submit one prompt, read both responses, vote for a preferred answer, and revisit previous comparisons from the same browser.

## Features

- Concurrent requests to two configurable models, with response timing and individual error states.
- Side-by-side responses on larger screens and stacked responses on mobile.
- One vote per comparison, enforced by a database constraint.
- A leaderboard calculated from stored votes.
- Browser-specific comparison and voting history, with pagination.

The frontend uses React, TypeScript, Vite, and Material UI. The backend uses FastAPI, SQLAlchemy, and the Google Gen AI SDK. SQLite is the local database; PostgreSQL support is provided through psycopg.

## Setup

Prerequisites: Python 3.13, Node.js 22 or 24, npm, and a Gemini API key with access to two distinct text-generation models. Install dependencies after cloning the repository and entering its root directory.

### Backend

In PowerShell:

```powershell
python -m venv backend/.venv
backend\.venv\Scripts\python.exe -m pip install -r backend/requirements.txt
if (-not (Test-Path backend/.env)) { Copy-Item backend/.env.example backend/.env }
```

If Python is not on PATH, use `py -3.13` or the full interpreter path for the first command. Set `GEMINI_API_KEY` in the new local environment file, then start the API:

```powershell
cd backend
.venv\Scripts\python.exe -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

On macOS/Linux, use `python3` to create the environment, `backend/.venv/bin/python` for installation, and `.venv/bin/python` from the backend directory. Create the environment file with `cp -n backend/.env.example backend/.env` from the repository root.

### Frontend

In a separate terminal, starting from the repository root:

```powershell
cd frontend
npm.cmd ci
npm.cmd run dev
```

Use `npm` instead of `npm.cmd` on macOS/Linux. Open the URL printed by Vite, normally <http://127.0.0.1:5173>. API documentation is available at <http://127.0.0.1:8000/docs>.

Vite proxies `/api` requests to port 8000, so the default local setup does not require a frontend environment file. If port 5173 is occupied, Vite chooses another port. Return to the same origin to retain your browser identity: `localhost`, `127.0.0.1`, and different ports have separate storage.

## Configuration

| Variable | Location | Default or purpose |
| --- | --- | --- |
| `GEMINI_API_KEY` | Backend only | Required for real comparisons; obtain one from [Google AI Studio](https://aistudio.google.com/apikey). |
| `MODEL_A` | Backend | `gemini-3.5-flash-lite` |
| `MODEL_B` | Backend | `gemini-3.1-flash-lite`; must differ from `MODEL_A`. |
| `DATABASE_URL` | Backend | `sqlite:///./comparisons.db`; use a PostgreSQL connection URL for deployment. |
| `CORS_ORIGINS` | Backend | JSON array, default `["http://localhost:5173"]`. Set exact frontend origins for direct cross-origin requests. |
| `VITE_API_BASE_URL` | Frontend, optional | Empty uses the local proxy. For deployment, use the backend HTTPS origin without `/api`. |

The backend reads its environment file relative to the application location; server environment variables take precedence. Restart the API after changing settings. Relative SQLite paths resolve from the server's working directory: the commands above create `backend/comparisons.db`. Keep that file to retain local data.

Model availability and quota depend on the Google project. Check [Google's model catalog](https://ai.google.dev/gemini-api/docs/models) if a configured model is unavailable. A missing key returns HTTP 503; provider failures are shown separately for each model.

The [backend example](backend/.env.example) and [frontend example](frontend/.env.example) contain configuration only. Local environment files are excluded from Git. Never set the Gemini key or database credentials in a `VITE_*` variable: those values are public and embedded in the frontend build. Direct API calls require `CORS_ORIGINS` to match the frontend scheme, hostname, and port. Rebuild the frontend after changing its environment variables.

## Tests and build

From the repository root, with both sets of dependencies installed:

```powershell
cd backend
.venv\Scripts\python.exe -m pytest -q
cd ../frontend
npm.cmd run build
npx.cmd playwright install chromium
npm.cmd run test:e2e
```

Use `npx` instead of `npx.cmd` on macOS/Linux. Backend tests use temporary SQLite databases and mocked model responses. They cover concurrent generation, validation, ownership checks, duplicate voting, persistence after reopening the app, leaderboard totals, pagination, and CORS. PostgreSQL schema compilation is checked, but this does not test a live PostgreSQL connection.

Playwright starts an isolated API on port 8011 and frontend on port 5181; both ports must be free. It exercises the real UI with mocked model responses and a temporary database, including comparison, voting, a returning browser context with restored storage, mobile layout, and failure states. Normal development servers can remain running.

### Live Gemini check

The live test is skipped by default. After configuring a valid key and accessible models, run from the backend directory:

```powershell
$env:RUN_LIVE_GEMINI = '1'
try { .venv\Scripts\python.exe -m pytest tests/test_live.py -q } finally { Remove-Item Env:RUN_LIVE_GEMINI }
```

On macOS/Linux: `RUN_LIVE_GEMINI=1 .venv/bin/python -m pytest tests/test_live.py -q`.

This makes two real provider requests and may consume API quota. It checks successful responses, voting, leaderboard totals, and history after reopening the app against a temporary database. Passing mocked tests or a successful health check does not verify Gemini access.

## API

| Endpoint | Purpose |
| --- | --- |
| `GET /api/health` | Process status and whether a key is configured; does not call Gemini. |
| `POST /api/comparisons` | Accept `{browser_id, prompt}` and store two timed responses or provider errors. |
| `GET /api/history?browser_id=UUID&limit=20&offset=0` | Return that browser's comparisons, newest first; maximum page size is 100. |
| `POST /api/comparisons/{id}/votes` | Accept `{browser_id, response_id}`; both responses must succeed and the identifier must match the comparison owner. |
| `GET /api/leaderboard` | Model wins and each model's percentage of all stored votes. |

The interactive API documentation describes request validation. Duplicate votes return HTTP 409. A leaderboard percentage is a share of votes, not an objective quality score or opponent-adjusted win rate.

## Scope and limitations

History uses an anonymous UUID in local storage rather than an account. Clearing storage, switching browsers, or changing origin creates a separate identity. The UUID is not authentication and does not prevent someone from creating multiple identities. Prompts and responses are stored in the database; prompts are sent to Google.

This assessment does not include authentication, rate limiting, schema migrations, streaming, or automatic submission retries. A request that times out in the browser may still finish on the server; check history before resubmitting. PostgreSQL connectivity and hosted behavior need deployment-specific verification.

See [DESIGN_NOTES.md](DESIGN_NOTES.md) for architecture and trade-offs, and [DEPLOYMENT.md](DEPLOYMENT.md) for optional Vercel, Render, and Neon configuration.
