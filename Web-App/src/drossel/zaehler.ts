/** Zähler mit Rückfall: Klemmt die Datenbank, zählt der Prozess im Speicher weiter, damit eine
 * Bremse dann nicht offen steht. Er zählt nur je Prozess; gemeldet wird höchstens einmal je Minute. */
import { fehlertext } from '../infra/fehler';
import { prozessweit } from '../infra/prozessweit';
import type { DrosselKontext } from './kontext';

/** Typisiert: Ein vertippter Feldname ergäbe `undefined >= MAX`, also keine Sperre. */
export interface Zaehlerstand {
  count: number;
  waitMin: number;
  seitLetztem: number;
}
export type Stand = Zaehlerstand & { laufend: number };

type Eintrag = { count: number; firstAt: number; lastAt: number | null; laufend: number };
const rueckfall = () =>
  prozessweit('anmeldeRueckfall', () => ({ eintraege: new Map<string, Eintrag>(), gemeldetAm: 0 }));
/** Ohne Aufräumen wüchse der Speicher mit jedem Rateversuch. */
const SPEICHER_HOECHSTENS = 5000;

function imSpeicher(wo: string, e: unknown): void {
  const r = rueckfall();
  if (Date.now() - r.gemeldetAm < 60_000) return;
  r.gemeldetAm = Date.now();
  console.warn(`[anmeldung] Zähler im Prozessspeicher statt in der Datenbank (${wo}): ${fehlertext(e)}`);
}

function stutze(fensterMs: number): void {
  if (rueckfall().eintraege.size <= SPEICHER_HOECHSTENS) return;
  const grenze = Date.now() - fensterMs;
  for (const [k, v] of rueckfall().eintraege) if (v.firstAt < grenze) rueckfall().eintraege.delete(k);
}

const restMin = (firstAt: number, fensterMin: number, jetzt: number) =>
  Math.max(1, Math.ceil((firstAt + fensterMin * 60000 - jetzt) / 60000));

export async function zaehlerStand(k: DrosselKontext, key: string, fensterMin: number): Promise<Zaehlerstand | null> {
  try {
    const row = await k.zaehler.lies(key, fensterMin);
    if (!row) return null;
    return {
      count: parseInt(row.count, 10) || 0,
      waitMin: Math.max(1, Math.ceil(parseFloat(row.wait_min) || 1)),
      seitLetztem: Math.max(0, parseFloat(row.seit) || 0),
    };
  } catch (fehler) {
    imSpeicher('lesen', fehler);
    const e = rueckfall().eintraege.get(key);
    const jetzt = k.uhr.jetzt();
    if (!e || jetzt - e.firstAt > fensterMin * 60000) return null;
    return {
      count: e.count,
      waitMin: restMin(e.firstAt, fensterMin, jetzt),
      seitLetztem: (jetzt - (e.lastAt ?? e.firstAt)) / 1000,
    };
  }
}

/** Ein Fehlversuch: zählt und gibt den belegten Laufplatz frei. @returns der neue Stand */
export async function zaehleVersuch(k: DrosselKontext, key: string, fensterMin: number): Promise<number> {
  try {
    return await k.zaehler.erhoehe(key, fensterMin);
  } catch (fehler) {
    imSpeicher('zählen', fehler);
    const jetzt = k.uhr.jetzt();
    const e = rueckfall().eintraege.get(key);
    if (!e || jetzt - e.firstAt > fensterMin * 60000)
      rueckfall().eintraege.set(key, { count: 1, firstAt: jetzt, lastAt: jetzt, laufend: 0 });
    else {
      e.count++;
      e.lastAt = jetzt;
      e.laufend = Math.max(0, (e.laufend || 0) - 1);
    }
    stutze(fensterMin * 60000);
    return rueckfall().eintraege.get(key)?.count ?? 1;
  }
}

/** BEVOR geprüft wird, unter einer Zeilensperre, damit gleichzeitige Versuche einander sehen;
 * ein Platz, dessen Prüfung nie gemeldet wurde, verfällt nach `verfallS`. */
export async function reserviere(
  k: DrosselKontext,
  key: string,
  fensterMin: number,
  verfallS: number,
  erlaubt: (s: Stand) => boolean,
): Promise<{ ok: boolean; stand: Stand }> {
  try {
    return await k.transaktion(async t => {
      const r = await t.zaehler.sperre(key, fensterMin, verfallS);
      const neu = !!r.abgelaufen;
      const s: Stand = {
        count: neu ? 0 : parseInt(r.count, 10) || 0,
        laufend: r.laufend_alt ? 0 : parseInt(r.laufend, 10) || 0,
        waitMin: neu ? fensterMin : Math.max(1, Math.ceil(parseFloat(r.wait_min) || 1)),
        seitLetztem: Math.max(0, parseFloat(r.seit) || 0),
      };
      if (!erlaubt(s)) return { ok: false, stand: s };
      await t.zaehler.belegeLaufplatz(key, s.laufend + 1, neu);
      return { ok: true, stand: s };
    });
  } catch (fehler) {
    imSpeicher('reservieren', fehler);
    // Im Prozessspeicher ist dieser Block ohne await atomar.
    const jetzt = k.uhr.jetzt();
    let e = rueckfall().eintraege.get(key);
    if (!e || jetzt - e.firstAt > fensterMin * 60000) {
      e = { count: 0, firstAt: jetzt, lastAt: null, laufend: 0 };
      rueckfall().eintraege.set(key, e);
    }
    const s: Stand = {
      count: e.count,
      laufend: e.laufend || 0,
      waitMin: restMin(e.firstAt, fensterMin, jetzt),
      seitLetztem: (jetzt - (e.lastAt ?? e.firstAt)) / 1000,
    };
    if (!erlaubt(s)) return { ok: false, stand: s };
    e.laufend = s.laufend + 1;
    stutze(fensterMin * 60000);
    return { ok: true, stand: s };
  }
}

export async function gibPlatzFrei(k: DrosselKontext, key: string): Promise<void> {
  try {
    await k.zaehler.gibLaufplatzFrei(key);
  } catch (fehler) {
    imSpeicher('freigeben', fehler);
    const e = rueckfall().eintraege.get(key);
    if (e) e.laufend = Math.max(0, (e.laufend || 0) - 1);
  }
}

/** Mit `auchDarunter` auch jeden Zähler `key|…`: Die Tagesgrenze zählt je Adresse eigene Zeilen. */
export async function vergissZaehler(
  k: DrosselKontext,
  key: string,
  o: { auchDarunter?: boolean } = {},
): Promise<void> {
  try {
    await k.zaehler.loescheZaehler(key);
    if (o.auchDarunter) await k.zaehler.loescheZaehlerMitPraefix(`${key}|`);
  } catch (e) {
    imSpeicher('löschen', e);
    rueckfall().eintraege.delete(key);
    if (o.auchDarunter)
      for (const n of rueckfall().eintraege.keys()) if (n.startsWith(`${key}|`)) rueckfall().eintraege.delete(n);
  }
}

/** In einem Schritt, sonst kamen gleichzeitige Anfragen durch. Abgewiesene zählen, verlängern aber nicht. */
export async function zaehleImFenster(
  k: DrosselKontext,
  key: string,
  fensterMin: number,
): Promise<{ count: number; waitMin: number }> {
  try {
    const r = await k.zaehler.zaehleHoch(key, fensterMin);
    return { count: parseInt(r.count, 10) || 0, waitMin: Math.max(1, Math.ceil(parseFloat(r.wait_min) || 1)) };
  } catch (fehler) {
    imSpeicher('anfrage', fehler);
    const jetzt = k.uhr.jetzt();
    let e = rueckfall().eintraege.get(key);
    if (!e || jetzt - e.firstAt > fensterMin * 60000) {
      e = { count: 0, firstAt: jetzt, lastAt: jetzt, laufend: 0 };
      rueckfall().eintraege.set(key, e);
    }
    e.count++;
    e.lastAt = jetzt;
    stutze(fensterMin * 60000);
    return { count: e.count, waitMin: restMin(e.firstAt, fensterMin, jetzt) };
  }
}

/** Jeder unbekannte Name legt eine Zeile an; ohne Aufräumen wüchse die Tabelle mit jedem Rateversuch.
 * `bekanntMin`: so lange bleiben die Zeilen bekannter Adressen. */
export function raeumeAuf(k: DrosselKontext, bekanntMin: number): Promise<number> {
  return k.zaehler.loescheAlteZaehler(bekanntMin);
}

/** Zählen und Stand in einer Anweisung, damit zwei Anfragen nicht beide durchkommen. @returns ob der Tag frei war */
export async function einmalJeTag(k: DrosselKontext, key: string): Promise<boolean> {
  return !!(await k.zaehler.zaehleEinmalJeTag(key));
}
