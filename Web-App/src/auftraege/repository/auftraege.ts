import * as db from '../../../db/database';
import { randomUUID } from 'node:crypto';
import { LOCKS } from '../../infra/lockNamespaces';
import { versucheSchluesselSperre, gibSchluesselSperreFrei } from '../../../db/txLock';
import type { AuftragsArt, Einstellen, AuftragsZeile, Belegung, Fortschritt, Pause, AuftragsStatus } from '../auftraege';

/** Hier nur das SQL; Wecken, Wartezeiten und das Arbeiten im Namen eines Kontos
 * stehen im Dienst. */
type Stand = { s: string } | undefined;

export interface AuftragsListenZeile {
  id: string; art: string; status: string; versuche: number; max_versuche: number;
  faellig_ab: Date | null; frist_bis: Date | null; gestartet: Date | null; erstellt: Date | null;
  aktualisiert: Date | null; fortschritt: Fortschritt | null; fehler: string | null;
  user_id: number | null; geplant: boolean; set_number: string | null;
}
export interface WiedervorlageZeile {
  set_number: string; name: string | null; attempts: number; retry_after: string | null;
  last_error: string | null; created_at: Date | null;
}

/** @returns die Kennung, oder null, wenn derselbe Auftrag schon offen steht */
export async function fuegeAuftragEin(art: AuftragsArt, nutzlast: object,
  o: Einstellen = {}): Promise<string | null> {
  const z = await db.get<{ id: string }>(
    `INSERT INTO auftraege (art, nutzlast, user_id, schluessel, max_versuche, faellig_ab, fortschritt)
     VALUES ($1, $2, $3, $4, $5, COALESCE($7::timestamptz, NOW() + make_interval(secs => $6)), $8)
     ON CONFLICT (schluessel) WHERE status = 'offen' DO NOTHING
     RETURNING id`,
    [art, JSON.stringify(nutzlast), o.userId ?? null, o.schluessel ?? null, o.maxVersuche ?? 5,
      o.nachSekunden ?? 0, o.faelligAb ?? null, o.fortschritt ? JSON.stringify(o.fortschritt) : null]);
  return z ? String(z.id) : null;
}
/** Ein 'laeuft' mit abgelaufener Frist gehört einem verschwundenen Prozess und
 * wird neu vergeben. SKIP LOCKED: Zwei Worker greifen nie dieselbe Zeile; zwei
 * exklusive derselben Art verhindert der Trigger aus Migration 0099.
 * @param ausser Kennungen, die dieser Prozess noch ausführt: nie an sich selbst neu vergeben */
export async function belegeAuftrag(arten: readonly string[], fristSek: number,
  belegtVon: string = randomUUID(),
  exklusiv: readonly string[] = [], ausser: readonly string[] = []): Promise<AuftragsZeile | null> {
  const z = await db.get(
    `UPDATE auftraege SET status = 'laeuft', versuche = versuche + 1, belegt_von = $1,
            frist_bis = NOW() + make_interval(secs => $2), gestartet = NOW(), aktualisiert = NOW()
      WHERE id = (SELECT a.id FROM auftraege a
                   WHERE a.art = ANY($3)
                     AND a.id::text <> ALL($5::text[])
                     AND ((a.status = 'offen' AND a.faellig_ab <= NOW())
                       OR (a.status = 'laeuft' AND a.frist_bis < NOW()))
                     AND NOT EXISTS (SELECT 1 FROM auftrag_pausen p WHERE p.art = a.art AND p.bis > NOW())
                     AND NOT ((a.art = ANY($4) OR EXISTS (SELECT 1 FROM auftrag_exklusiv e WHERE e.art = a.art))
                          AND EXISTS (SELECT 1 FROM auftraege l WHERE l.art = a.art AND l.status = 'laeuft'
                                         AND l.frist_bis >= NOW() AND l.id <> a.id))
                   ORDER BY a.faellig_ab, a.id LIMIT 1
                   FOR UPDATE SKIP LOCKED)
      RETURNING ${SPALTEN}`,
    [belegtVon, fristSek, [...arten], [...exklusiv], [...ausser]]);
  return z ? alsZeile(z) : null;
}
/** Herausnehmen ist eine Migration: Ein Worker ohne die Art ist sonst ein Test oder ein alter Stand. */
export async function merkeExklusive(exklusiv: readonly string[]): Promise<void> {
  if (exklusiv.length) await db.run('INSERT INTO auftrag_exklusiv (art) SELECT unnest($1::text[]) ON CONFLICT DO NOTHING', [[...exklusiv]]);
}
/** @returns false, wenn der Auftrag nicht mehr diesem Lauf gehört (auch: abgebrochen) */
export async function lebenszeichen(a: Belegung, fristSek: number): Promise<boolean> {
  const r = await db.run(
    `UPDATE auftraege SET frist_bis = NOW() + make_interval(secs => $3), aktualisiert = NOW()
      WHERE id = $1 AND belegt_von = $2 AND status = 'laeuft'`, [a.id, a.belegt_von, fristSek]);
  return (r?.changes ?? 0) > 0;
}
/** Nur lesen: Ein Statuswechsel weckt jeden Lauf, schreiben soll dabei keiner. */
export async function gehoertNoch(a: Belegung): Promise<boolean> {
  return !!(await db.get<{ ja: number }>(`SELECT 1 AS ja FROM auftraege WHERE id = $1 AND belegt_von = $2 AND status = 'laeuft'`, [a.id, a.belegt_von]));
}
export function schreibeFortschritt(a: Belegung, f: Fortschritt, fristSek: number): Promise<Stand> {
  return db.get(
    `UPDATE auftraege SET fortschritt = $3, frist_bis = NOW() + make_interval(secs => $4), aktualisiert = NOW()
      WHERE id = $1 AND belegt_von = $2 AND status = 'laeuft' RETURNING COALESCE(schluessel, id::text) AS s`,
    [a.id, a.belegt_von, JSON.stringify(f), fristSek]);
}
/** PDF und CSV tragen ganze Listen; erledigt braucht die niemand mehr. */
export function setzeErledigt(a: Belegung): Promise<Stand> {
  return db.get(
    `UPDATE auftraege SET status = 'erledigt', belegt_von = NULL, fehler = NULL, frist_bis = NULL, aktualisiert = NOW(),
            nutzlast = CASE WHEN art IN ('pdf', 'csv_import') THEN '{}'::jsonb ELSE nutzlast END
      WHERE id = $1 AND belegt_von = $2 AND status = 'laeuft' RETURNING COALESCE(schluessel, id::text) AS s`,
    [a.id, a.belegt_von]);
}
export function setzeFehlgeschlagen(a: Belegung, endgueltig: boolean, fehler: string, wartezeitSek: number): Promise<Stand> {
  return db.get(
    `UPDATE auftraege SET status = $3, fehler = $4, belegt_von = NULL, frist_bis = NULL, aktualisiert = NOW(),
            faellig_ab = NOW() + make_interval(secs => $5)
      WHERE id = $1 AND belegt_von = $2 AND status = 'laeuft' RETURNING COALESCE(schluessel, id::text) AS s`,
    [a.id, a.belegt_von, endgueltig ? 'fehler' : 'offen', fehler.slice(0, 2000), wartezeitSek]);
}
/** Zählt der Versuch nicht, bleibt die Zahl der Versuche, wie sie vor dem Belegen war. */
export function setzeVerschoben(a: Belegung, endgueltig: boolean, bis: Date, grund: string, zaehlt: boolean): Promise<Stand> {
  return db.get(
    `UPDATE auftraege SET status = $3, fehler = $4, faellig_ab = $5, belegt_von = NULL, frist_bis = NULL,
            versuche = CASE WHEN $6 THEN versuche ELSE GREATEST(versuche - 1, 0) END, aktualisiert = NOW()
      WHERE id = $1 AND belegt_von = $2 AND status = 'laeuft' RETURNING COALESCE(schluessel, id::text) AS s`,
    [a.id, a.belegt_von, endgueltig ? 'fehler' : 'offen', grund.slice(0, 2000), bis, zaehlt]);
}
type Abfrager = Pick<import('pg').ClientBase, 'query'>;

export async function halteProzessSperre(c: Abfrager, prozess: string): Promise<void> {
  await c.query('SELECT pg_advisory_lock($1, hashtext($2))', [LOCKS.JOB_PROZESS, prozess]);
}

/** Belegungen anderer Prozesse, deren Sperre frei ist: Der Prozess lebt nicht mehr
 * (die Sperre endet mit seiner Verbindung). Der Versuch zählt wie nach einer Frist.
 * @returns zurückgegebene Aufträge */
export async function gibVerwaisteZurueck(c: Abfrager, prozess: string): Promise<number> {
  const { rows } = await c.query<{ p: string }>(
    `SELECT DISTINCT split_part(belegt_von, '/', 1) AS p FROM auftraege
      WHERE status = 'laeuft' AND belegt_von LIKE '%/%' AND split_part(belegt_von, '/', 1) <> $1`, [prozess]);
  let n = 0;
  for (const { p } of rows) {
    if (!await versucheSchluesselSperre(c, LOCKS.JOB_PROZESS, p)) continue;
    try {
      n += (await c.query(
        `UPDATE auftraege SET status = 'offen', belegt_von = NULL, frist_bis = NULL, faellig_ab = NOW(), aktualisiert = NOW()
          WHERE status = 'laeuft' AND split_part(belegt_von, '/', 1) = $1 AND belegt_von LIKE '%/%'`, [p])).rowCount ?? 0;
    } finally {
      await gibSchluesselSperreFrei(c, LOCKS.JOB_PROZESS, p);
    }
  }
  return n;
}

/** Der Versuch zählt nicht. */
export async function gibZurueck(a: Belegung): Promise<void> {
  await db.run(
    `UPDATE auftraege SET status = 'offen', versuche = GREATEST(versuche - 1, 0), belegt_von = NULL,
            frist_bis = NULL, faellig_ab = NOW(), aktualisiert = NOW()
      WHERE id = $1 AND belegt_von = $2 AND status = 'laeuft'`, [a.id, a.belegt_von]);
}
export async function raeumeErledigteAuf(): Promise<number> {
  const r = await db.run(
    `DELETE FROM auftraege
      WHERE (status IN ('erledigt', 'abgebrochen') AND aktualisiert < NOW() - INTERVAL '7 days')
         OR (status = 'fehler' AND aktualisiert < NOW() - INTERVAL '30 days')`);
  return r?.changes ?? 0;
}
export async function liesPause(art: AuftragsArt): Promise<Pause | null> {
  return (await db.get('SELECT art, bis, grund, stufe FROM auftrag_pausen WHERE art = $1', [art])) ?? null;
}
/** `stufe` zählt wiederholte Drosselungen (Cloudflare). */
export async function pausiereArt(art: AuftragsArt, bis: Date, grund: string, stufe?: number): Promise<void> {
  await db.run(
    `INSERT INTO auftrag_pausen (art, bis, grund, stufe) VALUES ($1, $2, $3, COALESCE($4, 0))
     ON CONFLICT (art) DO UPDATE SET bis = EXCLUDED.bis, grund = EXCLUDED.grund,
       stufe = COALESCE($4, auftrag_pausen.stufe)`, [art, bis, grund, stufe ?? null]);
}
export async function loeschePause(art: AuftragsArt): Promise<void> {
  await db.run('DELETE FROM auftrag_pausen WHERE art = $1', [art]);
}
/** Ein laufender hört bei seinem nächsten Lebenszeichen auf. */
export async function setzeAbgebrochen(id: string): Promise<AuftragsZeile | null> {
  const z = await db.get(
    `UPDATE auftraege SET status = 'abgebrochen', frist_bis = NULL, aktualisiert = NOW(),
            fehler = COALESCE(fehler, 'abgebrochen')
      WHERE id = $1 AND status IN ('offen', 'laeuft') RETURNING ${SPALTEN}`, [id]);
  return z ? alsZeile(z) : null;
}
export async function stelleWiederEin(id: string): Promise<boolean> {
  const r = await db.run(
    `UPDATE auftraege a SET status = 'offen', versuche = 0, fehler = NULL, faellig_ab = NOW(), belegt_von = NULL,
            aktualisiert = NOW()
      WHERE a.id = $1 AND a.status IN ('fehler', 'abgebrochen')
        AND NOT EXISTS (SELECT 1 FROM auftraege o WHERE o.schluessel = a.schluessel AND o.status = 'offen')`, [id]);
  return (r?.changes ?? 0) > 0;
}
/** Ein geplanter Termin bleibt. */
export async function leereArt(art: AuftragsArt): Promise<number> {
  const r = await db.run(
    `DELETE FROM auftraege WHERE art = $1 AND status = 'offen' AND (schluessel IS NULL OR schluessel NOT LIKE 'plan:%')`, [art]);
  return r?.changes ?? 0;
}
export async function macheFaellig(art: AuftragsArt, schluessel?: string): Promise<number> {
  const r = await db.run(
    `UPDATE auftraege SET faellig_ab = NOW(), aktualisiert = NOW()
      WHERE art = $1 AND status = 'offen' AND ($2::text IS NULL OR schluessel = $2)`, [art, schluessel ?? null]);
  return r?.changes ?? 0;
}
export function statusZahlen(art: AuftragsArt) {
  return db.all<{ status: AuftragsStatus; n: number; }>(
    'SELECT status, COUNT(*)::int AS n FROM auftraege WHERE art = $1 GROUP BY status', [art]);
}
/** Die Rolle, wie sie jetzt ist, nicht wie beim Einstellen. */
export function kontoRolle(uid: number) {
  return db.get<{ is_admin: boolean }>('SELECT is_admin FROM users WHERE id = $1', [uid]);
}
export const AUFTRAG_KANAL = 'auftraege';
export const AUFTRAG_STAND_KANAL = 'auftrag_stand';
export const SPALTEN = 'id, art, nutzlast, user_id, schluessel, status, versuche, max_versuche, belegt_von, fehler';
export const alsZeile = (z: any): AuftragsZeile => ({ ...z, id: String(z.id) });

export async function setzeFaelligkeit(schluessel: string, faelligAb: Date): Promise<void> {
  await db.run(`UPDATE auftraege SET faellig_ab = $2, aktualisiert = NOW() WHERE schluessel = $1 AND status = 'offen'`,
    [schluessel, faelligAb]);
}

export async function zieheTerminVor(schluessel: string, sekunden: number, nutzlast: object): Promise<boolean> {
  const r = await db.run(
    `UPDATE auftraege SET faellig_ab = LEAST(faellig_ab, NOW() + make_interval(secs => $2)),
            nutzlast = nutzlast || $3::jsonb, aktualisiert = NOW()
      WHERE schluessel = $1 AND status = 'offen'`, [schluessel, sekunden, JSON.stringify(nutzlast)]);
  return (r.changes ?? 0) > 0;
}

export async function laeuftArt(art: string): Promise<boolean> {
  return !!(await db.get(`SELECT 1 FROM auftraege WHERE art = $1 AND status = 'laeuft'`, [art]));
}

export async function hoechsterBricksetVersuch(schluessel: string): Promise<number> {
  const z = await db.get<{ v: number }>(
    `SELECT COALESCE(MAX((nutzlast->>'versuch')::int), 0) AS v FROM auftraege
      WHERE schluessel = $1 AND status IN ('offen', 'laeuft')`, [schluessel]);
  return z?.v ?? 0;
}

/** Ein schon offener Auftrag desselben Sets wird umgeplant, nicht verdoppelt. */
export async function merkeBricksetVor(schluessel: string, nutzlast: Record<string, unknown>, faelligAb: Date, fehler: string): Promise<void> {
  await db.run(
    `INSERT INTO auftraege (art, nutzlast, schluessel, max_versuche, faellig_ab, fehler)
     VALUES ('brickset', $2, $1, 3, $3, $4)
     ON CONFLICT (schluessel) WHERE status = 'offen'
       DO UPDATE SET nutzlast = EXCLUDED.nutzlast, faellig_ab = EXCLUDED.faellig_ab,
                     fehler = EXCLUDED.fehler, aktualisiert = NOW()`,
    [schluessel, JSON.stringify(nutzlast), faelligAb, fehler]);
}

export async function loescheOffenen(schluessel: string): Promise<void> {
  await db.run(`DELETE FROM auftraege WHERE schluessel = $1 AND status = 'offen'`, [schluessel]);
}

/** Im Format der früheren Tabelle, damit die Oberfläche gleich bleibt. */
export function bricksetWiedervorlage() {
  return db.all<WiedervorlageZeile>(
    `SELECT a.nutzlast->>'set_number' AS set_number, to_char(a.faellig_ab, 'YYYY-MM-DD') AS retry_after,
            COALESCE((a.nutzlast->>'versuch')::int, 1) AS attempts, a.fehler AS last_error,
            a.erstellt AS created_at, rs.name
       FROM auftraege a LEFT JOIN rb_sets rs ON rs.set_num = a.nutzlast->>'set_number'
      WHERE a.art = 'brickset' AND a.status IN ('offen', 'laeuft')
      ORDER BY a.faellig_ab, 1`);
}

export function bricksetWartende() {
  return db.get<{ wartend: number; faellig: number }>(
    `SELECT COUNT(*)::int AS wartend, COUNT(*) FILTER (WHERE faellig_ab <= NOW())::int AS faellig
       FROM auftraege WHERE art = 'brickset' AND status IN ('offen', 'laeuft')`);
}

/** Ohne Nutzlast (ganze Listen) und ohne Konto, denn die Liste sieht der Verwalter. */
export function auftragsListe(status: string[], art: string | null) {
  return db.all<AuftragsListenZeile>(
    `SELECT id::text AS id, art, status, versuche, max_versuche, faellig_ab, frist_bis, gestartet, erstellt,
            aktualisiert, fortschritt, fehler, COALESCE(schluessel LIKE 'plan:%', false) AS geplant,
            nutzlast->>'set_number' AS set_number
       FROM auftraege
      WHERE status = ANY($1) AND ($2::text IS NULL OR art = $2)
      ORDER BY CASE status WHEN 'laeuft' THEN 0 WHEN 'offen' THEN 1 WHEN 'fehler' THEN 2 ELSE 3 END,
               faellig_ab, id
      LIMIT 200`, [status, art]);
}

export interface LetzterStand {
  art: AuftragsArt; status: AuftragsStatus; fortschritt: Fortschritt | null; fehler: string | null; aktualisiert: Date | null;
}
/** Je Art der laufende, sonst der zuletzt beendete, sonst der nächste geplante Auftrag. */
export function letzteJeArt(arten: readonly AuftragsArt[]) {
  return db.all<LetzterStand>(
    `SELECT DISTINCT ON (art) art, status, fortschritt, fehler, aktualisiert FROM auftraege
      WHERE art = ANY($1)
      ORDER BY art, CASE status WHEN 'laeuft' THEN 0 WHEN 'offen' THEN 2 ELSE 1 END, aktualisiert DESC`, [[...arten]]);
}

export function zahlenJeArtUndStatus() {
  return db.all<{ art: string; status: string; anzahl: number }>(`SELECT art, status, COUNT(*)::int AS anzahl FROM auftraege GROUP BY art, status ORDER BY art, status`);
}

export function laufendePausen() {
  return db.all<{ art: string; bis: Date; grund: string | null }>(`SELECT art, bis, grund FROM auftrag_pausen WHERE bis > NOW() ORDER BY bis`);
}

export function auftragsStand(id: string) {
  return db.get<{ status: AuftragsStatus; fortschritt: Fortschritt | null; ergebnis: Record<string, unknown> | null }>(
    'SELECT status, fortschritt, ergebnis FROM auftraege WHERE id = $1', [id]);
}

export function zieheBricksetTermineVor(bis: Date) {
  return db.run(`UPDATE auftraege SET faellig_ab = $1 WHERE art = 'brickset' AND status = 'offen' AND faellig_ab > NOW()`, [bis]);
}

export async function schreibeErgebnis(id: string, ergebnis: Record<string, unknown> | null): Promise<void> {
  await db.run('UPDATE auftraege SET ergebnis = $2 WHERE id = $1', [id, ergebnis === null ? null : JSON.stringify(ergebnis)]);
}
