# Contract: `inventory-core` Library

Pure functions with no I/O. Every function returns
`Result<T, DomainError>`, which is either `{ ok: true, value }` or `{ ok: false, error }`.
Types are described in [data-model.md](../data-model.md).

`Ctx` is `{ actor: { id, name }, now: ISO date-time, newId: () => string }`, supplied by the caller.

| Function | Inputs | Success value | Errors | Spec |
|----------|--------|---------------|--------|------|
| `emptyState()` | none | `State` | none | FR-015 |
| `addLaptop(state, input, ctx)` | brand, model, serialNumber, purchaseDate, specs? | `{ state, laptop }` | `ValidationError`, `DuplicateSerialNumber` | FR-001 to FR-004, FR-007 |
| `editLaptop(state, id, changes, ctx)` | any editable field | `{ state, laptop }` | `NotFound`, `ValidationError`, `DuplicateSerialNumber` | FR-006, FR-019 |
| `changeStatus(state, id, target, ctx)` | `Available`, `InRepair` or `Retired` | `{ state, laptop }` | `NotFound`, `InvalidStatusTransition` | FR-008 |
| `deleteLaptop(state, id)` | id | `{ state }` | `NotFound`, `HasAssignmentHistory` | FR-012 |
| `assignLaptop(state, id, personName, ctx)` | id, name | `{ state, laptop }` | `NotFound`, `NotAvailable`, `ValidationError` | FR-009 |
| `returnLaptop(state, id, ctx)` | id | `{ state, laptop }` | `NotFound`, `InvalidStatusTransition` (not assigned) | FR-010 |
| `getLaptop(state, id)` | id | `Laptop` with `currentHolder` | `NotFound` | FR-005, FR-011 |
| `listLaptops(state, query?)` | `{ text?, status? }` | `Laptop[]`, sorted by brand, model and serial number | none | FR-005, FR-013 |
| `statusCounts(state)` | none | `{ Available, Assigned, InRepair, Retired, total }` | none | FR-014 |
| `createAccount(state, input, hasher, ctx)` | username, displayName, password | `{ state, account }` | `ValidationError`, `DuplicateUsername` | FR-021 |
| `verifyCredentials(state, username, password, hasher)` | credentials | `Account` | `InvalidCredentials` | FR-018 |
| `hasAccounts(state)` | none | boolean | none | FR-021 |

Guarantees:
- Input state is never modified. A failed call returns the error and the caller keeps its state.
- `listLaptops` and `statusCounts` never include data from other laptops, and the counts always sum
  to `total` (SC-005).
- The library contains no notification or alert functionality (FR-016).
