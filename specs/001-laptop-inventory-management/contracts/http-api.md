# Contract: HTTP API

JSON over HTTP, served together with the static UI by `apps/web`. Write requests MUST use
`Content-Type: application/json`. The session cookie `sid` is `HttpOnly` and `SameSite=Strict`.

## Error format

```json
{ "error": { "code": "DuplicateSerialNumber", "message": "Serial number SN-1001 is already in use", "field": "serialNumber" } }
```

| Domain error | HTTP status |
|--------------|-------------|
| `ValidationError` | 400 |
| `Unauthenticated`, `InvalidCredentials` | 401 |
| `NotFound` | 404 |
| `DuplicateSerialNumber`, `DuplicateUsername`, `NotAvailable`, `InvalidStatusTransition`, `HasAssignmentHistory`, `SetupComplete` | 409 |
| Request body is not `application/json` | 415 |
| Request body over 100 KB | 413 |
| Too many login attempts (5 failures per username in 15 minutes) | 429 |

## Setup and authentication

| Method and path | Body | Result | Spec |
|-----------------|------|--------|------|
| `GET /api/setup` | none | `{ "needsSetup": boolean }`; public | FR-021 |
| `POST /api/setup` | `{ username, displayName, password }` | 201 and a session; 409 once any account exists | FR-021 |
| `POST /api/login` | `{ username, password }` | 200, sets cookie, returns `{ displayName }` | FR-018 |
| `POST /api/logout` | none | 204 | FR-018 |
| `GET /api/me` | none | `{ id, username, displayName }` | FR-018 |
| `POST /api/accounts` | `{ username, displayName, password }` | 201 `{ id, username, displayName }` | FR-021 |

Every route below requires a valid session; otherwise the response is 401 (FR-018). The password
hash is never returned by any endpoint.

## Laptops

| Method and path | Body or query | Result | Spec |
|-----------------|---------------|--------|------|
| `GET /api/laptops` | `?q=<text>&status=<status>` | 200 `Laptop[]`; an empty array when nothing matches; 400 for an unknown status | FR-005, FR-013 |
| `POST /api/laptops` | `{ brand, model, serialNumber, purchaseDate, specs? }` | 201 `Laptop` | FR-001 to FR-003 |
| `GET /api/laptops/{id}` | none | 200 `Laptop` with `currentHolder`, `assignments`, `history` | FR-005, FR-011, FR-019 |
| `PATCH /api/laptops/{id}` | any editable fields | 200 `Laptop` | FR-006 |
| `POST /api/laptops/{id}/status` | `{ status }` | 200 `Laptop` | FR-008 |
| `POST /api/laptops/{id}/assign` | `{ personName }` | 200 `Laptop` | FR-009 |
| `POST /api/laptops/{id}/return` | none | 200 `Laptop` | FR-010 |
| `DELETE /api/laptops/{id}` | none | 204 | FR-012 |
| `GET /api/summary` | none | `{ Available, Assigned, InRepair, Retired, total }` | FR-014 |

## Negative contract

No route, payload field or response may relate to alerts or notifications (FR-016). A contract
test requests common notification-style paths and expects 404.
