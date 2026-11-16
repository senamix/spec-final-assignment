# Tasks: Low Inventory Alerts

**Input**: Design documents from `/specs/002-low-stock-alerts/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md), [data-model.md](./data-model.md), [contracts/](./contracts/), [quickstart.md](./quickstart.md)

**Tests**: REQUIRED. The constitution makes TDD non-negotiable (Principle II). In every phase, write the tests first, run them, and see them fail for the intended reason before writing implementation code. Library (`inventory-core`) work comes before the web layer in each story (Principle I).

## Format: `- [ ] [ID] [P?] [Story?] Description with file path`

- **[P]**: can run in parallel (different files, no dependency on an unfinished task)
- **[Story]**: the user story the task belongs to (US1 to US3)
- Paths are relative to the repository root

## Phase 1: Setup

- [x] T001 Add `nodemailer` (runtime) and `@types/nodemailer` (dev) to `apps/web/package.json` and run `npm install` at the root; confirm `packages/inventory-core/package.json` still has no runtime dependencies
- [x] T002 [P] Create `packages/inventory-core/src/alerts.ts` as an empty module exporting nothing yet, and re-export it from `packages/inventory-core/src/index.ts` (lets tests import the new API path)

---

## Phase 2: Foundational (blocks all user stories)

**Purpose**: extend state and accounts with the new fields, and clear away the old "no alerts" assertions. Accounts need an email before any alert can be addressed (FR-004b).

### Tests first (write them, then see them fail)

- [x] T003 [P] Write unit tests in `packages/inventory-core/tests/unit/email.test.ts` for the email rule: "Required when creating an account; trimmed, at most 254 characters, one `@`, non-empty local part, domain containing a dot"
- [x] T004 [P] Write unit tests in `packages/inventory-core/tests/unit/email.test.ts` for `createAccount` rejecting a missing or invalid `email` with `ValidationError` on field `email`, and for `setEmail(state, accountId, email)`: valid change, invalid address, unknown account gives `NotFound`
- [x] T005 [P] Write unit tests in `apps/web/tests/unit/store.test.ts` that loading an older data file (no `alerts`, `settings`, `lowPeriodActive`) yields `alerts` `{}`, `settings` `{ lowLevel: 5, updatedBy: null, updatedAt: null }`, and `lowPeriodActive` `false`
- [x] T006 [P] Write HTTP contract tests in `apps/web/tests/contract/email.test.ts` for the changed routes in [contracts/http-api.md](./contracts/http-api.md): `POST /api/setup` and `POST /api/accounts` require `email` (400 `ValidationError` on `email`); `GET /api/me` returns `email` (null for a legacy account); `PUT /api/me/email` changes only the caller's own address, 400 for an invalid one, 401 without a session

### Implementation

- [x] T007 Extend `packages/inventory-core/src/types.ts` per [data-model.md](./data-model.md): `Account.email?`; `Settings`; `Alert` (`id`, `raisedAt`, `availableCount`, `level`, `readBy`, `deliveries`); `Delivery` (`accountId`, `email` string or null, `status` `pending | sent | failed | skipped`, `attempts` "0 to 4", `nextAttemptAt`, `lastError`); `State` gains `alerts`, `settings`, `lowPeriodActive`; update `emptyState()` with defaults (`lowLevel` 5, `lowPeriodActive` false)
- [x] T008 Add the email rule to `packages/inventory-core/src/validation.ts` and use it in `createAccount`; add `setEmail` in `packages/inventory-core/src/accounts.ts` and export it from `packages/inventory-core/src/index.ts` (makes T003 and T004 pass)
- [x] T009 Update `apps/web/src/store.ts` `load` to fill the new state defaults when absent (makes T005 pass)
- [x] T010 Update `apps/web/src/server.ts`: `POST /api/setup` and `POST /api/accounts` take required `email`; `GET /api/me` returns `email`; add `PUT /api/me/email`; add an email field to the setup and account forms in `apps/web/src/public/index.html` and `apps/web/src/public/app.js` (makes T006 pass)
- [x] T011 Fix existing tests and helpers that call `createAccount` or the setup route without an email: `packages/inventory-core/tests/helpers.ts`, `apps/web/tests/helpers/testApp.ts`, and any affected tests under `packages/inventory-core/tests/` and `apps/web/tests/`; run both workspaces and confirm all previously passing tests pass again
- [x] T012 Delete `apps/web/tests/contract/no-alerts.test.ts` (its assertions contradict this feature, research R8) and update `specs/001-laptop-inventory-management/spec.md` (FR-016, SC-007 and the alerts-excluded assumption) and its `plan.md`, `contracts/http-api.md` to state that alerts are now provided by feature 002

**Checkpoint**: accounts carry emails, state has alert defaults, all tests green.

---

## Phase 3: User Story 1 - Be alerted when available laptops run low (Priority: P1) 🎯 MVP

**Goal**: one in-app alert plus emails (with retries) whenever available laptops fall to or below the level.

**Independent Test**: with level 3 and 4 available laptops, assign one: every manager gets exactly one alert (count 3, level 3) and an email attempt; assign another: no second alert; recover above the level then drop again: a new alert.

### Tests first

- [x] T013 [P] [US1] Write unit tests in `packages/inventory-core/tests/unit/alerts.test.ts` for `availableCount` and `evaluateLowInventory` covering every US1 scenario and edge case in [spec.md](./spec.md): alert at count equal to the level; none above; no duplicate within one low period; new alert after recovery; count 0 still alerts once; multi-step drop gives one alert; evaluating twice with no change gives one alert; deliveries are one per account, `pending` with `nextAttemptAt` equal to now, or `skipped` (with `lastError` reason) when the account has no email; `lowPeriodActive` cleared on recovery
- [x] T014 [P] [US1] Write unit tests in `packages/inventory-core/tests/unit/alerts.test.ts` for `nextDueDeliveries` and `recordDeliveryResult` per the retry schedule in [data-model.md](./data-model.md): success gives `sent`; failures stay `pending` with `nextAttemptAt` +1, +5, +15 minutes after the 1st, 2nd, 3rd failure; the 4th failure gives `failed` with `lastError`; `attempts` never exceeds 4
- [x] T015 [P] [US1] Write a contract test in `packages/inventory-core/tests/contract/alerts-api.test.ts` that the exports in [contracts/core-library.md](./contracts/core-library.md) exist with the documented signatures and are pure (inputs are not mutated)
- [x] T016 [P] [US1] Write unit tests in `apps/web/tests/unit/delivery.test.ts` for the retry runner using a fake `Mailer` and fake clock: sends due pending deliveries, records success and failure through the store, never throws when the mailer throws, resumes pending deliveries after a simulated restart, and does not re-send `sent` deliveries
- [x] T017 [P] [US1] Write unit tests in `apps/web/tests/unit/mailer.test.ts` for the outbox-file adapter (appends one message with to, subject, and body per send) and for subject and body content: subject `Low laptop inventory: {availableCount} available`, body states time, available count, level, and nothing else sensitive
- [x] T018 [US1] Write the integration test `apps/web/tests/integration/us6-low-inventory-alerts.test.ts` for US1 through the HTTP API with a fake mailer: assign down to the level gives one alert and one email per manager with an address; the inventory change succeeds even when the mailer fails (FR-009); add, return, retire, status change to `InRepair`, and delete each re-evaluate (FR-002); a legacy account without an email gets a skipped delivery

### Implementation

- [x] T019 [US1] Implement `availableCount` and `evaluateLowInventory` in `packages/inventory-core/src/alerts.ts` as pure functions (makes T013 pass)
- [x] T020 [US1] Implement `nextDueDeliveries` and `recordDeliveryResult` in `packages/inventory-core/src/alerts.ts` and export the API from `packages/inventory-core/src/index.ts` (makes T014 and T015 pass)
- [x] T021 [P] [US1] Create `apps/web/src/mailer.ts`: `Mailer` interface (`send({ to, subject, text })`), a `nodemailer` adapter configured from `SMTP_URL` and `MAIL_FROM`, an outbox-file adapter used when `SMTP_URL` is unset, and the alert email subject and body builder (makes T017 pass)
- [x] T022 [US1] Create `apps/web/src/delivery.ts`: a runner that, on startup, on a timer, and right after an alert is raised, takes `nextDueDeliveries`, sends through the `Mailer`, and persists each outcome with `recordDeliveryResult` via `store.update`; errors are caught and recorded, never thrown (makes T016 pass)
- [x] T023 [US1] Update `apps/web/src/server.ts` so every laptop mutation route (add, edit if it can change status, status, assign, return, delete) calls `evaluateLowInventory` inside the same `store.update` as the change, and triggers the delivery runner when an alert was raised; wire the runner and mailer in `apps/web/src/main.ts` with the clock and `Mailer` injectable for tests (makes T018 pass)

**Checkpoint**: US1 is shippable on its own: alerts are created and emailed with retries.

---

## Phase 4: User Story 2 - See and acknowledge alerts in the web page (Priority: P2)

**Goal**: managers see alert history with unread state and can mark alerts read.

**Independent Test**: trigger an alert, sign in, see it unread, mark it read, confirm it is read for that manager only and still in history.

### Tests first

- [x] T024 [P] [US2] Write unit tests in `packages/inventory-core/tests/unit/alerts.test.ts` for `listAlerts` (newest first, `read` per account), `unreadCount`, and `markAlertRead` (idempotent, adds the account id once, unknown id gives `NotFound`, other managers stay unread)
- [x] T025 [P] [US2] Write HTTP contract tests in `apps/web/tests/contract/alerts.test.ts` for `GET /api/alerts` (`{ unread, alerts[] }` with `emailStatus` for the caller only) and `POST /api/alerts/{id}/read` (204, repeat allowed, 404 unknown) per [contracts/http-api.md](./contracts/http-api.md); all return 401 without a session; no response includes another manager's email address or a password hash
- [x] T026 [US2] Extend `apps/web/tests/integration/us6-low-inventory-alerts.test.ts` with the US2 flow: two managers, one marks read, the other still sees unread

### Implementation

- [x] T027 [US2] Implement `listAlerts`, `unreadCount`, and `markAlertRead` in `packages/inventory-core/src/alerts.ts` and export them (makes T024 pass)
- [x] T028 [US2] Add `GET /api/alerts` and `POST /api/alerts/{id}/read` in `apps/web/src/server.ts` (makes T025 and T026 pass)
- [x] T029 [US2] Build the alert panel in `apps/web/src/public/index.html`, `apps/web/src/public/app.js`, and `apps/web/src/public/styles.css`: unread badge in the header, alert list (time, available count, level, email status), a mark-read button per alert, and a prompt to add an email address when `/api/me` returns `email` null

**Checkpoint**: US1 and US2 work independently of US3 (the default level of 5 is in effect).

---

## Phase 5: User Story 3 - Configure the low-inventory level (Priority: P3)

**Goal**: managers can view and change the level; saving re-evaluates immediately.

**Independent Test**: change the level to 10; with 10 or fewer available laptops an alert is raised immediately; invalid values are rejected with the valid range.

### Tests first

- [x] T030 [P] [US3] Write unit tests in `packages/inventory-core/tests/unit/alerts.test.ts` for `getLowLevel` and `setLowLevel`: level must be "an integer from 0 to 100000"; negative, non-integer, non-numeric, and over-limit values give `ValidationError` on field `level` with a message stating the range; a valid level records `updatedBy` and `updatedAt` and re-evaluates (raising an alert when already low, clearing `lowPeriodActive` when the new level is below the count)
- [x] T031 [P] [US3] Write HTTP contract tests in `apps/web/tests/contract/alerts.test.ts` for `GET` and `PUT /api/settings/low-inventory-level` per [contracts/http-api.md](./contracts/http-api.md): 200 shapes including `alertRaised`, 400 with the range message, 401 without a session
- [x] T032 [US3] Extend `apps/web/tests/integration/us6-low-inventory-alerts.test.ts` with the US3 flow: raise the level above the available count and see an immediate alert and email

### Implementation

- [x] T033 [US3] Implement `getLowLevel` and `setLowLevel` in `packages/inventory-core/src/alerts.ts` and export them (makes T030 pass)
- [x] T034 [US3] Add `GET` and `PUT /api/settings/low-inventory-level` in `apps/web/src/server.ts`, triggering the delivery runner when an alert is raised (makes T031 and T032 pass)
- [x] T035 [US3] Add the level form to the web page in `apps/web/src/public/index.html` and `apps/web/src/public/app.js`, showing the current level and inline validation messages from the API

**Checkpoint**: all three stories work.

---

## Phase 6: Polish & Cross-Cutting

- [x] T036 [P] Add a performance test in `packages/inventory-core/tests/unit/performance.test.ts` that `evaluateLowInventory` over 1,000 laptops completes in well under 100 ms
- [x] T037 [P] Document `SMTP_URL`, `MAIL_FROM`, and the outbox-file fallback in `README` or `specs/002-low-stock-alerts/quickstart.md` if setup steps differ from what is written there
- [x] T038 Run the full test suite (`npm test` at the root) and confirm every test passes
- [x] T039 Walk through the manual scenario in [quickstart.md](./quickstart.md) (steps 1 to 9), including the failing-mailer retry check, and fix any deviation
- [x] T040 Review the change against the constitution: core has no new dependency and no I/O, effects only in `apps/web`, tests were written first, and no unrelated changes

---

## Dependencies and Order

- Phase 1, then Phase 2, then US1. US2 and US3 each depend on Phase 2 and on `alerts.ts` from US1 (T019), but not on each other.
- Within each phase: tests first (red), then implementation (green), core before web.
- T011 must finish before any later web test is trusted, because it repairs the shared helpers.
- T019 and T020 precede T022; T021 and T022 precede T023.

## Parallel Opportunities

- Phase 2 tests T003 to T006 can be written together.
- US1 tests T013 to T017 touch different files (T013 and T014 share one file, so write them in sequence); T021 can run alongside T019 and T020.
- After US1, US2 (T024 to T029) and US3 (T030 to T035) can proceed in parallel by different people; they share `alerts.ts`, `server.ts`, and `app.js`, so merge carefully.

## Implementation Strategy

- **MVP**: Phases 1 to 3 (through T023). Alerts are raised and emailed using the default level of 5.
- Then add US2 (visibility) and US3 (configuration) as independent increments, validating each with its own integration test before moving on.
