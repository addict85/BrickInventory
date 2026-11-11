/** Der Preislauf holt die Marktpreise ohnehin; hier fehlte nur der Schritt,
 * eine Schwelle damit zu vergleichen. Ein Alarm gehört EINEM Konto. */
import { meldeUndLiefere, meldeFehler, fehlertext } from '../infra/fehler';
import { scopeIds } from '../haushalt/haushalt';
import { fachfehler } from '../infra/fehlerTexte';
import * as mailer from '../mail/mailer';
import { toCsv, csvZeilenAusAnfrage, uebersprungenHinweis } from '../infra/csvExport';
import { normalisiereSetNummer } from '../infra/setNummer';
import * as repo from './repository/preisalarme';
import type { DbSchnittstelle } from '../../db/database';

/** Ausgeschrieben statt `any`: Betrag, Richtung und Mailadresse stehen
 * nebeneinander, ein Vertauschen wäre sonst nirgends sichtbar. */
interface AlarmZeile {
  user_id: number;
  set_number: string;
  condition: string;
  richtung: Richtung;
  schwelle: string | number;
  currency_code: string;
  ausgeloest: boolean;
  email: string | null;
  username: string;
  sprache: string;
}

export type Richtung = 'unter' | 'ueber';

export interface Preisalarm {
  set_number: string;
  condition: string;
  richtung: Richtung;
  schwelle: number;
  currency_code: string;
  ausgeloest: boolean;
  zuletzt_am: string | null;
  zuletzt_preis: number | null;
  /** Daran hängt die Detailansicht. */
  besitzt: boolean;
}

const ZUSTAENDE = new Set(['N', 'U']);

function pruefeEingabe(richtung: unknown, schwelle: unknown, condition: unknown) {
  const r = String(richtung ?? '');
  if (r !== 'unter' && r !== 'ueber') fachfehler('ungueltig', 'alarm_richtung_ungueltig');
  const s = Number(schwelle);
  // Number.isFinite fängt auch NaN aus einer leeren Eingabe; `> 0` allein
  // meldete zwei verschiedene Fehler gleich.
  if (!Number.isFinite(s) || s <= 0) fachfehler('ungueltig', 'alarm_schwelle_ungueltig');
  const c = String(condition ?? 'N').toUpperCase();
  if (!ZUSTAENDE.has(c)) fachfehler('ungueltig', 'alarm_zustand_ungueltig');
  return { richtung: r as Richtung, schwelle: s, condition: c };
}

/** Höchstens EIN Alarm je Set und Zustand (Primärschlüssel). */
export async function setzeAlarm(db: DbSchnittstelle, 
  userId: number, setNumber: string, waehrung: string,
  eingabe: { richtung?: unknown; schwelle?: unknown; condition?: unknown },
): Promise<Preisalarm> {
  const { richtung, schwelle, condition } =
    pruefeEingabe(eingabe.richtung, eingabe.schwelle, eingabe.condition);
  await repo.schreibeAlarm(db, userId, setNumber, condition, richtung, schwelle, waehrung);
  const alarme = await alarmeFuer(db, userId, setNumber);
  return alarme.find(a => a.condition === condition)!;
}

/** Der Alarm wandert mit einer Vormerkung ins andere Konto (src/merkliste). */
export async function alarmUebertragen(db: DbSchnittstelle, zuId: number, vonId: number, setNumber: string, condition: string): Promise<void> {
  await repo.uebertrageAlarm(db, zuId, vonId, setNumber, condition);
}

/** Kein Fehler, wenn es keinen gab — der Wunsch ist erfüllt. */
export async function loescheAlarm(db: DbSchnittstelle, userId: number, setNumber: string, condition: string) {
  const c = String(condition ?? 'N').toUpperCase();
  const r = await repo.entferneAlarm(db, userId, setNumber, c);
  return r.changes ?? 0;
}


export async function alarmeFuer(db: DbSchnittstelle, userId: number, setNumber: string): Promise<Preisalarm[]> {
  const rows = await repo.alarmeDesSets(db, userId, setNumber, await scopeIds(db, userId))
    .catch(e => { meldeFehler('preisalarm:lesen', e); return []; });
  type Zeile = Omit<Preisalarm, 'schwelle' | 'zuletzt_preis'> &
               { schwelle: string | number; zuletzt_preis: string | number | null };
  return (rows as Zeile[] || []).map(r => ({
    ...r,
    // numeric kommt als Zeichenkette aus dem Treiber.
    schwelle: parseFloat(String(r.schwelle)),
    zuletzt_preis: r.zuletzt_preis == null ? null : parseFloat(String(r.zuletzt_preis)),
  }));
}

/** Damit man Alarme findet, ohne das Set zu kennen. */
export interface AlarmMitName extends Preisalarm {
  name: string | null;
  set_img_url: string | null;
  /** Dieselbe Reihenfolge wie in den Finanzen, sonst zeigte die Übersicht ein
   * anderes Bild als die Galerie daneben. */
  image_local: string | null;
  image_url: string | null;
  // Nur mit Set im Blickfeld anklickbar, sonst endete der Klick in einem Fehler.
  besitzt: boolean;
}

export async function alleAlarme(db: DbSchnittstelle, userId: number): Promise<AlarmMitName[]> {
  // Das Blickfeld fragt nur, ob das Set sichtbar ist; der Alarm bleibt beim
  // eigenen Konto.
  const blickfeld = await scopeIds(db, userId);
  const rows = await repo.alarmeImBlickfeld(db, userId, blickfeld)
    .catch(e => { meldeFehler('preisalarm:alle', e); return []; });
  type Zeile = Omit<AlarmMitName, 'schwelle' | 'zuletzt_preis'> &
               { schwelle: string | number; zuletzt_preis: string | number | null };
  return (rows as Zeile[] || []).map(r => ({
    ...r,
    // numeric kommt als Zeichenkette aus dem Treiber.
    schwelle: parseFloat(String(r.schwelle)),
    zuletzt_preis: r.zuletzt_preis == null ? null : parseFloat(String(r.zuletzt_preis)),
  }));
}

/** Die App fragt, statt dass der Server schiebt: Push liefe über fremde Server. */
export async function ausgeloesteSeit(db: DbSchnittstelle, userId: number, seit: unknown) {
  // Die Zeit der Datenbank: Postgres speichert Mikro-, JavaScript nur
  // Millisekunden; mit der JS-Uhr käme eine Meldung zweimal.
  const jetztRow = await repo.datenbankJetzt(db);
  const jetzt = jetztRow?.jetzt ?? new Date();

  // `instanceof Date` ZUERST: String(date) verliert die Millisekunden, und eine
  // Meldung aus derselben Sekunde käme ein zweites Mal.
  const marke = seit instanceof Date ? seit
    : seit === undefined || seit === null || String(seit).trim() === ''
      ? null : new Date(String(seit));
  // Unlesbar wie fehlend, NICHT „seit Anbeginn": Ein Tippfehler darf keine Flut auslösen.
  if (!marke || Number.isNaN(marke.getTime())) return { alerts: [], now: jetzt };

  const rows = await repo.alarmeDesKontos(db, userId, marke, await scopeIds(db, userId))
    .catch(e => { meldeFehler('preisalarm:abholen', e); return []; });

  type Zeile = { set_number: string; condition: string; richtung: Richtung;
                 schwelle: string | number; currency_code: string; ausgeloest: boolean; besitzt: boolean;
                 zuletzt_am: string; zuletzt_preis: string | number | null };
  return {
    alerts: (rows as Zeile[] || []).map(r => ({
      ...r,
      schwelle: parseFloat(String(r.schwelle)),
      zuletzt_preis: r.zuletzt_preis == null ? null : parseFloat(String(r.zuletzt_preis)),
    })),
    now: jetzt,
  };
}

/** Eigene Funktion: die einzige Stelle, an der „unter" und „über" etwas
 * bedeuten — und an der ein Vorzeichenfehler entsteht. So ist sie prüfbar. */
export function reisst(richtung: Richtung, preis: number, schwelle: number): boolean {
  return richtung === 'unter' ? preis < schwelle : preis > schwelle;
}

/** Gemeldet wird der ÜBERGANG, nicht der Zustand. */
export type Versender = (mail: { to: string; subject: string; text: string; html?: string; link?: string }) => Promise<unknown>;

/** Als Parameter, damit ein Test den Versand ersetzen kann. */
async function standardVersand(mail: { to: string; subject: string; text: string; html?: string; link?: string }) {
  return mailer.sendMail(mail);
}

export async function pruefeSet(db: DbSchnittstelle, setNumber: string,
                                versende: Versender = standardVersand): Promise<number> {
  const alarme = await repo.alleAktivenAlarme(db, setNumber)
    // Gemeldet, nicht verschluckt: Sonst sähe man nur, dass keine Mails kommen,
    // und suchte den Fehler beim SMTP-Server.
    .catch(e => { meldeFehler('preisalarm:alarme-lesen', e); return []; });
  if (!alarme?.length) return 0;
  let verschickt = 0;
  for (const a of alarme as AlarmZeile[]) {
    const preisZeile = await repo.cachePreisFuerAlarm(db, a.set_number, a.condition, a.currency_code)
      .catch(e => { meldeFehler('preisalarm:preis-lesen', e); return null; });
    const preis = preisZeile?.avg_price == null ? null : parseFloat(String(preisZeile.avg_price));
    // Kein Preis in DIESER Währung: Der Alarm bleibt, der Merker auch.
    if (preis == null || !(preis > 0)) continue;

    const schwelle = parseFloat(String(a.schwelle));
    const jetzt = reisst(a.richtung, preis, schwelle);

    if (!jetzt) {
      // Zurück auf die andere Seite — der nächste Übergang meldet wieder.
      if (a.ausgeloest) {
        await repo.setzeAlarmZurueck(db, a.user_id, a.set_number, a.condition)
          .catch(e => meldeFehler('preisalarm:merker-loeschen', e));
      }
      continue;
    }
    if (a.ausgeloest) continue;          // schon gemeldet, nichts Neues

    if (a.email) {
      try {
        await verschicke(db, versende, a, preis, schwelle);
        verschickt++;
      } catch (e) {
        // Merker NICHT setzen — beim nächsten Lauf erneut versuchen.
        meldeFehler('preisalarm:versand', e);
        continue;
      }
    }
    await repo.loeseAlarmAus(db, a.user_id, a.set_number, a.condition, preis)
      // Ungesetzt meldet der nächste Lauf dieselbe Schwelle noch einmal — lästig,
      // aber besser als stumm.
      .catch(e => meldeFehler('preisalarm:merker-setzen', e));
  }
  return verschickt;
}

/** Getrennt, damit pruefeSet() über das WANN entscheidet, nicht über das WIE. */
async function verschicke(db: DbSchnittstelle, versende: Versender, a: AlarmZeile, preis: number, schwelle: number) {
  const name = await repo.setNameAusStamm(db, a.set_number)
    .catch(meldeUndLiefere('preisalarm:name', null));
  const mail = await mailer.baueAlarmMail({
    username:  a.username,
    lang:      String(a.sprache),
    setNumber: a.set_number,
    setName:   name?.name ?? null,
    condition: a.condition,
    richtung:  a.richtung,
    schwelle,
    preis,
    waehrung:  a.currency_code,
  });
  await versende({ to: a.email!, ...mail });
}

/** Eigene Datei statt Spalten an sets.csv: Ein Alarm braucht das Set nicht zu besitzen. */
export async function buildPreisalarmeCsv(db: DbSchnittstelle, uid: number): Promise<string> {
  const rows = await repo.alarmeFuerExport(db, uid);

  return toCsv(['set_number', 'condition', 'richtung', 'schwelle', 'currency_code'],
    // Number(): sonst stünde „200.0000" im Export.
    rows.map(r => ({ ...r, schwelle: Number(r.schwelle) })));
}

/** Schwellen gelten in der Kontowährung; eine andere in der Datei wird
 * genannt statt still umgerechnet — Kurse gibt es keine. */
export async function alarmeAusCsv(db: DbSchnittstelle, uid: number, waehrung: string, text: string) {
  const { records, bereinigt, uebersprungen } = csvZeilenAusAnfrage(text);
  let added = 0, updated = 0, errors = 0, fremdeWaehrung = 0;
  const results: Array<Record<string, unknown>> = [];
  for (const row of bereinigt) {
    const roh = String(row.set_number || row['Setnummer'] || row['set_num'] || Object.values(row)[0] || '').trim();
    if (!roh) continue;
    const sn = normalisiereSetNummer(roh);
    // Vor dem Schreiben fragen: setzeAlarm() legt an oder ändert, ohne es zu sagen.
    const schon = await alarmeFuer(db, uid, sn);
    const dateiWaehrung = String(row.currency_code || row['waehrung'] || '').trim().toUpperCase();
    const abweichend = dateiWaehrung !== '' && dateiWaehrung !== waehrung.toUpperCase();
    try {
      const alarm = await setzeAlarm(db, uid, sn, waehrung, {
        richtung: String(row.richtung || row['Richtung'] || '').trim().toLowerCase(),
        schwelle: String(row.schwelle || row['Schwelle'] || '').trim().replace(',', '.'),
        condition: String(row.condition || row['zustand'] || row['Zustand'] || 'N').trim().toUpperCase(),
      });
      const war = schon.some(a => a.condition === alarm.condition);
      if (war) updated++; else added++;
      if (abweichend) fremdeWaehrung++;
      results.push({ set_number: sn, condition: alarm.condition, action: war ? 'updated' : 'added',
        ...(abweichend ? { waehrung_angepasst: true, waehrung_datei: dateiWaehrung, waehrung_konto: waehrung } : {}) });
    } catch (e) {
      errors++;
      results.push({ set_number: sn, action: 'error', error: fehlertext(e) });
    }
  }
  return {
    success: true, added, updated, errors, total: records.length, results,
    skipped: uebersprungen.length || undefined,
    skipped_hint: uebersprungenHinweis(uebersprungen) || undefined,
    ...(fremdeWaehrung ? { waehrung_hinweis:
      `${fremdeWaehrung} Alarm(e) standen in einer anderen Währung als ${waehrung}. ` +
      `Die Schwellen wurden unverändert übernommen und gelten jetzt in ${waehrung} — ` +
      'die Zahlen bitte nachsehen.' } : {}),
  };
}
