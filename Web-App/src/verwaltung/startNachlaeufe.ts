/** Je Schritt ein Auftrag 'nachlauf', damit ein Fehler wiederholt wird und in der Verwaltung zu sehen ist. */
import { anleitungenNachtragen, setBilderNachladen, vorschaubilderNachtragen } from '../katalog/bildlage';
import { verschluesseleAltbestand } from '../konto/geheimnisAltbestand';
import { verschluesseleGutscheinAltbestand } from '../gutscheine/gutscheinDateien';
import * as catalogSync from '../katalog/katalogAbgleich';
import * as purchasePriceBackfill from '../bestand/kaufpreisNachtrag';
import type { Nutzlast } from '../auftraege/nutzlasten';
import { pruefeAbbruch, type AuftragsLauf } from '../auftraege/auftraege';

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
} as const satisfies Record<Nachlauf, { nachSekunden: number; lauf: () => Promise<unknown> }>;
type Nachlauf = Nutzlast<'nachlauf'>['schritt'];

async function nachlauf(n: Nutzlast<'nachlauf'>, lauf?: AuftragsLauf): Promise<void> {
  pruefeAbbruch(lauf);
  await NACHLAEUFE[n.schritt].lauf();
}

export { NACHLAEUFE, nachlauf };
export type { Nachlauf };
