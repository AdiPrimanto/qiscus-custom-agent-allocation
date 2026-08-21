# Qiscus Custom Agent Allocation

Webhook service implementing Qiscus Omnichannel's Custom Agent Allocation: FIFO queue, per-agent quota, online-only assignment.

**App ID:** `xxitg-980tjis6em26fxr`
**Live service:** https://qiscus-custom-agent-allocation.onrender.com (health check: `/health`)

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

Deployed on [Render](https://render.com) (Web Service + free Postgres, both built from the repo's `Dockerfile`). Any Docker-based host that runs a long-lived process works the same way — this service isn't serverless (it keeps a reconciliation `setInterval` running), so platforms limited to short-lived functions (e.g. Vercel, Netlify) won't work.

1. Push this repo to GitHub. On Render, create a new **PostgreSQL** instance (free tier), then a new **Web Service** connected to the repo — Render auto-detects the `Dockerfile`.
2. Set `DATABASE_URL` on the Web Service to the Postgres instance's **Internal Database URL** (same Render account, so internal networking is free and faster than external).
3. Set the remaining env vars from `.env.example` in the Web Service's Environment tab, including `WEBHOOK_SECRET`. `QISCUS_ADMIN_EMAIL`/`QISCUS_ADMIN_PASSWORD` aren't needed here — they're only used by the setup script in step 6, which you can run from your own machine.
4. Deploy. Render runs `prisma migrate deploy` automatically on every deploy (see `Dockerfile`'s `CMD`). Note the public URL Render assigns, and confirm `GET /<url>/health` returns `{"status":"ok"}`.
5. In the Qiscus dashboard, go to **Settings > Custom Agent Allocation**, switch the toggle on, paste `https://<your-deployed-url>/webhooks/<WEBHOOK_SECRET>/custom-agent-allocation` (substituting the actual `WEBHOOK_SECRET` value you configured) into the Webhook URL field, and click Save.
6. Register the Mark As Resolved webhook via the API (required by the test spec, not the dashboard) — run this from your own machine, with `QISCUS_ADMIN_EMAIL`/`QISCUS_ADMIN_PASSWORD` set in your local `.env`:
   ```bash
   npm run setup:webhook -- https://<your-deployed-url>/webhooks/<WEBHOOK_SECRET>/mark-as-resolved
   ```

Render's free tier sleeps a service after ~15 minutes with no traffic; the next request pays a ~30s cold-start. An external uptime pinger (e.g. UptimeRobot) hitting `/health` every 5 minutes keeps it warm — that's optional, not required for correctness.

### Configuring an agent's quota

Each agent's `max_concurrent` defaults to `MAX_CONCURRENT_DEFAULT` (2) the first time the service sees them. To set a different quota for a specific agent, update their row directly:

```bash
docker compose exec postgres psql -U postgres -d qiscus_agent_allocation \
  -c "UPDATE agents SET max_concurrent = 5 WHERE email = 'agent@example.com';"
```

(Against the deployed database, swap the `docker compose exec` prefix for `psql "$DATABASE_URL"` using the Render Postgres instance's External Database URL.)

## How it works

- `POST /webhooks/:webhookSecret/custom-agent-allocation` — Qiscus calls this when a new customer has no agent yet. The service queries `GET /api/v2/admin/service/available_agents?room_id=...` for online agents under quota, assigns the least busy one via `POST /api/v1/admin/service/assign_agent`, or leaves the customer `waiting` if none are free.
- `POST /webhooks/:webhookSecret/mark-as-resolved` — Qiscus calls this when a chat is resolved. The service marks the local assignment `resolved` and immediately tries to pull the next `waiting` customer in FIFO order.
- A background interval (`RECONCILIATION_INTERVAL_MS`, default 20s) re-checks any `waiting` customers in case an agent came online outside of a resolve event. It skips entirely (no API calls) when the queue is empty.
- Both webhook routes require the shared `WEBHOOK_SECRET` as a URL path segment. Qiscus doesn't support payload signing or custom headers on either webhook type, so the URL is the only thing Qiscus lets you configure — a missing or wrong secret returns `404` without revealing whether the route exists.

## Known limitations

- **URL-embedded secret, not a signature.** Qiscus offers no HMAC/signing mechanism for either webhook, so `WEBHOOK_SECRET` in the path is the strongest available mitigation, not a cryptographic guarantee. Keep it long and random, and treat access/proxy logs that might capture the URL as sensitive.
- **Allocation decisions are fully serialized.** Every `tryAssign`/`tryAssignWaiting` call runs inside a Postgres advisory-locked transaction, so concurrent requests queue up instead of racing — a room only gets an agent after every older `waiting` room has been considered. Under a big burst, that queueing eats into the transaction's own time budget, which is why `timeout`/`maxWait` are set generously (30s/10s) rather than left at Prisma's defaults.
- **A new agent isn't picked up instantly.** Adding an agent (or an existing one coming back online) doesn't push anything to this service — there's no "agent status changed" webhook. Waiting rooms only get retried on the next trigger: a `mark-as-resolved` event, or the periodic reconciliation (`RECONCILIATION_INTERVAL_MS`, default 20s). So there can be up to ~20s of lag between an agent becoming available and the queue picking them up.
- **A room already `assigned` to an agent who goes offline is not reassigned.** The service only re-evaluates capacity for `waiting` rooms. If an agent goes offline while still holding an `assigned` room, that assignment stays as-is — nothing detects the agent dropped offline and pulls the room back into the queue. It's stuck until the room is explicitly resolved (`mark-as-resolved` webhook) or the agent comes back and handles it via the Qiscus dashboard.
- **A failed `mark-as-resolved` write isn't retried.** `handleMarkAsResolved` marks the room resolved with a single `updateMany`; if that specific write fails (a DB blip), there's no retry and no later reconciliation pass that revisits it. The agent's local `assigned` count for that room stays inflated indefinitely — `pickAgent` will keep treating that agent as busier than they actually are, even though Qiscus already considers the chat closed.
- **`assign_agent` succeeding but the local commit failing afterward leaves the two systems out of sync.** `commitAssignment` calls Qiscus's `assign_agent` and then writes `status: assigned` in the same Postgres transaction — but the external call can't be rolled back if the local write fails right after. If that happens, Qiscus thinks the room is assigned while our DB still says `waiting`, so the next reconcile pass will try to assign it again (possibly to a different agent, since `replace_latest_agent=true` silently reassigns). This is a distributed-transaction problem with no cheap fix; closing it properly needs either an outbox-style retry queue or a periodic job that reconciles `assigned` rows against Qiscus's real state, neither of which exists yet.
