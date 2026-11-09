import { z } from 'zod';
import { type Route, zeit, Erfolg } from './grund';

/** Die Schritte, die die App hinter ihren Schrittschutz stellt (src/konto/geraeteChallenge.ts). */
export const AKTIONEN = ['gutschein', 'verwaltung', 'zweiter_faktor'] as const;

export const SchrittChallenge = z.looseObject({
  success: z.literal(true),
  challenge: z.string(),
  /** Genau diesen Text signiert die App (UTF-8, SHA256withECDSA). */
  nachricht: z.string(),
  gueltig_bis: zeit,
});

export const SchrittFreigabe = z.looseObject({
  success: z.literal(true),
  aktion: z.enum(AKTIONEN),
  gueltig_bis: zeit,
});

export const routen = {
  'POST /api/v1/geraet/schluessel': {
    antwort: Erfolg,
    eingabe: z.strictObject({ oeffentlich: z.string().min(1).max(512) }),
  },
  'POST /api/v1/geraet/schritt/challenge': {
    antwort: SchrittChallenge,
    geheim: true,
    eingabe: z.strictObject({ aktion: z.enum(AKTIONEN) }),
  },
  'POST /api/v1/geraet/schritt/freigabe': {
    antwort: SchrittFreigabe,
    geheim: true,
    eingabe: z.strictObject({ challenge: z.string().min(1).max(128), signatur: z.string().min(1).max(512) }),
  },
} satisfies Record<string, Route>;
