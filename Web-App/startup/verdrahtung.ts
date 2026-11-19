/** Die eine Stelle, an der verdrahtet wird: Bereiche und die Klienten
 * (über src/fremdquellen) entstehen aus einem Datenbankzugang. Der Einstieg (server.ts, Skripte,
 * Testhilfen) hält das Ergebnis und reicht es weiter; einen Prozess-Speicher gibt es nicht. */
import path from 'node:path';
import { erzeugeAuftraege, type Anmeldung, type AuftragsArt } from '../src/auftraege';
import { dbKonfigAusUmgebung, erzeugeDb, type Db } from '../db/database';
import { erzeugeSets } from '../src/sets';
import { erzeugeHaushalt } from '../src/haushalt';
import { erzeugeMail } from '../src/mail';
import { createIdempotency } from '../src/idempotency';
import { erzeugeBestand } from '../src/bestand';
import { createParts } from '../src/parts';
import { createMinifigs } from '../src/minifigs';
import { createWanted } from '../src/wanted';
import { createVouchers } from '../src/vouchers';
import { createCollection } from '../src/collection';
import { erzeugeVerwaltung } from '../src/verwaltung';
import { erzeugeKatalog } from '../src/katalog';
import { type Bildwerk, erzeugeBilder } from '../src/bilder';
import { erzeugeFinanzen } from '../src/finanzen';
import { erzeugeKonto } from '../src/konto';
import { createFactors } from '../src/factors';
import { createProfile } from '../src/profile';
import { erzeugeFremdquellen, type Quellen } from '../src/fremdquellen';
import { createSettings } from '../src/settings';
import { createThrottle } from '../src/throttle';
import { erzeugeGeraete } from '../src/geraete';
import { konfig, type Konfig } from '../src/infra/konfig';
import { systemUhr, type Uhr } from '../src/infra/uhr';
import { LESEVERTRAG, type Dienste } from '../src/dienste';

export type { Dienste } from '../src/dienste';

/** Was ein Test statt des Echten gibt: eigenes Bildwerk, eigene Fremdquellen. */
export interface Bauteile {
  bildwerk?: Bildwerk;
  /** Ersetzte Klienten (src/fremdquellen/quellen.ts), gelesen beim Aufruf. */
  quellen?: Partial<Quellen>;
  /** Nur Testhilfen: Hier legt jede Fabrik ihren Kontext ab (Einblick). */
  kontexte?: Record<string, unknown>;
  /** Die Konfiguration; ohne Angabe die des Prozesses (src/infra/konfig.ts). */
  konfig?: Readonly<Konfig>;
  /** Die Zeit der Dienste (k.uhr); ohne Angabe die des Systems. */
  uhr?: Uhr;
}
type Gesetzt = Bauteile & { konfig: Readonly<Konfig>; uhr: Uhr };

// Der Katalog-Import läuft in einem eigenen Prozess; sein Einstieg liegt im Bau unter jobs/.
const IMPORT_PROZESS = path.join(__dirname, '..', 'jobs', 'csvImportWorker.js');

/** Alle Bereiche über einen Zugang, von unten nach oben: Jeder bekommt die Dienste
 * der tieferen, die er braucht, als Teil seines Kontexts. Wer einen höheren braucht,
 * horcht auf ein Ereignis des tieferen (etwa beiSetBildGeladen); späte Bindung gibt es nicht. */
export function baueDienste(db: Db, bauteile: Bauteile = {}): Dienste {
  const d = baueBereiche(db, { ...bauteile, konfig: bauteile.konfig ?? konfig(), uhr: bauteile.uhr ?? systemUhr });
  meldeAuftragsartenAn(d);
  return d;
}

/** Jede deklarierte Art (AuftragsNutzlasten): Der Übersetzer verlangt hier jede, der Start prüft ihre Anmeldung. */
export const DEKLARIERTE_ARTEN: Record<AuftragsArt, true> = {
  anleitung: true,
  aufraeumen: true,
  aufraeumen_taeglich: true,
  bild_nachlauf: true,
  bildbedarf: true,
  bilder: true,
  bilder_neu_laden: true,
  brickset: true,
  csv_import: true,
  csv_sync: true,
  katalog_nachzug: true,
  konto_dateien: true,
  nacharbeit: true,
  nachlauf: true,
  pdf: true,
  preise: true,
  preise_nachladen: true,
  wechselkurse: true,
  widerrufsliste: true,
};

export class ArtNichtAngemeldet extends Error {}

/** Jeder Bereich meldet seine Auftragsarten mit Nutzlast und Ausführer; die Warteschlange kennt keine. */
function meldeAuftragsartenAn(d: Dienste): void {
  const arten: Anmeldung[] = [
    ...d.bilder.auftragsarten(),
    ...d.konto.auftragsarten(),
    ...d.katalog.auftragsarten(IMPORT_PROZESS),
    ...d.finanzen.auftragsarten(),
    ...d.sets.auftragsarten(),
    ...d.collection.jobKinds(),
    ...d.parts.jobKinds(),
    ...d.verwaltung.auftragsarten(),
  ];
  for (const a of arten) d.auftraege.meldeArtAn(a);
  const angemeldet = new Set(d.auftraege.angemeldeteArten().map(a => a.art));
  const fehlt = Object.keys(DEKLARIERTE_ARTEN).filter(a => !angemeldet.has(a as AuftragsArt));
  if (fehlt.length) throw new ArtNichtAngemeldet(`Auftragsart ohne Anmeldung: ${fehlt.join(', ')}`);
}

type Zeige = ReturnType<typeof einblickIn>;

/** Je Bereich ein Rückruf, der seinen Kontext ablegt; ohne Ablage keiner. */
function einblickIn(kontexte: Record<string, unknown> | undefined) {
  return (name: string) =>
    kontexte
      ? (k: unknown) => {
          kontexte[name] = k;
        }
      : undefined;
}

/** Die Bereiche bis zum Katalog: Sie brauchen nur einander und den Zugang. */
function baueGrund(db: Db, { bildwerk, quellen, konfig, uhr }: Gesetzt, zeige: Zeige) {
  const throttle = createThrottle({ db, uhr }, zeige('throttle'));
  const einstellungen = createSettings({ db, uhr, throttle, lesevertrag: LESEVERTRAG }, zeige('settings'));
  const mail = erzeugeMail({ uhr, einstellungen, konfig }, zeige('mail'));
  const auftraege = erzeugeAuftraege({ db, uhr, einstellungen, lesevertrag: LESEVERTRAG }, zeige('auftraege'));
  const haushalt = erzeugeHaushalt({ db, uhr, einstellungen, lesevertrag: LESEVERTRAG }, zeige('haushalt'));
  const geraete = erzeugeGeraete({ db, uhr, konfig, auftraege, lesevertrag: LESEVERTRAG }, zeige('geraete'));
  const factors = createFactors({ db, uhr, konfig, einstellungen }, zeige('factors'));
  const konto = erzeugeKonto(
    { db, uhr, konfig, einstellungen, auftraege, haushalt, mail, throttle, geraete, factors },
    zeige('konto'),
  );
  const profile = createProfile({ db, uhr, konfig, einstellungen, konto, mail }, zeige('profile'));
  const idempotency = createIdempotency({ db, uhr }, zeige('idempotency'));
  const fremdquellen = erzeugeFremdquellen(
    { db, uhr, einstellungen, auftraege, ersatz: quellen },
    zeige('fremdquellen'),
  );
  const bilder = erzeugeBilder(
    { db, uhr, konfig, auftraege, haushalt, fremdquellen, bildwerk, lesevertrag: LESEVERTRAG },
    zeige('bilder'),
  );
  const katalog = erzeugeKatalog(
    { db, uhr, einstellungen, auftraege, haushalt, fremdquellen, bilder, throttle, lesevertrag: LESEVERTRAG },
    zeige('katalog'),
  );
  // Den Eintrag beim Set macht der Katalog (höher); er horcht auf die Bilder, statt dass sie ihn rufen.
  bilder.beiSetBildGeladen((sn, quelle) => katalog.setBildLokalEintragen(sn, quelle));
  return {
    throttle,
    settings: einstellungen,
    mail,
    auftraege,
    haushalt,
    geraete,
    factors,
    konto,
    profile,
    idempotency,
    fremdquellen,
    bilder,
    katalog,
  };
}

function baueBereiche(db: Db, bauteile: Gesetzt): Dienste {
  const zeige = einblickIn(bauteile.kontexte);
  const grund = baueGrund(db, bauteile, zeige);
  const {
    throttle,
    settings: einstellungen,
    mail,
    auftraege,
    haushalt,
    factors,
    konto,
    idempotency,
    fremdquellen,
    bilder,
    katalog,
  } = grund;
  const { konfig, uhr } = bauteile;
  const finanzen = erzeugeFinanzen(
    { db, uhr, konfig, einstellungen, auftraege, haushalt, katalog, fremdquellen, mail, lesevertrag: LESEVERTRAG },
    zeige('finanzen'),
  );
  const bestand = erzeugeBestand(
    { db, uhr, einstellungen, haushalt, konto, katalog, finanzen, lesevertrag: LESEVERTRAG },
    zeige('bestand'),
  );
  const sets = erzeugeSets(
    { db, uhr, konfig, katalog, fremdquellen, bilder, finanzen, haushalt, auftraege, bestand, einstellungen, konto },
    zeige('sets'),
  );
  const parts = createParts(
    { db, uhr, einstellungen, auftraege, haushalt, katalog, fremdquellen, finanzen, bestand },
    zeige('parts'),
  );
  const minifigs = createMinifigs(
    { db, uhr, einstellungen, haushalt, katalog, fremdquellen, auftraege, finanzen, bestand },
    zeige('minifigs'),
  );
  const wanted = createWanted(
    { db, uhr, einstellungen, haushalt, katalog, fremdquellen, bilder, finanzen, sets },
    zeige('wanted'),
  );
  const vouchers = createVouchers({ db, uhr, einstellungen, konto, fremdquellen, throttle }, zeige('vouchers'));
  const collection = createCollection(
    { db, uhr, haushalt, auftraege, katalog, finanzen, bestand, sets, parts, minifigs, wanted },
    zeige('collection'),
  );
  const verwaltung = erzeugeVerwaltung(
    {
      db,
      uhr,
      einstellungen,
      auftraege,
      factors,
      konto,
      idempotency,
      katalog,
      fremdquellen,
      bilder,
      finanzen,
      bestand,
      sets,
      wanted,
      gutscheine: vouchers,
      mail,
    },
    zeige('verwaltung'),
  );
  return { ...grund, finanzen, bestand, sets, parts, minifigs, wanted, vouchers, collection, verwaltung };
}

/** Der Zugang des Prozesses samt Erststart, verdrahtet. Der Erststart legt das erste
 * Konto über die Dienste an, die erst nach dem Zugang entstehen. */
export function verdrahteProzess(): { db: Db; dienste: Dienste } {
  const fertig: { d: Dienste | null } = { d: null };
  const db = erzeugeDb(dbKonfigAusUmgebung(), {
    erststart: async () => {
      if (!fertig.d) throw new Error('Erststart vor der Verdrahtung');
      await fertig.d.konto.legeStartVerwalterAn();
    },
  });
  fertig.d = baueDienste(db);
  return { db, dienste: fertig.d };
}
