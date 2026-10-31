/**
 * Die Auftragstabelle als Schnittstelle: einstellen, belegen, melden,
 * pausieren. Jeder Wechsel, auf den jemand wartet, weckt ihn: neue Aufträge
 * den Job-Prozess (AUFTRAG_KANAL), Statuswechsel den Statusstrom einer
 * Oberfläche (AUFTRAG_STAND_KANAL). Geht ein NOTIFY verloren, findet der
 * Worker den Auftrag in seinem Takt.
 */
import { notify } from '../../db/pgNotify';
import { imNamenVon } from '../infra/anfrageKonto';
import * as repo from './repository/auftraege';
import type { AuftragsArt, AuftragsStatus, AuftragsZeile, Belegung, Einstellen, Fortschritt } from './auftraege';

export { belegeAuftrag, gibZurueck, lebenszeichen, leereArt, liesPause, pausiereArt, raeumeErledigteAuf,
  setzeFaelligkeit, zieheTerminVor, laeuftArt, AUFTRAG_KANAL, AUFTRAG_STAND_KANAL } from './repository/auftraege';

async function meldeStand(z: { s: string } | undefined): Promise<void> {
  if (z) await notify(repo.AUFTRAG_STAND_KANAL, z.s);
}

/** Wartezeit vor dem nächsten Versuch: 30 s, verdoppelt je Versuch, höchstens eine Stunde. */
export function wartezeitSek(versuch: number): number {
  return Math.min(3600, 30 * 2 ** Math.max(0, versuch - 1));
}

/** @returns die Kennung, oder null, wenn derselbe Auftrag schon offen steht */
export async function stelleAuftragEin(art: AuftragsArt, nutzlast: Record<string, unknown>, o: Einstellen = {}): Promise<string | null> {
  const id = await repo.fuegeAuftragEin(art, nutzlast, o);
  await notify(repo.AUFTRAG_KANAL, art);
  return id;
}

/** Den Stand für die Anzeige setzen; zählt zugleich als Lebenszeichen. */
export async function setzeFortschritt(a: Belegung, f: Fortschritt, fristSek: number): Promise<boolean> {
  const z = await repo.schreibeFortschritt(a, f, fristSek);
  await meldeStand(z);
  return !!z;
}

export async function erledigt(a: Belegung): Promise<boolean> {
  const z = await repo.setzeErledigt(a);
  await meldeStand(z);
  return !!z;
}

/** @returns true, wenn es der letzte Versuch war und der Auftrag jetzt 'fehler' ist */
export async function fehlgeschlagen(a: AuftragsZeile, fehler: string): Promise<boolean> {
  const endgueltig = a.versuche >= a.max_versuche;
  const z = await repo.setzeFehlgeschlagen(a, endgueltig, fehler, wartezeitSek(a.versuche));
  await meldeStand(z);
  return endgueltig && !!z;
}

/**
 * Später fortsetzen, etwa nach einer Drosselung der Gegenseite.
 * @returns true, wenn der Versuch zählte und es der letzte war (dann 'fehler')
 */
export async function verschoben(a: AuftragsZeile, bis: Date, grund: string, zaehlt: boolean): Promise<boolean> {
  const endgueltig = zaehlt && a.versuche >= a.max_versuche;
  const z = await repo.setzeVerschoben(a, endgueltig, bis, grund, zaehlt);
  await meldeStand(z);
  return endgueltig && !!z;
}

export async function beendePause(art: AuftragsArt): Promise<void> {
  await repo.loeschePause(art);
  await notify(repo.AUFTRAG_KANAL, art);
}

/** Einen offenen oder laufenden Auftrag abbrechen; ein laufender hört bei seinem nächsten Lebenszeichen auf. */
export async function brichAb(id: string): Promise<AuftragsZeile | null> {
  const a = await repo.setzeAbgebrochen(id);
  if (a) await meldeStand({ s: a.schluessel ?? a.id });
  return a;
}

export async function wiederhole(id: string): Promise<boolean> {
  const ja = await repo.stelleWiederEin(id);
  if (ja) await notify(repo.AUFTRAG_KANAL, 'wiederholt');
  return ja;
}

/** Offene Aufträge einer Art (oder eines Schlüssels) jetzt fällig machen. @returns wie viele */
export async function zieheVor(art: AuftragsArt, schluessel?: string): Promise<number> {
  const n = await repo.macheFaellig(art, schluessel);
  if (n > 0) await notify(repo.AUFTRAG_KANAL, art);
  return n;
}

/** Wie viele Aufträge einer Art in welchem Status stehen — jeder Status mit Zahl, auch 0. */
export async function zaehleArt(art: AuftragsArt): Promise<Record<AuftragsStatus, number>> {
  const aus = { offen: 0, laeuft: 0, erledigt: 0, fehler: 0, abgebrochen: 0 };
  for (const z of await repo.statusZahlen(art)) aus[z.status] = z.n;
  return aus;
}

/**
 * Einen Auftrag im Namen des Kontos ausführen, das ihn eingestellt hat. Sonst
 * zählte ein CSV-Import eines Unterkontos als Hintergrund und umginge dessen
 * Anteil am Fremdkontingent (src/katalog/apiKontingent.ts).
 */
export async function imNamenDesAuftrags<T>(a: Pick<AuftragsZeile, 'user_id'>, f: () => Promise<T>): Promise<T> {
  if (a.user_id == null) return f();
  const u = await repo.kontoRolle(a.user_id);
  return imNamenVon({ apiUser: { user_id: a.user_id, is_admin: u?.is_admin === true || Number(u?.is_admin) === 1 ? 1 : 0 } }, f);
}
