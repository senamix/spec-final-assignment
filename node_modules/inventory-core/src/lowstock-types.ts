export type Channel = 'in-app' | 'email' | 'slack' | 'teams' | 'sms';
export type AlertStatus = 'sent' | 'acknowledged' | 'resolved';
export type DeliveryResult = 'ok' | 'failed' | 'pending';

/** A stock threshold for a SKU; `warehouse` null means the SKU-wide default. */
export interface Threshold {
  readonly sku: string;
  readonly warehouse: string | null;
  readonly minQty: number;
  readonly reorderTarget: number | null;
  readonly updatedAt: string;
  readonly updatedBy: string;
}

export interface RecipientSettings {
  readonly accountId: string;
  readonly designated: boolean;
  readonly email: string | null;
  readonly slack: string | null;
  readonly teams: string | null;
  readonly sms: string | null;
  readonly secondaryAccountId: string | null;
}

export interface AlertConfig {
  readonly escalationMinutes: number;
}

export interface LowStockAlert {
  readonly id: string;
  readonly sku: string;
  readonly skuLabel: string;
  readonly warehouse: string;
  readonly available: number;
  readonly threshold: number;
  readonly suggestedReorder: number;
  readonly status: AlertStatus;
  readonly createdAt: string;
  readonly notifiedAt: string;
  readonly acknowledgedAt: string | null;
  readonly acknowledgedBy: string | null;
  readonly snoozedUntil: string | null;
  readonly escalatedAt: string | null;
  readonly resolvedAt: string | null;
  readonly recipients: readonly string[];
}

export interface AlertHistoryEntry {
  readonly id: string;
  readonly at: string;
  readonly alertId: string;
  readonly sku: string;
  readonly skuLabel: string;
  readonly warehouse: string;
  readonly recipientId: string;
  readonly channel: Channel;
  readonly status: AlertStatus;
  readonly delivery: DeliveryResult;
  readonly note: string;
}

export interface LowStockState {
  readonly thresholds: readonly Threshold[];
  readonly recipients: Readonly<Record<string, RecipientSettings>>;
  readonly config: AlertConfig;
  readonly alerts: Readonly<Record<string, LowStockAlert>>;
  readonly history: readonly AlertHistoryEntry[];
}

export const DEFAULT_ESCALATION_MINUTES = 240;
export const DEFAULT_WAREHOUSE = 'Main';

export const emptyLowStock = (): LowStockState => ({
  thresholds: [],
  recipients: {},
  config: { escalationMinutes: DEFAULT_ESCALATION_MINUTES },
  alerts: {},
  history: [],
});

export interface AlertMessage {
  readonly sku: string;
  readonly warehouse: string;
  readonly available: number;
  readonly threshold: number;
  readonly suggestedReorder: number;
  readonly link: string;
  readonly escalation: boolean;
  readonly outOfStock: boolean;
}

/** An external send the caller must perform; its history entry starts as pending. */
export interface Delivery {
  readonly historyId: string;
  readonly alertId: string;
  readonly recipientId: string;
  readonly channel: Exclude<Channel, 'in-app'>;
  readonly address: string;
  readonly message: AlertMessage;
}
