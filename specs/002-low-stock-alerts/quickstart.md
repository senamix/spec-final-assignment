# Quickstart: Validating Low Inventory Alerts

## Prerequisites

- Node.js 24 and `npm install` run at the repository root (installs the new `nodemailer` dependency).
- Optional for real mail: set `SMTP_URL` (an SMTP connection URL from your mail provider) and `MAIL_FROM`. Without them, emails are appended as JSON lines to `outbox.jsonl` next to the data file (`data/outbox.jsonl` by default).

## Automated validation

```text
npm test
```

Expected: core unit and contract tests for alerts, HTTP contract tests, and the integration flow all pass, using a fake mailer and fake clock. See [core-library.md](./contracts/core-library.md) and [http-api.md](./contracts/http-api.md).

## Manual scenario (maps to User Stories 1 to 3)

1. Start the app (`npm start --workspace apps/web`) and create the first manager with an email address.
2. Add 6 laptops (all Available). Open the level setting and confirm it shows the default of 5.
3. Assign one laptop: 5 remain, equal to the level. Expect one alert in the alert panel (unread badge shows 1) and one email in the outbox with count 5 and level 5. (US1)
4. Assign another: expect no second alert. (US1 scenario 2)
5. Return two laptops (7 not reached; count rises above 5), then assign again to fall to 5: expect a new alert. (US1 scenario 4)
6. Mark the first alert read: badge drops, alert stays in history. Sign in as a second manager: it is still unread for them. (US2)
7. Set the level to 100 with 5 available: expect an immediate alert. Try -1 or `abc`: expect a message stating the valid range 0 to 100000. (US3)
8. Make the mailer fail (set an unreachable `SMTP_URL`), trigger an alert: the inventory change succeeds, retries occur at about 1, 5, and 15 minutes, then the delivery shows `failed`. (FR-009)
9. Sign in as a manager created before this feature (no email): expect the in-app alert, a skipped email, and a prompt to add an address.

## Done when

All automated tests pass and steps 3 to 9 behave as described.
