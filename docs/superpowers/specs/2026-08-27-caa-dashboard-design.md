# CAA Dashboard — Design Spec

**Date:** 2026-08-27
**Status:** Draft, pending user review

## 1. Purpose

Klien (admin) selama ini gak punya cara mandiri buat lihat kondisi queue/agent atau ubah kuota (`max_concurrent`) — semua perubahan harus minta tim Qiscus jalanin SQL manual (lihat README bagian "Configuring an agent's quota"). Dashboard ini kasih klien akses self-service: monitor kesehatan sistem + ubah config sendiri, tanpa perlu request ke Qiscus.

Bukan pengganti admin panel Qiscus — cuma nutupin celah yang gak ada di sana: konfigurasi `max_concurrent` per agent dan visibility ke internal queue/assignment state (data yang cuma ada di database service ini, `agents`/`assignments`, bukan di sisi Qiscus).

## 2. Scope

**In scope (MVP):**
- Baca kondisi queue & agent (jumlah waiting, load per agent, status online/offline)
- Edit `max_concurrent` per agent dari UI
- Riwayat assignment per room (audit trail)
- Flag kondisi gak normal (room nunggu kelamaan, agent offline yang masih pegang assignment)

**Out of scope (gak didukung backend sekarang, butuh perubahan business logic terpisah kalau mau ditambah nanti):**
- Global allocation mode (1 limit buat semua agent) — schema cuma support per-agent quota
- Assignment rules custom (office hours, toggle online-only) — "online-only" itu fixed rule di `allocate.ts`, bukan setting
- Custom unserved-message text — gak ada field ini di manapun
- Auth penuh (JWT dari iframe Qiscus addon) — di-defer, settingnya ribet di sisi Qiscus, dipakai basic auth sementara

## 3. Architecture

### 3.1 Data layer

Nuxt Nitro server routes (`server/api/*`) import `PrismaClient` yang sama dari `src/db/prisma.ts` (monorepo, satu Postgres, satu schema — bukan database terpisah). Dashboard cuma nyentuh CRUD sederhana (baca `Assignment`, baca/tulis `Agent.maxConcurrent`) — business logic alokasi (FIFO, assign_agent ke Qiscus) tetap murni di Express service, gak diduplikasi.

Alasan milih ini dibanding bikin endpoint admin baru di Express: kerjaan lebih sedikit (gak ada API layer + auth middleware baru buat sekadar CRUD), dan gak ada kebutuhan bisnis yang butuh 1 pintu terpusat buat operasi sesimpel ini.

Konstanta 45-detik offline grace period harus diambil dari satu sumber yang sama dengan `src/allocation/reassignOffline.ts` (di-export jadi shared constant), gak boleh ditulis ulang sebagai magic number di sisi dashboard — biar gak drift kalau salah satu diubah.

### 3.2 Auth

HTTP Basic Auth, 1 shared password (env var baru, misal `DASHBOARD_PASSWORD`). Nitro middleware global di `server/middleware/auth.ts`, jalan buat semua request (page render maupun `/api/*`) — bukan cuma proteksi halaman, API routes juga harus lewat middleware yang sama, kalau enggak `PATCH /api/agents/:id` bisa diakses langsung tanpa lewat browser.

Ini placeholder sampai integrasi JWT-dari-iframe-Qiscus (addon) siap disetup — di luar scope dokumen ini.

### 3.3 Deployment

Nitro API butuh proses Node yang jalan terus (server-side), bukan static hosting — deploy sebagai Web Service terpisah di Render, mirror pola Express service yang sudah ada. Env var yang dibutuhkan: `DATABASE_URL` (sama dengan Express service, Internal Database URL Render), `DASHBOARD_PASSWORD`.

## 4. Pages & Features

### 4.1 `/` — Overview

- Queue snapshot: jumlah room `waiting` sekarang, umur room waiting tertua
- Ringkasan utilization semua agent (donut chart via `nuxt-charts`, gaya "Agent Distribution" — total/used/available)
- Ringkasan status assignment (donut "Room Distribution" — queue/assigned/resolved)
- Alert banner, 2 kondisi:
  - Room `waiting` > threshold (fixed 2 menit untuk MVP, gak configurable dulu)
  - Agent `offlineSince` terisi (dalam grace period) tapi masih ada assignment `assigned` — nunjuk reassign sedang berjalan/pending

### 4.2 `/agents`

- Tabel: avatar inisial, nama + email, `qiscusAgentId`, status online/offline (derived dari `offlineSince` + grace period shared constant), load saat ini (`assigned` count) vs `maxConcurrent`
- Kolom `max_concurrent` inline-editable (input angka), pattern mirip referensi UI "Bucket Agent"
- Validasi di endpoint `PATCH /api/agents/:id`: integer, minimal 1 (gak ada upper bound eksplisit di schema, tapi UI kasih batas wajar mis. 100 mengikuti pola referensi)

### 4.3 `/assignments` — History

- Tabel: Room ID, Agent (nama+id), Status (waiting/assigned/resolved), Created At, Assigned At, Resolved At
- Filter: `room_id`, `agent_id`, `status`, rentang tanggal
- Pagination wajib dari awal (default limit, offset/cursor) — tabel ini nambah terus tiap ada chat baru, gak ada retention policy

## 5. API Endpoints (Nitro)

| Endpoint | Fungsi |
|---|---|
| `GET /api/agents` | List agent + status + load |
| `PATCH /api/agents/:id` | Update `max_concurrent` (validasi integer 1-100) |
| `GET /api/assignments?status=&agentId=&roomId=&from=&to=&page=` | List assignment, paginated |
| `GET /api/queue/summary` | Waiting count, oldest waiting age, alert flags |

Semua endpoint di atas dilindungi middleware Basic Auth (3.2).

## 6. Design System

- `@nuxt/ui` (sudah terpasang) sebagai komponen dasar, `nuxt-charts` untuk donut chart
- Primary color: `#27b198` (tonal scale), dipakai konsisten di button/toggle/badge aktif — mengikuti referensi UI yang dikasih user (case lain, cuma dipakai warnanya)
- Layout pattern: page header (judul + subtitle + tombol aksi kanan atas), card putih border tipis dengan section divider — mengikuti referensi UI

## 7. Known Gaps / Deliberate Simplifications

- Auto-refresh polling di overview & agents (gak ada realtime push di sistem sekarang) — interval belum ditentukan, default disarankan 10-15 detik saat implementasi
- Threshold "room waiting kelamaan" (2 menit) hardcode dulu, bukan configurable — bisa diangkat jadi setting kalau klien minta
- Basic Auth 1 password bukan solusi jangka panjang — upgrade ke JWT iframe pas integrasi addon Qiscus disetup
- Race antara Nuxt (tulis `max_concurrent`) dan Express (baca `max_concurrent` dalam transaksi alokasi) sudah dicek: aman, karena ini scalar column tanpa invariant yang butuh atomicity lintas proses
