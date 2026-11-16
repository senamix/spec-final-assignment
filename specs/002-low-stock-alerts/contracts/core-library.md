# Contract: Core Library additions

Exported from `inventory-core`. All functions are pure and return `Result<T>` where they can fail; time and ids come from `Ctx`.

| Function | Inputs | Result | Spec |
|----------|--------|--------|------|
| `availableCount(state)` | state | number of laptops with status `Available` | FR-001 |
| `evaluateLowInventory(state, ctx)` | state, `Ctx` | `{ state, alert: Alert \| null }`. Raises at most one alert per low period; clears `lowPeriodActive` on recovery. Deliveries are `pending` (attempt due now) or `skipped` when the account has no email. | FR-001 to FR-004a |
| `setLowLevel(state, level, ctx)` | state, level, `Ctx` | `Result<{ state, alert: Alert \| null }>`; re-evaluates with the new level. `ValidationError` (field `level`) unless an integer from 0 to 100000. | FR-007, FR-008 |
| `getLowLevel(state)` | state | `{ lowLevel, updatedBy, updatedAt }` | FR-007 |
| `listAlerts(state, accountId)` | state, account id | alerts newest first, each with `read: boolean` for that account | FR-005 |
| `unreadCount(state, accountId)` | state, account id | number | FR-005 |
| `markAlertRead(state, alertId, accountId)` | state, alert id, account id | `Result<{ state }>`; `NotFound` for an unknown id; idempotent | FR-006 |
| `nextDueDeliveries(state, now)` | state, ISO time | list of `{ alertId, accountId, email }` that are `pending` and due | FR-009 |
| `recordDeliveryResult(state, alertId, accountId, outcome, { now })` | outcome is `{ ok: true }` or `{ ok: false, error }` | the new `State`; applies the retry schedule from the data model; unknown alerts or non-pending deliveries return the state unchanged | FR-009 |
| `listAlerts(state, accountId)` items | each item includes `emailStatus`: the caller's own delivery status, or null | see `listAlerts` above | FR-005 |
| `setEmail(state, accountId, email)` | state, id, email | `Result<{ state, account }>`; `ValidationError` (field `email`), `NotFound` | FR-004b |

## Changed

- `createAccount` input gains required `email`; a missing or invalid value gives `ValidationError` on `email`.
- `emptyState()` includes the new default fields.
- Existing laptop and assignment functions are unchanged; evaluation is called by the web layer after them, in the same update.

## Guarantees

- Same input always yields the same output; the library never sends email or reads the clock.
- Evaluating twice in a row with no change raises no second alert.
