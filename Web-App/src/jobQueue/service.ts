/** Jeder Wechsel, auf den jemand wartet, weckt ihn per NOTIFY: neue Aufträge
 * den Job-Prozess, Statuswechsel den Statusstrom. Geht ein NOTIFY verloren,
 * findet der Worker den Auftrag in seinem Takt. */
import { asRequest, inSystemContext } from '../infra/kontoKontext';
import * as repo from './repository/jobs';
import {
  JobLost,
  type JobKind,
  type JobStatus,
  type JobRow,
  type Belegung,
  type Einstellen,
  type Fortschritt,
  type PayloadInput,
} from './jobs';
import { logAndContinue } from '../infra/fehler';
import { signal } from '../infra/ereignis';
import type { JobsContext } from './context';

/** Ein neuer oder wieder fälliger Auftrag weckt den Job-Prozess; die Nutzlast nennt die Art. */
export const NEW_JOB = signal(repo.JOB_CHANNEL);
/** Ein Statuswechsel weckt die Statusströme; die Nutzlast nennt den Schlüssel. */
export const JOB_STATUS = signal(repo.JOB_STATUS_CHANNEL);

export function wakeWorker(k: JobsContext, art: string): Promise<void> {
  return NEW_JOB.melde(k.db.notification, art);
}

async function reportStatus(k: JobsContext, z: { s: string } | undefined): Promise<void> {
  if (z) await JOB_STATUS.melde(k.db.notification, z.s);
}

/** 30 s, verdoppelt je Versuch, höchstens eine Stunde. */
export function waitTimeSec(versuch: number): number {
  return Math.min(3600, 30 * 2 ** Math.max(0, versuch - 1));
}

export async function placeJobOne<A extends JobKind>(
  k: JobsContext,
  art: A,
  nutzlast: PayloadInput<A>,
  o: Einstellen = {},
): Promise<string | null> {
  const id = await k.auftraege.addJobOne(art, k.arten.pruefe(art, nutzlast), o);
  await wakeWorker(k, art);
  return id;
}

/** Ein Auftrag des anfragenden Kontos (oder seines Unterkontos), auch in dessen Transaktion:
 * ohne Systemrahmen, der Zeilenschutz prüft, dass user_id zum Haushalt gehört. */
export async function placeOwnJobOne<A extends JobKind>(
  k: JobsContext,
  art: A,
  nutzlast: PayloadInput<A>,
  o: Einstellen & { userId: number },
): Promise<string | null> {
  const id = await k.auftraege.addOwnJobOne(art, k.arten.pruefe(art, nutzlast), o);
  await wakeWorker(k, art);
  return id;
}

/** Je Schlüssel höchstens ein wartender Auftrag, der die neuen Einträge der Liste `liste` zu
 * seinen nimmt: Jede Meldung ergänzt, statt einen zweiten Auftrag anzulegen. */
export async function supplementListenJob<A extends JobKind>(
  k: JobsContext,
  art: A,
  nutzlast: PayloadInput<A>,
  o: { schluessel: string; liste: string; hoechstens: number; userId: number },
): Promise<string> {
  const n = k.arten.pruefe(art, nutzlast);
  const id = await k.auftraege.addListAn(art, n as object, o);
  await wakeWorker(k, art);
  return id;
}

/** Zählt zugleich als Lebenszeichen. erledigt und gesamt sind Zählungen (Vertrag
 * und App: ganzzahlig); ein Bruchteil wie 5,532 von 8 Schritten stand als „5.532 / 8“ da. */
export async function setProgress(kx: JobsContext, a: Belegung, f: Fortschritt, deadlineSec: number): Promise<boolean> {
  const stand: Fortschritt = { ...f };
  for (const k of ['erledigt', 'gesamt'] as const) {
    const x = f[k];
    if (typeof x === 'number' && Number.isFinite(x)) stand[k] = Math.floor(x);
  }
  const z = await kx.auftraege.writeProgress(a, stand, deadlineSec);
  await reportStatus(kx, z);
  return !!z;
}

export async function erledigt(k: JobsContext, a: Belegung & Pick<JobRow, 'type'>): Promise<boolean> {
  const z = await k.auftraege.setDone(a, !!k.arten.von(a.type)?.discardPayload);
  await reportStatus(k, z);
  return !!z;
}

/** @returns true, wenn es der letzte Versuch war und der Auftrag jetzt 'fehler' ist */
export async function fehlgeschlagen(
  k: JobsContext,
  a: JobRow,
  fehler: string,
  immediatelyFinal = false,
): Promise<boolean> {
  const final = immediatelyFinal || a.attempts >= a.max_attempts;
  const z = await k.auftraege.setFailed(a, final, fehler, waitTimeSec(a.attempts));
  await reportStatus(k, z);
  return final && !!z;
}

/** Etwa nach einer Drosselung der Gegenseite.
 * @returns true, wenn der Versuch zählte und es der letzte war (dann 'fehler') */
export async function verschoben(
  k: JobsContext,
  a: JobRow,
  bis: Date,
  grund: string,
  zaehlt: boolean,
): Promise<boolean> {
  const final = zaehlt && a.attempts >= a.max_attempts;
  const z = await k.auftraege.setMoved(a, final, bis, grund, zaehlt);
  await reportStatus(k, z);
  return final && !!z;
}

export async function endPause(k: JobsContext, art: JobKind): Promise<void> {
  await k.auftraege.deletePause(art);
  await wakeWorker(k, art);
}

/** Ein laufender hört bei seinem nächsten Lebenszeichen auf. */
export async function abortAb(k: JobsContext, id: string): Promise<JobRow | null> {
  const a = await k.auftraege.setAborted(id);
  if (a) await reportStatus(k, { s: a.dedupe_key ?? a.id });
  return a;
}

export async function repeat(k: JobsContext, id: string): Promise<boolean> {
  const ja = await k.auftraege.placeAgainOne(id);
  if (ja) await wakeWorker(k, 'wiederholt');
  return ja;
}

export async function pullBefore(k: JobsContext, art: JobKind, schluessel?: string): Promise<number> {
  const n = await k.auftraege.makeDue(art, schluessel);
  if (n > 0) await wakeWorker(k, art);
  return n;
}

/** Jeder Status mit Zahl, auch 0. */
export async function countKind(k: JobsContext, art: JobKind): Promise<Record<JobStatus, number>> {
  const aus = { offen: 0, laeuft: 0, erledigt: 0, fehler: 0, abgebrochen: 0 };
  for (const z of await k.auftraege.statusNumbers(art)) aus[z.status] = z.n;
  return aus;
}

/** Ein Auftrag mit Konto läuft wie eine Anfrage dieses Kontos, auch aus einem Systemrahmen
 * heraus: Der Zeilenschutz gilt für ihn wie für das Konto, und ein Import eines Unterkontos
 * zählt auf dessen Anteil am Fremdkontingent. */
export async function inNamesOfJob<T>(
  k: JobsContext,
  a: Pick<JobRow, 'type' | 'user_id'>,
  f: () => Promise<T>,
): Promise<T> {
  if (a.user_id == null) return imAuftragsrahmen(k, a, f);
  const u = await k.auftraege.accountRole(a.user_id);
  return asRequest({ apiUser: { user_id: a.user_id, is_admin: !!u?.is_admin } }, f);
}

/** Ein Auftrag ohne Konto: im Systemrahmen nur, wenn seine Art als kontoübergreifend
 * angemeldet ist (Anmeldung.kontouebergreifend), sonst ohne Konto und ohne Systemrahmen. */
export function imAuftragsrahmen<T>(k: JobsContext, a: Pick<JobRow, 'type'>, f: () => Promise<T>): Promise<T> {
  const grund = k.arten.von(a.type)?.kontouebergreifend;
  return grund ? inSystemContext(`auftrag ${a.type}: ${grund}`, f) : asRequest({}, f);
}

/** Weckt bei jedem Statuswechsel eines Auftrags, auch aus dem Job-Prozess; gibt das Abmelden zurück. */
export function atJobStatus(k: JobsContext, f: (schluessel?: string) => void): () => void {
  return JOB_STATUS.horche(k.db.notification, f);
}

/** Weckt, sobald irgendwo ein Auftrag eingestellt wird; gibt das Abmelden zurück. */
export function atNewJob(k: JobsContext, f: () => void): () => void {
  return NEW_JOB.horche(k.db.notification, f);
}

/** Ein Abbruch über die Verwaltung meldet sich per NOTIFY: Die betroffenen laufenden Aufträge sehen sofort
 * nach, ob sie ihre Zeile noch halten, statt erst beim nächsten Lebenszeichen. */
export function checkMembership(
  k: JobsContext,
  runs: Iterable<{ a: JobRow; ac: AbortController }>,
  schluessel?: string,
): void {
  for (const { a, ac } of runs) {
    if (ac.signal.aborted || (schluessel !== undefined && schluessel !== (a.dedupe_key ?? a.id))) continue;
    void k.auftraege.belongsStill(a).then(
      ja => {
        if (!ja && !ac.signal.aborted) ac.abort(new JobLost());
      },
      logAndContinue(`auftraege:stand ${a.type}`),
    );
  }
}
