# Design notes

## Approach

The project focuses on the assessment's six flows: prompt submission, two-model generation, response comparison, voting, a leaderboard, and returning-user history. AI-assisted tools were used during implementation and verification.

The code is intentionally small. The backend keeps configuration, ORM entities, validation, provider calls, and routes in one module, with separate tests. The frontend keeps page state in one React component and API calls and shared types in a separate module. These boundaries are sufficient for the current scope; splitting routes and presentation components would become useful as the application grows.

## Request flow

The browser generates a UUID and retains it in local storage. It sends that identifier and a validated prompt to FastAPI. Two Google Gen AI SDK calls run concurrently through `asyncio.gather`, each with a 60-second timeout and an output limit of 2,048 tokens.

After both requests settle, a transaction stores the comparison and its two response records. Provider failures are saved as generic errors alongside any successful response. The UI displays model IDs, output, and elapsed request time. Timing includes provider and network latency; it is not a controlled performance benchmark.

Voting requires two successful responses. This avoids treating a provider outage as an answer-quality preference. Results are returned together rather than streamed, which keeps state handling and voting rules simple. The client has a 75-second request timeout and does not automatically retry comparison submissions. A disconnected client may still have a completed comparison in history.

## Persistence and scoring

SQLAlchemy models three tables for comparisons and votes:

- `comparisons`: prompt, browser identifier, and creation timestamp.
- `responses`: model ID, text or error, and latency, linked to a comparison.
- `votes`: chosen response, browser identifier, and timestamp, linked to a comparison.

A fourth table, `generation_limits`, stores two shared counters for fixed UTC minute/day windows. Each comparison atomically reserves both counters before calling Gemini. SQLite/PostgreSQL upserts use conditional updates, so concurrent workers cannot exceed the allowance; rejection rolls back both updates. Defaults are 3 comparisons per minute and 30 per day. Reservations remain consumed after provider failure or client disconnection. Only two counter rows are retained, and restarts do not reset them. This avoids IP-based limits and assumptions about trusted Render proxy headers. One visitor can still exhaust the allowance for everyone; boundary bursts, unbounded traffic to other endpoints, and denial of service remain possible.

Foreign keys preserve references. Before accepting a vote, the API checks that the browser identifier matches the comparison owner and that the selected response belongs to that comparison. A unique `(comparison_id, browser_id)` constraint prevents a second vote, including concurrent duplicate requests. Votes cannot be changed through the API.

The leaderboard counts stored votes grouped by the winning response's model ID. Percentages divide model wins by the total number of votes. Unvoted comparisons add no wins; configured models with no votes remain visible. Historical model IDs remain in the leaderboard if configuration changes. Rankings do not account for prompt difficulty, exposure, or opponents.

SQLite keeps local setup simple. PostgreSQL uses the same ORM entities through psycopg. Startup `create_all` initializes a fresh database but does not migrate an existing schema. Relative SQLite paths follow the server's working directory. UTC offsets are included in API timestamps so SQLite and PostgreSQL results have consistent browser display.

Synchronous SQLAlchemy sessions reduce dependency and implementation complexity. Database operations in the asynchronous comparison route can briefly block the event loop. An async driver or a worker-thread persistence layer would be appropriate if throughput became important. History uses paginated queries and separate response/vote lookups per comparison; batching those lookups is another scaling improvement.

## Security and identity

Gemini requests originate from the backend. Keys and database credentials are read from its environment, not sent to the frontend. SDK exception details are not returned because they can contain request data or credentials. Provider failure logs contain only an allowlisted model identifier, numeric HTTP status, fixed error category, and parsed retry duration when available. Raw exceptions, prompts, outputs and credentials are never included in these diagnostics. Model output is rendered as plain React text, without raw HTML. Prompts are limited to 12,000 characters, and CORS uses an explicit origin list.

The browser UUID provides continuity without a login flow. It can be copied or reset, so matching it is not authentication or protection against multiple identities. Anyone who obtains the identifier can retrieve its history; access logs may contain history query identifiers. CORS controls browser access; it does not stop direct API clients. The global generation cap limits model operations but does not replace authentication, per-user quotas, retention rules or broader abuse protection. Prompt and response storage should also be disclosed to users, as it is in the application and README.

## Verification

Backend tests use real temporary SQLite databases and an injected fake provider. They cover concurrency, validation, browser isolation, vote ownership, duplicate rejection, partial failures, pagination, and persistence across application instances. Leaderboard checks include zero votes, a two-to-one split across browser identities, and an unvoted comparison. CORS tests check an allowed origin and a rejected origin.

Additional protection tests verify minute/day boundaries, persistence across restarts, reservations from separate concurrent database engines, rejection rollback, and that rejected requests never call the provider. Diagnostic tests check allowlisted status/category/retry fields, timeout reporting, and exclusion of sensitive sentinel values. The keyboard-scrolling browser test waits for `scrollend` before comparing panel offsets, avoiding assertions during native scroll animation.

PostgreSQL DDL compilation checks schema portability without a database server. It does not establish live PostgreSQL connectivity. Playwright runs the real frontend and a test-only API with temporary storage. It checks the user flow, a fresh browser context with restored local storage, responsive layout, and error handling. Mocked tests do not verify Gemini availability or quota.

The opt-in live test uses the production provider integration and a temporary database. It verifies both model responses, voting, leaderboard totals, and persistence after reopening the application. Hosted networking, PostgreSQL persistence, and free-tier cold starts require separate deployment checks. Test commands are documented in [README.md](README.md).

## Future improvements

The next operational improvements would be schema migrations, live PostgreSQL integration tests, authentication and per-user abuse controls. Blind model labels, ties, streaming, and richer scoring are possible product improvements, but are outside the assessment requirements.
