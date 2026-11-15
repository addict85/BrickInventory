/** Die eine Stelle, an der verdrahtet wird: Bereiche und die Klienten
 * (über src/fremdquellen) entstehen aus einem Datenbankzugang. Der Einstieg (server.ts, Skripte,
 * Testhilfen) hält das Ergebnis und reicht es weiter; einen Prozess-Speicher gibt es nicht. */
import { erzeugeAuftraege } from '../src/auftraege';
import { dbKonfigAusUmgebung, erzeugeDb, type Db } from '../db/database';
import { erzeugeSets } from '../src/sets';
import { erzeugeHaushalt } from '../src/haushalt';
import { erzeugeMail } from '../src/mail';
import { erzeugeIdempotenz } from '../src/idempotenz';
import { erzeugeBestand } from '../src/bestand';
import { erzeugeTeile } from '../src/teile';
import { erzeugeFiguren } from '../src/figuren';
import { erzeugeMerkliste } from '../src/merkliste';
import { erzeugeGutscheine } from '../src/gutscheine';
import { erzeugeSammlung } from '../src/sammlung';
import { erzeugeVerwaltung } from '../src/verwaltung';
import { erzeugeKatalog } from '../src/katalog';
import { type Bildwerk, erzeugeBilder } from '../src/bilder';
import { erzeugeFinanzen } from '../src/finanzen';
import { erzeugeKonto } from '../src/konto';
import { erzeugeProfil } from '../src/profil';
import { erzeugeFremdquellen, type Quellen } from '../src/fremdquellen';
import { erzeugeEinstellungen } from '../src/einstellungen';
import { erzeugeDrossel } from '../src/drossel';
import { erzeugeGeraete } from '../src/geraete';
import { konfig, type Konfig } from '../src/infra/konfig';
import { systemUhr, type Uhr } from '../src/infra/uhr';
import type { Dienste } from '../src/dienste';

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

/** Alle Bereiche über einen Zugang, von unten nach oben: Jeder bekommt die Dienste
 * der tieferen, die er braucht, als Teil seines Kontexts. Wer einen höheren braucht,
 * horcht auf ein Ereignis des tieferen (etwa beiSetBildGeladen); späte Bindung gibt es nicht. */
export function baueDienste(db: Db, bauteile: Bauteile = {}): Dienste {
  return baueBereiche(db, { ...bauteile, konfig: bauteile.konfig ?? konfig(), uhr: bauteile.uhr ?? systemUhr });
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
  const drossel = erzeugeDrossel({ db }, zeige('drossel'));
  const einstellungen = erzeugeEinstellungen({ db, uhr, drossel }, zeige('einstellungen'));
  const mail = erzeugeMail({ uhr, einstellungen, konfig }, zeige('mail'));
  const auftraege = erzeugeAuftraege({ db, uhr, einstellungen }, zeige('auftraege'));
  const haushalt = erzeugeHaushalt({ db, uhr, einstellungen }, zeige('haushalt'));
  const geraete = erzeugeGeraete({ db, konfig, auftraege }, zeige('geraete'));
  const konto = erzeugeKonto(
    { db, uhr, konfig, einstellungen, auftraege, haushalt, mail, drossel, geraete },
    zeige('konto'),
  );
  const profil = erzeugeProfil({ db, uhr, konfig, einstellungen, konto, mail }, zeige('profil'));
  const idempotenz = erzeugeIdempotenz({ db, uhr }, zeige('idempotenz'));
  const fremdquellen = erzeugeFremdquellen(
    { db, uhr, einstellungen, auftraege, ersatz: quellen },
    zeige('fremdquellen'),
  );
  const bilder = erzeugeBilder({ db, uhr, konfig, auftraege, haushalt, fremdquellen, bildwerk }, zeige('bilder'));
  const katalog = erzeugeKatalog(
    { db, uhr, einstellungen, auftraege, haushalt, fremdquellen, bilder, drossel },
    zeige('katalog'),
  );
  return {
    drossel,
    einstellungen,
    mail,
    auftraege,
    haushalt,
    geraete,
    konto,
    profil,
    idempotenz,
    fremdquellen,
    bilder,
    katalog,
  };
}

function baueBereiche(db: Db, bauteile: Gesetzt): Dienste {
  const zeige = einblickIn(bauteile.kontexte);
  const grund = baueGrund(db, bauteile, zeige);
  const { drossel, einstellungen, mail, auftraege, haushalt, konto, idempotenz, fremdquellen, bilder, katalog } = grund;
  const { konfig, uhr } = bauteile;
  const finanzen = erzeugeFinanzen(
    { db, uhr, konfig, einstellungen, auftraege, haushalt, katalog, fremdquellen, mail },
    zeige('finanzen'),
  );
  const bestand = erzeugeBestand({ db, uhr, einstellungen, haushalt, konto, katalog, finanzen }, zeige('bestand'));
  const sets = erzeugeSets(
    { db, uhr, konfig, katalog, fremdquellen, bilder, finanzen, haushalt, auftraege, bestand, einstellungen, konto },
    zeige('sets'),
  );
  const teile = erzeugeTeile(
    { db, uhr, einstellungen, haushalt, katalog, fremdquellen, finanzen, bestand },
    zeige('teile'),
  );
  const figuren = erzeugeFiguren(
    { db, uhr, einstellungen, haushalt, katalog, fremdquellen, auftraege, finanzen, bestand },
    zeige('figuren'),
  );
  const merkliste = erzeugeMerkliste(
    { db, uhr, einstellungen, haushalt, katalog, fremdquellen, bilder, finanzen, sets },
    zeige('merkliste'),
  );
  const gutscheine = erzeugeGutscheine({ db, uhr, einstellungen, konto, fremdquellen, drossel }, zeige('gutscheine'));
  const sammlung = erzeugeSammlung(
    { db, uhr, haushalt, auftraege, katalog, finanzen, bestand, sets, teile, figuren, merkliste },
    zeige('sammlung'),
  );
  const verwaltung = erzeugeVerwaltung(
    {
      db,
      uhr,
      einstellungen,
      auftraege,
      konto,
      idempotenz,
      katalog,
      fremdquellen,
      bilder,
      finanzen,
      bestand,
      sets,
      merkliste,
      gutscheine,
      mail,
    },
    zeige('verwaltung'),
  );
  return { ...grund, finanzen, bestand, sets, teile, figuren, merkliste, gutscheine, sammlung, verwaltung };
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
