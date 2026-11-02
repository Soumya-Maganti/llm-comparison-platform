# Optional deployment

Current demo: [frontend](https://llm-comparison-platform.vercel.app/), [backend health](https://llm-comparison-api.onrender.com/api/health), [API docs](https://llm-comparison-api.onrender.com/docs).

The project is configured for Vercel Hobby, a Render Free Web Service, and Neon Free PostgreSQL. Deployment is optional and is not required to run or test the application locally. Free-plan terms and limits can change; check the provider's creation summary before proceeding. Do not select upgrades or enter billing details for this demo.

## Prerequisites

Publish the source to GitHub and sign in to the three hosting providers. Only credential-free environment examples belong in Git; keep the Gemini key and database URL private. The backend and frontend deployment configurations are [render.yaml](render.yaml) and [frontend/vercel.json](frontend/vercel.json).

## Neon database

1. Create a project on the Free plan in the [Neon console](https://console.neon.tech). Choose a region near the Render service.
2. Use the default database and role, or create a dedicated database for the demo.
3. Open Connect and copy the PostgreSQL connection string. A pooled endpoint is suitable for this setup. Retain the TLS parameters Neon supplies, including `sslmode=require`.
4. Store the URL as Render's private `DATABASE_URL` environment variable. It must not appear in the frontend or repository.

The backend accepts `postgres://`, `postgresql://`, and `postgresql+psycopg://` URLs. SQLAlchemy creates the tables and constraints on successful startup. No manual SQL or SQLite upload is required. A fresh database starts with empty history; local records are not migrated automatically.

## Render API

Create a Python Web Service from the GitHub repository in the [Render dashboard](https://dashboard.render.com):

| Setting | Value |
| --- | --- |
| Root directory | `backend` |
| Instance type | Free |
| Build command | `pip install -r requirements.txt` |
| Start command | `uvicorn app.main:app --host 0.0.0.0 --port $PORT` |
| Health-check path | `/api/health` |

Set these environment variables:

| Name | Value |
| --- | --- |
| `PYTHON_VERSION` | `3.13.12` |
| `DATABASE_URL` | Private Neon connection URL |
| `GEMINI_API_KEY` | Existing Gemini key |
| `MODEL_A` | `gemini-3.5-flash-lite` |
| `MODEL_B` | `gemini-3.1-flash-lite` |
| `CORS_ORIGINS` | `[]` initially; set the actual frontend origin after Vercel deployment |
| `COMPARISON_LIMIT_PER_MINUTE` | Optional; default `3`, shared across all visitors |
| `COMPARISON_LIMIT_PER_DAY` | Optional; default `30`, shared across all visitors |

The Blueprint explicitly selects `plan: free`; the manual creation form must also select Free. No Render database or persistent disk is needed. The local backend environment file is not uploaded: Render supplies the production values.

Wait for successful startup, then open `/api/health` on the assigned Render origin. It should report `status: ok` and `configured: true`. Configuration status only checks whether a key is present; it does not prove the key works. API documentation is at `/docs` on the same origin.

## Vercel frontend

Import the same repository into a personal Hobby account at [Vercel](https://vercel.com):

| Setting | Value |
| --- | --- |
| Root directory | `frontend` |
| Framework preset | Vite |
| Install command | `npm ci` |
| Build command | `npm run build` |
| Output directory | `dist` |
| Production environment variable | `VITE_API_BASE_URL` |

Set `VITE_API_BASE_URL` to the assigned Render HTTPS origin, without `/api` or a trailing slash. Never configure `GEMINI_API_KEY` or `DATABASE_URL` on Vercel. Frontend environment values are embedded in the build, so changes require a new deployment.

## Production CORS

After Vercel assigns the stable frontend origin, set Render's `CORS_ORIGINS` to a JSON array containing that exact origin. It must include the scheme and hostname, with no path or trailing slash. Save the setting and restart/redeploy the API.

Use only the intended origins rather than a wildcard. A Vercel preview URL is a separate origin and needs its own entry if used. If requests fail, compare the browser's origin with the CORS setting and confirm the frontend was built with the correct Render API origin.

## Deployment checks

1. Open backend health before submitting a comparison. Render Free can sleep when idle; allow it to wake before starting generation. A cold start plus generation can exceed the frontend's 75-second timeout. Neon may also scale to zero.
2. Submit a short prompt through the production frontend. Confirm two distinct model IDs, real responses, and timings. The test-only mock server must not be used for deployment.
3. Vote for one response. Confirm the selected vote is shown and the leaderboard gains exactly one vote. A duplicate vote must not add another win.
4. Reopen the same frontend origin with browser storage retained. Confirm responses and the selected vote remain in history.
5. Restart the Render service, wait for health, and check history and leaderboard totals again. This verifies that Neon, rather than Render's ephemeral filesystem, holds the data.
6. Check that browser requests target Render and contain no Gemini key or database credentials. Record public URLs only after these checks pass.

## Free-plan considerations

Use the project's existing Gemini quota without enabling API billing. Free hosting does not change the billing settings of the Google project. If a quota is exhausted, pause the demo or wait for the allowance to reset rather than upgrading.

Review the current [Vercel Hobby terms](https://vercel.com/docs/plans/hobby), [Render Free limitations](https://render.com/docs/free), [Neon Free allowances](https://neon.com/pricing), and [Neon connection instructions](https://neon.com/docs/connect/connect-from-any-app). The application has a database-backed global generation cap, but no authentication or per-user abuse protection; see [DESIGN_NOTES.md](DESIGN_NOTES.md) before opening it to unrestricted traffic. Counters use the same SQLite/PostgreSQL database and work across workers without trusting proxy headers. Failures consume reservations, rejected requests return `Retry-After`, and counters are not reset during deployment. No Redis, background service or paid add-on is needed. Health does not verify remaining generation allowance. Check Google AI Studio billing and quotas separately; hosting plans cannot establish Gemini's billing tier.
