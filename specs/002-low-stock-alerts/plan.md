# Implementation Plan: Low Inventory Alerts

**Branch**: `002-low-stock-alerts` | **Date**: 2026-11-16 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/002-low-stock-alerts/spec.md`

## Summary

Add low-inventory alerting on top of the existing laptop inventory system. A pure
`inventory-core` module decides when a low period starts, creates one alert per low period, and
records per-manager delivery and read state. The web app adds the effects: email delivery with
retries, alert and level endpoints, and a small alert panel in the UI. This feature intentionally
replaces feature 001's "no alerts" rule (001 FR-016 and SC-007). See [research.md](./research.md).

## Technical Context

**Language/Version**: TypeScript 5.x on Node.js 24 (LTS), as in 001

**Primary Dependencies**: Core library: none. Web app: adds `nodemailer` as the only new runtime dependency, used behind an injected `Mailer` port. Dev-only: `typescript`, `vitest` (unchanged).

**Storage**: The existing single JSON data file, extended with `alerts`, `settings`, and `lowPeriodActive`; same atomic write. Old files load with defaults.

**Testing**: Vitest (unit, contract, integration), strictly test-first per the constitution. Email is tested with a fake `Mailer` and a fake clock; no real mail is sent in tests.

**Target Platform**: Node.js server; modern desktop browsers

**Project Type**: Library plus web application (existing npm workspaces monorepo)

**Performance Goals**: Alert evaluation is O(laptops) per change and negligible at about 1,000 laptops; alerts visible and first email attempted within 1 minute (SC-001)

**Constraints**: Evaluation runs inside the same serialized state update as the triggering change, so no lost or duplicate alerts; email failure never fails the inventory change; SMTP credentials come from environment variables, never from the data file or source

**Scale/Scope**: Fewer than 20 managers, a handful of alerts per month, one new UI panel

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Gate | Status |
|-----------|------|--------|
| I. Library-First | Low-period detection, alert creation, read state, level validation, and delivery scheduling decisions live in `inventory-core/src/alerts.ts`, testable without the web app | Pass |
| II. TDD (non-negotiable) | Tasks order failing tests before implementation; the existing no-alerts tests are replaced first by tests for the new behavior | Pass (enforced in `/speckit-tasks`) |
| III. Functional Programming | Core functions are pure over immutable state; clock, ids, SMTP, and timers are injected or live in `apps/web` | Pass |
| IV. Contract and Integration Testing | Contract tests for the new core API and HTTP routes; integration tests for the full flow with a fake mailer | Pass |
| V. Simplicity | One new dependency, justified in research (SMTP); no queue server, no scheduler library; retries use an in-process timer over persisted delivery records | Pass |

**Post-design re-check (after Phase 1)**: Pass. The single new dependency is confined to
`apps/web` and hidden behind a port, so the core stays dependency-free. No Complexity Tracking
entries are needed.

## Project Structure

### Documentation (this feature)

```text
specs/002-low-stock-alerts/
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
packages/inventory-core/
├── src/
│   ├── types.ts          # + Alert, Delivery, Settings; Account.email; State additions
│   ├── alerts.ts         # NEW: evaluateLowInventory, setLowLevel, markAlertRead, delivery transitions
│   ├── accounts.ts       # + email validation, setEmail
│   ├── validation.ts     # + email and level rules
│   └── index.ts          # export new API
└── tests/
    ├── unit/alerts.test.ts          # NEW
    └── contract/alerts-api.test.ts  # NEW

apps/web/
├── src/
│   ├── mailer.ts         # NEW: Mailer port, nodemailer adapter, outbox-file adapter for local use
│   ├── delivery.ts       # NEW: retry runner that drains pending deliveries
│   ├── store.ts          # load defaults for new state fields
│   ├── server.ts         # new routes; call evaluateLowInventory inside every inventory update
│   └── public/           # alert panel, unread badge, level and email forms
└── tests/
    ├── contract/alerts.test.ts      # NEW (replaces no-alerts.test.ts)
    └── integration/us6-low-inventory-alerts.test.ts  # NEW
```

**Structure Decision**: Keep the two existing packages. `inventory-core` gains one module and has
no dependency on `apps/web`; all email and timer effects stay in `apps/web`, so the core test
suite still runs without a server.

## Complexity Tracking

No constitution violations to justify.
