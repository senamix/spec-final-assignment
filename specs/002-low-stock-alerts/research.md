# Research: Low Inventory Alerts

## R1. Where does low-inventory evaluation run?

- **Decision**: A pure `evaluateLowInventory(state, ctx)` in `inventory-core`, called by the web layer inside the same serialized store update as every change that can alter the available count.
- **Rationale**: The state change and the alert commit together or not at all, so there are no missed or duplicate alerts (FR-002, FR-003). The core stays pure.
- **Alternatives**: Evaluate in each laptop function (couples unrelated modules and duplicates the call); a periodic background check (can miss the crossing and delays alerts).

## R2. How is "one alert per low period" tracked?

- **Decision**: Persist a `lowPeriodActive` boolean. Alert when `available <= level` and the flag is false (set it true); clear the flag when `available > level`.
- **Rationale**: Simple, deterministic, and survives restarts. Covers multi-step drops, level changes, and retire or delete cases (FR-003, edge cases).
- **Alternatives**: Compare previous and current counts (breaks when the level changes); derive from the latest alert (ambiguous after the level changes).

## R3. Email delivery mechanism

- **Decision**: Add `nodemailer` to `apps/web` only, behind a `Mailer` port (`send({to, subject, text})`). Configure via `SMTP_URL` and `MAIL_FROM` environment variables. When unset, use an outbox-file adapter that appends messages to a local file, so development and demos work without a mail server.
- **Rationale**: Node has no built-in SMTP client; hand-writing SMTP and TLS is riskier than one well-known dependency. The port keeps the core and tests free of it (constitution V and Engineering Constraints).
- **Alternatives**: Hand-rolled SMTP over `node:net` (security and correctness risk); third-party HTTP mail APIs (vendor lock-in, needs an account).

## R4. Retry policy and persistence

- **Decision**: Each recipient gets a persisted `Delivery` record (`pending`, `sent`, `failed`, `skipped`) with `attempts` and `nextAttemptAt`. First attempt is immediate, then retries after 1, 5, and 15 minutes (3 retries over about 15 minutes). After the last failure the status becomes `failed` with the last error text. A runner in `apps/web` wakes on a timer and on startup and processes due `pending` records.
- **Rationale**: Matches the clarified rule. Persisted records mean retries survive a restart and failures are never lost silently (FR-009).
- **Alternatives**: In-memory retries (lost on restart); external job queue (excessive for the scale).

## R5. Recipients and missing addresses

- **Decision**: Recipients are all accounts at the time the alert is raised, snapshotted into the alert. Accounts without an email get a `skipped` delivery with a reason, and the UI prompts them to add an address.
- **Rationale**: Meets "every manager" and the clarified edge case; the snapshot keeps history stable if accounts change later.

## R6. Email address rules

- **Decision**: Required on account creation and setup; a simple format check (single `@`, non-empty local part and domain with a dot, max 254 characters), no deliverability probing. A manager may change only their own address.
- **Rationale**: Matches the clarification; strict RFC validation adds risk without value.

## R7. Level setting

- **Decision**: One organization-wide `settings.lowLevel`, an integer 0 to 100000 inclusive, default 5, with `updatedBy` and `updatedAt`. Saving a new level re-runs evaluation with the new level.
- **Rationale**: FR-007 and US3 scenario 3. An upper bound prevents absurd input.

## R8. Effect on feature 001

- **Decision**: Replace `apps/web/tests/contract/no-alerts.test.ts` and update 001's FR-016, SC-007, and its "no alerts" notes to point to this feature once implemented.
- **Rationale**: Those assertions directly contradict this feature.
