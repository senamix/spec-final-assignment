# Quickstart: Validating the Laptop Inventory System

A guide for proving the feature works once it is built. Details live in
[contracts/core-library.md](./contracts/core-library.md),
[contracts/http-api.md](./contracts/http-api.md) and [data-model.md](./data-model.md).

## Prerequisites

- Node.js 24 and npm
- From the repository root: `npm install`

## 1. Library tests (no server needed)

```powershell
npm test --workspace packages/inventory-core
```

Expected: all unit and contract tests pass. This proves the rules in FR-001 to FR-014 and FR-019
without any web code.

## 2. Web app tests

```powershell
npm test --workspace apps/web
```

Expected: HTTP contract tests and the integration tests for each user story pass.

## 3. Manual walkthrough

```powershell
npm start --workspace apps/web
```

Open `http://localhost:3000`, then check each step:

1. **Setup**: the page asks you to create the first manager account; after creating it you are signed in.
2. **Add** a laptop with brand, model, serial number `SN-1001` and a past purchase date. It appears as Available (US1).
3. **Duplicate**: add another laptop with serial number `sn-1001 `. It is rejected (US1, FR-003).
4. **Assign** the laptop to "Ada Lovelace". It shows as Assigned to her; assigning again is refused (US3).
5. **Return** it. It is Available and the history lists the assignment (US3).
6. **Delete** is refused for this laptop because it has assignment history; **Retire** it instead, then confirm no status change is possible (US2).
7. **Search** by brand and filter by status; the summary counts add up to the total (US4).
8. **Accounts**: create a second manager, sign in as them, edit a laptop and confirm the change history names them (US5).
9. **Signed out**: after signing out, `GET /api/laptops` returns 401 (FR-018).
10. **No alerts**: originally no notification feature existed (FR-016, SC-007); this is superseded by feature 002-low-stock-alerts.

## 4. Persistence check

Stop the server, restart it, and confirm all laptops, assignments and accounts are still present
(FR-015).
