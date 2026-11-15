/** Jeder Wechsel, auf den jemand wartet, weckt ihn per NOTIFY: neue Aufträge
 * den Job-Prozess, Statuswechsel den Statusstrom. Geht ein NOTIFY verloren,
 * findet der Worker den Auftrag in seinem Takt. */
import { alsAnfrage, imSystemkontext } from '../infra/kontoKontext';
import * as repo from './repository/auftraege';
import {
  AuftragVerloren,
  type AuftragsArt,
  type AuftragsStatus,
  type AuftragsZeile,
  type Belegung,
  type Einstellen,
  type Fortschritt,
  type NutzlastEingabe,
} from './auftraege';
import { logAndContinue } from '../infra/fehler';
import { signal } from '../infra/ereignis';
import type { AuftraegeKontext } from './kontext';

/** Ein neuer oder wieder fälliger Auftrag weckt den Job-Prozess; die Nutzlast nennt die Art. */
export const NEUER_AUFTRAG = signal(repo.AUFTRAG_KANAL);
/** Ein Statuswechsel weckt die Statusströme; die Nutzlast nennt den Schlüssel. */
export const AUFTRAGS_STAND = signal(repo.AUFTRAG_STAND_KANAL);

export function weckeWorker(k: AuftraegeKontext, art: string): Promise<void> {
  return NEUER_AUFTRAG.melde(k.db.benachrichtigung, art);
}

async function meldeStand(k: AuftraegeKontext, z: { s: string } | undefined): Promise<void> {
  if (z) await AUFTRAGS_STAND.melde(k.db.benachrichtigung, z.s);
}

/** 30 s, verdoppelt je Versuch, höchstens eine Stunde. */
export function wartezeitSek(versuch: number): number {
  return Math.min(3600, 30 * 2 ** Math.max(0, versuch - 1));
}

export async function stelleAuftragEin<A extends AuftragsArt>(
  k: AuftraegeKontext,
  art: A,
  nutzlast: NutzlastEingabe<A>,
  o: Einstellen = {},
): Promise<string | null> {
  const id = await k.auftraege.fuegeAuftragEin(art, k.arten.pruefe(art, nutzlast), o);
  await weckeWorker(k, art);
  return id;
}

/** Ein Auftrag des anfragenden Kontos (oder seines Unterkontos), auch in dessen Transaktion:
 * ohne Systemrahmen, der Zeilenschutz prüft, dass user_id zum Haushalt gehört. */
export async function stelleEigenenAuftragEin<A extends AuftragsArt>(
  k: AuftraegeKontext,
  art: A,
  nutzlast: NutzlastEingabe<A>,
  o: Einstellen & { userId: number },
): Promise<string | null> {
  const id = await k.auftraege.fuegeEigenenAuftragEin(art, k.arten.pruefe(art, nutzlast), o);
  await weckeWorker(k, art);
  return id;
}

/** Je Schlüssel höchstens ein wartender Auftrag, der die neuen Einträge der Liste `liste` zu
 * seinen nimmt: Jede Meldung ergänzt, statt einen zweiten Auftrag anzulegen. */
export async function ergaenzeListenAuftrag<A extends AuftragsArt>(
  k: AuftraegeKontext,
  art: A,
  nutzlast: NutzlastEingabe<A>,
  o: { schluessel: string; liste: string; hoechstens: number; userId: number },
): Promise<string> {
  const n = k.arten.pruefe(art, nutzlast);
  const id = await k.auftraege.ergaenzeListenAuftrag(art, n as object, o);
  await weckeWorker(k, art);
  return id;
}

/** Zählt zugleich als Lebenszeichen. erledigt und gesamt sind Zählungen (Vertrag
 * und App: ganzzahlig); ein Bruchteil wie 5,532 von 8 Schritten stand als „5.532 / 8“ da. */
export async function setzeFortschritt(
  kx: AuftraegeKontext,
  a: Belegung,
  f: Fortschritt,
  fristSek: number,
): Promise<boolean> {
  const stand: Fortschritt = { ...f };
  for (const k of ['erledigt', 'gesamt'] as const) {
    const x = f[k];
    if (typeof x === 'number' && Number.isFinite(x)) stand[k] = Math.floor(x);
  }
  const z = await kx.auftraege.schreibeFortschritt(a, stand, fristSek);
  await meldeStand(kx, z);
  return !!z;
}

export async function erledigt(k: AuftraegeKontext, a: Belegung & Pick<AuftragsZeile, 'art'>): Promise<boolean> {
  const z = await k.auftraege.setzeErledigt(a, !!k.arten.von(a.art)?.nutzlastVerwerfen);
  await meldeStand(k, z);
  return !!z;
}

/** @returns true, wenn es der letzte Versuch war und der Auftrag jetzt 'fehler' ist */
export async function fehlgeschlagen(
  k: AuftraegeKontext,
  a: AuftragsZeile,
  fehler: string,
  sofortEndgueltig = false,
): Promise<boolean> {
  const endgueltig = sofortEndgueltig || a.versuche >= a.max_versuche;
  const z = await k.auftraege.setzeFehlgeschlagen(a, endgueltig, fehler, wartezeitSek(a.versuche));
  await meldeStand(k, z);
  return endgueltig && !!z;
}

/** Etwa nach einer Drosselung der Gegenseite.
 * @returns true, wenn der Versuch zählte und es der letzte war (dann 'fehler') */
export async function verschoben(
  k: AuftraegeKontext,
  a: AuftragsZeile,
  bis: Date,
  grund: string,
  zaehlt: boolean,
): Promise<boolean> {
  const endgueltig = zaehlt && a.versuche >= a.max_versuche;
  const z = await k.auftraege.setzeVerschoben(a, endgueltig, bis, grund, zaehlt);
  await meldeStand(k, z);
  return endgueltig && !!z;
}

export async function beendePause(k: AuftraegeKontext, art: AuftragsArt): Promise<void> {
  await k.auftraege.loeschePause(art);
  await weckeWorker(k, art);
}

/** Ein laufender hört bei seinem nächsten Lebenszeichen auf. */
export async function brichAb(k: AuftraegeKontext, id: string): Promise<AuftragsZeile | null> {
  const a = await k.auftraege.setzeAbgebrochen(id);
  if (a) await meldeStand(k, { s: a.schluessel ?? a.id });
  return a;
}

export async function wiederhole(k: AuftraegeKontext, id: string): Promise<boolean> {
  const ja = await k.auftraege.stelleWiederEin(id);
  if (ja) await weckeWorker(k, 'wiederholt');
  return ja;
}

export async function zieheVor(k: AuftraegeKontext, art: AuftragsArt, schluessel?: string): Promise<number> {
  const n = await k.auftraege.macheFaellig(art, schluessel);
  if (n > 0) await weckeWorker(k, art);
  return n;
}

/** Jeder Status mit Zahl, auch 0. */
export async function zaehleArt(k: AuftraegeKontext, art: AuftragsArt): Promise<Record<AuftragsStatus, number>> {
  const aus = { offen: 0, laeuft: 0, erledigt: 0, fehler: 0, abgebrochen: 0 };
  for (const z of await k.auftraege.statusZahlen(art)) aus[z.status] = z.n;
  return aus;
}

/** Ein Auftrag mit Konto läuft wie eine Anfrage dieses Kontos, auch aus einem Systemrahmen
 * heraus: Der Zeilenschutz gilt für ihn wie für das Konto, und ein Import eines Unterkontos
 * zählt auf dessen Anteil am Fremdkontingent. */
export async function imNamenDesAuftrags<T>(
  k: AuftraegeKontext,
  a: Pick<AuftragsZeile, 'art' | 'user_id'>,
  f: () => Promise<T>,
): Promise<T> {
  if (a.user_id == null) return imAuftragsrahmen(k, a, f);
  const u = await k.auftraege.kontoRolle(a.user_id);
  return alsAnfrage({ apiUser: { user_id: a.user_id, is_admin: !!u?.is_admin } }, f);
}

/** Ein Auftrag ohne Konto: im Systemrahmen nur, wenn seine Art als kontoübergreifend
 * angemeldet ist (Anmeldung.kontouebergreifend), sonst ohne Konto und ohne Systemrahmen. */
export function imAuftragsrahmen<T>(
  k: AuftraegeKontext,
  a: Pick<AuftragsZeile, 'art'>,
  f: () => Promise<T>,
): Promise<T> {
  const grund = k.arten.von(a.art)?.kontouebergreifend;
  return grund ? imSystemkontext(`auftrag ${a.art}: ${grund}`, f) : alsAnfrage({}, f);
}

/** Weckt bei jedem Statuswechsel eines Auftrags, auch aus dem Job-Prozess; gibt das Abmelden zurück. */
export function beiAuftragsStand(k: AuftraegeKontext, f: (schluessel?: string) => void): () => void {
  return AUFTRAGS_STAND.horche(k.db.benachrichtigung, f);
}

/** Weckt, sobald irgendwo ein Auftrag eingestellt wird; gibt das Abmelden zurück. */
export function beiNeuemAuftrag(k: AuftraegeKontext, f: () => void): () => void {
  return NEUER_AUFTRAG.horche(k.db.benachrichtigung, f);
}

/** Ein Abbruch über die Verwaltung meldet sich per NOTIFY: Die betroffenen laufenden Aufträge sehen sofort
 * nach, ob sie ihre Zeile noch halten, statt erst beim nächsten Lebenszeichen. */
export function pruefeZugehoerigkeit(
  k: AuftraegeKontext,
  laeufe: Iterable<{ a: AuftragsZeile; ac: AbortController }>,
  schluessel?: string,
): void {
  for (const { a, ac } of laeufe) {
    if (ac.signal.aborted || (schluessel !== undefined && schluessel !== (a.schluessel ?? a.id))) continue;
    void k.auftraege.gehoertNoch(a).then(
      ja => {
        if (!ja && !ac.signal.aborted) ac.abort(new AuftragVerloren());
      },
      logAndContinue(`auftraege:stand ${a.art}`),
    );
  }
}
