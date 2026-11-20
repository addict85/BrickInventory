import { z } from 'zod';
import { type Route, zeit, Erfolg, WITHOUT_BODY } from './base';

/** The steps the app puts behind its step guard (src/devices/deviceChallenge.ts). */
export const ACTIONS = ['gutschein', 'verwaltung', 'zweiter_faktor'] as const;

export const SchrittChallenge = z.looseObject({
  success: z.literal(true),
  challenge: z.string(),
  /** Exactly this text is signed by the app (UTF-8, SHA256withECDSA). */
  nachricht: z.string(),
  gueltig_bis: zeit,
});

export const SchrittFreigabe = z.looseObject({
  success: z.literal(true),
  aktion: z.enum(ACTIONS),
  gueltig_bis: zeit,
});

/** Base64 of the nonce; the app uses its bytes as the attestation challenge. */
export const SchluesselNonce = z.looseObject({ success: z.literal(true), nonce: z.string() });

export const routen = {
  'POST /api/v1/geraet/schluessel/nonce': { antwort: SchluesselNonce, geheim: true, eingabe: WITHOUT_BODY },
  'POST /api/v1/geraet/schluessel': {
    antwort: Erfolg,
    /** `kette`: the certificates of the keystore key (Base64 DER, leaf first). `oeffentlich`
     * is sent by older apps; without a chain the server rejects them with `geraeteschluessel_attestation`. */
    eingabe: z.strictObject({
      oeffentlich: z.string().min(1).max(512).optional(),
      kette: z.array(z.string().min(1).max(8192)).min(1).max(8).optional(),
    }),
  },
  'POST /api/v1/geraet/schritt/challenge': {
    antwort: SchrittChallenge,
    geheim: true,
    eingabe: z.strictObject({ aktion: z.enum(ACTIONS) }),
  },
  'POST /api/v1/geraet/schritt/freigabe': {
    antwort: SchrittFreigabe,
    geheim: true,
    eingabe: z.strictObject({ challenge: z.string().min(1).max(128), signatur: z.string().min(1).max(512) }),
  },
} satisfies Record<string, Route>;
