import { z } from 'zod';
import { type Route, time, confirmed, WITHOUT_BODY, query, Q, PAGE, PAGES_DETAIL } from './base';
import { GenericResponse } from './shared';
import { input } from '../infra/validate';
import {
  voucherNumber,
  voucherNumberOrMask,
  voucherPin,
  voucherPinOrMask,
  voucherCurrency,
  voucherCurrencyChange,
} from '../infra/voucherValues';

/** The contract checks the format; the service only receives checked values (src/infra/voucherValues.ts). */
const VOUCHER_NUMBER = input.regel(voucherNumber, { type: 'string', pattern: '^[0-9 -]{4,40}$' });
const VOUCHER_PIN = input.regel(voucherPin, { type: ['string', 'null'], pattern: '^\\s*([0-9]{3,10})?\\s*$' });
const VOUCHER_CURRENCY = input.regel(voucherCurrency, { type: ['string', 'null'], pattern: '^([A-Za-z]{3})?$' });
const NUMBER_OR_MASK = input.regel(voucherNumberOrMask, {
  type: 'string',
  pattern: '^([0-9 -]{4,40}|…[0-9]{4})$',
});
const PIN_OR_MASK = input.regel(voucherPinOrMask, {
  type: ['string', 'null'],
  pattern: '^(\\s*([0-9]{3,10})?\\s*|•••)$',
});
const CURRENCY_CHANGE = input.regel(voucherCurrencyChange, {
  type: ['string', 'null'],
  pattern: '^([A-Za-z]{3})?$',
});

export const ParsedVoucher = z.looseObject({
  number: z.string().nullable(),
  pin: z.string().nullable(),
  amount: z.number().optional(),
  currency: z.string().nullable(),
});

export const Voucher = z.looseObject({
  id: z.number().int(),
  number: z.string(),
  pin: z.string().nullable(),
  amount: z.number(),
  currency: z.string(),
  hat_pdf: z.boolean(),
  created_at: time,
  updated_at: time,
  guthaben_geprueft_am: time.nullable(),
});

export const BalanceReply = z.looseObject({
  success: z.boolean(),
  voucher: Voucher.nullable(),
  angezeigt: z.string().nullable(),
  waehrung_geaendert: z.boolean(),
  grund: z.string().nullable().optional(),
  wartenSek: z.number().int().nullable().optional(),
  error: z.string().nullable().optional(),
  code: z.string().nullable().optional(),
});

export const VoucherBatch = z.looseObject({
  results: z.array(z.unknown()),
  added: z.number().int(),
  updated: z.number().int(),
  errors: z.number().int(),
  total: z.number().int(),
});

export const VoucherReply = z.looseObject({
  success: z.boolean(),
  voucher: Voucher.nullable().optional(),
  mehrere: VoucherBatch.nullable().optional(),
  gelesen: ParsedVoucher.nullable().optional(),
  error: z.string().nullable().optional(),
  code: z.string().nullable().optional(),
});

export const VoucherList = z.looseObject({
  success: z.boolean(),
  ...PAGES_DETAIL,
  vouchers: z.array(Voucher),
});

export const VoucherPlaintext = z.looseObject({
  success: z.literal(true),
  id: z.number().int(),
  number: z.string(),
  pin: z.string().nullable(),
});

export const PdfFreigabe = z.looseObject({
  success: z.literal(true),
  ticket: z.string(),
  gueltig_sek: z.number().int(),
});

export const routen = {
  'GET /api/v1/vouchers': { antwort: VoucherList, abfrage: query(PAGE) },
  'POST /api/v1/vouchers': {
    eingabe: z.strictObject({
      number: VOUCHER_NUMBER,
      pin: VOUCHER_PIN.optional(),
      amount: input.geld('Betrag', { nullbar: false, oneCode: 'betrag_ungueltig' }),
      currency: VOUCHER_CURRENCY.optional(),
    }),
    antwort: VoucherReply,
  },
  'PUT /api/v1/vouchers/:id': {
    eingabe: z.strictObject({
      number: NUMBER_OR_MASK.optional(),
      pin: PIN_OR_MASK.optional(),
      amount: input.geld('Betrag', { nullbar: false, oneCode: 'betrag_ungueltig' }).optional(),
      currency: CURRENCY_CHANGE.optional(),
    }),
    antwort: VoucherReply,
  },
  'DELETE /api/v1/vouchers/:id': { antwort: GenericResponse, ...confirmed(), schritt: 'gutschein' },
  'POST /api/v1/vouchers/pdf': {
    formular: true,
    antwort: VoucherReply,
    eingabe: z.strictObject({
      number: VOUCHER_NUMBER.optional(),
      pin: VOUCHER_PIN.optional(),
      amount: input.geld('Betrag', { nullbar: false, oneCode: 'betrag_ungueltig' }).optional(),
      currency: VOUCHER_CURRENCY.optional(),
    }),
  },
  'POST /api/v1/vouchers/:id/guthaben': { eingabe: WITHOUT_BODY, antwort: BalanceReply },
  'POST /api/v1/vouchers/:id/klartext': {
    antwort: VoucherPlaintext,
    ...confirmed(),
    geheim: true,
    schritt: 'gutschein',
  },
  'POST /api/v1/vouchers/:id/pdf-freigabe': {
    antwort: PdfFreigabe,
    ...confirmed(),
    geheim: true,
    schritt: 'gutschein',
  },
  'POST /api/v1/vouchers/export/pdf-freigabe': {
    antwort: PdfFreigabe,
    ...confirmed(),
    geheim: true,
    schritt: 'gutschein',
  },
  'GET /api/v1/vouchers/:id/pdf': { art: 'pdf', abfrage: query({ ticket: Q.text(200), download: Q.schalter }) },
  'GET /api/v1/vouchers/export/pdf': { art: 'pdf', abfrage: query({ ticket: Q.text(200) }) },
} satisfies Record<string, Route>;
