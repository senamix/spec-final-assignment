# Tasks: Laptop Inventory Management System

**Input**: Design documents from `/specs/001-laptop-inventory-management/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md), [data-model.md](./data-model.md), [contracts/](./contracts/), [quickstart.md](./quickstart.md)

**Tests**: REQUIRED. The constitution makes TDD non-negotiable (Principle II). In every phase, write the tests first, run them, and see them fail for the intended reason before writing implementation code. Library (`inventory-core`) work comes before the web layer in each story (Principle I).

## Format: `- [ ] [ID] [P?] [Story?] Description with file path`

- **[P]**: can run in parallel (different files, no dependency on an unfinished task)
- **[Story]**: the user story the task belongs to (US1 to US5)
- Paths are relative to the repository root

## Phase 1: Setup

- [x] T001 Create root `package.json` with npm workspaces `packages/*` and `apps/*`, plus a `test` script that runs both workspaces
- [x] T002 [P] Create `tsconfig.base.json` (strict mode, ES2023 target, NodeNext modules)
- [x] T003 [P] Create `packages/inventory-core/package.json`, `tsconfig.json` and `vitest.config.ts` (no runtime dependencies; dev-only `typescript` and `vitest`)
- [x] T004 [P] Create `apps/web/package.json`, `tsconfig.json` and `vitest.config.ts` (depends on workspace `inventory-core`; scripts `start` and `test`; no runtime dependencies)
- [x] T005 Run `npm install` at the root and confirm `npm test` runs (with no tests yet) in both workspaces

---

## Phase 2: Foundational (blocks all user stories)

**Purpose**: shared types, validation, account rules, and the web skeleton with sign-in. Sign-in comes first because FR-018 requires a session for every inventory route.

### Tests first (write them, then see them fail)

- [x] T006 [P] Write unit tests for the `Result` helpers (`ok`, `err`, `map`, `chain`) in `packages/inventory-core/tests/unit/result.test.ts`
- [x] T007 [P] Write unit tests for field validation in `packages/inventory-core/tests/unit/validation.test.ts`: brand and model "Required, 1 to 100 characters, trimmed"; serialNumber "Required, 1 to 100 characters, trimmed; unique across laptops ignoring case"; purchaseDate "Required; must not be in the future"; each spec field "an optional string of at most 100 characters"; personName "Required, 1 to 100 characters, trimmed"
- [x] T008 [P] Write unit tests for accounts in `packages/inventory-core/tests/unit/accounts.test.ts`: `createAccount` (username "Required, 3 to 50 characters, unique ignoring case"; displayName "Required, 1 to 100 characters"; password never stored in plain text, using an injected fake hasher), `verifyCredentials`, `hasAccounts`
- [x] T009 [P] Write unit tests for password hashing, session tokens (8-hour expiry) and per-username login rate limiting in `apps/web/tests/unit/auth.test.ts`
- [x] T010 [P] Write unit tests for the file store in `apps/web/tests/unit/store.test.ts`: atomic write (temp file then rename), reload after restart, writes serialized through one queue so two simultaneous updates cannot lose data
- [x] T011 Create the test helper `apps/web/tests/helpers/testApp.ts` that starts the server on a random port with a temporary data file and returns an authenticated session cookie (depends on T006 to T010 being written)
- [x] T012 [P] Write HTTP contract tests for setup and authentication in `apps/web/tests/contract/auth.test.ts` per [contracts/http-api.md](./contracts/http-api.md): `GET /api/setup`; `POST /api/setup` returns 201 with a session, then 409 once any account exists; `POST /api/login`, `/api/logout` and `GET /api/me`; cookie is `HttpOnly` and `SameSite=Strict`; write requests without `application/json` are rejected; repeated failed logins return 429; any laptop route without a session returns 401; no response contains a password hash

### Implementation

- [x] T013 Implement `packages/inventory-core/src/types.ts` (Laptop, Assignment, ChangeRecord, Account, State, `Ctx`, status union and domain error types per [data-model.md](./data-model.md)) and `emptyState()`
- [x] T014 [P] Implement `packages/inventory-core/src/result.ts` to pass T006
- [x] T015 Implement `packages/inventory-core/src/validation.ts` to pass T007 (pure functions; the caller passes `now` for the future-date check)
- [x] T016 Implement `packages/inventory-core/src/accounts.ts` (`createAccount`, `verifyCredentials`, `hasAccounts`) to pass T008
- [x] T017 Create `packages/inventory-core/src/index.ts` exporting the public API from [contracts/core-library.md](./contracts/core-library.md)
- [x] T018 [P] Implement `apps/web/src/auth.ts` (scrypt hasher with random salt and timing-safe compare, session store, rate limiter) to pass T009
- [x] T019 [P] Implement `apps/web/src/store.ts` (atomic JSON persistence and a serialized write queue) to pass T010
- [x] T020 Implement `apps/web/src/server.ts` skeleton: router, JSON body parsing with content-type enforcement, domain-error to HTTP status mapping, session middleware, static file serving, and the setup, login, logout and me routes, to pass T012
- [x] T021 Create `apps/web/src/public/index.html`, `app.js` and `styles.css` with the page shell, first-run setup form and sign-in form

**Checkpoint**: library and web foundation tests pass; a manager can complete setup and sign in.

---

## Phase 3: User Story 1 - Register and view laptops (Priority: P1) MVP

**Goal**: record laptops and view the list and a laptop's details.

**Independent Test**: add several laptops, view the list, and open one. A duplicate serial number and a missing required detail are both rejected.

### Tests first

- [x] T022 [P] [US1] Write unit tests for `addLaptop`, `getLaptop` and an unfiltered `listLaptops` in `packages/inventory-core/tests/unit/laptops.test.ts`: starts `Available`; duplicate serial number rejected ignoring case and surrounding spaces; missing required field named in the error; future purchase date rejected; over-length text rejected; a `Created` change record naming the acting manager; input state never modified
- [x] T023 [P] [US1] Write HTTP contract tests for `POST /api/laptops`, `GET /api/laptops` and `GET /api/laptops/{id}` (201, 400, 409, 404; empty list returns `[]`) in `apps/web/tests/contract/laptops-read.test.ts`
- [x] T024 [P] [US1] Write an integration test of the US1 scenarios, including persistence across a server restart (FR-015), in `apps/web/tests/integration/us1-register-view.test.ts`

### Implementation

- [x] T025 [US1] Implement `addLaptop` and `getLaptop` (with `currentHolder`) in `packages/inventory-core/src/laptops.ts`
- [x] T026 [US1] Implement unfiltered `listLaptops`, sorted by brand, model and serial number, in `packages/inventory-core/src/query.ts`
- [x] T027 [US1] Export the new functions from `packages/inventory-core/src/index.ts`
- [x] T028 [US1] Add the `POST /api/laptops`, `GET /api/laptops` and `GET /api/laptops/{id}` routes in `apps/web/src/server.ts`, persisting through the store
- [x] T029 [US1] Add the laptop list, add-laptop form and details view (with specs, status and change history) in `apps/web/src/public/app.js` and `index.html`, with an empty state and clear error messages

**Checkpoint**: User Story 1 works on its own and is the MVP.

---

## Phase 4: User Story 5 - Sign in and manage manager accounts (Priority: P2)

**Goal**: managers create further accounts, and every change is attributed to the signed-in manager.

**Independent Test**: starting from a fresh system, complete setup, create a second manager, sign in as them, edit a laptop, and confirm the change history names them. A signed-out visitor is refused.

### Tests first

- [x] T030 [P] [US5] Write HTTP contract tests for `POST /api/accounts` (201 without a hash; 400; 409 duplicate username ignoring case; 401 when signed out) in `apps/web/tests/contract/accounts.test.ts`
- [x] T031 [P] [US5] Write an integration test of the US5 scenarios in `apps/web/tests/integration/us5-accounts.test.ts`, including that no self-registration route exists and that a laptop edit by the second manager records their name

### Implementation

- [x] T032 [US5] Add the `POST /api/accounts` route in `apps/web/src/server.ts`; the new account has the same permissions as every other manager (FR-020)
- [x] T033 [US5] Add the "add manager" screen and a sign-out control in `apps/web/src/public/app.js` and `index.html`; the sign-in page offers no registration option

**Checkpoint**: Stories 1 and 5 both work independently.

---

## Phase 5: User Story 2 - Update and retire laptops (Priority: P2)

**Goal**: correct details, change status, retire permanently, and delete mistaken records.

**Independent Test**: edit a laptop, move it to In Repair and back, retire another laptop (no further changes allowed), delete a never-assigned laptop.

### Tests first

- [x] T034 [P] [US2] Write unit tests for `editLaptop`, `changeStatus` and `deleteLaptop` in `packages/inventory-core/tests/unit/laptops-update.test.ts`: every row of the status-transition table in [data-model.md](./data-model.md); Retired is permanent; Assigned laptops cannot change status; edit keeps serial uniqueness; delete is refused when assignment history exists; delete erases the laptop and its history and frees the serial number
- [x] T035 [P] [US2] Write HTTP contract tests for `PATCH /api/laptops/{id}`, `POST /api/laptops/{id}/status` and `DELETE /api/laptops/{id}` in `apps/web/tests/contract/laptops-write.test.ts`
- [x] T036 [P] [US2] Write an integration test of the US2 scenarios in `apps/web/tests/integration/us2-update-retire.test.ts`

### Implementation

- [x] T037 [US2] Implement `editLaptop`, `changeStatus` and `deleteLaptop` in `packages/inventory-core/src/laptops.ts`, appending `Edited` and `StatusChanged` change records
- [x] T038 [US2] Export the new functions from `packages/inventory-core/src/index.ts`
- [x] T039 [US2] Add the `PATCH`, `status` and `DELETE` routes in `apps/web/src/server.ts`
- [x] T040 [US2] Add edit, change-status (with retire confirmation) and delete controls in `apps/web/src/public/app.js`, showing the refusal reasons

---

## Phase 6: User Story 3 - Assign and return laptops (Priority: P2)

**Goal**: know who holds each laptop and keep the history of who has held it.

**Independent Test**: assign an available laptop, confirm the holder, try a second assignment (refused), return it, and see the history.

### Tests first

- [x] T041 [P] [US3] Write unit tests for `assignLaptop` and `returnLaptop` in `packages/inventory-core/tests/unit/assignments.test.ts`: only `Available` laptops can be assigned (In Repair and Retired are refused with a reason); one open assignment at most; return restores `Available` and keeps history; `Assigned` and `Returned` change records; person name validation
- [x] T042 [P] [US3] Write HTTP contract tests for `POST /api/laptops/{id}/assign` and `/return` in `apps/web/tests/contract/assignments.test.ts`
- [x] T043 [P] [US3] Write an integration test of the US3 scenarios, including two simultaneous assign requests where exactly one succeeds, in `apps/web/tests/integration/us3-assign-return.test.ts`

### Implementation

- [x] T044 [US3] Implement `assignLaptop` and `returnLaptop` in `packages/inventory-core/src/assignments.ts`
- [x] T045 [US3] Export them from `packages/inventory-core/src/index.ts`
- [x] T046 [US3] Add the `assign` and `return` routes in `apps/web/src/server.ts`, run through the serialized write queue
- [x] T047 [US3] Add assign and return controls and the assignment history list in `apps/web/src/public/app.js`

---

## Phase 7: User Story 4 - Search, filter, and review inventory (Priority: P3)

**Goal**: find laptops quickly and see counts per status.

**Independent Test**: with a mixed inventory, search by brand, filter by status, and confirm the counts sum to the total.

### Tests first

- [x] T048 [P] [US4] Write unit tests for `listLaptops` filtering and `statusCounts` in `packages/inventory-core/tests/unit/query.test.ts`: case-insensitive text match over brand, model, serial number and current holder; status filter; combined filters; no matches returns an empty list; counts sum to `total`
- [x] T049 [P] [US4] Write HTTP contract tests for `GET /api/laptops?q=&status=` and `GET /api/summary` in `apps/web/tests/contract/search-summary.test.ts`
- [x] T050 [P] [US4] Write an integration test of the US4 scenarios in `apps/web/tests/integration/us4-search-summary.test.ts`

### Implementation

- [x] T051 [US4] Extend `listLaptops` with `text` and `status` filters and add `statusCounts` in `packages/inventory-core/src/query.ts`, then export from `packages/inventory-core/src/index.ts`
- [x] T052 [US4] Add query parameters to `GET /api/laptops` and add `GET /api/summary` in `apps/web/src/server.ts`
- [x] T053 [US4] Add the search box, status filter, "no laptops found" message and the status summary in `apps/web/src/public/app.js` and `index.html`

---

## Phase 8: Polish and cross-cutting

- [x] T054 [P] Add a contract test that notification-style paths (for example `/api/alerts`, `/api/notifications`) return 404, and a test that the repository source contains no email or notification dependencies, in `apps/web/tests/contract/no-alerts.test.ts` (FR-016, SC-007)
- [x] T055 [P] Add a performance test that searches a 1,000-laptop state in well under 1 second in `packages/inventory-core/tests/unit/performance.test.ts` (SC-003)
- [x] T056 [P] Add a property-style test that status counts always sum to the total and that every laptop with an open assignment is `Assigned` in `packages/inventory-core/tests/unit/invariants.test.ts` (SC-005)
- [x] T057 Run the full suite with `npm test` at the root and fix any failures
- [x] T058 Walk through every step of [quickstart.md](./quickstart.md) against the running app and record the result
- [x] T059 Review the final code against the constitution (library-first, test-first evidence, pure functions, no extra dependencies) and against FR-016

---

## Dependencies and Execution Order

- **Phase 1** has no dependencies. **Phase 2** depends on Phase 1 and blocks every user story.
- **US1** (Phase 3) depends on Phase 2 only. It is the MVP.
- **US5** (Phase 4) depends on Phase 2. **US2, US3 and US4** depend on Phase 2 and on `addLaptop` from US1 for their tests, but not on each other.
- **Phase 8** depends on all the stories you intend to ship.
- Within a story: tests, then library implementation, then routes, then UI. Tests must be failing before the implementation begins.
- Tasks that edit the same file (`server.ts`, `app.js`, `laptops.ts`, `query.ts`, `index.ts`) are not marked [P] and must run in order.

## Parallel Opportunities

- Setup: T002, T003 and T004 together.
- Foundational tests: T006 to T010 and T012 together; T014, T018 and T019 together.
- Within each story, all test tasks (marked [P]) together.
- After Phase 2 and T025, US2, US3, US4 and US5 can proceed in parallel by different people, with the shared-file ordering above.

## Implementation Strategy

1. **MVP**: Phases 1 to 3. This gives signed-in managers a working inventory with add and view.
2. **Increment**: add US5 (more managers), then US2 and US3 (the day-to-day operations), then US4 (search).
3. Validate each story at its checkpoint with its integration test before starting the next.
4. Finish with Phase 8 and the quickstart walkthrough.
