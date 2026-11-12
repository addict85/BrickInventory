import { z } from 'zod';
import { type Route, zeit, bestaetigt, OHNE_RUMPF, TEXT, abfrage, Q, SEITE, SEITEN_ANGABE } from './grund';
import { GenericResponse } from './gemeinsam';
import { eingabe } from '../infra/validate';

export const GelesenerGutschein = z.looseObject({
  number: z.string().nullable().optional(),
  pin: z.string().nullable().optional(),
  amount: z.number().optional(),
  currency: z.string().nullable().optional(),
});

export const Gutschein = z.looseObject({
  id: z.number().int(),
  number: z.string(),
  pin: z.string().nullable().optional(),
  amount: z.number(),
  currency: z.string(),
  hat_pdf: z.boolean(),
  created_at: zeit.nullable().optional(),
  updated_at: zeit.nullable().optional(),
  guthaben_geprueft_am: zeit.nullable().optional(),
});

export const GuthabenAntwort = z.looseObject({
  success: z.boolean().optional(),
  voucher: Gutschein.nullable().optional(),
  angezeigt: z.string().nullable().optional(),
  waehrung_geaendert: z.boolean().optional(),
  grund: z.string().nullable().optional(),
  wartenSek: z.number().int().nullable().optional(),
  error: z.string().nullable().optional(),
  code: z.string().nullable().optional(),
});

export const GutscheinStapel = z.looseObject({
  results: z.array(z.unknown()).optional(),
  added: z.number().int().optional(),
  updated: z.number().int().optional(),
  errors: z.number().int().optional(),
  total: z.number().int().optional(),
});

export const GutscheinAntwort = z.looseObject({
  success: z.boolean().optional(),
  voucher: Gutschein.nullable().optional(),
  mehrere: GutscheinStapel.nullable().optional(),
  gelesen: GelesenerGutschein.nullable().optional(),
  error: z.string().nullable().optional(),
  code: z.string().nullable().optional(),
});

export const GutscheinListe = z.looseObject({
  success: z.boolean(),
  ...SEITEN_ANGABE,
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
      number: TEXT(40),
      pin: TEXT(40).nullable().optional(),
      amount: eingabe.geld('Betrag', { nullbar: false, einCode: 'betrag_ungueltig' }),
      currency: TEXT(40).nullable().optional(),
    }),
    antwort: GutscheinAntwort,
  },
  'PUT /api/v1/vouchers/:id': {
    eingabe: z.strictObject({
      number: TEXT(40).optional(),
      pin: TEXT(40).nullable().optional(),
      amount: eingabe.geld('Betrag', { nullbar: false, einCode: 'betrag_ungueltig' }).optional(),
      currency: TEXT(40).nullable().optional(),
    }),
    antwort: GutscheinAntwort,
  },
  'DELETE /api/v1/vouchers/:id': { antwort: GenericResponse, ...bestaetigt() },
  'POST /api/v1/vouchers/pdf': {
    formular: true,
    antwort: GutscheinAntwort,
    eingabe: z.strictObject({
      number: TEXT(40).optional(),
      pin: TEXT(40).optional(),
      amount: eingabe.geld('Betrag', { nullbar: false, einCode: 'betrag_ungueltig' }).optional(),
      currency: TEXT(40).optional(),
    }),
  },
  'POST /api/v1/vouchers/:id/guthaben': { eingabe: OHNE_RUMPF, antwort: GuthabenAntwort },
  'POST /api/v1/vouchers/:id/klartext': { antwort: GutscheinKlartext, ...bestaetigt(), geheim: true },
  'POST /api/v1/vouchers/:id/pdf-freigabe': { antwort: PdfFreigabe, ...bestaetigt(), geheim: true },
  'POST /api/v1/vouchers/export/pdf-freigabe': { antwort: PdfFreigabe, ...bestaetigt(), geheim: true },
  'GET /api/v1/vouchers/:id/pdf': { art: 'pdf', abfrage: abfrage({ ticket: Q.text(200), download: Q.schalter }) },
  'GET /api/v1/vouchers/export/pdf': { art: 'pdf', abfrage: abfrage({ ticket: Q.text(200) }) },
} satisfies Record<string, Route>;
