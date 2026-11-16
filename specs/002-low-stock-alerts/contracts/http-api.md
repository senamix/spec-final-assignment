# Contract: HTTP API additions

Follows the conventions of [feature 001's HTTP contract](../../001-laptop-inventory-management/contracts/http-api.md): JSON bodies, the `sid` session cookie, and the same error format and status mapping. Every route below requires a valid session (401 otherwise, FR-010).

## New routes

| Method and path | Body | Result | Spec |
|-----------------|------|--------|------|
| `GET /api/alerts` | none | 200 `{ unread: number, alerts: [{ id, raisedAt, availableCount, level, read, emailStatus }] }`, newest first. `emailStatus` is the caller's own delivery status. | FR-004, FR-005 |
| `POST /api/alerts/{id}/read` | none | 204; 404 for an unknown id; repeating is allowed | FR-006 |
| `GET /api/settings/low-inventory-level` | none | 200 `{ level, updatedBy, updatedAt }` | FR-007 |
| `PUT /api/settings/low-inventory-level` | `{ level }` | 200 `{ level, alertRaised: boolean }`; 400 `ValidationError` (field `level`) with a message stating the valid range | FR-007, FR-008 |
| `PUT /api/me/email` | `{ email }` | 200 `{ email }`; 400 for an invalid address. Only the caller's own address can be changed. | FR-004b |

## Changed routes

| Route | Change |
|-------|--------|
| `POST /api/setup` and `POST /api/accounts` | Body gains required `email`; 400 `ValidationError` (field `email`) when missing or invalid |
| `GET /api/me` | Response gains `email` (null for legacy accounts) so the UI can prompt for one |
| `POST /api/laptops`, `PATCH`, status, assign, return, `DELETE` | Behavior unchanged; each now also evaluates low inventory in the same update. An email failure never changes these responses. |

## Email content

Subject: `Low laptop inventory: {availableCount} available`. Body states the time, available count, and level (FR-004). It contains no passwords or session data.

## Negative contract

- Alerts, level, and email routes return 401 without a session.
- No route returns another manager's email address or a password hash.
- The earlier "no alert or notification routes exist" assertion from 001 no longer applies and is replaced by these routes.
