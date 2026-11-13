/** Die eine Stelle, an der verdrahtet wird: Bereiche, Nacharbeit und der Zugang der
 * Klienten entstehen aus einem Datenbankzugang. Der Einstieg (server.ts, Skripte,
 * Testhilfen) hält das Ergebnis und reicht es weiter; einen Prozess-Speicher gibt es nicht. */
import { BRICKSET_HOECHSTENS, erzeugeAuftraege, type Nacharbeit } from '../src/auftraege';
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
import { type Bildwerk, erzeugeKatalog } from '../src/katalog';
import { erzeugeFinanzen } from '../src/finanzen';
import { mitVersion } from '../src/infra/setNummer';
import { erzeugeKonto } from '../src/konto';
import { meldeFehler } from '../src/infra/fehler';
import { verdrahteKlienten, type KlientenZugang } from '../clients/zugang';
import { erzeugeEinstellungen } from '../src/einstellungen';

/** Die Nacharbeit ruft höhere Bereiche, die beim Bau der unteren noch nicht stehen:
 * Sie greift erst beim Aufruf auf die fertigen Dienste zu (späte Bindung). */
export function baueNacharbeit(d: () => Dienste): Nacharbeit {
  return {
    preisJobAnstossen: () => {
      d()
        .auftraege.ziehePlanVor('preise')
        .catch((e: unknown) => meldeFehler('einstellungen:preis-job-anstossen', e));
    },
    preisFuerSetHolen: (sn, uid, zustand) => d().finanzen.refreshPriceForSet(sn, uid, zustand),
    bildVormerken: (url, sn) => d().katalog.merkeGebraucht(url, sn),
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

/** Was die Klienten (clients/) von der Anwendung brauchen: Schlüssel, Kontingent,
 * Drossel und die Brickset-Wiedervorlage; wie die Nacharbeit spät gebunden. */
export function baueKlientenZugang(d: () => Dienste): KlientenZugang {
  return {
    schluessel: async name => (await d().einstellungen.getGlobalSetting(name)) || '',
    zaehle: api => d().katalog.checkAndIncrementRateLimit(api),
    kontingentStand: api =>
      api === 'rebrickable' ? d().katalog.rebrickableDailyStatus() : d().katalog.getRateLimitStatus(api),
    drossel: {
      vordergrund: {
        waitForSlot: () => d().katalog.drossel.vordergrund.waitForSlot(),
        throttle: ms => d().katalog.drossel.vordergrund.throttle(ms),
      },
      hintergrund: {
        waitForSlot: () => d().katalog.drossel.hintergrund.waitForSlot(),
        throttle: ms => d().katalog.drossel.hintergrund.throttle(ms),
      },
    },
    bricksetVormerken: async (sn, fehler, bald) => ({
      ...(await d().auftraege.bricksetVormerken(sn, fehler, bald)),
      hoechstens: BRICKSET_HOECHSTENS,
    }),
    bricksetVergessen: sn => d().auftraege.bricksetAusWiedervorlage(sn),
  };
}

/** Was ein Test statt des Echten gibt: eigene Nacharbeit, eigenes Bildwerk. */
export interface Bauteile {
  nacharbeit?: Nacharbeit;
  bildwerk?: Bildwerk;
  /** Nur Testhilfen: Hier legt jede Fabrik ihren Kontext ab (Einblick). */
  kontexte?: Record<string, unknown>;
}

/** Alle Bereiche über einen Zugang, von unten nach oben: Jeder bekommt die Dienste
 * der tieferen, die er braucht, als Teil seines Kontexts. */
export function baueDienste(db: Db, bauteile: Bauteile = {}): Dienste {
  const fertig: { d: Dienste | null } = { d: null };
  const d = (): Dienste => {
    if (!fertig.d) throw new Error('Nacharbeit vor dem Ende von baueDienste gerufen');
    return fertig.d;
  };
  fertig.d = baueBereiche(db, bauteile.nacharbeit ?? baueNacharbeit(d), bauteile);
  return fertig.d;
}

/** Je Bereich ein Rückruf, der seinen Kontext ablegt; ohne Ablage keiner. */
function einblickIn(kontexte: Record<string, unknown> | undefined) {
  return (name: string) =>
    kontexte
      ? (k: unknown) => {
          kontexte[name] = k;
        }
      : undefined;
}

function baueBereiche(db: Db, nacharbeit: Nacharbeit, { bildwerk, kontexte }: Bauteile) {
  const zeige = einblickIn(kontexte);
  const einstellungen = erzeugeEinstellungen({ db }, zeige('einstellungen'));
  const mail = erzeugeMail({ einstellungen }, zeige('mail'));
  const auftraege = erzeugeAuftraege({ db, einstellungen }, zeige('auftraege'));
  const haushalt = erzeugeHaushalt({ db, einstellungen }, zeige('haushalt'));
  const konto = erzeugeKonto({ db, einstellungen, auftraege, haushalt, nacharbeit, mail }, zeige('konto'));
  const idempotenz = erzeugeIdempotenz({ db }, zeige('idempotenz'));
  const katalog = erzeugeKatalog({ db, einstellungen, auftraege, haushalt, nacharbeit, bildwerk }, zeige('katalog'));
  const finanzen = erzeugeFinanzen(
    { db, einstellungen, auftraege, haushalt, katalog, nacharbeit, mail },
    zeige('finanzen'),
  );
  const bestand = erzeugeBestand({ db, einstellungen, haushalt, konto, katalog, finanzen }, zeige('bestand'));
  const sets = erzeugeSets(
    { db, nacharbeit, katalog, finanzen, auftraege, bestand, einstellungen, konto },
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
  const gutscheine = erzeugeGutscheine({ db, einstellungen, konto }, zeige('gutscheine'));
  const sammlung = erzeugeSammlung(
    {
      db,
      haushalt,
      auftraege,
      katalog,
      finanzen,
      bestand,
      sets,
      teile,
      figuren,
      merkliste,
    },
    zeige('sammlung'),
  );
  const verwaltung = erzeugeVerwaltung(
    {
      db,
      einstellungen,
      auftraege,
      konto,
      idempotenz,
      katalog,
      finanzen,
      bestand,
      sets,
      merkliste,
      mail,
    },
    zeige('verwaltung'),
  );
  return {
    einstellungen,
    mail,
    auftraege,
    haushalt,
    konto,
    idempotenz,
    katalog,
    finanzen,
    bestand,
    sets,
    teile,
    figuren,
    merkliste,
    gutscheine,
    sammlung,
    verwaltung,
  };
}
export type Dienste = ReturnType<typeof baueBereiche>;

/** Dienste und Klienten über einen Zugang; der Einstieg hält beides. */
export function verdrahte(db: Db, bauteile: Bauteile = {}): Dienste {
  const dienste = baueDienste(db, bauteile);
  verdrahteKlienten(baueKlientenZugang(() => dienste));
  return dienste;
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
  fertig.d = verdrahte(db);
  return { db, dienste: fertig.d };
}
