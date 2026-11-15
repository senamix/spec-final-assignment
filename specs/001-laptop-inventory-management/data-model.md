# Data Model: Laptop Inventory Management System

All values are immutable. Every operation returns a new `State`.

## State

| Field | Type | Notes |
|-------|------|-------|
| `laptops` | map of laptop id to Laptop | |
| `accounts` | map of account id to Account | |

## Laptop

| Field | Type | Rules |
|-------|------|-------|
| `id` | string | Unique, generated, never changes (FR-004) |
| `brand` | string | Required, 1 to 100 characters, trimmed |
| `model` | string | Required, 1 to 100 characters, trimmed |
| `serialNumber` | string | Required, 1 to 100 characters, trimmed; unique across laptops ignoring case (FR-003) |
| `purchaseDate` | ISO date | Required; must not be in the future |
| `specs` | `{ processor, memory, storage }` | Each an optional string of at most 100 characters |
| `status` | `Available`, `Assigned`, `InRepair` or `Retired` | New laptops start `Available` (FR-007) |
| `assignments` | list of Assignment | Oldest first |
| `history` | list of ChangeRecord | Append-only, oldest first |

Derived values: `currentHolder` is the `personName` of the open assignment, if any.

## Assignment

| Field | Type | Rules |
|-------|------|-------|
| `personName` | string | Required, 1 to 100 characters, trimmed |
| `assignedAt` | ISO date-time | Set when assigned |
| `returnedAt` | ISO date-time or null | Null while the laptop is held |

Invariant: a laptop has at most one open assignment, and has one if and only if its status is
`Assigned`.

## ChangeRecord

| Field | Type | Notes |
|-------|------|-------|
| `at` | ISO date-time | |
| `byAccountId` | string | The acting manager |
| `byName` | string | Manager name at the time of the change |
| `action` | `Created`, `Edited`, `StatusChanged`, `Assigned` or `Returned` | |
| `detail` | string | Short human-readable summary, for example `status: Available -> InRepair` |

## Account

| Field | Type | Rules |
|-------|------|-------|
| `id` | string | Unique, generated |
| `username` | string | Required, 3 to 50 characters, unique ignoring case |
| `displayName` | string | Required, 1 to 100 characters |
| `passwordHash` | string | Salted hash produced by the injected hasher; the plain password is never stored |

## Status transitions

| From | To | Allowed |
|------|----|---------|
| Available | InRepair | Yes |
| Available | Assigned | Only through `assign` |
| Available | Retired | Yes (permanent) |
| InRepair | Available | Yes |
| InRepair | Retired | Yes (permanent) |
| Assigned | Available | Only through `return` |
| Assigned | InRepair or Retired | No; return the laptop first |
| Retired | any | No (retirement is permanent) |

## Deletion

A laptop can be deleted only when its `assignments` list is empty. Deletion removes the laptop and
its `history`, and frees the serial number for reuse.

## Domain errors

`ValidationError` (with field name), `DuplicateSerialNumber`, `DuplicateUsername`, `NotFound`,
`InvalidStatusTransition`, `NotAvailable`, `HasAssignmentHistory`, `Unauthenticated`,
`InvalidCredentials` and `SetupComplete` (first-time setup attempted after an account exists).
