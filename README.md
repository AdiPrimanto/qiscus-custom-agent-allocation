# Qiscus Custom Agent Allocation

Webhook service implementing Qiscus Omnichannel's Custom Agent Allocation: FIFO queue, per-agent quota, online-only assignment.

## Local setup

1. `npm install`
2. `docker compose up -d` — starts Postgres on `localhost:5432`
3. `docker compose exec postgres createdb -U postgres qiscus_agent_allocation_test` — one-time, for tests
4. `cp .env.example .env` and fill in:
   - `QISCUS_APP_ID` — from Settings > App Information
   - `QISCUS_SECRET_KEY` — from Settings > App Information
   - `QISCUS_ADMIN_EMAIL` / `QISCUS_ADMIN_PASSWORD` — your dashboard admin login, used only by the webhook-registration script
   - `WEBHOOK_SECRET` — a long random value shared by both webhook routes (e.g. generate one with `openssl rand -hex 32`); required, the server refuses to start without it
5. `npx prisma migrate dev --name init`
6. `DATABASE_URL="postgresql://postgres:postgres@localhost:5432/qiscus_agent_allocation_test" npx prisma migrate deploy`
7. `npm test`
8. `npm run dev` — serves on `http://localhost:3000`

## Deploying

1. Push this repo to GitHub, connect it to a new Railway project (Railway auto-detects the `Dockerfile`).
2. Add a Postgres plugin in Railway and set `DATABASE_URL` to its connection string.
3. Set the remaining env vars from `.env.example` in Railway's variables tab, including `WEBHOOK_SECRET`.
4. Deploy. Note the public URL Railway assigns.
5. In the Qiscus dashboard, go to **Settings > Custom Agent Allocation**, switch the toggle on, paste `https://<your-railway-url>/webhooks/<WEBHOOK_SECRET>/custom-agent-allocation` (substituting the actual `WEBHOOK_SECRET` value you configured) into the Webhook URL field, and click Save.
6. Register the Mark As Resolved webhook via the API (required by the test spec, not the dashboard):
   ```bash
   npm run setup:webhook -- https://<your-railway-url>/webhooks/<WEBHOOK_SECRET>/mark-as-resolved
   ```

## How it works

- `POST /webhooks/:webhookSecret/custom-agent-allocation` — Qiscus calls this when a new customer has no agent yet. The service queries `GET /api/v2/admin/service/available_agents?room_id=...` for online agents under quota, assigns the least busy one via `POST /api/v1/admin/service/assign_agent`, or leaves the customer `waiting` if none are free.
- `POST /webhooks/:webhookSecret/mark-as-resolved` — Qiscus calls this when a chat is resolved. The service marks the local assignment `resolved` and immediately tries to pull the next `waiting` customer in FIFO order.
- A background interval (`RECONCILIATION_INTERVAL_MS`, default 20s) re-checks any `waiting` customers in case an agent came online outside of a resolve event. It skips entirely (no API calls) when the queue is empty.
- Both webhook routes require the shared `WEBHOOK_SECRET` as a URL path segment. Qiscus doesn't support payload signing or custom headers on either webhook type, so the URL is the only thing Qiscus lets you configure — a missing or wrong secret returns `404` without revealing whether the route exists.
