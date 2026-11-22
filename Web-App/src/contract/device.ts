import { z } from 'zod';
import { v1Keys, v1Values } from './v1';
import { type Route, time, Success, WITHOUT_BODY } from './base';

/** The steps the app puts behind its step guard (src/devices/deviceChallenge.ts). */
export const ACTIONS = ['voucher', 'admin', 'second_factor'] as const;
const Action = v1Values(z.enum(ACTIONS), {
  voucher: 'gutschein',
  admin: 'verwaltung',
  second_factor: 'zweiter_faktor',
});

export const StepChallenge = z.looseObject({
  success: z.literal(true),
  challenge: z.string(),
  /** Exactly this text is signed by the app (UTF-8, SHA256withECDSA). */
  message: z.string(),
  valid_until: time,
});

export const StepApproval = z.looseObject({
  success: z.literal(true),
  action: Action,
  valid_until: time,
});

/** Base64 of the nonce; the app uses its bytes as the attestation challenge. */
export const KeyNonce = z.looseObject({ success: z.literal(true), nonce: z.string() });

// v1 names of fields whose v2 name also exists unchanged elsewhere (v1.ts).
v1Keys(StepChallenge, { message: 'nachricht' });
v1Keys(StepApproval, { action: 'aktion' });

export const routes = {
  'POST /api/v2/device/key/nonce': { response: KeyNonce, secret: true, input: WITHOUT_BODY },
  'POST /api/v2/device/key': {
    response: Success,
    /** `kette`: the certificates of the keystore key (Base64 DER, leaf first). `oeffentlich`
     * is sent by older apps; without a chain the server rejects them with `geraeteschluessel_attestation`. */
    input: z.strictObject({
      public_key: z.string().min(1).max(512).optional(),
      chain: z.array(z.string().min(1).max(8192)).min(1).max(8).optional(),
    }),
  },
  'POST /api/v2/device/step/challenge': {
    response: StepChallenge,
    secret: true,
    input: v1Keys(z.strictObject({ action: Action }), { action: 'aktion' }),
  },
  'POST /api/v2/device/step/approval': {
    response: StepApproval,
    secret: true,
    input: z.strictObject({ challenge: z.string().min(1).max(128), signature: z.string().min(1).max(512) }),
  },
} satisfies Record<string, Route>;
