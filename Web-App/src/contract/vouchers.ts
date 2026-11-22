import { z } from 'zod';
import { v1Keys } from './v1';
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
const VOUCHER_NUMBER = input.rule(voucherNumber, { type: 'string', pattern: '^[0-9 -]{4,40}$' });
const VOUCHER_PIN = input.rule(voucherPin, { type: ['string', 'null'], pattern: '^\\s*([0-9]{3,10})?\\s*$' });
const VOUCHER_CURRENCY = input.rule(voucherCurrency, { type: ['string', 'null'], pattern: '^([A-Za-z]{3})?$' });
const NUMBER_OR_MASK = input.rule(voucherNumberOrMask, {
  type: 'string',
  pattern: '^([0-9 -]{4,40}|…[0-9]{4})$',
});
const PIN_OR_MASK = input.rule(voucherPinOrMask, {
  type: ['string', 'null'],
  pattern: '^(\\s*([0-9]{3,10})?\\s*|•••)$',
});
const CURRENCY_CHANGE = input.rule(voucherCurrencyChange, {
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
  has_pdf: z.boolean(),
  created_at: time,
  updated_at: time,
  balance_checked_at: time.nullable(),
});

export const BalanceReply = z.looseObject({
  success: z.boolean(),
  voucher: Voucher.nullable(),
  displayed: z.string().nullable(),
  currency_changed: z.boolean(),
  reason: z.string().nullable().optional(),
  waitSeconds: z.number().int().nullable().optional(),
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
  multiple: VoucherBatch.nullable().optional(),
  parsed: ParsedVoucher.nullable().optional(),
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

export const PdfGrant = z.looseObject({
  success: z.literal(true),
  ticket: z.string(),
  valid_seconds: z.number().int(),
});

// v1 names of fields whose v2 name also exists unchanged elsewhere (v1.ts).
v1Keys(BalanceReply, { reason: 'grund' });

export const routes = {
  'GET /api/v2/vouchers': { response: VoucherList, query: query(PAGE) },
  'POST /api/v2/vouchers': {
    input: z.strictObject({
      number: VOUCHER_NUMBER,
      pin: VOUCHER_PIN.optional(),
      amount: input.geld('Betrag', { nullbar: false, oneCode: 'amount_invalid' }),
      currency: VOUCHER_CURRENCY.optional(),
    }),
    response: VoucherReply,
  },
  'PUT /api/v2/vouchers/:id': {
    input: z.strictObject({
      number: NUMBER_OR_MASK.optional(),
      pin: PIN_OR_MASK.optional(),
      amount: input.geld('Betrag', { nullbar: false, oneCode: 'amount_invalid' }).optional(),
      currency: CURRENCY_CHANGE.optional(),
    }),
    response: VoucherReply,
  },
  'DELETE /api/v2/vouchers/:id': { response: GenericResponse, ...confirmed(), step: 'voucher' },
  'POST /api/v2/vouchers/pdf': {
    form: true,
    response: VoucherReply,
    input: z.strictObject({
      number: VOUCHER_NUMBER.optional(),
      pin: VOUCHER_PIN.optional(),
      amount: input.geld('Betrag', { nullbar: false, oneCode: 'amount_invalid' }).optional(),
      currency: VOUCHER_CURRENCY.optional(),
    }),
  },
  'POST /api/v2/vouchers/:id/balance': { input: WITHOUT_BODY, response: BalanceReply },
  'POST /api/v2/vouchers/:id/plaintext': {
    response: VoucherPlaintext,
    ...confirmed(),
    secret: true,
    step: 'voucher',
  },
  'POST /api/v2/vouchers/:id/pdf-grant': {
    response: PdfGrant,
    ...confirmed(),
    secret: true,
    step: 'voucher',
  },
  'POST /api/v2/vouchers/export/pdf-grant': {
    response: PdfGrant,
    ...confirmed(),
    secret: true,
    step: 'voucher',
  },
  'GET /api/v2/vouchers/:id/pdf': { kind: 'pdf', query: query({ ticket: Q.text(200), download: Q.toggle }) },
  'GET /api/v2/vouchers/export/pdf': { kind: 'pdf', query: query({ ticket: Q.text(200) }) },
} satisfies Record<string, Route>;
