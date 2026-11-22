/** One job 'nachlauf' per step, so that an error is retried and visible in the admin. */
import { type Nutzlast, checkAbort, type JobRun } from '../jobQueue';
import type { ManagementContext } from './context';

/** Secrets from the time before encryption (src/infra/secret.ts). */
async function encryptSecrets(k: ManagementContext): Promise<void> {
  const n = (await k.factors.encryptLegacySecrets()) + (await k.vouchers.encryptLegacyFiles());
  if (n) console.log(`[geheimnis] ${n} Geheimnisse nachträglich verschlüsselt`);
}

/** The steps of the follow-up after startup; the payload of the kind 'nachlauf' knows exactly these. */
export const FOLLOW_UP_STEPS = [
  'geheimnisse',
  'vorschauen',
  'katalog',
  'anleitungen',
  'set_bilder',
  'kaufpreise',
] as const;
type FollowUpStep = (typeof FOLLOW_UP_STEPS)[number];

/** The steps and their distance from startup in seconds: at startup the catalog has priority. */
const FOLLOWUP_RUNS = {
  geheimnisse: { afterSeconds: 0 },
  vorschauen: { afterSeconds: 0 },
  katalog: { afterSeconds: 10 },
  anleitungen: { afterSeconds: 15 },
  set_bilder: { afterSeconds: 45 },
  kaufpreise: { afterSeconds: 45 },
} as const satisfies Record<FollowUpStep, { afterSeconds: number }>;

function runners(k: ManagementContext): Record<FollowUpStep, () => Promise<unknown>> {
  return {
    geheimnisse: () => encryptSecrets(k),
    vorschauen: () => k.catalog.backfillThumbnails(),
    katalog: () => k.catalog.sameMissingAb(),
    anleitungen: () => k.catalog.backfillInstructions(),
    set_bilder: () => k.catalog.reloadSetImages(),
    kaufpreise: () => k.inventory.backfillPurchasePrices(),
  };
}

async function runFollowUp(k: ManagementContext, n: Nutzlast<'nachlauf'>, lauf?: JobRun): Promise<void> {
  checkAbort(lauf);
  await runners(k)[n.schritt]();
}

export { FOLLOWUP_RUNS, runFollowUp };
export type { FollowUpStep };
