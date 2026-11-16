# Feature Specification: Low-Stock Alerts

**Feature Branch**: `002-low-stock-alerts`

**Created**: 2026-11-16

**Status**: Draft

**Input**: User description: "The system shall send an alert to the manager when inventory is low." Refined into five requirements: configurable low-stock threshold, available stock calculation, multi-channel role-based notification, alert deduplication and escalation, reorder suggestion and alert history.

**Relationship to feature 001**: This feature deliberately reverses the "no alerts" exclusion of the Laptop Inventory Management specification (001: FR-016, SC-007 and the related assumption). Those items are superseded by this feature for low-stock alerts only; warranty, overdue-return, and status-change alerts remain out of scope.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Set thresholds and flag Low Stock (Priority: P1)

A manager defines a minimum stock threshold (reorder point) for a laptop SKU, optionally for a specific warehouse location. A SKU is a brand and model with a specific processor, memory, and storage configuration. When the available quantity of a SKU falls to or below its threshold, the SKU is flagged "Low Stock". Only laptops that are actually available count toward that quantity.

**Why this priority**: Without thresholds and a correct available count, no alert can be trustworthy. This is the foundation and delivers value alone (managers can see which SKUs are low).

**Independent Test**: Set a threshold of 3 for a SKU, bring its available quantity from 4 to 3, and verify the SKU shows "Low Stock"; assign one more laptop and verify it stays flagged; return it and verify the count updates.

**Acceptance Scenarios**:

1. **Given** a SKU with 5 available laptops, **When** a manager sets its threshold to 5, **Then** the SKU is flagged "Low Stock".
2. **Given** a SKU with threshold 3 and 4 available laptops, **When** one laptop is assigned, **Then** available quantity is 3 and the SKU is flagged "Low Stock".
3. **Given** a SKU with 10 laptops of which 2 are Assigned, 1 In Repair, 1 Retired, 1 reserved, and 1 marked defective, **When** available quantity is calculated, **Then** it is 4.
4. **Given** a SKU with a SKU-wide threshold of 5 and a warehouse-specific threshold of 2 for warehouse A, **When** stock is evaluated, **Then** warehouse A uses 2 and other warehouses use 5.
5. **Given** a manager entering a threshold, **When** the value is negative or not a whole number, **Then** it is rejected with a clear message.

---

### User Story 2 - Receive a timely low-stock alert (Priority: P1)

When a SKU reaches its threshold, each designated manager is alerted in the app and by email, and through any optional channel (Slack, Microsoft Teams, SMS) that manager has enabled. The alert shows the SKU, warehouse, current available quantity, configured threshold, a suggested reorder quantity, and a link to the item.

**Why this priority**: This is the core business request: managers are told when inventory is low.

**Independent Test**: Lower a SKU's available quantity to its threshold and verify every designated manager receives an in-app notification and an email with all required content within 5 minutes.

**Acceptance Scenarios**:

1. **Given** a SKU with threshold 3 and 4 available, **When** available quantity drops to 3, **Then** each designated manager receives an in-app notification and an email within 5 minutes.
2. **Given** a manager who enabled Slack, **When** an alert is raised, **Then** that manager also receives it on Slack; a manager who did not enable Slack does not.
3. **Given** a delivered alert, **When** the manager reads it, **Then** it shows SKU, warehouse, available quantity, threshold, suggested reorder quantity, and a working link to the item.
4. **Given** one channel fails to deliver, **When** the alert is sent, **Then** the other channels are still delivered and the failure is recorded.
5. **Given** a SKU with several designated managers, **When** an alert is raised, **Then** each designated manager receives it.

---

### User Story 3 - Avoid duplicates, acknowledge, snooze, and escalate (Priority: P2)

A manager receives only one alert per low-stock event and can acknowledge or snooze it. If nobody acknowledges within a configurable period, or if the SKU runs out of stock, the alert escalates to a secondary recipient.

**Why this priority**: Prevents alert fatigue and ensures low stock is never silently ignored; depends on Stories 1 and 2.

**Independent Test**: Keep a SKU low across several stock changes and verify a single alert; leave it unacknowledged past the configured period and verify escalation; reduce stock to zero and verify immediate escalation.

**Acceptance Scenarios**:

1. **Given** an open alert for a SKU, **When** available quantity changes but stays at or below the threshold, **Then** no new alert is sent.
2. **Given** an open alert, **When** stock recovers above the threshold and later drops to or below it again, **Then** a new alert is sent.
3. **Given** an alert snoozed for a chosen period, **When** the period ends and the SKU is still at or below threshold, **Then** a new alert is sent; if stock has recovered, none is sent.
4. **Given** an unacknowledged alert, **When** the configured escalation period passes, **Then** the secondary recipient is alerted.
5. **Given** an open alert, **When** available stock reaches zero, **Then** the secondary recipient is alerted immediately, even if the escalation period has not passed.
6. **Given** an acknowledged alert, **When** the escalation period passes, **Then** no escalation occurs.

---

### User Story 4 - Alert history and low-stock reports (Priority: P3)

A manager reviews a log of all alerts (time, SKU, recipient, status: sent, acknowledged, or resolved), filters it by SKU, warehouse, and date range, and views a report of how often each SKU went low.

**Why this priority**: Supports audit and purchasing decisions but is not needed for alerts to work.

**Independent Test**: Generate several alerts across SKUs and warehouses, filter by each criterion, and verify results and per-SKU frequency counts.

**Acceptance Scenarios**:

1. **Given** alerts for several SKUs, **When** a manager filters by SKU, warehouse, or date range, **Then** only matching entries are shown, and combined filters narrow the results further.
2. **Given** an alert that was sent, acknowledged, and then stock recovered, **When** the history is viewed, **Then** its status progression shows sent, acknowledged, and resolved with times.
3. **Given** a date range, **When** the frequency report is run, **Then** each SKU shows the number of low-stock events in that range, sorted from most to least frequent.

---

### Edge Cases

- A SKU has no threshold defined: it is never flagged and never alerts.
- Available quantity is already at or below the threshold when the threshold is first set or raised: the SKU is flagged and one alert is raised.
- The threshold is changed while an alert is open: the state is re-evaluated; if stock is now above the new threshold the alert is marked resolved.
- Stock changes rapidly around the threshold: one alert per low-stock event, with a new one only after a real recovery above the threshold.
- A SKU reaches zero available while a snooze is active: escalation to the secondary recipient still occurs.
- No secondary recipient is configured: escalation is skipped, the gap is recorded in the history, and the primary managers are re-alerted instead.
- A designated manager account is deleted or has no email: the alert is still delivered to the remaining valid recipients and the problem is recorded in the history.
- All laptops of a SKU are Retired: available quantity is zero and the SKU is treated as out of stock.
- Suggested reorder quantity would be zero or negative: it is shown as at least 1.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST allow a manager to define a minimum stock threshold (reorder point) for each laptop SKU, and optionally for each warehouse location, and MUST reject negative or non-whole values.
- **FR-002**: The system MUST flag a SKU "Low Stock" whenever its available quantity is at or below its threshold, using the warehouse-specific threshold when one exists and the SKU-wide threshold otherwise.
- **FR-003**: The system MUST calculate available quantity as laptops that are Available only, excluding Assigned, In Repair, Retired, reserved, and defective laptops.
- **FR-004**: The system MUST send a low-stock alert to each designated manager through in-app notification and email.
- **FR-005**: The system MUST support optional Slack, Microsoft Teams, and SMS channels, each enabled or disabled per manager.
- **FR-006**: Each alert MUST include the SKU, warehouse, current available quantity, configured threshold, suggested reorder quantity, and a link to the item.
- **FR-007**: Alerts MUST be delivered within 5 minutes of the stock level reaching the threshold.
- **FR-008**: The system MUST send only one alert per SKU per low-stock event, and a new alert MUST be sent only after stock has recovered above the threshold and dropped again, or after a snooze period ends with the SKU still low.
- **FR-009**: A manager MUST be able to acknowledge an alert or snooze it for a chosen period.
- **FR-010**: The system MUST escalate to a secondary recipient when an alert is not acknowledged within a configurable period, and immediately when available stock reaches zero.
- **FR-011**: The system MUST include a suggested reorder quantity in each alert, calculated from the threshold and current available quantity.
- **FR-012**: The system MUST keep an alert history recording time, SKU, recipient, and status (sent, acknowledged, or resolved), and MUST allow filtering by SKU, warehouse, and date range.
- **FR-013**: The system MUST provide a report of low-stock frequency per SKU for a chosen date range.
- **FR-014**: The system MUST record failed deliveries per channel in the alert history without blocking delivery on other channels.
- **FR-015**: Only signed-in managers MUST be able to configure thresholds, recipients, channels, and escalation settings, and to acknowledge or snooze alerts; every such action MUST be attributed to the manager who made it.
- **FR-016**: Low-stock alerting MUST NOT extend to other alert types (warranty, overdue return, status change), which remain out of scope.

### Key Entities *(include if feature involves data)*

- **SKU**: A laptop configuration identified by brand, model, processor, memory, and storage. Groups individual laptops for stock counting.
- **Warehouse Location**: A place where laptops are stored, used to scope stock counts and thresholds.
- **Stock Threshold**: The minimum available quantity for a SKU, optionally for one warehouse location, plus an optional reorder quantity target.
- **Low-Stock Alert**: One low-stock event for a SKU and warehouse. Attributes: SKU, warehouse, available quantity and threshold at the time, suggested reorder quantity, status (sent, acknowledged, resolved), snooze end, escalation state, and times.
- **Alert Recipient Settings**: Per manager: whether designated for alerts, enabled optional channels and contact details, and the secondary (escalation) recipient.
- **Alert History Entry**: A log record of an alert per recipient: time, SKU, warehouse, recipient, channel, delivery result, and status.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% of low-stock events produce an alert to every designated manager within 5 minutes of the stock level reaching the threshold.
- **SC-002**: 100% of alerts contain SKU, warehouse, available quantity, threshold, suggested reorder quantity, and a working link.
- **SC-003**: Available quantity matches the count of laptops that are Available in 100% of checks, with Assigned, In Repair, Retired, reserved, and defective laptops never counted.
- **SC-004**: A continuous low-stock period produces exactly one alert, with no duplicates, until recovery above the threshold or the end of a snooze.
- **SC-005**: 100% of unacknowledged alerts reach the secondary recipient by the end of the configured escalation period, and 100% of out-of-stock events escalate within 5 minutes.
- **SC-006**: A manager can set a threshold for a SKU in under 1 minute and acknowledge or snooze an alert in under 30 seconds.
- **SC-007**: A manager can find the alerts for a given SKU and date range in under 30 seconds in a history of 10,000 entries.
- **SC-008**: The low-stock frequency report covers 100% of SKUs that had at least one event in the selected range.

## Assumptions

- Feature 001 had no concept of warehouses, reserved status, or defective status; this feature adds warehouse location, "reserved", and "defective" as inventory attributes so that available stock can be calculated as required. Existing laptops default to a single default warehouse, not reserved, and not defective.
- SKU is derived from brand, model, processor, memory, and storage of a laptop; laptops sharing all of these values belong to one SKU.
- Feature 001 states that all managers have the same permissions. "Designated manager" and "secondary recipient" are per-alert-setting designations among existing manager accounts, not new permission roles.
- A suggested reorder quantity defaults to the amount needed to restore stock to twice the threshold (minimum 1), unless a manager sets a reorder target for the SKU.
- Default escalation period is 4 hours and is configurable; default snooze options are 1 hour, 1 day, and 1 week.
- Alerts are triggered by changes in stock level and are also re-checked periodically so the 5-minute delivery target holds.
- Optional channels (Slack, Microsoft Teams, SMS) depend on external services; credentials and contact details are supplied by the organization or manager. Failure of one channel never blocks the others.
- Alert history is retained for at least 12 months.
- In-app notifications and the alert history are available on the existing manager web page, used in a modern desktop browser.
- Per the project constitution, core alert behavior is delivered as a standalone, independently testable library before application integration, and tests are written first.
