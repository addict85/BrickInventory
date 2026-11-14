/** Die eine Stelle, an der verdrahtet wird: Bereiche, Nacharbeit und die Klienten
 * (über src/fremdquellen) entstehen aus einem Datenbankzugang. Der Einstieg (server.ts, Skripte,
 * Testhilfen) hält das Ergebnis und reicht es weiter; einen Prozess-Speicher gibt es nicht. */
import { erzeugeAuftraege, type Nacharbeit } from '../src/auftraege';
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
import { mitVersion } from '../src/infra/setNummer';
import { erzeugeKonto } from '../src/konto';
import { meldeFehler } from '../src/infra/fehler';
import { erzeugeFremdquellen, type Quellen } from '../src/fremdquellen';
import { erzeugeEinstellungen } from '../src/einstellungen';
import { konfig, type Konfig } from '../src/infra/konfig';
import type { Dienste } from '../src/dienste';

export type { Dienste } from '../src/dienste';

/** Die Nacharbeit ruft höhere Bereiche, die beim Bau der unteren noch nicht stehen:
 * Sie greift erst beim Aufruf auf die fertigen Dienste zu (späte Bindung). */
export function baueNacharbeit(d: () => Dienste): Nacharbeit & { ueber(db: Db): Nacharbeit } {
  return {
    // In einer Transaktion läuft die Nacharbeit über deren Verbindung, wie jeder Dienst in `t`.
    ueber: db => baueNacharbeit(() => ueberDb(d(), db)),
    preisJobAnstossen: () => {
      d()
        .auftraege.ziehePlanVor('preise')
        .catch((e: unknown) => meldeFehler('einstellungen:preis-job-anstossen', e));
    },
    preisFuerSetHolen: (sn, uid, zustand) => d().finanzen.refreshPriceForSet(sn, uid, zustand),
    bildVormerken: (url, sn) => d().bilder.merkeGebraucht(url, sn),
    setTeileAnreichern: sn => d().katalog.enrichSetParts(sn),
    figurenAnreichern: sn => d().katalog.enrichSetMinifigs(sn),
    setBilderLaden: sn =>
      d().auftraege.stelleAuftragEin(
        'bilder',
        { set_number: sn, nur_bilder: true },
        { schluessel: `bilder:${mitVersion(sn)}:nur`, maxVersuche: 3 },
      ),
  };
}

/** Jeder Bereich über einer anderen Verbindung (src/infra/bereich.ts, Bereich.ueber). */
function ueberDb(d: Dienste, db: Db): Dienste {
  return Object.fromEntries(
    Object.entries(d).map(([name, b]) => [name, (b as { ueber(db: Db): unknown }).ueber(db)]),
  ) as unknown as Dienste;
}

/** Was ein Test statt des Echten gibt: eigene Nacharbeit, eigenes Bildwerk, eigene Fremdquellen. */
export interface Bauteile {
  nacharbeit?: Nacharbeit;
  bildwerk?: Bildwerk;
  /** Ersetzte Klienten (src/fremdquellen/quellen.ts), gelesen beim Aufruf. */
  quellen?: Partial<Quellen>;
  /** Nur Testhilfen: Hier legt jede Fabrik ihren Kontext ab (Einblick). */
  kontexte?: Record<string, unknown>;
  /** Die Konfiguration; ohne Angabe die des Prozesses (src/infra/konfig.ts). */
  konfig?: Readonly<Konfig>;
}
type Gesetzt = Bauteile & { konfig: Readonly<Konfig> };

/** Alle Bereiche über einen Zugang, von unten nach oben: Jeder bekommt die Dienste
 * der tieferen, die er braucht, als Teil seines Kontexts. */
export function baueDienste(db: Db, bauteile: Bauteile = {}): Dienste {
  const fertig: { d: Dienste | null } = { d: null };
  const d = (): Dienste => {
    if (!fertig.d) throw new Error('Nacharbeit vor dem Ende von baueDienste gerufen');
    return fertig.d;
  };
  fertig.d = baueBereiche(db, bauteile.nacharbeit ?? baueNacharbeit(d), {
    ...bauteile,
    konfig: bauteile.konfig ?? konfig(),
  });
  return fertig.d;
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
function baueGrund(db: Db, nacharbeit: Nacharbeit, { bildwerk, quellen, konfig }: Gesetzt, zeige: Zeige) {
  const einstellungen = erzeugeEinstellungen({ db }, zeige('einstellungen'));
  const mail = erzeugeMail({ einstellungen, konfig }, zeige('mail'));
  const auftraege = erzeugeAuftraege({ db, einstellungen }, zeige('auftraege'));
  const haushalt = erzeugeHaushalt({ db, einstellungen }, zeige('haushalt'));
  const konto = erzeugeKonto({ db, konfig, einstellungen, auftraege, haushalt, nacharbeit, mail }, zeige('konto'));
  const idempotenz = erzeugeIdempotenz({ db }, zeige('idempotenz'));
  const fremdquellen = erzeugeFremdquellen({ db, einstellungen, auftraege, ersatz: quellen }, zeige('fremdquellen'));
  const bilder = erzeugeBilder(
    { db, konfig, auftraege, haushalt, nacharbeit, fremdquellen, bildwerk },
    zeige('bilder'),
  );
  const katalog = erzeugeKatalog(
    { db, einstellungen, auftraege, haushalt, nacharbeit, fremdquellen, bilder },
    zeige('katalog'),
  );
  return { einstellungen, mail, auftraege, haushalt, konto, idempotenz, fremdquellen, bilder, katalog };
}

function baueBereiche(db: Db, nacharbeit: Nacharbeit, bauteile: Gesetzt): Dienste {
  const zeige = einblickIn(bauteile.kontexte);
  const grund = baueGrund(db, nacharbeit, bauteile, zeige);
  const { einstellungen, mail, auftraege, haushalt, konto, idempotenz, fremdquellen, katalog } = grund;
  const { konfig } = bauteile;
  const finanzen = erzeugeFinanzen(
    { db, konfig, einstellungen, auftraege, haushalt, katalog, nacharbeit, mail },
    zeige('finanzen'),
  );
  const bestand = erzeugeBestand({ db, einstellungen, haushalt, konto, katalog, finanzen }, zeige('bestand'));
  const sets = erzeugeSets(
    { db, konfig, nacharbeit, katalog, finanzen, haushalt, auftraege, bestand, einstellungen, konto },
    zeige('sets'),
  );
  const teile = erzeugeTeile({ db, einstellungen, haushalt, katalog, finanzen, bestand }, zeige('teile'));
  const figuren = erzeugeFiguren(
    { db, einstellungen, haushalt, katalog, finanzen, bestand, nacharbeit },
    zeige('figuren'),
  );
  const merkliste = erzeugeMerkliste(
    { db, einstellungen, haushalt, katalog, finanzen, sets, nacharbeit },
    zeige('merkliste'),
  );
  const gutscheine = erzeugeGutscheine({ db, einstellungen, konto, fremdquellen }, zeige('gutscheine'));
  const sammlung = erzeugeSammlung(
    { db, haushalt, auftraege, katalog, finanzen, bestand, sets, teile, figuren, merkliste },
    zeige('sammlung'),
  );
  const verwaltung = erzeugeVerwaltung(
    { db, einstellungen, auftraege, konto, idempotenz, katalog, finanzen, bestand, sets, merkliste, mail },
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
