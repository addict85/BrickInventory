import { z } from 'zod';
import type { Route } from './grund';
import { BrickLinkRef } from './gemeinsam';

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
  year_min: z.number().int().nullable().optional(),
  year_max: z.number().int().nullable().optional(),
  year_counts: z.array(CatalogYearCount),
  error: z.string().nullable().optional(),
});

export const CatalogSetDetail = z.looseObject({
  set_number: z.string(),
  name: z.string().nullable().optional(),
  year: z.number().int().nullable().optional(),
  theme_id: z.number().int().nullable().optional(),
  theme_name: z.string().nullable().optional(),
  num_parts: z.number().int().nullable().optional(),
  image_url: z.string().nullable().optional(),
  image_local: z.string().nullable().optional(),
  minifigs: z.number().int(),
  owned: z.boolean(),
  owned_quantity: z.number().int(),
  bricklink: BrickLinkRef.nullable().optional(),
  preisvergleich_url: z.string().nullable().optional(),
});

export const CatalogSetDetailResponse = z.looseObject({
  success: z.boolean(),
  set: CatalogSetDetail.nullable().optional(),
  error: z.string().nullable().optional(),
});

export const CatalogSetItem = z.looseObject({
  set_number: z.string(),
  name: z.string().nullable().optional(),
  year: z.number().int().nullable().optional(),
  theme_id: z.number().int().nullable().optional(),
  theme_name: z.string().nullable().optional(),
  num_parts: z.number().int().nullable().optional(),
  image_url: z.string().nullable().optional(),
  image_local: z.string().nullable().optional(),
  owned: z.boolean(),
  owned_quantity: z.number().int(),
});

export const CatalogSetsResponse = z.looseObject({
  success: z.boolean(),
  total: z.number().int(),
  page: z.number().int(),
  pages: z.number().int(),
  sets: z.array(CatalogSetItem),
  error: z.string().nullable().optional(),
});

export const JahrAnzahl = z.looseObject({
  year: z.number().int().nullable().optional(),
  n: z.number().int(),
});

export const CatalogYearVerteilungResponse = z.looseObject({
  success: z.boolean(),
  years: z.array(JahrAnzahl),
});

/** BrickLink-Verweise je Set-Nummer der Anfrage. */
export const BricklinkVerweise = z.looseObject({ success: z.literal(true), links: z.record(z.string(), z.unknown()) });

export const routen = {
  'GET /api/v1/catalog/meta': { antwort: CatalogMetaResponse },
  'GET /api/v1/catalog/sets': { antwort: CatalogSetsResponse },
  'GET /api/v1/catalog/sets/:setNumber': { antwort: CatalogSetDetailResponse },
  'GET /api/v1/catalog/year-verteilung': { antwort: CatalogYearVerteilungResponse },
  'GET /api/v1/catalog/bricklink': { antwort: BricklinkVerweise },
} satisfies Record<string, Route>;
