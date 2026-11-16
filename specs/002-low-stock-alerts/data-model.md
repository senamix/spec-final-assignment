# Data Model: Low Inventory Alerts

All types are immutable. New or changed items extend `State` from feature 001.

## State (extended)

| Field | Type | Notes |
|-------|------|-------|
| `laptops`, `accounts` | existing | unchanged shape except `Account.email` |
| `alerts` | `Record<id, Alert>` | default `{}` |
| `settings` | `Settings` | default `{ lowLevel: 5, updatedBy: null, updatedAt: null }` |
| `lowPeriodActive` | `boolean` | default `false`; true from the moment an alert is raised until available count exceeds the level |

Loading an older data file fills these defaults.

## Account (changed)

| Field | Type | Rules |
|-------|------|-------|
| `email` | `string \| undefined` | Required when creating an account (FR-004b). Trimmed, at most 254 chars, one `@`, non-empty local part, domain containing a dot. Missing only on accounts that predate this feature. |

## Settings

| Field | Type | Rules |
|-------|------|-------|
| `lowLevel` | integer | 0 to 100000; non-integers and out-of-range values rejected with `ValidationError` on field `level` |
| `updatedBy` | account id or null | |
| `updatedAt` | ISO time or null | |

## Alert

| Field | Type | Notes |
|-------|------|-------|
| `id` | string | |
| `raisedAt` | ISO time | |
| `availableCount` | integer | count of laptops with status `Available` at that moment |
| `level` | integer | level in effect at that moment |
| `readBy` | account id list | per-manager read state (FR-005, FR-006) |
| `deliveries` | `Delivery[]` | one per recipient account, snapshotted when raised |

## Delivery

| Field | Type | Notes |
|-------|------|-------|
| `accountId` | string | recipient |
| `email` | string \| null | address used; null when skipped |
| `status` | `pending \| sent \| failed \| skipped` | |
| `attempts` | integer | 0 to 4 (1 initial plus up to 3 retries) |
| `nextAttemptAt` | ISO time \| null | set while `pending` |
| `lastError` | string \| null | set on failure or skip reason |

## State transitions

- **Alert raising**: `available <= lowLevel` and `lowPeriodActive` is false: create one Alert with deliveries, set `lowPeriodActive` true.
- **Recovery**: `available > lowLevel` and `lowPeriodActive` is true: set `lowPeriodActive` false (no alert).
- **Delivery**: `pending` becomes `sent` on success. On failure with attempts below 4, stay `pending` with `nextAttemptAt` +1, +5, or +15 minutes after the 1st, 2nd, and 3rd failure. A 4th failure becomes `failed`. An account without an email starts as `skipped`.
- **Read**: marking read adds the account id to `readBy` once; idempotent.

## Evaluation triggers

Run after: add laptop, status change (including retire), assign, return, delete, and level change (FR-002). Evaluation counts `Available` laptops only.
