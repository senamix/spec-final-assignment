# Feature Specification: Low Inventory Alerts

**Feature Branch**: `002-low-stock-alerts`

**Created**: 2026-11-16

**Status**: Draft

**Input**: User description: "The system shall send an alert to the manager when inventory is low."

## Clarifications

### Session 2026-11-16

- Q: Besides in-app, should managers also get an alert outside the app? → A: Yes, in-app plus email to each manager.
- Q: How is a manager's email address added? → A: Required when an account is created; existing managers add or edit their own address after signing in.
- Q: If an alert email cannot be delivered, should it be retried? → A: Yes, up to 3 retries over about 15 minutes, then record the failure.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Be alerted when available laptops run low (Priority: P1)

An inventory manager wants to be told automatically when the number of laptops available for assignment drops to or below a set level, so they can order or free up laptops before requests go unfilled.

**Why this priority**: This is the core of the request. Without it, managers must keep checking counts manually.

**Independent Test**: Set the low-inventory level to 3, have 4 available laptops, assign one, and confirm every manager receives exactly one alert showing the current available count and the level.

**Acceptance Scenarios**:

1. **Given** the low-inventory level is 3 and 4 laptops are available, **When** a manager assigns one laptop (3 remain), **Then** an alert is sent to the managers, both in-app and by email, stating that available inventory is low, with the current count (3) and the level (3).
2. **Given** an alert has already been sent for the current low condition, **When** another laptop is assigned (2 remain), **Then** no duplicate alert is sent for the same low period.
3. **Given** available inventory is above the level, **When** laptops are added, assigned, or returned without crossing the level, **Then** no alert is sent.
4. **Given** a low-inventory alert is active, **When** available inventory rises above the level and later drops to or below it again, **Then** a new alert is sent.

---

### User Story 2 - See and acknowledge alerts in the web page (Priority: P2)

A manager signs in and sees any current low-inventory alerts, including past ones, in the manager web page, and can mark an alert as read.

**Why this priority**: Alerts are only useful if managers can find them when they next sign in.

**Independent Test**: Trigger an alert, sign in as a manager, confirm the alert is visible and marked unread, mark it read, and confirm it no longer shows as unread.

**Acceptance Scenarios**:

1. **Given** an unread alert exists, **When** a manager signs in, **Then** they see an unread-alert indicator and the alert's details (time, available count, level).
2. **Given** an unread alert, **When** the manager marks it read, **Then** it shows as read for that manager and remains in the alert history.
3. **Given** two managers, **When** one marks an alert read, **Then** it remains unread for the other.

---

### User Story 3 - Configure the low-inventory level (Priority: P3)

A manager sets the level at or below which inventory is considered low.

**Why this priority**: A sensible default makes the feature usable immediately; configuration is a refinement.

**Independent Test**: Change the level from the default to 10 and confirm that an alert is sent when available laptops drop to 10 or fewer.

**Acceptance Scenarios**:

1. **Given** the default level, **When** a manager sets a new whole-number level of 0 or more, **Then** it is saved and used for all later checks.
2. **Given** a manager enters a negative or non-numeric level, **When** they submit it, **Then** the system rejects it and explains the valid range.
3. **Given** a new level at or above the current available count, **When** it is saved, **Then** an alert is sent immediately because inventory is already low.

---

### Edge Cases

- Available count drops to 0: an alert is still sent (once per low period) and states that no laptops are available.
- A single change moves the count across the level by more than one (for example, a laptop is retired and another goes to repair): one alert only.
- A laptop is deleted, retired, or sent to repair, reducing the available count: counts as a reduction and is checked like an assignment.
- The level is raised or lowered while an alert is active: the low condition is re-evaluated against the new level.
- Email delivery fails for a manager: the system retries up to 3 times over about 15 minutes; if all retries fail, the inventory change still succeeds, the in-app alert remains available, and the failure is recorded against that manager so the alert is not silently lost.
- A manager account created before this feature has no email address: they receive the in-app alert only, the skipped email is recorded, and they are prompted to add an address after signing in.
- No manager accounts exist yet (initial setup not done): no alert can be delivered and none is expected.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST send an alert to all managers when the number of laptops with status "Available" becomes equal to or lower than the low-inventory level.
- **FR-002**: The system MUST evaluate the low condition after every change that can alter the available count: adding, assigning, returning, changing status, retiring, deleting a laptop, and changing the level.
- **FR-003**: The system MUST send at most one alert per low period; a new alert is sent only after available inventory has risen above the level and then fallen to or below it again.
- **FR-004**: Each alert, in-app and email, MUST state the time, the current available count, and the level.
- **FR-004a**: In addition to the in-app alert, the system MUST send an email with the alert details to every manager who has an email address on file, and MUST send one email per manager per alert.
- **FR-004b**: The system MUST require a valid email address when a manager account is created, and MUST let a signed-in manager add or change their own email address (and no one else's); invalid addresses MUST be rejected with an explanation.
- **FR-005**: The system MUST keep a history of alerts, viewable by signed-in managers, with read/unread state tracked per manager.
- **FR-006**: Managers MUST be able to mark an alert as read without removing it from history.
- **FR-007**: Managers MUST be able to view and change the low-inventory level; the level MUST be a whole number of 0 or more, and the system MUST ship with a default of 5.
- **FR-008**: The system MUST reject invalid levels and explain the valid range.
- **FR-009**: A failure to deliver an email MUST NOT cause the triggering inventory change or the in-app alert to fail. The system MUST retry a failed email up to 3 times over about 15 minutes, and if all retries fail MUST record the failure per manager.
- **FR-010**: Alert history and the level MUST only be accessible to signed-in managers.

### Key Entities

- **Low-Inventory Level**: The single organization-wide whole number at or below which available inventory is considered low. Has a default value and a record of who last changed it and when.
- **Low-Inventory Alert**: A record that inventory became low. Attributes: time raised, available count, level at that time, per-manager read state, and per-manager email delivery outcome (sent, failed, or skipped).
- **Manager Account**: Existing entity; the recipients of alerts. Gains an email address (required for new accounts, optional for existing ones until added).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: In 100% of cases where available inventory crosses to or below the level, every manager has an in-app alert available, and every manager with an email address has been sent an email, within 1 minute.
- **SC-002**: A single low period never produces more than one alert (0 duplicates across test scenarios).
- **SC-003**: No alert is raised while available inventory is above the level (0 false alerts across test scenarios).
- **SC-004**: A manager can find and mark an unread alert as read in under 30 seconds after signing in.
- **SC-005**: A manager can change the level in under 30 seconds.
- **SC-006**: 100% of rejected level entries show a message explaining the valid range.

## Assumptions

- "Inventory is low" means the number of laptops with status "Available" is at or below a single organization-wide level; per-brand or per-model levels are out of scope.
- "The manager" means every manager account; all managers have equal permissions, as in the existing system, and there are no per-manager alert preferences.
- Alerts are delivered in-app (shown in the manager web page and available through the library) and by email; SMS and other channels are out of scope for this version.
- Depends on an email delivery service being available to the organization.
- The default level is 5 available laptops.
- This feature intentionally supersedes the earlier exclusion of alerts in `001-laptop-inventory-management` (its "no alerts" requirement and success criterion SC-007 no longer apply once this feature ships).
- Per the project constitution, alert behavior is delivered first as a standalone, independently testable library, with the web page integration added afterwards.
- Depends on the existing laptop status, assignment, and manager account capabilities.
