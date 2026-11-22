import { z } from 'zod';
import { type Route, abfrage, Q, SEITE, veraltet } from './base';
import { BrickLinkRef } from './shared';

export const CatalogTheme = z.looseObject({
  id: z.number().int(),
  name: z.string(),
  set_count: z.number().int(),
});

export const CatalogYearCount = z.looseObject({
  year: z.number().int(),
  n: z.number().int(),
});

export const CatalogMetaResponse = z.looseObject({
  success: z.boolean(),
  themes: z.array(CatalogTheme),
  year_min: z.number().int().nullable(),
  year_max: z.number().int().nullable(),
  year_counts: z.array(CatalogYearCount),
});

export const CatalogSetDetail = z.looseObject({
  set_number: z.string(),
  name: z.string().nullable(),
  year: z.number().int().nullable(),
  theme_id: z.number().int().nullable(),
  theme_name: z.string().nullable(),
  num_parts: z.number().int().nullable(),
  image_url: z.string().nullable(),
  image_local: z.string().nullable().optional(),
  minifigs: z.number().int(),
  owned: z.boolean(),
  owned_quantity: z.number().int(),
  bricklink: BrickLinkRef.nullable(),
  preisvergleich_url: z.string().nullable(),
});

export const CatalogSetDetailResponse = z.looseObject({
  success: z.boolean(),
  set: CatalogSetDetail.nullable(),
});

export const CatalogSetItem = z.looseObject({
  set_number: z.string(),
  name: z.string().nullable(),
  year: z.number().int().nullable(),
  theme_id: z.number().int().nullable(),
  theme_name: z.string().nullable(),
  num_parts: z.number().int().nullable(),
  image_url: z.string().nullable(),
  image_local: z.string().nullable(),
  owned: z.boolean(),
  owned_quantity: z.number().int(),
});

export const CatalogSetsResponse = z.looseObject({
  success: z.boolean(),
  total: z.number().int(),
  page: z.number().int(),
  page_size: z.number().int(),
  pages: z.number().int(),
  sets: z.array(CatalogSetItem),
});

export const JahrAnzahl = z.looseObject({
  year: z.number().int().nullable(),
  n: z.number().int(),
});

export const CatalogYearVerteilungResponse = z.looseObject({
  success: z.boolean(),
  years: z.array(JahrAnzahl),
});

/** BrickLink references per set number of the request. */
export const BricklinkVerweise = z.looseObject({ success: z.literal(true), links: z.record(z.string(), z.unknown()) });

export const routen = {
  'GET /api/v1/catalog/meta': { klein: true, antwort: CatalogMetaResponse },
  'GET /api/v1/catalog/sets': {
    antwort: CatalogSetsResponse,
    abfrage: abfrage({
      q: Q.text(),
      theme_id: Q.numberOrEmpty,
      year_from: Q.numberOrEmpty,
      year_to: Q.numberOrEmpty,
      sort: Q.text(40),
      ...SEITE,
      limit: veraltet(Q.zahl(), 'page_size'),
    }),
  },
  'GET /api/v1/catalog/sets/:setNumber': { antwort: CatalogSetDetailResponse },
  'GET /api/v1/catalog/year-verteilung': {
    klein: true,
    antwort: CatalogYearVerteilungResponse,
    abfrage: abfrage({ q: Q.text(), theme_id: Q.numberOrEmpty, sort: Q.text(40) }),
  },
  'GET /api/v1/catalog/bricklink': { antwort: BricklinkVerweise, abfrage: abfrage({ sets: Q.text(4000) }) },
} satisfies Record<string, Route>;
