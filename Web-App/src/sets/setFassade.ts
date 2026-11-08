/** Was die Set-Routen aus anderen Bereichen brauchen, damit die Route nur prüft, ruft und antwortet.
 * Absagen sind Fachfehler: Der Fehlerweg des Routers antwortet wie sendeFehler(). */
import path from 'path';
import { normalizeSetNumber, findSetInScope } from './setAdd';
import { normalisiereLagerort, setzeLagerort, orteFuer, vorgabeVon } from '../bestand/lagerort';
import { alarmeFuer, loescheAlarm, setzeAlarm } from '../finanzen/preisalarm';
import { getSetting } from '../einstellungen/settings';
import { importAlsAuftrag } from '../auftraege/importAlsAuftrag';
import { anleitungEinreihen } from '../auftraege/anleitungsAuftrag';
import { csvImportBus, buildJobStatus, jobGet, beiImportStand } from '../auftraege/importAuftrag';
import {
  anleitungenZuSet,
  anleitungenZusammenlegen,
  loescheAnleitungen,
  anleitungNeuLadenErlaubt,
  anzahlAnleitungen,
} from '../katalog/instructions';
import { importPartsForSet } from '../katalog/partsImport';
import { zaehleAnfrage } from '../konto/loginLimiter';
import { DATA_DIR } from '../infra/appPaths';
import { meldeUndLiefere } from '../infra/fehler';
import { fehlerWerfen } from '../infra/fehlerTexte';
import type { Sprache } from '../infra/fehlerTexte';
import { normalisiereSetNummer, moeglicheSetNummer } from '../infra/setNummer';
import type { CsvImportBericht } from '../infra/csvExport';

/** Die Währung aus den Einstellungen, nicht aus der Anfrage: Zwei Quellen
 * liefen beim nächsten Wechsel auseinander. */
export async function waehrungVon(uid: number): Promise<string> {
  return String(await getSetting(uid, 'currency', 'EUR'));
}

/** Trifft alle Zeilen des Sets im Schreibbereich: Wer die Kiste packt, packt
 * sie für alle, die darin nachsehen. */
export async function lagerortDesSetsSetzen(uid: number, sn: string, storage: unknown) {
  const ort = normalisiereLagerort(storage);
  const n = await setzeLagerort('set', { schreiber: uid }, [normalizeSetNumber(sn)], ort);
  return { ort, n };
}

/** Die Liste kann über mehrere Konten spannen, die Vorgabe ist immer die des
 * Anfragenden: Ein geerbter Stern wäre eine Aussage über eine fremde Wohnung. */
export async function lagerorteMitVorgabe(uid: number, owner: string | undefined) {
  const [orte, vorgabe] = await Promise.all([orteFuer(uid, owner), vorgabeVon(uid)]);
  return { orte, vorgabe };
}

// ── Preisalarm: gehört genau EINEM Konto, deshalb uid statt Blickfeld ────────

export function alarmeDesSets(uid: number, sn: string) {
  return alarmeFuer(uid, normalizeSetNumber(sn));
}

export async function alarmDesSetsSetzen(uid: number, sn: string, eingabe: Parameters<typeof setzeAlarm>[3]) {
  return setzeAlarm(uid, normalizeSetNumber(sn), await waehrungVon(uid), eingabe);
}

export function alarmDesSetsLoeschen(uid: number, sn: string, condition: unknown) {
  return loescheAlarm(uid, normalizeSetNumber(sn), String(condition || 'N'));
}

export async function alarmeAusCsv(uid: number, text: string) {
  return importAlsAuftrag<CsvImportBericht>(uid, 'alarme_csv', { waehrung: await waehrungVon(uid), text });
}

/** Nur zu Sets im Blickfeld und gedrosselt: Jeder Import kann Rebrickable-Kontingent kosten. */
export async function teileDesSetsImportieren(uid: number, sn: string): Promise<number> {
  const set = await findSetInScope(uid, sn);
  if (!set) fehlerWerfen('set_nicht_gefunden', 404);
  const takt = await zaehleAnfrage('teile-import', `konto:${uid}`, 60 * 60 * 1000);
  if (takt.count > 30) fehlerWerfen('zu_viele_anfragen', 429, { minuten: takt.waitMin });
  return importPartsForSet(set.set_number, set.owner_user_id);
}

/** Die Anleitungen sind geteilt: Ersetzen darf nur der Verwalter (ein leerer
 * Abruf löschte sie sonst für alle). Andere holen, was fehlt, einmal je Set und Tag. */
export async function anleitungenNeuLaden(uid: number, roh: string, verwalter: boolean) {
  const sn = normalisiereSetNummer(roh);
  if (!moeglicheSetNummer(sn)) fehlerWerfen('setnummer_ungueltig', 400);
  if (verwalter) await loescheAnleitungen(sn);
  else {
    if (!(await findSetInScope(uid, sn))) fehlerWerfen('set_nicht_gefunden', 404);
    if ((await anzahlAnleitungen(sn)) > 0) fehlerWerfen('nur_admins', 403);
    if (!(await anleitungNeuLadenErlaubt(sn))) fehlerWerfen('zu_viele_anfragen', 429, { minuten: 24 * 60 });
  }
  const auftrag = await anleitungEinreihen(sn, { jetzt: true });
  const instructions = anleitungenZusammenlegen(await anleitungenZuSet(sn), []);
  return { instructions, auftrag };
}

/** Hochgeladene Anleitungen liegen je Konto in einem eigenen Ordner darunter. */
export const ANLEITUNGS_WURZEL = path.join(DATA_DIR, 'uploads');

type Kopf = { headers?: Record<string, unknown> };

export async function importStand(uid: number, req: Kopf) {
  return buildJobStatus(await jobGet(uid), req);
}

/** Im offenen Strom gibt es keinen Statuscode mehr: Ein Lesefehler wird zu „kein Import“. */
export async function importStandFuerStrom(uid: number, req: Kopf, sprache: Sprache) {
  return buildJobStatus(await jobGet(uid).catch(meldeUndLiefere('sets:jobGet', null)), req, sprache);
}

/** Jeder neue Stand, aus diesem Prozess (Bus) wie aus anderen (LISTEN/NOTIFY). @returns Abmelden */
export function beobachteImport(uid: number, melde: () => void): () => void {
  const lokal = () => melde();
  const fremd = (payload: unknown) => {
    if (String(payload) === String(uid)) melde();
  };
  csvImportBus.on(`progress:${uid}`, lokal);
  const abmelden = beiImportStand(fremd);
  return () => {
    csvImportBus.off(`progress:${uid}`, lokal);
    abmelden();
  };
}
