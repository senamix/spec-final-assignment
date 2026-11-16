# Implementation Plan: Laptop Inventory Management System

**Branch**: `001-laptop-inventory-management` | **Date**: 2026-11-15 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/001-laptop-inventory-management/spec.md`

## Summary

A simple laptop inventory system with sign-in, delivered library-first. A pure, functional
`inventory-core` library holds all business rules (laptops, assignments, status transitions,
search, change history, accounts). A thin web application adds a JSON API, a single-page browser
UI, password sign-in, and file-based persistence. This feature shipped without alerting (FR-016);
low-inventory alerts were later added by feature 002-low-stock-alerts. See [research.md](./research.md) for the decisions behind this approach.

## Technical Context

**Language/Version**: TypeScript 5.x on Node.js 24 (LTS)

**Primary Dependencies**: None at runtime for the core library. The web app uses only Node built-ins (`node:http`, `node:crypto`, `node:fs`). Dev-only: `typescript`, `vitest`.

**Storage**: A single JSON data file, written atomically (write temp file, then rename); the full state is loaded at startup.

**Testing**: Vitest (unit, contract, integration), strictly test-first per the constitution

**Target Platform**: Node.js server; modern desktop browsers for the UI

**Project Type**: Library plus web application (npm workspaces monorepo)

**Performance Goals**: Search over 1,000 laptops returns in well under 1 second (supports SC-003); typical page actions feel instant

**Constraints**: Single process and single organization; writes are serialized to avoid lost updates; no alerting or notifications (until feature 002); passwords never stored in plain text

**Scale/Scope**: About 1,000 laptops, fewer than 20 managers, about 5 screens

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Gate | Status |
|-----------|------|--------|
| I. Library-First | All rules live in `packages/inventory-core`, usable and testable without the web app | Pass |
| II. TDD (non-negotiable) | Tasks order tests before implementation; red run is recorded for each | Pass (enforced in `/speckit-tasks`) |
| III. Functional Programming | Core exposes pure functions over immutable state; I/O, clock, ID generation and password hashing are injected at the edges | Pass |
| IV. Contract and Integration Testing | Contract tests for the library API and HTTP API; integration tests across web app, core and storage | Pass |
| V. Simplicity | No runtime dependencies, no database server, no framework; one JSON file | Pass |

**Post-design re-check (after Phase 1)**: Pass. The design adds no dependencies and keeps all
effects in `apps/web`. No Complexity Tracking entries are needed.

## Project Structure

### Documentation (this feature)

```text
specs/001-laptop-inventory-management/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── core-library.md
│   └── http-api.md
├── checklists/requirements.md
└── tasks.md              # Created later by /speckit-tasks
```

### Source Code (repository root)

```text
package.json                     # npm workspaces
tsconfig.base.json

packages/inventory-core/         # Pure library: no I/O
├── src/
│   ├── types.ts                 # Laptop, Assignment, ChangeRecord, Account, State, errors
│   ├── result.ts                # Result type helpers
│   ├── validation.ts            # Field and serial-number rules
│   ├── laptops.ts               # add, edit, status change, delete
│   ├── assignments.ts           # assign, return
│   ├── query.ts                 # search, filter, status counts
│   ├── accounts.ts              # create account, verify credentials (hashing injected)
│   └── index.ts                 # Public API
└── tests/
    ├── unit/
    └── contract/

apps/web/                        # Effects: HTTP, sessions, persistence, UI
├── src/
│   ├── server.ts                # Routes and request handling
│   ├── store.ts                 # Atomic JSON file persistence, serialized writes
│   ├── auth.ts                  # scrypt hashing, session cookies
│   └── public/                  # index.html, app.js, styles.css
└── tests/
    ├── contract/                # HTTP API contract
    └── integration/             # End-to-end flows per user story
```

**Structure Decision**: Two workspace packages. `inventory-core` has no dependency on
`apps/web`; the dependency points one way only. This keeps the constitution's library-first rule
verifiable: the core test suite runs without starting any server.

## Complexity Tracking

No constitution violations to justify.
