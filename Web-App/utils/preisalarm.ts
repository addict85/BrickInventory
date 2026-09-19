/**
 * Preisalarm — sag Bescheid, wenn ein Set eine Schwelle reisst.
 *
 * ── Warum es diesen Helfer gibt ─────────────────────────────────────────────
 *
 * Die Zahl, auf die es ankommt, wird ohnehin geholt: Der Preislauf
 * (jobs/priceJob.ts) fragt die Marktpreise regelmässig ab und schreibt sie in
 * price_cache. Es fehlte nur der Schritt danach — nachsehen, ob jemand darauf
 * gewartet hat.
 *
 * Diese Datei ist ein BLATT: Sie liest die Preise, entscheidet und verschickt.
 * Sie kennt weder Routen noch den Job, der sie aufruft — nur db, mailer und
 * fehlerTexte. Damit lässt sie sich auch ohne laufenden Job prüfen, und der
 * Job bleibt ein Job.
 *
 * ── Was hier ABSICHTLICH nicht steht ────────────────────────────────────────
 *
 * Kein Blickfeld, kein Haushalt. Ein Alarm gehört genau EINEM Konto: Wer eine
 * Schwelle setzt, will selbst benachrichtigt werden, und das Elternkonto hat
 * nichts davon, die Wünsche seiner Kinder per Mail zu bekommen. Das ist der
 * einzige Ort im Projekt, an dem `user_id = $1` steht, ohne dass es ein
 * Versehen ist — deshalb steht es hier auch begründet.
 */
import * as db from '../db/database';
import { fehlerWerfen } from './fehlerTexte';

/**
 * Eine Alarmzeile samt Empfänger — das, was pruefeSet() aus der Datenbank
 * bekommt.
 *
 * Ausgeschrieben statt `any`: Hier stehen ein Geldbetrag, eine Richtung und
 * eine Mailadresse nebeneinander, und ein Vertauschen wäre an keiner Stelle
 * sichtbar. `schwelle` ist ausdrücklich `string | number`, weil der
 * Postgres-Treiber numeric als Zeichenkette liefert — genau deshalb steht
 * unten parseFloat und nicht Number().
 */
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

/** 'unter' = melden beim Unterschreiten, 'ueber' = beim Überschreiten. */
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
}

/** Die beiden Zustände, die der ganze Baum kennt (N = neu, U = gebraucht). */
const ZUSTAENDE = new Set(['N', 'U']);

function pruefeEingabe(richtung: unknown, schwelle: unknown, condition: unknown) {
  const r = String(richtung ?? '');
  if (r !== 'unter' && r !== 'ueber') fehlerWerfen('alarm_richtung_ungueltig', 400);
  const s = Number(schwelle);
  // Number.isFinite fängt auch NaN aus einer leeren Eingabe — `> 0` allein
  // täte das nicht, denn NaN > 0 ist false und ergäbe dieselbe Meldung für
  // zwei verschiedene Fehler.
  if (!Number.isFinite(s) || s <= 0) fehlerWerfen('alarm_schwelle_ungueltig', 400);
  const c = String(condition ?? 'N').toUpperCase();
  if (!ZUSTAENDE.has(c)) fehlerWerfen('alarm_zustand_ungueltig', 400);
  return { richtung: r as Richtung, schwelle: s, condition: c };
}

/**
 * Alarm setzen oder ändern.
 *
 * Ein Konto hat je Set und Zustand höchstens EINEN Alarm (Primärschlüssel).
 * Zwei Schwellen in dieselbe Richtung wären ohnehin eine davon zu viel, und
 * „unter 200 UND über 400" ist eine Frage, die noch niemand gestellt hat —
 * käme sie, wäre sie ein zweiter Datensatz, nicht ein zweites Feld.
 *
 * Der Merker `ausgeloest` wird beim Ändern ZURÜCKGESETZT: Eine neue Schwelle
 * ist eine neue Frage, und die soll beantwortet werden, auch wenn die alte
 * schon einmal gemeldet hat.
 */
export async function setzeAlarm(
  userId: number, setNumber: string, waehrung: string,
  eingabe: { richtung?: unknown; schwelle?: unknown; condition?: unknown },
): Promise<Preisalarm> {
  const { richtung, schwelle, condition } =
    pruefeEingabe(eingabe.richtung, eingabe.schwelle, eingabe.condition);
  await db.run(
    `INSERT INTO price_alerts (user_id, set_number, condition, richtung, schwelle, currency_code)
     VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (user_id, set_number, condition) DO UPDATE
        SET richtung = $4, schwelle = $5, currency_code = $6,
            ausgeloest = FALSE`,
    [userId, setNumber, condition, richtung, schwelle, waehrung]);
  const alarme = await alarmeFuer(userId, setNumber);
  return alarme.find(a => a.condition === condition)!;
}

/** Alarm entfernen. Kein Fehler, wenn es keinen gab — der Wunsch ist erfüllt. */
export async function loescheAlarm(userId: number, setNumber: string, condition: string) {
  const c = String(condition ?? 'N').toUpperCase();
  const r = await db.run(
    'DELETE FROM price_alerts WHERE user_id=$1 AND set_number=$2 AND condition=$3',
    [userId, setNumber, c]);
  return r.changes ?? 0;
}

/** Die Alarme EINES Kontos zu einem Set (höchstens zwei: N und U). */
export async function alarmeFuer(userId: number, setNumber: string): Promise<Preisalarm[]> {
  const rows = await db.all(
    `SELECT set_number, condition, richtung, schwelle, currency_code,
            ausgeloest, zuletzt_am, zuletzt_preis
       FROM price_alerts WHERE user_id=$1 AND set_number=$2 ORDER BY condition`,
    [userId, setNumber])
    .catch(e => { require('./httpError').meldeUndWeiter('preisalarm:lesen', e); return []; });
  type Zeile = Omit<Preisalarm, 'schwelle' | 'zuletzt_preis'> &
               { schwelle: string | number; zuletzt_preis: string | number | null };
  return (rows as Zeile[] || []).map(r => ({
    ...r,
    // numeric kommt als Zeichenkette aus dem Treiber — dieselbe Stelle, an der
    // in diesem Baum schon einmal ein Vergleich still falsch wurde.
    schwelle: parseFloat(String(r.schwelle)),
    zuletzt_preis: r.zuletzt_preis == null ? null : parseFloat(String(r.zuletzt_preis)),
  }));
}

/**
 * Ist die Schwelle gerissen?
 *
 * Eigene Funktion, obwohl es eine Zeile ist: Sie ist die einzige Stelle, an
 * der „unter" und „ueber" etwas bedeuten, und damit die einzige, an der ein
 * Vorzeichenfehler entsteht. Als Ausdruck mitten in einer Schleife wäre sie
 * nicht für sich prüfbar.
 */
export function reisst(richtung: Richtung, preis: number, schwelle: number): boolean {
  return richtung === 'unter' ? preis < schwelle : preis > schwelle;
}

/**
 * Alle Alarme zu EINEM Set prüfen und bei Übergang benachrichtigen.
 *
 * ── Die Hysterese ───────────────────────────────────────────────────────────
 *
 * Gemeldet wird der ÜBERGANG, nicht der Zustand. Bleibt der Preis unter der
 * Schwelle, bleibt es bei der einen Meldung; steigt er darüber und fällt
 * später wieder, meldet der Alarm erneut. Eine Sperrfrist („höchstens einmal
 * pro Woche") wäre die naheliegende und die falsche Antwort: Sie verschluckt
 * genau das zweite Unterschreiten, das wieder interessant ist.
 *
 * ── Warum der Versand einen Fehler nicht weiterreicht ───────────────────────
 *
 * Diese Funktion läuft IM PREISLAUF. Ein nicht erreichbarer SMTP-Server darf
 * den Lauf nicht abbrechen — die Preise sind dann trotzdem geholt. Der Fehler
 * wird gemeldet (meldeUndWeiter), und der Merker bleibt ungesetzt: Beim
 * nächsten Lauf wird es erneut versucht.
 *
 * @returns wie viele Benachrichtigungen verschickt wurden
 */
export type Versender = (mail: { to: string; subject: string; text: string }) => Promise<unknown>;

/**
 * Der Versand als PARAMETER, nicht als Import im Rumpf.
 *
 * ── Warum (beim Schreiben des Tests gemerkt) ────────────────────────────────
 *
 * Der erste Entwurf holte sendMail über ein spätes `require()`. Im Test liess
 * sich das nicht ersetzen: TypeScript übersetzt `export { sendMail }` zu einem
 * GETTER auf dem Modulobjekt, und eine Zuweisung darauf verpufft lautlos — der
 * Test lief gegen den echten Versand und zählte null Meldungen, ohne dass
 * irgendwo ein Fehler stand.
 *
 * Das ist nicht nur ein Testproblem: Eine Funktion, deren Aussenwirkung sich
 * nicht austauschen lässt, ist eine, die man nur im Betrieb prüfen kann.
 */
async function standardVersand(mail: { to: string; subject: string; text: string }) {
  return require('./mailer').sendMail(mail);
}

export async function pruefeSet(setNumber: string,
                                versende: Versender = standardVersand): Promise<number> {
  const { meldeUndWeiter } = require('./httpError');
  const alarme = await db.all(
    `SELECT a.user_id, a.set_number, a.condition, a.richtung, a.schwelle,
            a.currency_code, a.ausgeloest, u.email, u.username,
            COALESCE(us.value, 'de') AS sprache
       FROM price_alerts a
       JOIN users u ON u.id = a.user_id
       LEFT JOIN user_settings us ON us.user_id = a.user_id AND us.key = 'language'
      WHERE a.set_number = $1`, [setNumber])
    // Gemeldet, nicht verschluckt: Faellt diese Abfrage aus (fehlende Tabelle
    // auf einer alten Datenbank, Verbindungsabbruch), sieht man sonst nur,
    // dass keine Mails kommen — und sucht den Fehler beim SMTP-Server.
    .catch(e => { meldeUndWeiter('preisalarm:alarme-lesen', e); return []; });
  if (!alarme?.length) return 0;
  let verschickt = 0;
  for (const a of alarme as AlarmZeile[]) {
    const preisZeile = await db.get(
      `SELECT avg_price FROM price_cache
        WHERE set_number=$1 AND condition=$2 AND currency_code=$3`,
      [a.set_number, a.condition, a.currency_code])
      .catch(e => { meldeUndWeiter('preisalarm:preis-lesen', e); return null; });
    const preis = preisZeile?.avg_price == null ? null : parseFloat(String(preisZeile.avg_price));
    // Kein Preis in DIESER Währung: Der Alarm ist nicht falsch, nur (noch)
    // nicht beantwortbar. Er bleibt stehen, und der Merker bleibt, wie er ist.
    if (preis == null || !(preis > 0)) continue;

    const schwelle = parseFloat(String(a.schwelle));
    const jetzt = reisst(a.richtung, preis, schwelle);

    if (!jetzt) {
      // Zurück auf die andere Seite — der nächste Übergang meldet wieder.
      if (a.ausgeloest) {
        await db.run(`UPDATE price_alerts SET ausgeloest = FALSE
                       WHERE user_id=$1 AND set_number=$2 AND condition=$3`,
          [a.user_id, a.set_number, a.condition])
          .catch(e => meldeUndWeiter('preisalarm:merker-loeschen', e));
      }
      continue;
    }
    if (a.ausgeloest) continue;          // schon gemeldet, nichts Neues

    if (a.email) {
      try {
        await verschicke(versende, a, preis, schwelle);
        verschickt++;
      } catch (e) {
        // Merker NICHT setzen — beim nächsten Lauf erneut versuchen.
        meldeUndWeiter('preisalarm:versand', e);
        continue;
      }
    }
    await db.run(
      `UPDATE price_alerts SET ausgeloest = TRUE, zuletzt_am = NOW(), zuletzt_preis = $4
        WHERE user_id=$1 AND set_number=$2 AND condition=$3`,
      [a.user_id, a.set_number, a.condition, preis])
      // Bleibt der Merker ungesetzt, meldet der naechste Lauf dieselbe
      // Schwelle noch einmal. Laestig, aber besser als stumm: Genau deshalb
      // wird der Fehler gemeldet und nicht verschluckt.
      .catch(e => meldeUndWeiter('preisalarm:merker-setzen', e));
  }
  return verschickt;
}

/** Die Mail. Getrennt, damit pruefeSet() über das WANN entscheidet, nicht über das WIE. */
async function verschicke(versende: Versender, a: AlarmZeile, preis: number, schwelle: number) {
  const de = String(a.sprache) !== 'en';
  const zustand = a.condition === 'U'
    ? (de ? 'gebraucht' : 'used') : (de ? 'neu' : 'new');
  const richtung = a.richtung === 'unter'
    ? (de ? 'unter' : 'below') : (de ? 'über' : 'above');
  const geld = (n: number) => `${a.currency_code} ${n.toFixed(2)}`;
  const betreff = de
    ? `Preisalarm: ${a.set_number} liegt ${richtung} ${geld(schwelle)}`
    : `Price alert: ${a.set_number} is ${richtung} ${geld(schwelle)}`;
  const text = de
    ? `Hallo ${a.username},\n\n` +
      `der Marktpreis für ${a.set_number} (${zustand}) liegt bei ${geld(preis)} ` +
      `und damit ${richtung} deiner Schwelle von ${geld(schwelle)}.\n\n` +
      `Diese Meldung kommt einmal je Übergang: Erst wenn der Preis wieder auf ` +
      `die andere Seite wechselt, kann sie erneut ausgelöst werden.\n`
    : `Hi ${a.username},\n\n` +
      `the market price for ${a.set_number} (${zustand}) is ${geld(preis)}, ` +
      `which is ${richtung} your threshold of ${geld(schwelle)}.\n\n` +
      `You get this once per crossing: it can only trigger again after the ` +
      `price has moved back to the other side.\n`;
  await versende({ to: a.email!, subject: betreff, text });
}
