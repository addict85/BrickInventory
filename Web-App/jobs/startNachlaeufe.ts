/**
 * Was der Job-Prozess bei jedem Start einmal nachholt — je Schritt ein
 * Auftrag 'nachlauf' (startup/jobsProzess.ts), damit ein Fehler wiederholt
 * wird und in der Verwaltung zu sehen ist.
 * Ausführlich: docs/begruendungen/jobs/startNachlaeufe.ts.md#abschnitt
 */
import { anleitungenNachtragen, setBilderNachladen, vorschaubilderNachtragen } from '../src/katalog/bildlage';
import { verschluesseleAltbestand } from '../src/konto/geheimnisAltbestand';
import { verschluesseleGutscheinAltbestand } from '../src/gutscheine/gutscheinDateien';
import * as catalogSync from '../src/katalog/katalogAbgleich';
import * as purchasePriceBackfill from './purchasePriceBackfill';

/** Geheimnisse aus der Zeit vor der Verschlüsselung (src/infra/geheimnis.ts). */
async function geheimnisseVerschluesseln(): Promise<void> {
  const n = await verschluesseleAltbestand() + await verschluesseleGutscheinAltbestand();
  if (n) console.log(`[geheimnis] ${n} Geheimnisse nachträglich verschlüsselt`);
}

/** Die Schritte und ihr Abstand zum Start in Sekunden: Beim Start hat der Katalog Vorrang. */
const NACHLAEUFE = {
  geheimnisse:  { nachSekunden: 0,  lauf: geheimnisseVerschluesseln },
  vorschauen:   { nachSekunden: 0,  lauf: vorschaubilderNachtragen },
  katalog:      { nachSekunden: 10, lauf: () => catalogSync.syncAllMissing() },
  anleitungen:  { nachSekunden: 15, lauf: anleitungenNachtragen },
  set_bilder:   { nachSekunden: 45, lauf: setBilderNachladen },
  kaufpreise:   { nachSekunden: 45, lauf: () => purchasePriceBackfill.run() },
} as const;
type Nachlauf = keyof typeof NACHLAEUFE;

/** Der Bearbeiter des Auftrags 'nachlauf'. */
async function nachlauf(n: Record<string, unknown>): Promise<void> {
  const schritt = String(n.schritt);
  if (!Object.hasOwn(NACHLAEUFE, schritt)) throw new Error(`unbekannter Nachlauf ${schritt}`);
  await NACHLAEUFE[schritt as Nachlauf].lauf();
}

export { NACHLAEUFE, nachlauf };
export type { Nachlauf };
