/** Je Schritt ein Auftrag 'nachlauf', damit ein Fehler wiederholt wird und in der Verwaltung zu sehen ist. */
import { verschluesseleGutscheinAltbestand } from '../gutscheine';
import { type Nutzlast, pruefeAbbruch, type AuftragsLauf } from '../auftraege';
import type { VerwaltungKontext } from './kontext';

/** Geheimnisse aus der Zeit vor der Verschlüsselung (src/infra/geheimnis.ts). */
async function geheimnisseVerschluesseln(k: VerwaltungKontext): Promise<void> {
  const n = (await k.konto.verschluesseleAltbestand()) + (await verschluesseleGutscheinAltbestand());
  if (n) console.log(`[geheimnis] ${n} Geheimnisse nachträglich verschlüsselt`);
}

/** Die Schritte und ihr Abstand zum Start in Sekunden: Beim Start hat der Katalog Vorrang. */
const NACHLAEUFE = {
  geheimnisse: { nachSekunden: 0 },
  vorschauen: { nachSekunden: 0 },
  katalog: { nachSekunden: 10 },
  anleitungen: { nachSekunden: 15 },
  set_bilder: { nachSekunden: 45 },
  kaufpreise: { nachSekunden: 45 },
} as const satisfies Record<Nachlauf, { nachSekunden: number }>;
type Nachlauf = Nutzlast<'nachlauf'>['schritt'];

function laeufe(k: VerwaltungKontext): Record<Nachlauf, () => Promise<unknown>> {
  return {
    geheimnisse: () => geheimnisseVerschluesseln(k),
    vorschauen: () => k.katalog.vorschaubilderNachtragen(),
    katalog: () => k.katalog.syncAllMissing(),
    anleitungen: () => k.katalog.anleitungenNachtragen(),
    set_bilder: () => k.katalog.setBilderNachladen(),
    kaufpreise: () => k.bestand.run(),
  };
}

async function nachlauf(k: VerwaltungKontext, n: Nutzlast<'nachlauf'>, lauf?: AuftragsLauf): Promise<void> {
  pruefeAbbruch(lauf);
  await laeufe(k)[n.schritt]();
}

export { NACHLAEUFE, nachlauf };
export type { Nachlauf };
