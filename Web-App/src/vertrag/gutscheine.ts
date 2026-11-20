import { z } from 'zod';
import { type Route, zeit, bestaetigt, WITHOUT_BODY, abfrage, Q, SEITE, PAGES_DETAIL } from './grund';
import { GenericResponse } from './gemeinsam';
import { eingabe } from '../infra/validate';
import {
  gutscheinNummer,
  voucherNumberOrMask,
  voucherPin,
  voucherPinOrMask,
  voucherCurrency,
  voucherCurrencyChange,
} from '../infra/gutscheinWerte';

/** Das Format prüft der Vertrag; der Dienst bekommt nur geprüfte Werte (src/infra/gutscheinWerte.ts). */
const VOUCHER_NUMBER = eingabe.regel(gutscheinNummer, { type: 'string', pattern: '^[0-9 -]{4,40}$' });
const VOUCHER_PIN = eingabe.regel(voucherPin, { type: ['string', 'null'], pattern: '^\\s*([0-9]{3,10})?\\s*$' });
const VOUCHER_CURRENCY = eingabe.regel(voucherCurrency, { type: ['string', 'null'], pattern: '^([A-Za-z]{3})?$' });
const NUMBER_OR_MASK = eingabe.regel(voucherNumberOrMask, {
  type: 'string',
  pattern: '^([0-9 -]{4,40}|…[0-9]{4})$',
});
const PIN_OR_MASK = eingabe.regel(voucherPinOrMask, {
  type: ['string', 'null'],
  pattern: '^(\\s*([0-9]{3,10})?\\s*|•••)$',
});
const CURRENCY_CHANGE = eingabe.regel(voucherCurrencyChange, {
  type: ['string', 'null'],
  pattern: '^([A-Za-z]{3})?$',
});

export const GelesenerGutschein = z.looseObject({
  number: z.string().nullable(),
  pin: z.string().nullable(),
  amount: z.number().optional(),
  currency: z.string().nullable(),
});

export const Gutschein = z.looseObject({
  id: z.number().int(),
  number: z.string(),
  pin: z.string().nullable(),
  amount: z.number(),
  currency: z.string(),
  hat_pdf: z.boolean(),
  created_at: zeit,
  updated_at: zeit,
  guthaben_geprueft_am: zeit.nullable(),
});

export const GuthabenAntwort = z.looseObject({
  success: z.boolean(),
  voucher: Gutschein.nullable(),
  angezeigt: z.string().nullable(),
  waehrung_geaendert: z.boolean(),
  grund: z.string().nullable().optional(),
  wartenSek: z.number().int().nullable().optional(),
  error: z.string().nullable().optional(),
  code: z.string().nullable().optional(),
});

export const GutscheinStapel = z.looseObject({
  results: z.array(z.unknown()),
  added: z.number().int(),
  updated: z.number().int(),
  errors: z.number().int(),
  total: z.number().int(),
});

export const GutscheinAntwort = z.looseObject({
  success: z.boolean(),
  voucher: Gutschein.nullable().optional(),
  mehrere: GutscheinStapel.nullable().optional(),
  gelesen: GelesenerGutschein.nullable().optional(),
  error: z.string().nullable().optional(),
  code: z.string().nullable().optional(),
});

export const GutscheinListe = z.looseObject({
  success: z.boolean(),
  ...PAGES_DETAIL,
  vouchers: z.array(Gutschein),
});

export const GutscheinKlartext = z.looseObject({
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
  'GET /api/v1/vouchers': { antwort: GutscheinListe, abfrage: abfrage(SEITE) },
  'POST /api/v1/vouchers': {
    eingabe: z.strictObject({
      number: VOUCHER_NUMBER,
      pin: VOUCHER_PIN.optional(),
      amount: eingabe.geld('Betrag', { nullbar: false, oneCode: 'betrag_ungueltig' }),
      currency: VOUCHER_CURRENCY.optional(),
    }),
    antwort: GutscheinAntwort,
  },
  'PUT /api/v1/vouchers/:id': {
    eingabe: z.strictObject({
      number: NUMBER_OR_MASK.optional(),
      pin: PIN_OR_MASK.optional(),
      amount: eingabe.geld('Betrag', { nullbar: false, oneCode: 'betrag_ungueltig' }).optional(),
      currency: CURRENCY_CHANGE.optional(),
    }),
    antwort: GutscheinAntwort,
  },
  'DELETE /api/v1/vouchers/:id': { antwort: GenericResponse, ...bestaetigt(), schritt: 'gutschein' },
  'POST /api/v1/vouchers/pdf': {
    formular: true,
    antwort: GutscheinAntwort,
    eingabe: z.strictObject({
      number: VOUCHER_NUMBER.optional(),
      pin: VOUCHER_PIN.optional(),
      amount: eingabe.geld('Betrag', { nullbar: false, oneCode: 'betrag_ungueltig' }).optional(),
      currency: VOUCHER_CURRENCY.optional(),
    }),
  },
  'POST /api/v1/vouchers/:id/guthaben': { eingabe: WITHOUT_BODY, antwort: GuthabenAntwort },
  'POST /api/v1/vouchers/:id/klartext': {
    antwort: GutscheinKlartext,
    ...bestaetigt(),
    geheim: true,
    schritt: 'gutschein',
  },
  'POST /api/v1/vouchers/:id/pdf-freigabe': {
    antwort: PdfFreigabe,
    ...bestaetigt(),
    geheim: true,
    schritt: 'gutschein',
  },
  'POST /api/v1/vouchers/export/pdf-freigabe': {
    antwort: PdfFreigabe,
    ...bestaetigt(),
    geheim: true,
    schritt: 'gutschein',
  },
  'GET /api/v1/vouchers/:id/pdf': { art: 'pdf', abfrage: abfrage({ ticket: Q.text(200), download: Q.schalter }) },
  'GET /api/v1/vouchers/export/pdf': { art: 'pdf', abfrage: abfrage({ ticket: Q.text(200) }) },
} satisfies Record<string, Route>;
