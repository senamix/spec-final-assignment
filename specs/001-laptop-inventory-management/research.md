# Research: Laptop Inventory Management System

All Technical Context items were resolved by the decisions below. No `NEEDS CLARIFICATION`
items remain.

## 1. Language and runtime

- **Decision**: TypeScript on Node.js 24.
- **Rationale**: Node 24 is already installed here. One language covers the library, server and
  browser script, and the type system models statuses and `Result` types well, which suits the
  functional style the constitution requires.
- **Alternatives**: Python (no shared language with the browser UI); Go (less convenient for
  functional patterns).

## 2. Dependencies

- **Decision**: Zero runtime dependencies; Node built-ins for HTTP, crypto and file I/O. Dev-only:
  `typescript`, `vitest`.
- **Rationale**: Constitution Principle V (simplicity) and the "simple" scope in the request.
  Fewer dependencies mean a smaller attack surface for an app that holds credentials.
- **Alternatives**: Express or Fastify (convenient, but unnecessary for about 15 routes); a UI
  framework (the UI is a few forms and one table).

## 3. Storage

- **Decision**: One JSON file, loaded at startup, rewritten atomically (temp file, then rename)
  after each successful change. Writes are serialized through a single queue.
- **Rationale**: Meets FR-015 for about 1,000 laptops. It keeps the core pure, because state is a
  plain value. The serialized queue answers the spec's near-simultaneous-assignment edge case: the
  second request sees the laptop as already Assigned and is refused.
- **Alternatives**: SQLite (`node:sqlite` is still experimental in Node 24; a native addon adds
  build complexity); a server database (too heavy for this scope).

## 4. Functional core design

- **Decision**: Every operation has the shape `(state, input, context) => Result<{ state, ... },
  DomainError>`. `context` carries the acting manager, the current time and a generated ID, all
  supplied by the caller. State is immutable, so each operation returns a new state.
- **Rationale**: Constitution Principle III. Time and ID injection makes the core deterministic,
  so tests need no mocks.
- **Alternatives**: A class-based repository with internal mutation (harder to test in isolation).

## 5. Authentication

- **Decision**: Individual accounts with `scrypt` password hashing (`node:crypto`, per-account
  random salt, timing-safe compare). Sessions use random tokens in an `HttpOnly`,
  `SameSite=Strict` cookie. Sessions are held in memory and expire after 8 hours. Login attempts
  are rate-limited per username. The first account is created through a one-time setup endpoint
  that works only while no accounts exist.
- **Rationale**: Satisfies FR-018 to FR-021 with no dependencies and follows standard guidance.
  `SameSite=Strict` plus requiring a JSON content type on writes covers cross-site request
  forgery for this app.
- **Alternatives**: JWT (adds complexity and revocation problems); a third-party identity
  provider (out of scope).

## 6. Change history

- **Decision**: Each laptop carries its own append-only list of change records (what changed,
  manager, time). Deleting a laptop removes its records with it.
- **Rationale**: Matches the clarified decision that deletion erases history, and satisfies
  FR-019 without a separate audit store.

## 7. Search

- **Decision**: In-memory case-insensitive substring match over brand, model, serial number and
  current holder, combined with an optional status filter.
- **Rationale**: Linear scan over 1,000 records is far faster than the 10-second target in SC-003.

## 8. Alerts

- **Decision**: No notification code, dependencies or endpoints exist. A contract test asserts that
  no notification routes exist, and the code review checklist covers it.
- **Rationale**: FR-016 and SC-007.

## 9. Frontend

- **Decision**: One static HTML page with a small vanilla JavaScript script served by the same
  server. It calls the JSON API.
- **Rationale**: Desktop-only, about 5 screens, no build step needed.
- **Alternatives**: React or Vue (needs a build pipeline and dependencies for little benefit).
