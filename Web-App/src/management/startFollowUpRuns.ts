/** Je Schritt ein Auftrag 'nachlauf', damit ein Fehler wiederholt wird und in der Verwaltung zu sehen ist. */
import { type Nutzlast, pruefeAbbruch, type AuftragsLauf } from '../auftraege';
import type { ManagementContext } from './context';

/** Geheimnisse aus der Zeit vor der Verschlüsselung (src/infra/geheimnis.ts). */
async function encryptSecrets(k: ManagementContext): Promise<void> {
  const n = (await k.factors.encryptLegacySecrets()) + (await k.vouchers.encryptLegacyFiles());
  if (n) console.log(`[geheimnis] ${n} Geheimnisse nachträglich verschlüsselt`);
}

/** Die Schritte des Nachlaufs nach dem Start; die Nutzlast der Art 'nachlauf' kennt genau diese. */
export const NACHLAUF_SCHRITTE = [
  'geheimnisse',
  'vorschauen',
  'katalog',
  'anleitungen',
  'set_bilder',
  'kaufpreise',
] as const;
type FollowUpStep = (typeof NACHLAUF_SCHRITTE)[number];

/** Die Schritte und ihr Abstand zum Start in Sekunden: Beim Start hat der Katalog Vorrang. */
const FOLLOWUP_RUNS = {
  geheimnisse: { nachSekunden: 0 },
  vorschauen: { nachSekunden: 0 },
  katalog: { nachSekunden: 10 },
  anleitungen: { nachSekunden: 15 },
  set_bilder: { nachSekunden: 45 },
  kaufpreise: { nachSekunden: 45 },
} as const satisfies Record<FollowUpStep, { nachSekunden: number }>;

function runners(k: ManagementContext): Record<FollowUpStep, () => Promise<unknown>> {
  return {
    geheimnisse: () => encryptSecrets(k),
    vorschauen: () => k.katalog.vorschaubilderNachtragen(),
    katalog: () => k.katalog.gleicheFehlendeAb(),
    anleitungen: () => k.katalog.anleitungenNachtragen(),
    set_bilder: () => k.katalog.setBilderNachladen(),
    kaufpreise: () => k.bestand.kaufpreiseNachtragen(),
  };
}

async function runFollowUp(k: ManagementContext, n: Nutzlast<'nachlauf'>, lauf?: AuftragsLauf): Promise<void> {
  pruefeAbbruch(lauf);
  await runners(k)[n.schritt]();
}

export { FOLLOWUP_RUNS, runFollowUp };
export type { FollowUpStep };
