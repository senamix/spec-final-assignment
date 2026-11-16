import { err, ok } from './result.ts';
import type { Result, Specs } from './types.ts';

export interface LaptopFields {
  readonly brand: string;
  readonly model: string;
  readonly serialNumber: string;
  readonly purchaseDate: string;
  readonly specs: Specs;
  readonly warehouse?: string;
  readonly reserved?: boolean;
  readonly defective?: boolean;
}

const MAX_TEXT = 100;
const SPEC_KEYS = ['processor', 'memory', 'storage'] as const;

export const normalizeSerial = (serial: string): string => serial.trim().toLowerCase();

function validateStockFields(input: Record<string, unknown>): Result<Pick<LaptopFields, 'warehouse' | 'reserved' | 'defective'>> {
  const out: { warehouse?: string; reserved?: boolean; defective?: boolean } = {};
  const { warehouse } = input;
  if (warehouse !== undefined && warehouse !== null) {
    if (typeof warehouse !== 'string') return err('ValidationError', 'warehouse must be text', 'warehouse');
    if (warehouse.trim().length > MAX_TEXT) return err('ValidationError', `warehouse must be at most ${MAX_TEXT} characters`, 'warehouse');
    if (warehouse.trim().length > 0) out.warehouse = warehouse.trim();
  }
  for (const key of ['reserved', 'defective'] as const) {
    const value = input[key];
    if (value === undefined || value === null) continue;
    if (typeof value !== 'boolean') return err('ValidationError', `${key} must be true or false`, key);
    out[key] = value;
  }
  return ok(out);
}

export function validateText(field: string, value: unknown, label = field): Result<string> {
  const text = typeof value === 'string' ? value.trim() : '';
  if (text.length === 0) return err('ValidationError', `${label} is required`, field);
  if (text.length > MAX_TEXT) return err('ValidationError', `${label} must be at most ${MAX_TEXT} characters`, field);
  return ok(text);
}

export function validatePurchaseDate(value: unknown, now: string): Result<string> {
  const text = typeof value === 'string' ? value.trim() : '';
  if (text.length === 0) return err('ValidationError', 'purchaseDate is required', 'purchaseDate');
  const parsed = /^\d{4}-\d{2}-\d{2}$/.test(text) ? new Date(`${text}T00:00:00Z`) : undefined;
  if (!parsed || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== text) {
    return err('ValidationError', 'purchaseDate must be a valid date (YYYY-MM-DD)', 'purchaseDate');
  }
  if (text > now.slice(0, 10)) return err('ValidationError', 'purchaseDate must not be in the future', 'purchaseDate');
  return ok(text);
}

export function validateSpecs(value: unknown): Result<Specs> {
  if (value === undefined || value === null) return ok({});
  if (typeof value !== 'object') return err('ValidationError', 'specs must be an object', 'specs');
  const out: Record<string, string> = {};
  for (const key of SPEC_KEYS) {
    const raw = (value as Record<string, unknown>)[key];
    if (raw === undefined || raw === null || raw === '') continue;
    if (typeof raw !== 'string' || raw.trim().length > MAX_TEXT) {
      return err('ValidationError', `${key} must be at most ${MAX_TEXT} characters`, key);
    }
    if (raw.trim().length > 0) out[key] = raw.trim();
  }
  return ok(out);
}

export function validateLaptopInput(input: Record<string, unknown>, now: string): Result<LaptopFields> {
  const brand = validateText('brand', input.brand);
  if (!brand.ok) return brand;
  const model = validateText('model', input.model);
  if (!model.ok) return model;
  const serialNumber = validateText('serialNumber', input.serialNumber, 'serial number');
  if (!serialNumber.ok) return serialNumber;
  const purchaseDate = validatePurchaseDate(input.purchaseDate, now);
  if (!purchaseDate.ok) return purchaseDate;
  const specs = validateSpecs(input.specs);
  if (!specs.ok) return specs;
  const stock = validateStockFields(input);
  if (!stock.ok) return stock;
  return ok({
    brand: brand.value,
    model: model.value,
    serialNumber: serialNumber.value,
    purchaseDate: purchaseDate.value,
    specs: specs.value,
    ...stock.value,
  });
}

export const validatePersonName = (value: unknown): Result<string> => validateText('personName', value, 'person name');
