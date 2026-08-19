# Custom Agent Allocation Service Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build and deploy a Node.js/TypeScript webhook service that implements Qiscus Omnichannel's Custom Agent Allocation: FIFO-queued, quota-limited, online-only agent assignment, plus the required Mark As Resolved webhook to free up quota.

**Architecture:** Express HTTP service backed by PostgreSQL (via Prisma). Two inbound webhooks (`custom-agent-allocation`, `mark-as-resolved`) drive a shared allocation core that queries Qiscus's live `Available Agents (v2)` API (online status + current load) and calls `Assign Agent` to commit a decision. A local `agents` table only stores the configurable per-agent quota (`max_concurrent`); a local `assignments` table is the FIFO queue of record. A lightweight in-process interval reconciles any customers left `waiting` once agents free up.

**Tech Stack:** Node.js 22 + TypeScript (run via `tsx`, no separate build step), Express, PostgreSQL + Prisma, Axios, Vitest + Supertest + nock for tests, Docker for local Postgres and for deployment (Railway).

**Spec:** `.claude/Qiscus_Custom_Agent_Allocation_Test.pdf` (requirements) and `.claude/Qiscus_Custom_Agent_Allocation_Plan.docx` (original design). This plan supersedes the docx's open items in section 9 with verified API contracts pulled directly from the live Postman collection (`https://documenter.gw.postman.com/api/collections/8259884/SVYjThTY`) and `https://documentation.qiscus.com/omnichannel-chat/customization.md` — see Global Constraints for the corrections.

## Global Constraints

- Qiscus API base URL: `https://multichannel.qiscus.com` (verified from the collection's "Base Url" folder description).
- Test account App ID (app_code): `xxitg-980tjis6em26fxr` — always read from `QISCUS_APP_ID` env var, never hardcoded in source.
- Each agent has a configurable max concurrent customer count, default `2` (PDF requirement #2) — stored per-agent in the local `agents` table, seeded from `MAX_CONCURRENT_DEFAULT`.
- Queue order is strict FIFO by `assignments.created_at ASC` (PDF requirement #3).
- Only assign to agents where `is_available === true` (PDF requirement #4). Verified: `is_available` is the exact boolean field Qiscus returns on `candidate_agent` (inbound webhook payload), on `GET /api/v2/admin/service/available_agents`, and on `GET /api/v1/admin/agents` — the same field their own native auto-allocation uses. No further diffing is needed to resolve docx section 9.1.
- `Assign Agent` (`POST /api/v1/admin/service/assign_agent`) and `Available Agents (v2)` (`GET /api/v2/admin/service/available_agents`) authenticate with headers `Qiscus-App-Id` + `Qiscus-Secret-Key` — **not** `Authorization: AdminToken`.
- `Available Agents (v2)` requires a `room_id` query parameter ("list of all agents that are eligible in a room") — always call it per-room, not globally.
- `current_customer_count` is returned live by Qiscus on every agent-list endpoint — never cached or recomputed locally; the local DB never stores a customer count.
- The Mark As Resolved webhook **must** be registered via the API `POST /api/v1/app/webhook/mark_as_resolved` (PDF requirement #7) with header `Authorization: {AdminToken}`, where `AdminToken` comes from `POST /api/v1/auth` (form-data `email` + `password`). Both of those two calls use **multipart/form-data** bodies, not urlencoded.
- The Custom Agent Allocation webhook URL has no registration API in the collection — it is wired up manually via the dashboard toggle at Settings > Custom Agent Allocation (confirmed by the provided screenshots: a toggle + a "Webhook URL" text field + Save button).
- `assign_agent`'s `max_agent` parameter is a room-participant cap, unrelated to per-agent customer quota — never send it.
- No features beyond the 4 core requirements — this is a test/take-home project, not production.

---

## File Structure

```
qiscus-custom-agent-allocation/
├── .claude/                                   (existing — test spec, untouched)
├── docker-compose.yml                         (local Postgres for dev + test)
├── Dockerfile                                  (Railway deployment)
├── .env.example
├── .env.test
├── .gitignore
├── package.json
├── tsconfig.json
├── vitest.config.ts
├── prisma/
│   └── schema.prisma
├── src/
│   ├── config/
│   │   └── env.ts               (env parsing/validation)
│   ├── db/
│   │   └── prisma.ts            (PrismaClient singleton)
│   ├── qiscus/
│   │   ├── types.ts             (verified Qiscus payload/response types)
│   │   └── client.ts            (loginAdmin, getAvailableAgents, assignAgent, setMarkAsResolvedWebhook)
│   ├── allocation/
│   │   ├── agents.ts            (getOrCreateLocalAgent)
│   │   ├── allocate.ts          (tryAssign, tryAssignWaiting — core FIFO/quota logic)
│   │   └── reconcile.ts         (reconcileWaitingAssignments)
│   ├── webhooks/
│   │   ├── customAgentAllocation.ts
│   │   └── markAsResolved.ts
│   ├── app.ts                   (Express app factory)
│   └── server.ts                (bootstrap: listen + reconciliation interval)
├── scripts/
│   └── setup-mark-as-resolved-webhook.ts   (one-time: register the webhook via API)
├── tests/
│   ├── setup.ts                 (loads .env.test, resets nock)
│   ├── env.test.ts
│   ├── db.prisma.test.ts
│   ├── qiscus.client.test.ts
│   ├── allocation.agents.test.ts
│   ├── allocation.allocate.test.ts
│   ├── allocation.reconcile.test.ts
│   ├── webhooks.customAgentAllocation.test.ts
│   ├── webhooks.markAsResolved.test.ts
│   └── setup-mark-as-resolved-webhook.test.ts
└── README.md
```

---

### Task 1: Project scaffold, tooling, and local Postgres

**Files:**
- Create: `package.json`, `tsconfig.json`, `.gitignore`, `.env.example`, `.env.test`, `docker-compose.yml`, `vitest.config.ts`
- Create: `tests/setup.ts`
- Create: `src/app.ts` (health check only, for now)
- Create: `src/server.ts`
- Test: `tests/health.test.ts`

**Interfaces:**
- Produces: `createApp(): express.Express` from `src/app.ts` — later tasks add routes to this same factory.

- [ ] **Step 1: Init git repo and Node project**

```bash
git init
npm init -y
```

- [ ] **Step 2: Install dependencies**

```bash
npm install express axios form-data dotenv @prisma/client
npm install -D typescript tsx prisma vitest supertest nock @types/node @types/express @types/supertest
```

- [ ] **Step 3: Write `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "CommonJS",
    "moduleResolution": "node",
    "lib": ["ES2022"],
    "outDir": "dist",
    "rootDir": ".",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true
  },
  "include": ["src", "scripts", "tests"]
}
```

- [ ] **Step 4: Write `.gitignore`**

```
node_modules
dist
.env
*.log
```

- [ ] **Step 5: Write `docker-compose.yml`**

```yaml
services:
  postgres:
    image: postgres:16-alpine
    restart: unless-stopped
    environment:
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: postgres
      POSTGRES_DB: qiscus_agent_allocation
    ports:
      - "5432:5432"
    volumes:
      - qiscus_agent_allocation_pgdata:/var/lib/postgresql/data
volumes:
  qiscus_agent_allocation_pgdata:
```

- [ ] **Step 6: Write `.env.example`**

```
PORT=3000
QISCUS_BASE_URL=https://multichannel.qiscus.com
QISCUS_APP_ID=xxitg-980tjis6em26fxr
QISCUS_SECRET_KEY=
QISCUS_ADMIN_EMAIL=
QISCUS_ADMIN_PASSWORD=
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/qiscus_agent_allocation
MAX_CONCURRENT_DEFAULT=2
RECONCILIATION_INTERVAL_MS=20000
```

- [ ] **Step 7: Write `.env.test`**

```
PORT=3001
QISCUS_BASE_URL=https://multichannel.qiscus.com
QISCUS_APP_ID=test-app-id
QISCUS_SECRET_KEY=test-secret-key
QISCUS_ADMIN_EMAIL=admin@example.com
QISCUS_ADMIN_PASSWORD=secret
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/qiscus_agent_allocation_test
MAX_CONCURRENT_DEFAULT=2
RECONCILIATION_INTERVAL_MS=20000
```

- [ ] **Step 8: Start local Postgres and create the test database**

```bash
docker compose up -d
docker compose exec postgres createdb -U postgres qiscus_agent_allocation_test
```

- [ ] **Step 9: Write `vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    setupFiles: ['./tests/setup.ts'],
    hookTimeout: 20000,
    testTimeout: 20000,
  },
});
```

- [ ] **Step 10: Write `tests/setup.ts`**

```ts
import path from 'node:path';
import dotenv from 'dotenv';
import nock from 'nock';
import { afterEach } from 'vitest';

dotenv.config({ path: path.resolve(__dirname, '../.env.test'), override: true });

afterEach(() => {
  nock.cleanAll();
});
```

- [ ] **Step 11: Write the failing test for the app factory**

```ts
// tests/health.test.ts
import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app';

describe('GET /health', () => {
  it('returns 200 ok', async () => {
    const app = createApp();
    const response = await request(app).get('/health');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'ok' });
  });
});
```

- [ ] **Step 12: Run test to verify it fails**

Run: `npx vitest run tests/health.test.ts`
Expected: FAIL — `src/app.ts` does not exist yet.

- [ ] **Step 13: Write `src/app.ts` and `src/server.ts`**

```ts
// src/app.ts
import express from 'express';

export function createApp() {
  const app = express();
  app.use(express.json());

  app.get('/health', (_req, res) => {
    res.status(200).json({ status: 'ok' });
  });

  return app;
}
```

```ts
// src/server.ts
import { createApp } from './app';

const port = Number(process.env.PORT ?? 3000);
const app = createApp();

app.listen(port, () => {
  console.log(`qiscus-custom-agent-allocation listening on port ${port}`);
});
```

- [ ] **Step 14: Run test to verify it passes**

Run: `npx vitest run tests/health.test.ts`
Expected: PASS

- [ ] **Step 15: Add npm scripts to `package.json`**

```json
{
  "scripts": {
    "dev": "tsx watch src/server.ts",
    "start": "tsx src/server.ts",
    "test": "vitest run",
    "prisma:generate": "prisma generate",
    "prisma:migrate": "prisma migrate dev",
    "setup:webhook": "tsx scripts/setup-mark-as-resolved-webhook.ts"
  }
}
```

- [ ] **Step 16: Commit**

```bash
git add package.json package-lock.json tsconfig.json .gitignore .env.example .env.test docker-compose.yml vitest.config.ts tests/setup.ts tests/health.test.ts src/app.ts src/server.ts
git commit -m "chore: scaffold project with express health check"
```

---

### Task 2: Prisma schema and database client

**Files:**
- Create: `prisma/schema.prisma`
- Create: `src/db/prisma.ts`
- Test: `tests/db.prisma.test.ts`

**Interfaces:**
- Produces: `prisma` (PrismaClient instance) from `src/db/prisma.ts`; Prisma models `Agent { id, qiscusAgentId, name, email, maxConcurrent }` and `Assignment { id, roomId, customerIdentifier, agentId, status: 'waiting'|'assigned'|'resolved', createdAt, assignedAt, resolvedAt }`.

- [ ] **Step 1: Write `prisma/schema.prisma`**

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model Agent {
  id            Int          @id @default(autoincrement())
  qiscusAgentId Int          @unique @map("qiscus_agent_id")
  name          String
  email         String
  maxConcurrent Int          @default(2) @map("max_concurrent")
  createdAt     DateTime     @default(now()) @map("created_at")
  updatedAt     DateTime     @updatedAt @map("updated_at")
  assignments   Assignment[]

  @@map("agents")
}

enum AssignmentStatus {
  waiting
  assigned
  resolved
}

model Assignment {
  id                 Int              @id @default(autoincrement())
  roomId             String           @map("room_id")
  customerIdentifier String           @map("customer_identifier")
  agentId            Int?             @map("agent_id")
  agent              Agent?           @relation(fields: [agentId], references: [id])
  status             AssignmentStatus @default(waiting)
  createdAt          DateTime         @default(now()) @map("created_at")
  assignedAt         DateTime?        @map("assigned_at")
  resolvedAt         DateTime?        @map("resolved_at")

  @@index([status, createdAt])
  @@index([roomId])
  @@map("assignments")
}
```

- [ ] **Step 2: Generate Prisma client and run the first migration against the dev database**

```bash
npx prisma migrate dev --name init
```

Expected: creates `prisma/migrations/<timestamp>_init/`, applies it to `qiscus_agent_allocation`, and generates the client into `node_modules/@prisma/client`.

- [ ] **Step 3: Apply the same migration to the test database**

```bash
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/qiscus_agent_allocation_test" npx prisma migrate deploy
```

- [ ] **Step 4: Write `src/db/prisma.ts`**

```ts
import { PrismaClient } from '@prisma/client';

export const prisma = new PrismaClient();
```

- [ ] **Step 5: Write the test**

```ts
// tests/db.prisma.test.ts
import { afterAll, describe, expect, it } from 'vitest';
import { prisma } from '../src/db/prisma';

describe('prisma client', () => {
  afterAll(async () => {
    await prisma.assignment.deleteMany();
    await prisma.agent.deleteMany();
    await prisma.$disconnect();
  });

  it('creates and reads an agent with an assignment', async () => {
    const agent = await prisma.agent.create({
      data: { qiscusAgentId: 1, name: 'Dewi', email: 'dewi@mail.com', maxConcurrent: 2 },
    });

    const assignment = await prisma.assignment.create({
      data: {
        roomId: 'room-1',
        customerIdentifier: 'customer@mail.com',
        agentId: agent.id,
        status: 'assigned',
        assignedAt: new Date(),
      },
    });

    const found = await prisma.assignment.findUnique({
      where: { id: assignment.id },
      include: { agent: true },
    });

    expect(found?.status).toBe('assigned');
    expect(found?.agent?.qiscusAgentId).toBe(1);
  });
});
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npx vitest run tests/db.prisma.test.ts`
Expected: PASS (requires `docker compose up -d` running and migrations applied from Steps 2–3)

- [ ] **Step 7: Commit**

```bash
git add prisma src/db tests/db.prisma.test.ts
git commit -m "feat: add prisma schema for agents and assignments"
```

---

### Task 3: Environment config loader

**Files:**
- Create: `src/config/env.ts`
- Test: `tests/env.test.ts`

**Interfaces:**
- Produces: `loadEnv(source: NodeJS.ProcessEnv): AppEnv`, `env: AppEnv` (singleton loaded from `process.env`). `AppEnv` fields: `port, qiscusBaseUrl, qiscusAppId, qiscusSecretKey, qiscusAdminEmail, qiscusAdminPassword, maxConcurrentDefault, reconciliationIntervalMs`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/env.test.ts
import { describe, expect, it } from 'vitest';
import { loadEnv } from '../src/config/env';

describe('loadEnv', () => {
  it('parses required and optional values with defaults', () => {
    const result = loadEnv({
      QISCUS_APP_ID: 'app-1',
      QISCUS_SECRET_KEY: 'secret-1',
    } as NodeJS.ProcessEnv);

    expect(result.qiscusAppId).toBe('app-1');
    expect(result.qiscusSecretKey).toBe('secret-1');
    expect(result.qiscusBaseUrl).toBe('https://multichannel.qiscus.com');
    expect(result.maxConcurrentDefault).toBe(2);
    expect(result.reconciliationIntervalMs).toBe(20000);
    expect(result.port).toBe(3000);
  });

  it('throws when QISCUS_APP_ID is missing', () => {
    expect(() =>
      loadEnv({ QISCUS_SECRET_KEY: 'secret-1' } as NodeJS.ProcessEnv),
    ).toThrow('Missing required environment variable: QISCUS_APP_ID');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/env.test.ts`
Expected: FAIL — `src/config/env.ts` does not exist yet.

- [ ] **Step 3: Write `src/config/env.ts`**

```ts
import dotenv from 'dotenv';

dotenv.config();

export interface AppEnv {
  port: number;
  qiscusBaseUrl: string;
  qiscusAppId: string;
  qiscusSecretKey: string;
  qiscusAdminEmail: string;
  qiscusAdminPassword: string;
  maxConcurrentDefault: number;
  reconciliationIntervalMs: number;
}

export function loadEnv(source: NodeJS.ProcessEnv): AppEnv {
  const required = (name: string): string => {
    const value = source[name];
    if (!value) {
      throw new Error(`Missing required environment variable: ${name}`);
    }
    return value;
  };

  return {
    port: Number(source.PORT ?? 3000),
    qiscusBaseUrl: source.QISCUS_BASE_URL ?? 'https://multichannel.qiscus.com',
    qiscusAppId: required('QISCUS_APP_ID'),
    qiscusSecretKey: required('QISCUS_SECRET_KEY'),
    qiscusAdminEmail: source.QISCUS_ADMIN_EMAIL ?? '',
    qiscusAdminPassword: source.QISCUS_ADMIN_PASSWORD ?? '',
    maxConcurrentDefault: Number(source.MAX_CONCURRENT_DEFAULT ?? 2),
    reconciliationIntervalMs: Number(source.RECONCILIATION_INTERVAL_MS ?? 20000),
  };
}

export const env = loadEnv(process.env);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/env.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/config tests/env.test.ts
git commit -m "feat: add env config loader with validation"
```

---

### Task 4: Qiscus API client

**Files:**
- Create: `src/qiscus/types.ts`
- Create: `src/qiscus/client.ts`
- Test: `tests/qiscus.client.test.ts`

**Interfaces:**
- Consumes: `env` from `src/config/env.ts`.
- Produces: `getAvailableAgents(roomId: string): Promise<AvailableAgent[]>`, `assignAgent(roomId: string, agentId: number): Promise<AssignAgentResponse>`, `loginAdmin(email: string, password: string): Promise<string>`, `setMarkAsResolvedWebhook(adminToken: string, webhookUrl: string, isEnabled: boolean): Promise<void>`. Types: `CandidateAgent`, `CustomAgentAllocationWebhookPayload`, `AvailableAgent`, `AssignAgentResponse`, `MarkAsResolvedWebhookPayload`.

- [ ] **Step 1: Write `src/qiscus/types.ts`**

```ts
export interface CandidateAgent {
  id: number;
  name: string;
  email: string;
  is_available: boolean;
  type: number;
  type_as_string: string;
  assigned_rules: string[];
}

export interface CustomAgentAllocationWebhookPayload {
  app_id: string;
  source: string;
  name: string;
  email: string;
  avatar_url: string;
  extras: string | null;
  is_resolved: boolean;
  room_id: string;
  candidate_agent: CandidateAgent;
}

export interface AvailableAgent {
  id: number;
  name: string;
  email: string;
  type: number;
  type_as_string: string;
  is_available: boolean;
  is_verified: boolean;
  current_customer_count: number;
  assigned_rules: string[];
}

export interface AssignAgentResponse {
  data: {
    added_agent: {
      id: number;
      name: string;
      email: string;
      is_available: boolean;
    };
  };
}

export interface MarkAsResolvedWebhookPayload {
  service: {
    id: number;
    room_id: string;
    is_resolved: boolean;
    notes: string | null;
    first_comment_id: string;
    last_comment_id: number;
    source: string;
  };
  resolved_by: {
    id: number;
    email: string;
    name: string;
    type: string;
    is_available: boolean;
  };
  customer: {
    user_id: string;
  };
}
```

- [ ] **Step 2: Write the failing test**

```ts
// tests/qiscus.client.test.ts
import { describe, expect, it } from 'vitest';
import nock from 'nock';
import { env } from '../src/config/env';
import {
  assignAgent,
  getAvailableAgents,
  loginAdmin,
  setMarkAsResolvedWebhook,
} from '../src/qiscus/client';

describe('qiscus client', () => {
  it('fetches available agents for a room', async () => {
    nock(env.qiscusBaseUrl)
      .get('/api/v2/admin/service/available_agents')
      .query({ room_id: 'room-1' })
      .reply(200, {
        data: [
          {
            id: 1,
            name: 'Dewi',
            email: 'dewi@mail.com',
            type: 2,
            type_as_string: 'agent',
            is_available: true,
            is_verified: true,
            current_customer_count: 1,
            assigned_rules: ['qiscus_messaging'],
          },
        ],
      });

    const agents = await getAvailableAgents('room-1');

    expect(agents).toHaveLength(1);
    expect(agents[0].is_available).toBe(true);
  });

  it('assigns an agent to a room', async () => {
    nock(env.qiscusBaseUrl)
      .post('/api/v1/admin/service/assign_agent', 'room_id=room-1&agent_id=1')
      .reply(200, {
        data: { added_agent: { id: 1, name: 'Dewi', email: 'dewi@mail.com', is_available: true } },
      });

    const result = await assignAgent('room-1', 1);

    expect(result.data.added_agent.id).toBe(1);
  });

  it('logs in as admin and returns the authentication token', async () => {
    nock(env.qiscusBaseUrl)
      .post('/api/v1/auth')
      .reply(200, { data: { user: { authentication_token: 'token-123' } } });

    const token = await loginAdmin('admin@example.com', 'secret');

    expect(token).toBe('token-123');
  });

  it('registers the mark as resolved webhook', async () => {
    nock(env.qiscusBaseUrl)
      .post('/api/v1/app/webhook/mark_as_resolved')
      .reply(200, { data: { id: 1 } });

    await expect(
      setMarkAsResolvedWebhook('token-123', 'https://example.com/webhooks/mark-as-resolved', true),
    ).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run tests/qiscus.client.test.ts`
Expected: FAIL — `src/qiscus/client.ts` does not exist yet.

- [ ] **Step 4: Write `src/qiscus/client.ts`**

```ts
import axios from 'axios';
import FormData from 'form-data';
import { env } from '../config/env';
import type { AssignAgentResponse, AvailableAgent } from './types';

function adminServiceHeaders() {
  return {
    'Qiscus-App-Id': env.qiscusAppId,
    'Qiscus-Secret-Key': env.qiscusSecretKey,
  };
}

export async function getAvailableAgents(roomId: string): Promise<AvailableAgent[]> {
  const response = await axios.get(`${env.qiscusBaseUrl}/api/v2/admin/service/available_agents`, {
    headers: adminServiceHeaders(),
    params: { room_id: roomId },
  });
  return response.data.data as AvailableAgent[];
}

export async function assignAgent(roomId: string, agentId: number): Promise<AssignAgentResponse> {
  const response = await axios.post(
    `${env.qiscusBaseUrl}/api/v1/admin/service/assign_agent`,
    new URLSearchParams({ room_id: roomId, agent_id: String(agentId) }),
    { headers: adminServiceHeaders() },
  );
  return response.data as AssignAgentResponse;
}

export async function loginAdmin(email: string, password: string): Promise<string> {
  const form = new FormData();
  form.append('email', email);
  form.append('password', password);

  const response = await axios.post(`${env.qiscusBaseUrl}/api/v1/auth`, form, {
    headers: form.getHeaders(),
  });
  return response.data.data.user.authentication_token as string;
}

export async function setMarkAsResolvedWebhook(
  adminToken: string,
  webhookUrl: string,
  isEnabled: boolean,
): Promise<void> {
  const form = new FormData();
  form.append('webhook_url', webhookUrl);
  form.append('is_webhook_enabled', String(isEnabled));

  await axios.post(`${env.qiscusBaseUrl}/api/v1/app/webhook/mark_as_resolved`, form, {
    headers: {
      ...form.getHeaders(),
      Authorization: adminToken,
      'Qiscus-App-Id': env.qiscusAppId,
    },
  });
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/qiscus.client.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/qiscus tests/qiscus.client.test.ts
git commit -m "feat: add qiscus api client for allocation and webhook setup"
```

---

### Task 5: Local agent upsert

**Files:**
- Create: `src/allocation/agents.ts`
- Test: `tests/allocation.agents.test.ts`

**Interfaces:**
- Consumes: `prisma` from `src/db/prisma.ts`, `env` from `src/config/env.ts`, `AvailableAgent` from `src/qiscus/types.ts`.
- Produces: `getOrCreateLocalAgent(qiscusAgent: Pick<AvailableAgent, 'id' | 'name' | 'email'>): Promise<Agent>` (Prisma `Agent`).

- [ ] **Step 1: Write the failing test**

```ts
// tests/allocation.agents.test.ts
import { afterAll, describe, expect, it } from 'vitest';
import { prisma } from '../src/db/prisma';
import { getOrCreateLocalAgent } from '../src/allocation/agents';

describe('getOrCreateLocalAgent', () => {
  afterAll(async () => {
    await prisma.agent.deleteMany();
    await prisma.$disconnect();
  });

  it('creates a new local agent on first sight with the default quota', async () => {
    const agent = await getOrCreateLocalAgent({ id: 501, name: 'Budi', email: 'budi@mail.com' });

    expect(agent.qiscusAgentId).toBe(501);
    expect(agent.maxConcurrent).toBe(2);
  });

  it('reuses the existing local agent and updates its name on repeat sightings', async () => {
    await getOrCreateLocalAgent({ id: 502, name: 'Citra', email: 'citra@mail.com' });
    const updated = await getOrCreateLocalAgent({ id: 502, name: 'Citra Renamed', email: 'citra@mail.com' });

    const all = await prisma.agent.findMany({ where: { qiscusAgentId: 502 } });

    expect(all).toHaveLength(1);
    expect(updated.name).toBe('Citra Renamed');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/allocation.agents.test.ts`
Expected: FAIL — `src/allocation/agents.ts` does not exist yet.

- [ ] **Step 3: Write `src/allocation/agents.ts`**

```ts
import type { Agent } from '@prisma/client';
import { prisma } from '../db/prisma';
import { env } from '../config/env';
import type { AvailableAgent } from '../qiscus/types';

export async function getOrCreateLocalAgent(
  qiscusAgent: Pick<AvailableAgent, 'id' | 'name' | 'email'>,
): Promise<Agent> {
  return prisma.agent.upsert({
    where: { qiscusAgentId: qiscusAgent.id },
    update: { name: qiscusAgent.name, email: qiscusAgent.email },
    create: {
      qiscusAgentId: qiscusAgent.id,
      name: qiscusAgent.name,
      email: qiscusAgent.email,
      maxConcurrent: env.maxConcurrentDefault,
    },
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/allocation.agents.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/allocation/agents.ts tests/allocation.agents.test.ts
git commit -m "feat: upsert local agent record with default quota on first sighting"
```

---

### Task 6: Core allocation logic (FIFO + quota + online filter)

**Files:**
- Create: `src/allocation/allocate.ts`
- Test: `tests/allocation.allocate.test.ts`

**Interfaces:**
- Consumes: `prisma`, `getAvailableAgents`, `assignAgent`, `getOrCreateLocalAgent`.
- Produces: `tryAssign(roomId: string, customerIdentifier: string): Promise<Assignment>` (creates the queue row if needed, assigns if a slot is free), `tryAssignWaiting(assignment: Assignment): Promise<Assignment>` (assigns an existing waiting row if a slot is free — used by reconciliation).

- [ ] **Step 1: Write the failing test**

```ts
// tests/allocation.allocate.test.ts
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import nock from 'nock';
import { env } from '../src/config/env';
import { prisma } from '../src/db/prisma';
import { tryAssign } from '../src/allocation/allocate';

describe('tryAssign', () => {
  afterEach(async () => {
    await prisma.assignment.deleteMany();
    await prisma.agent.deleteMany();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('assigns the least busy online agent under quota', async () => {
    nock(env.qiscusBaseUrl)
      .get('/api/v2/admin/service/available_agents')
      .query({ room_id: 'room-1' })
      .reply(200, {
        data: [
          { id: 10, name: 'Agent Busy', email: 'busy@mail.com', type: 2, type_as_string: 'agent', is_available: true, is_verified: true, current_customer_count: 1, assigned_rules: [] },
          { id: 11, name: 'Agent Free', email: 'free@mail.com', type: 2, type_as_string: 'agent', is_available: true, is_verified: true, current_customer_count: 0, assigned_rules: [] },
        ],
      });

    nock(env.qiscusBaseUrl)
      .post('/api/v1/admin/service/assign_agent', 'room_id=room-1&agent_id=11')
      .reply(200, { data: { added_agent: { id: 11, name: 'Agent Free', email: 'free@mail.com', is_available: true } } });

    const result = await tryAssign('room-1', 'customer@mail.com');

    expect(result.status).toBe('assigned');
    const agent = await prisma.agent.findUnique({ where: { qiscusAgentId: 11 } });
    expect(result.agentId).toBe(agent?.id);
  });

  it('ignores offline and over-quota agents, leaving the assignment waiting', async () => {
    nock(env.qiscusBaseUrl)
      .get('/api/v2/admin/service/available_agents')
      .query({ room_id: 'room-2' })
      .reply(200, {
        data: [
          { id: 20, name: 'Agent Offline', email: 'offline@mail.com', type: 2, type_as_string: 'agent', is_available: false, is_verified: true, current_customer_count: 0, assigned_rules: [] },
          { id: 21, name: 'Agent Full', email: 'full@mail.com', type: 2, type_as_string: 'agent', is_available: true, is_verified: true, current_customer_count: 2, assigned_rules: [] },
        ],
      });

    await prisma.agent.create({ data: { qiscusAgentId: 21, name: 'Agent Full', email: 'full@mail.com', maxConcurrent: 2 } });

    const result = await tryAssign('room-2', 'customer2@mail.com');

    expect(result.status).toBe('waiting');
    expect(result.agentId).toBeNull();
  });

  it('does not call the assign API again for a room that is already assigned', async () => {
    const scope = nock(env.qiscusBaseUrl)
      .get('/api/v2/admin/service/available_agents')
      .query({ room_id: 'room-3' })
      .reply(200, {
        data: [{ id: 30, name: 'Agent A', email: 'a@mail.com', type: 2, type_as_string: 'agent', is_available: true, is_verified: true, current_customer_count: 0, assigned_rules: [] }],
      });

    nock(env.qiscusBaseUrl)
      .post('/api/v1/admin/service/assign_agent', 'room_id=room-3&agent_id=30')
      .reply(200, { data: { added_agent: { id: 30, name: 'Agent A', email: 'a@mail.com', is_available: true } } });

    await tryAssign('room-3', 'customer3@mail.com');
    const second = await tryAssign('room-3', 'customer3@mail.com');

    expect(second.status).toBe('assigned');
    expect(scope.isDone()).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/allocation.allocate.test.ts`
Expected: FAIL — `src/allocation/allocate.ts` does not exist yet.

- [ ] **Step 3: Write `src/allocation/allocate.ts`**

```ts
import type { Assignment } from '@prisma/client';
import { prisma } from '../db/prisma';
import { assignAgent, getAvailableAgents } from '../qiscus/client';
import { getOrCreateLocalAgent } from './agents';
import type { AvailableAgent } from '../qiscus/types';

async function pickAgent(roomId: string): Promise<AvailableAgent | null> {
  const candidates = await getAvailableAgents(roomId);
  const online = candidates.filter((agent) => agent.is_available);

  let best: AvailableAgent | null = null;

  for (const agent of online) {
    const local = await getOrCreateLocalAgent(agent);
    if (agent.current_customer_count >= local.maxConcurrent) {
      continue;
    }
    if (!best || agent.current_customer_count < best.current_customer_count) {
      best = agent;
    }
  }

  return best;
}

async function commitAssignment(assignment: Assignment, chosen: AvailableAgent): Promise<Assignment> {
  const localAgent = await getOrCreateLocalAgent(chosen);
  await assignAgent(assignment.roomId, chosen.id);

  return prisma.assignment.update({
    where: { id: assignment.id },
    data: { agentId: localAgent.id, status: 'assigned', assignedAt: new Date() },
  });
}

export async function tryAssign(roomId: string, customerIdentifier: string): Promise<Assignment> {
  let assignment = await prisma.assignment.findFirst({
    where: { roomId, status: { in: ['waiting', 'assigned'] } },
  });

  if (!assignment) {
    assignment = await prisma.assignment.create({
      data: { roomId, customerIdentifier, status: 'waiting' },
    });
  }

  if (assignment.status === 'assigned') {
    return assignment;
  }

  const chosen = await pickAgent(roomId);
  if (!chosen) {
    return assignment;
  }

  return commitAssignment(assignment, chosen);
}

export async function tryAssignWaiting(assignment: Assignment): Promise<Assignment> {
  const chosen = await pickAgent(assignment.roomId);
  if (!chosen) {
    return assignment;
  }

  return commitAssignment(assignment, chosen);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/allocation.allocate.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/allocation/allocate.ts tests/allocation.allocate.test.ts
git commit -m "feat: implement fifo quota-aware agent allocation"
```

---

### Task 7: Reconciliation loop

**Files:**
- Create: `src/allocation/reconcile.ts`
- Test: `tests/allocation.reconcile.test.ts`

**Interfaces:**
- Consumes: `prisma`, `tryAssignWaiting` from `src/allocation/allocate.ts`.
- Produces: `reconcileWaitingAssignments(): Promise<number>` (returns count of assignments newly assigned this run).

- [ ] **Step 1: Write the failing test**

```ts
// tests/allocation.reconcile.test.ts
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import nock from 'nock';
import { env } from '../src/config/env';
import { prisma } from '../src/db/prisma';
import { reconcileWaitingAssignments } from '../src/allocation/reconcile';

describe('reconcileWaitingAssignments', () => {
  afterEach(async () => {
    await prisma.assignment.deleteMany();
    await prisma.agent.deleteMany();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('makes no Qiscus API calls when there is nothing waiting', async () => {
    nock.disableNetConnect();

    const assignedCount = await reconcileWaitingAssignments();

    expect(assignedCount).toBe(0);
    nock.enableNetConnect();
  });

  it('assigns the oldest waiting room first when a slot frees up', async () => {
    const older = await prisma.assignment.create({
      data: {
        roomId: 'room-older',
        customerIdentifier: 'old@mail.com',
        status: 'waiting',
        createdAt: new Date('2026-01-01T00:00:00Z'),
      },
    });
    await prisma.assignment.create({
      data: {
        roomId: 'room-newer',
        customerIdentifier: 'new@mail.com',
        status: 'waiting',
        createdAt: new Date('2026-01-01T00:01:00Z'),
      },
    });

    nock(env.qiscusBaseUrl)
      .get('/api/v2/admin/service/available_agents')
      .query({ room_id: 'room-older' })
      .reply(200, {
        data: [{ id: 40, name: 'Agent A', email: 'a@mail.com', type: 2, type_as_string: 'agent', is_available: true, is_verified: true, current_customer_count: 0, assigned_rules: [] }],
      });
    nock(env.qiscusBaseUrl)
      .post('/api/v1/admin/service/assign_agent', 'room_id=room-older&agent_id=40')
      .reply(200, { data: { added_agent: { id: 40, name: 'Agent A', email: 'a@mail.com', is_available: true } } });

    nock(env.qiscusBaseUrl)
      .get('/api/v2/admin/service/available_agents')
      .query({ room_id: 'room-newer' })
      .reply(200, { data: [] });

    const assignedCount = await reconcileWaitingAssignments();

    expect(assignedCount).toBe(1);
    const olderResult = await prisma.assignment.findUnique({ where: { id: older.id } });
    expect(olderResult?.status).toBe('assigned');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/allocation.reconcile.test.ts`
Expected: FAIL — `src/allocation/reconcile.ts` does not exist yet.

- [ ] **Step 3: Write `src/allocation/reconcile.ts`**

```ts
import { prisma } from '../db/prisma';
import { tryAssignWaiting } from './allocate';

export async function reconcileWaitingAssignments(): Promise<number> {
  const waiting = await prisma.assignment.findMany({
    where: { status: 'waiting' },
    orderBy: { createdAt: 'asc' },
  });

  let assignedCount = 0;
  for (const assignment of waiting) {
    const result = await tryAssignWaiting(assignment);
    if (result.status === 'assigned') {
      assignedCount += 1;
    }
  }

  return assignedCount;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/allocation.reconcile.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/allocation/reconcile.ts tests/allocation.reconcile.test.ts
git commit -m "feat: add fifo reconciliation for waiting assignments"
```

---

### Task 8: Custom Agent Allocation webhook

**Files:**
- Create: `src/webhooks/customAgentAllocation.ts`
- Modify: `src/app.ts` — mount the route
- Test: `tests/webhooks.customAgentAllocation.test.ts`

**Interfaces:**
- Consumes: `tryAssign` from `src/allocation/allocate.ts`, `CustomAgentAllocationWebhookPayload` from `src/qiscus/types.ts`.
- Produces: Express handler `handleCustomAgentAllocation(req, res)`, mounted at `POST /webhooks/custom-agent-allocation`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/webhooks.customAgentAllocation.test.ts
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import nock from 'nock';
import { env } from '../src/config/env';
import { prisma } from '../src/db/prisma';
import { createApp } from '../src/app';

const app = createApp();

describe('POST /webhooks/custom-agent-allocation', () => {
  afterEach(async () => {
    await prisma.assignment.deleteMany();
    await prisma.agent.deleteMany();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('assigns an online agent under quota to a new customer', async () => {
    nock(env.qiscusBaseUrl)
      .get('/api/v2/admin/service/available_agents')
      .query({ room_id: '1905692' })
      .reply(200, {
        data: [{ id: 22, name: 'dewi', email: 'dewi@mail.com', type: 2, type_as_string: 'agent', is_available: true, is_verified: false, current_customer_count: 0, assigned_rules: ['qiscus_messaging'] }],
      });
    nock(env.qiscusBaseUrl)
      .post('/api/v1/admin/service/assign_agent', 'room_id=1905692&agent_id=22')
      .reply(200, { data: { added_agent: { id: 22, name: 'dewi', email: 'dewi@mail.com', is_available: true } } });

    const response = await request(app)
      .post('/webhooks/custom-agent-allocation')
      .send({
        app_id: 'oni-bgo2lummmhvzqxbt5',
        source: 'qiscus',
        name: 'sudah',
        email: 'sudah@gmail.com',
        avatar_url: 'https://example.com/avatar.png',
        extras: '{"timezone_offset":7}',
        is_resolved: false,
        room_id: '1905692',
        candidate_agent: {
          id: 22,
          name: 'dewi',
          email: 'dewi@mail.com',
          is_available: true,
          type: 2,
          type_as_string: 'agent',
          assigned_rules: ['qiscus_messaging'],
        },
      });

    expect(response.status).toBe(200);
    const assignment = await prisma.assignment.findFirst({ where: { roomId: '1905692' } });
    expect(assignment?.status).toBe('assigned');
  });

  it('rejects a payload missing room_id', async () => {
    const response = await request(app).post('/webhooks/custom-agent-allocation').send({ email: 'x@mail.com' });

    expect(response.status).toBe(400);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/webhooks.customAgentAllocation.test.ts`
Expected: FAIL — route not mounted yet.

- [ ] **Step 3: Write `src/webhooks/customAgentAllocation.ts`**

```ts
import type { Request, Response } from 'express';
import { tryAssign } from '../allocation/allocate';
import type { CustomAgentAllocationWebhookPayload } from '../qiscus/types';

export async function handleCustomAgentAllocation(req: Request, res: Response): Promise<void> {
  const payload = req.body as CustomAgentAllocationWebhookPayload;

  if (!payload.room_id || !payload.email) {
    res.status(400).json({ error: 'room_id and email are required' });
    return;
  }

  await tryAssign(payload.room_id, payload.email);
  res.status(200).json({ status: 'ok' });
}
```

- [ ] **Step 4: Mount the route in `src/app.ts`**

```ts
import express from 'express';
import { handleCustomAgentAllocation } from './webhooks/customAgentAllocation';

export function createApp() {
  const app = express();
  app.use(express.json());

  app.get('/health', (_req, res) => {
    res.status(200).json({ status: 'ok' });
  });

  app.post('/webhooks/custom-agent-allocation', handleCustomAgentAllocation);

  return app;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/webhooks.customAgentAllocation.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/webhooks/customAgentAllocation.ts src/app.ts tests/webhooks.customAgentAllocation.test.ts
git commit -m "feat: add custom agent allocation webhook endpoint"
```

---

### Task 9: Mark As Resolved webhook

**Files:**
- Create: `src/webhooks/markAsResolved.ts`
- Modify: `src/app.ts` — mount the route
- Test: `tests/webhooks.markAsResolved.test.ts`

**Interfaces:**
- Consumes: `prisma`, `reconcileWaitingAssignments` from `src/allocation/reconcile.ts`, `MarkAsResolvedWebhookPayload` from `src/qiscus/types.ts`.
- Produces: Express handler `handleMarkAsResolved(req, res)`, mounted at `POST /webhooks/mark-as-resolved`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/webhooks.markAsResolved.test.ts
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { prisma } from '../src/db/prisma';
import { createApp } from '../src/app';

const app = createApp();

describe('POST /webhooks/mark-as-resolved', () => {
  afterEach(async () => {
    await prisma.assignment.deleteMany();
    await prisma.agent.deleteMany();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('marks the matching assigned room as resolved', async () => {
    const agent = await prisma.agent.create({ data: { qiscusAgentId: 99, name: 'Dewi', email: 'dewi@mail.com', maxConcurrent: 2 } });
    await prisma.assignment.create({
      data: { roomId: '1961380', customerIdentifier: 'auliaollegh@gmail.com', agentId: agent.id, status: 'assigned', assignedAt: new Date() },
    });

    const response = await request(app)
      .post('/webhooks/mark-as-resolved')
      .send({
        service: { id: 237788, room_id: '1961380', is_resolved: true, notes: null, first_comment_id: '15828799', last_comment_id: 15828825, source: 'qiscus' },
        resolved_by: { id: 1576, email: 'admin@qiscus.com', name: 'Dewi Corp', type: 'admin', is_available: true },
        customer: { user_id: 'auliaollegh@gmail.com' },
      });

    expect(response.status).toBe(200);
    const resolved = await prisma.assignment.findFirst({ where: { roomId: '1961380' } });
    expect(resolved?.status).toBe('resolved');
    expect(resolved?.resolvedAt).not.toBeNull();
  });

  it('rejects a payload missing service.room_id', async () => {
    const response = await request(app).post('/webhooks/mark-as-resolved').send({ service: {} });

    expect(response.status).toBe(400);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/webhooks.markAsResolved.test.ts`
Expected: FAIL — route not mounted yet.

- [ ] **Step 3: Write `src/webhooks/markAsResolved.ts`**

```ts
import type { Request, Response } from 'express';
import { prisma } from '../db/prisma';
import { reconcileWaitingAssignments } from '../allocation/reconcile';
import type { MarkAsResolvedWebhookPayload } from '../qiscus/types';

export async function handleMarkAsResolved(req: Request, res: Response): Promise<void> {
  const payload = req.body as MarkAsResolvedWebhookPayload;
  const roomId = payload.service?.room_id;

  if (!roomId) {
    res.status(400).json({ error: 'service.room_id is required' });
    return;
  }

  await prisma.assignment.updateMany({
    where: { roomId, status: 'assigned' },
    data: { status: 'resolved', resolvedAt: new Date() },
  });

  await reconcileWaitingAssignments();
  res.status(200).json({ status: 'ok' });
}
```

- [ ] **Step 4: Mount the route in `src/app.ts`**

```ts
import express from 'express';
import { handleCustomAgentAllocation } from './webhooks/customAgentAllocation';
import { handleMarkAsResolved } from './webhooks/markAsResolved';

export function createApp() {
  const app = express();
  app.use(express.json());

  app.get('/health', (_req, res) => {
    res.status(200).json({ status: 'ok' });
  });

  app.post('/webhooks/custom-agent-allocation', handleCustomAgentAllocation);
  app.post('/webhooks/mark-as-resolved', handleMarkAsResolved);

  return app;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/webhooks.markAsResolved.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/webhooks/markAsResolved.ts src/app.ts tests/webhooks.markAsResolved.test.ts
git commit -m "feat: add mark as resolved webhook endpoint"
```

---

### Task 10: Wire the reconciliation interval into the server

**Files:**
- Modify: `src/server.ts`

**Interfaces:**
- Consumes: `env`, `createApp`, `reconcileWaitingAssignments`.

- [ ] **Step 1: Update `src/server.ts`**

```ts
import { createApp } from './app';
import { env } from './config/env';
import { reconcileWaitingAssignments } from './allocation/reconcile';

const app = createApp();

app.listen(env.port, () => {
  console.log(`qiscus-custom-agent-allocation listening on port ${env.port}`);
});

setInterval(() => {
  reconcileWaitingAssignments().catch((error) => {
    console.error('reconciliation failed', error);
  });
}, env.reconciliationIntervalMs);
```

- [ ] **Step 2: Manually verify the server boots**

Run: `npm run dev`
Expected: Console prints `qiscus-custom-agent-allocation listening on port 3000` and no uncaught errors after the first reconciliation tick.

- [ ] **Step 3: Commit**

```bash
git add src/server.ts
git commit -m "feat: run reconciliation on an interval in the server process"
```

---

### Task 11: Mark As Resolved webhook registration script

**Files:**
- Create: `scripts/setup-mark-as-resolved-webhook.ts`
- Test: `tests/setup-mark-as-resolved-webhook.test.ts`

**Interfaces:**
- Consumes: `env`, `loginAdmin`, `setMarkAsResolvedWebhook` from `src/qiscus/client.ts`.
- Produces: `registerMarkAsResolvedWebhook(webhookUrl: string): Promise<void>`; a CLI entrypoint that calls it with `process.argv[2]`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/setup-mark-as-resolved-webhook.test.ts
import { describe, expect, it } from 'vitest';
import nock from 'nock';
import { env } from '../src/config/env';
import { registerMarkAsResolvedWebhook } from '../scripts/setup-mark-as-resolved-webhook';

describe('registerMarkAsResolvedWebhook', () => {
  it('logs in as admin then registers the webhook url', async () => {
    nock(env.qiscusBaseUrl)
      .post('/api/v1/auth')
      .reply(200, { data: { user: { authentication_token: 'token-abc' } } });

    const registerScope = nock(env.qiscusBaseUrl)
      .post('/api/v1/app/webhook/mark_as_resolved')
      .reply(200, { data: { id: 1 } });

    await registerMarkAsResolvedWebhook('https://example.com/webhooks/mark-as-resolved');

    expect(registerScope.isDone()).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/setup-mark-as-resolved-webhook.test.ts`
Expected: FAIL — `scripts/setup-mark-as-resolved-webhook.ts` does not exist yet.

- [ ] **Step 3: Write `scripts/setup-mark-as-resolved-webhook.ts`**

```ts
import { env } from '../src/config/env';
import { loginAdmin, setMarkAsResolvedWebhook } from '../src/qiscus/client';

export async function registerMarkAsResolvedWebhook(webhookUrl: string): Promise<void> {
  if (!env.qiscusAdminEmail || !env.qiscusAdminPassword) {
    throw new Error('QISCUS_ADMIN_EMAIL and QISCUS_ADMIN_PASSWORD must be set to run this script');
  }

  const token = await loginAdmin(env.qiscusAdminEmail, env.qiscusAdminPassword);
  await setMarkAsResolvedWebhook(token, webhookUrl, true);
}

if (require.main === module) {
  const webhookUrl = process.argv[2];
  if (!webhookUrl) {
    console.error('Usage: npm run setup:webhook -- <https://your-deployed-url>/webhooks/mark-as-resolved');
    process.exit(1);
  }

  registerMarkAsResolvedWebhook(webhookUrl)
    .then(() => console.log(`Mark As Resolved webhook registered: ${webhookUrl}`))
    .catch((error) => {
      console.error('Failed to register webhook', error);
      process.exit(1);
    });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/setup-mark-as-resolved-webhook.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add scripts/setup-mark-as-resolved-webhook.ts tests/setup-mark-as-resolved-webhook.test.ts
git commit -m "feat: add script to register mark as resolved webhook via api"
```

---

### Task 12: Deployment (Dockerfile) and README

**Files:**
- Create: `Dockerfile`
- Create: `README.md`

**Interfaces:**
- None (infra/docs only).

- [ ] **Step 1: Write `Dockerfile`**

```dockerfile
FROM node:22-alpine

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npx prisma generate

EXPOSE 3000

CMD ["sh", "-c", "npx prisma migrate deploy && npx tsx src/server.ts"]
```

- [ ] **Step 2: Write `README.md`**

```markdown
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
5. `npx prisma migrate dev --name init`
6. `DATABASE_URL="postgresql://postgres:postgres@localhost:5432/qiscus_agent_allocation_test" npx prisma migrate deploy`
7. `npm test`
8. `npm run dev` — serves on `http://localhost:3000`

## Deploying

1. Push this repo to GitHub, connect it to a new Railway project (Railway auto-detects the `Dockerfile`).
2. Add a Postgres plugin in Railway and set `DATABASE_URL` to its connection string.
3. Set the remaining env vars from `.env.example` in Railway's variables tab.
4. Deploy. Note the public URL Railway assigns.
5. In the Qiscus dashboard, go to **Settings > Custom Agent Allocation**, switch the toggle on, paste `https://<your-railway-url>/webhooks/custom-agent-allocation` into the Webhook URL field, and click Save.
6. Register the Mark As Resolved webhook via the API (required by the test spec, not the dashboard):
   ```bash
   npm run setup:webhook -- https://<your-railway-url>/webhooks/mark-as-resolved
   ```

## How it works

- `POST /webhooks/custom-agent-allocation` — Qiscus calls this when a new customer has no agent yet. The service queries `GET /api/v2/admin/service/available_agents?room_id=...` for online agents under quota, assigns the least busy one via `POST /api/v1/admin/service/assign_agent`, or leaves the customer `waiting` if none are free.
- `POST /webhooks/mark-as-resolved` — Qiscus calls this when a chat is resolved. The service marks the local assignment `resolved` and immediately tries to pull the next `waiting` customer in FIFO order.
- A background interval (`RECONCILIATION_INTERVAL_MS`, default 20s) re-checks any `waiting` customers in case an agent came online outside of a resolve event. It skips entirely (no API calls) when the queue is empty.
```

- [ ] **Step 3: Commit**

```bash
git add Dockerfile README.md
git commit -m "docs: add dockerfile and readme with setup and deployment steps"
```

---

## Self-Review Notes

- **Spec coverage:** PDF requirement #2 (configurable quota) → Task 2 (`maxConcurrent`) + Task 6 (`pickAgent` quota filter). #3 (FIFO) → Task 6/7 (`createdAt` ordering). #4 (online-only) → Task 6 (`is_available` filter). #7 (register mark-as-resolved via API) → Task 11. Deliverables (app_id, live service, webhook wired, GitHub repo) → Task 12 README + Task 1 `git init`.
- **Placeholder scan:** every step has runnable code; no "TBD"/"similar to Task N" left in.
- **Type consistency:** `Assignment`/`Agent` Prisma types flow from Task 2 through Tasks 5–9 unchanged; `AvailableAgent` from Task 4 is the exact shape `pickAgent` (Task 6) and `getOrCreateLocalAgent` (Task 5) consume.
