import { randomUUID } from 'crypto';
import * as db from '../db/database';
import { notify } from './pgNotify';

/**
 * Die Auftragstabelle (Migrationen 0066, 0080): jede Hintergrundarbeit als
 * Zeile. Einstellen geht aus jedem Prozess, abgearbeitet wird im Job-Prozess
 * (jobs/auftragsWorker.ts). Das NOTIFY weckt ihn sofort; geht es verloren,
 * findet ihn sein Takt.
 */
export const AUFTRAG_KANAL = 'auftraege';
/** Ein Auftrag hat seinen Stand geändert; die Nutzlast ist sein Schlüssel oder seine Kennung. */
export const AUFTRAG_STAND_KANAL = 'auftrag_stand';

/** Was im Baum als Auftrag läuft; der Worker kennt für jede Art einen Bearbeiter. */
export const AUFTRAGS_ARTEN = [
  'nacharbeit', 'bilder', 'pdf', 'csv_import', 'wechselkurse',
  'anleitung', 'brickset', 'bildbedarf', 'bilder_neu_laden', 'nachlauf',
  'csv_sync', 'preise', 'bild_nachlauf', 'aufraeumen', 'aufraeumen_taeglich',
] as const;
export type AuftragsArt = typeof AUFTRAGS_ARTEN[number];

export type AuftragsStatus = 'offen' | 'laeuft' | 'erledigt' | 'fehler' | 'abgebrochen';

/** Stand eines laufenden Auftrags für die Anzeige. */
export interface Fortschritt { erledigt?: number; gesamt?: number; text?: string | null; [k: string]: unknown }

export interface AuftragsZeile {
  id: string;
  art: AuftragsArt;
  nutzlast: Record<string, unknown>;
  user_id: number | null;
  schluessel: string | null;
  status: AuftragsStatus;
  versuche: number;
  max_versuche: number;
  belegt_von: string | null;
  fehler: string | null;
}

export interface Einstellen {
  userId?: number | null;
  /** Steht ein offener Auftrag mit diesem Schlüssel schon da, kommt kein zweiter dazu. */
  schluessel?: string;
  maxVersuche?: number;
  /** Frühestens nach so vielen Sekunden. */
  nachSekunden?: number;
  /** Frühestens zu diesem Zeitpunkt; geht nachSekunden vor. */
  faelligAb?: Date;
  fortschritt?: Fortschritt;
}

const SPALTEN = 'id, art, nutzlast, user_id, schluessel, status, versuche, max_versuche, belegt_von, fehler';
const alsZeile = (z: any): AuftragsZeile => ({ ...z, id: String(z.id) });

/** @returns die Kennung, oder null, wenn derselbe Auftrag schon offen steht */
export async function stelleAuftragEin(art: AuftragsArt, nutzlast: Record<string, unknown>,
                                       o: Einstellen = {}): Promise<string | null> {
  const z = await db.get(
    `INSERT INTO auftraege (art, nutzlast, user_id, schluessel, max_versuche, faellig_ab, fortschritt)
     VALUES ($1, $2, $3, $4, $5, COALESCE($7::timestamptz, NOW() + make_interval(secs => $6)), $8)
     ON CONFLICT (schluessel) WHERE status = 'offen' DO NOTHING
     RETURNING id`,
    [art, JSON.stringify(nutzlast), o.userId ?? null, o.schluessel ?? null, o.maxVersuche ?? 5,
     o.nachSekunden ?? 0, o.faelligAb ?? null, o.fortschritt ? JSON.stringify(o.fortschritt) : null]);
  await notify(AUFTRAG_KANAL, art);
  return z ? String(z.id) : null;
}

/**
 * Den nächsten fälligen Auftrag belegen. Ein 'laeuft' mit abgelaufener Frist
 * gehört einem Prozess, den es nicht mehr gibt, und wird neu vergeben. Eine
 * pausierte Art wartet; von einer exklusiven läuft höchstens einer.
 * SKIP LOCKED: Zwei Worker greifen nie dieselbe Zeile.
 */
export async function belegeAuftrag(arten: readonly string[], fristSek: number,
                                    belegtVon: string = randomUUID(),
                                    exklusiv: readonly string[] = []): Promise<AuftragsZeile | null> {
  const z = await db.get(
    `UPDATE auftraege SET status = 'laeuft', versuche = versuche + 1, belegt_von = $1,
            frist_bis = NOW() + make_interval(secs => $2), gestartet = NOW(), aktualisiert = NOW()
      WHERE id = (SELECT a.id FROM auftraege a
                   WHERE a.art = ANY($3)
                     AND ((a.status = 'offen' AND a.faellig_ab <= NOW())
                       OR (a.status = 'laeuft' AND a.frist_bis < NOW()))
                     AND NOT EXISTS (SELECT 1 FROM auftrag_pausen p WHERE p.art = a.art AND p.bis > NOW())
                     AND NOT (a.art = ANY($4) AND EXISTS (
                           SELECT 1 FROM auftraege l WHERE l.art = a.art AND l.status = 'laeuft'
                              AND l.frist_bis >= NOW() AND l.id <> a.id))
                   ORDER BY a.faellig_ab, a.id LIMIT 1
                   FOR UPDATE SKIP LOCKED)
      RETURNING ${SPALTEN}`,
    [belegtVon, fristSek, [...arten], [...exklusiv]]);
  return z ? alsZeile(z) : null;
}

type Belegung = Pick<AuftragsZeile, 'id' | 'belegt_von'>;

/** Frist verlängern. @returns false, wenn der Auftrag nicht mehr diesem Lauf gehört (auch: abgebrochen) */
export async function lebenszeichen(a: Belegung, fristSek: number): Promise<boolean> {
  const r = await db.run(
    `UPDATE auftraege SET frist_bis = NOW() + make_interval(secs => $3), aktualisiert = NOW()
      WHERE id = $1 AND belegt_von = $2 AND status = 'laeuft'`, [a.id, a.belegt_von, fristSek]);
  return (r?.changes ?? 0) > 0;
}

/** Den Stand für die Anzeige setzen; zählt zugleich als Lebenszeichen. */
export async function setzeFortschritt(a: Belegung, f: Fortschritt, fristSek: number): Promise<boolean> {
  const z = await db.get(
    `UPDATE auftraege SET fortschritt = $3, frist_bis = NOW() + make_interval(secs => $4), aktualisiert = NOW()
      WHERE id = $1 AND belegt_von = $2 AND status = 'laeuft' RETURNING COALESCE(schluessel, id::text) AS s`,
    [a.id, a.belegt_von, JSON.stringify(f), fristSek]);
  if (z) await notify(AUFTRAG_STAND_KANAL, z.s);
  return !!z;
}

/** Ein Statuswechsel weckt, wer auf den Auftrag wartet (z. B. den PDF-Statusstrom). */
async function meldeStand(z: { s: string } | undefined): Promise<void> {
  if (z) await notify(AUFTRAG_STAND_KANAL, z.s);
}

/** PDF und CSV tragen ganze Listen; erledigt braucht die niemand mehr. */
export async function erledigt(a: Belegung): Promise<boolean> {
  const z = await db.get(
    `UPDATE auftraege SET status = 'erledigt', belegt_von = NULL, fehler = NULL, frist_bis = NULL, aktualisiert = NOW(),
            nutzlast = CASE WHEN art IN ('pdf', 'csv_import') THEN '{}'::jsonb ELSE nutzlast END
      WHERE id = $1 AND belegt_von = $2 AND status = 'laeuft' RETURNING COALESCE(schluessel, id::text) AS s`,
    [a.id, a.belegt_von]);
  await meldeStand(z);
  return !!z;
}

/** Wartezeit vor dem nächsten Versuch: 30 s, verdoppelt je Versuch, höchstens eine Stunde. */
export function wartezeitSek(versuch: number): number {
  return Math.min(3600, 30 * 2 ** Math.max(0, versuch - 1));
}

/** @returns true, wenn es der letzte Versuch war und der Auftrag jetzt 'fehler' ist */
export async function fehlgeschlagen(a: AuftragsZeile, fehler: string): Promise<boolean> {
  const endgueltig = a.versuche >= a.max_versuche;
  const z = await db.get(
    `UPDATE auftraege SET status = $3, fehler = $4, belegt_von = NULL, frist_bis = NULL, aktualisiert = NOW(),
            faellig_ab = NOW() + make_interval(secs => $5)
      WHERE id = $1 AND belegt_von = $2 AND status = 'laeuft' RETURNING COALESCE(schluessel, id::text) AS s`,
    [a.id, a.belegt_von, endgueltig ? 'fehler' : 'offen', fehler.slice(0, 2000), wartezeitSek(a.versuche)]);
  await meldeStand(z);
  return endgueltig && !!z;
}

/**
 * Später fortsetzen, etwa nach einer Drosselung der Gegenseite. Zählt der
 * Versuch nicht, bleibt die Zahl der Versuche, wie sie vor dem Belegen war.
 * @returns true, wenn der Versuch zählte und es der letzte war (dann 'fehler')
 */
export async function verschoben(a: AuftragsZeile, bis: Date, grund: string, zaehlt: boolean): Promise<boolean> {
  const endgueltig = zaehlt && a.versuche >= a.max_versuche;
  const z = await db.get(
    `UPDATE auftraege SET status = $3, fehler = $4, faellig_ab = $5, belegt_von = NULL, frist_bis = NULL,
            versuche = CASE WHEN $6 THEN versuche ELSE GREATEST(versuche - 1, 0) END, aktualisiert = NOW()
      WHERE id = $1 AND belegt_von = $2 AND status = 'laeuft' RETURNING COALESCE(schluessel, id::text) AS s`,
    [a.id, a.belegt_von, endgueltig ? 'fehler' : 'offen', grund.slice(0, 2000), bis, zaehlt]);
  await meldeStand(z);
  return endgueltig && !!z;
}

/** Beim Herunterfahren zurückgeben: sofort wieder fällig, der Versuch zählt nicht. */
export async function gibZurueck(a: Belegung): Promise<void> {
  await db.run(
    `UPDATE auftraege SET status = 'offen', versuche = GREATEST(versuche - 1, 0), belegt_von = NULL,
            frist_bis = NULL, faellig_ab = NOW(), aktualisiert = NOW()
      WHERE id = $1 AND belegt_von = $2 AND status = 'laeuft'`, [a.id, a.belegt_von]);
}

/** Erledigte und abgebrochene nach sieben, gescheiterte nach dreissig Tagen entfernen. */
export async function raeumeErledigteAuf(): Promise<number> {
  const r = await db.run(
    `DELETE FROM auftraege
      WHERE (status IN ('erledigt', 'abgebrochen') AND aktualisiert < NOW() - INTERVAL '7 days')
         OR (status = 'fehler' AND aktualisiert < NOW() - INTERVAL '30 days')`);
  return r?.changes ?? 0;
}

// ── Pausen je Art ────────────────────────────────────────────────────────────
// Eine Gegenseite drosselt (Cloudflare, CDN, Tageskontingent) oder will
// Abstand zwischen zwei Abrufen: Dann wartet die ganze Art, nicht ein Auftrag.

export interface Pause { art: string; bis: Date; grund: string | null; stufe: number }

export async function liesPause(art: AuftragsArt): Promise<Pause | null> {
  return (await db.get('SELECT art, bis, grund, stufe FROM auftrag_pausen WHERE art = $1', [art])) ?? null;
}

/** Ohne `stufe` bleibt die bisherige; sie zählt wiederholte Drosselungen (Cloudflare). */
export async function pausiereArt(art: AuftragsArt, bis: Date, grund: string, stufe?: number): Promise<void> {
  await db.run(
    `INSERT INTO auftrag_pausen (art, bis, grund, stufe) VALUES ($1, $2, $3, COALESCE($4, 0))
     ON CONFLICT (art) DO UPDATE SET bis = EXCLUDED.bis, grund = EXCLUDED.grund,
       stufe = COALESCE($4, auftrag_pausen.stufe)`, [art, bis, grund, stufe ?? null]);
}

export async function beendePause(art: AuftragsArt): Promise<void> {
  await db.run('DELETE FROM auftrag_pausen WHERE art = $1', [art]);
  await notify(AUFTRAG_KANAL, art);
}

// ── Für die Verwaltung ───────────────────────────────────────────────────────

/** Einen offenen oder laufenden Auftrag abbrechen; ein laufender hört bei seinem nächsten Lebenszeichen auf. */
export async function brichAb(id: string): Promise<AuftragsZeile | null> {
  const z = await db.get(
    `UPDATE auftraege SET status = 'abgebrochen', frist_bis = NULL, aktualisiert = NOW(),
            fehler = COALESCE(fehler, 'abgebrochen')
      WHERE id = $1 AND status IN ('offen', 'laeuft') RETURNING ${SPALTEN}`, [id]);
  if (z) await meldeStand({ s: z.schluessel ?? String(z.id) });
  return z ? alsZeile(z) : null;
}

/** Einen gescheiterten oder abgebrochenen Auftrag neu einstellen, mit allen Versuchen. */
export async function wiederhole(id: string): Promise<boolean> {
  const r = await db.run(
    `UPDATE auftraege a SET status = 'offen', versuche = 0, fehler = NULL, faellig_ab = NOW(), belegt_von = NULL,
            aktualisiert = NOW()
      WHERE a.id = $1 AND a.status IN ('fehler', 'abgebrochen')
        AND NOT EXISTS (SELECT 1 FROM auftraege o WHERE o.schluessel = a.schluessel AND o.status = 'offen')`, [id]);
  if ((r?.changes ?? 0) > 0) await notify(AUFTRAG_KANAL, 'wiederholt');
  return (r?.changes ?? 0) > 0;
}

/** Offene Aufträge einer Art entfernen; ein geplanter Termin bleibt. @returns wie viele */
export async function leereArt(art: AuftragsArt): Promise<number> {
  const r = await db.run(
    `DELETE FROM auftraege WHERE art = $1 AND status = 'offen' AND (schluessel IS NULL OR schluessel NOT LIKE 'plan:%')`, [art]);
  return r?.changes ?? 0;
}

/** Offene Aufträge einer Art (oder eines Schlüssels) jetzt fällig machen. @returns wie viele */
export async function zieheVor(art: AuftragsArt, schluessel?: string): Promise<number> {
  const r = await db.run(
    `UPDATE auftraege SET faellig_ab = NOW(), aktualisiert = NOW()
      WHERE art = $1 AND status = 'offen' AND ($2::text IS NULL OR schluessel = $2)`, [art, schluessel ?? null]);
  if ((r?.changes ?? 0) > 0) await notify(AUFTRAG_KANAL, art);
  return r?.changes ?? 0;
}

/** Wie viele Aufträge einer Art in welchem Status stehen. */
export async function zaehleArt(art: AuftragsArt): Promise<Record<AuftragsStatus, number>> {
  const zeilen = await db.all<{ status: AuftragsStatus; n: number }>(
    'SELECT status, COUNT(*)::int AS n FROM auftraege WHERE art = $1 GROUP BY status', [art]);
  const aus = { offen: 0, laeuft: 0, erledigt: 0, fehler: 0, abgebrochen: 0 };
  for (const z of zeilen) aus[z.status] = z.n;
  return aus;
}
