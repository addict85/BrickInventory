/** Als Auftrag, damit ein Fehlschlag wiederholt wird und sichtbar bleibt. */
import { stelleAuftragEin, type AuftragsLauf } from '../auftraege';
import { EZB_HISTORIE, EZB_TAGESKURSE, ezbAbruf, ersteZipDatei, historieLesen, tageskurseLesen, type Abruf, type Kurs } from '../katalog';
import * as repo from './repository/wechselkurse';

const BLOCK = 5000;

/** Ein vorhandener Tag wird überschrieben: Die EZB korrigiert selten, aber sie tut es. */
export async function speichereKurse(kurse: Kurs[]): Promise<number> {
  let n = 0;
  for (let i = 0; i < kurse.length; i += BLOCK) {
    const teil = kurse.slice(i, i + BLOCK);
    const r = await repo.schreibeKurse(teil.map(k => k.tag), teil.map(k => k.waehrung), teil.map(k => String(k.je_eur)));
    n += r?.changes ?? 0;
  }
  return n;
}

export async function kurseNachladen(abruf: Abruf = ezbAbruf, signal?: AbortSignal): Promise<{ quelle: 'historie' | 'tag'; kurse: number }> {
  const leer = !(await repo.gibtEsKurse());
  const kurse = leer
    ? historieLesen(ersteZipDatei(await abruf(EZB_HISTORIE, signal)).toString('utf8'))
    : tageskurseLesen((await abruf(EZB_TAGESKURSE, signal)).toString('utf8'));
  if (!kurse.length) throw new Error(`EZB lieferte keine Kurse (${leer ? 'Historie' : 'Tageskurse'})`);
  return { quelle: leer ? 'historie' : 'tag', kurse: await speichereKurse(kurse) };
}

/** 15:30 UTC liegt nach der Veröffentlichung der EZB. Je Tag ein eigener
 * Schlüssel: Ein gescheiterter Versuch darf den nächsten Tag nicht sperren. */
export async function planeKursabruf(jetzt = new Date(), morgen = false): Promise<string | null> {
  const ziel = new Date(Date.UTC(jetzt.getUTCFullYear(), jetzt.getUTCMonth(), jetzt.getUTCDate() + (morgen ? 1 : 0), 15, 30));
  const sek = Math.max(0, Math.round((ziel.getTime() - jetzt.getTime()) / 1000));
  return stelleAuftragEin('wechselkurse', {}, {
    schluessel: `wechselkurse:${ziel.toISOString().slice(0, 10)}`, nachSekunden: morgen ? sek : 0, maxVersuche: 6 });
}

/** Erst den nächsten Tag einplanen, dann laden: Scheitert das Laden, steht der Plan schon. */
export async function kursauftrag(abruf: Abruf = ezbAbruf, lauf?: AuftragsLauf): Promise<void> {
  await planeKursabruf(new Date(), true);
  const r = await kurseNachladen(abruf, lauf?.signal);
  console.log(`[wechselkurse] ${r.kurse} Kurse aus der EZB-${r.quelle === 'historie' ? 'Historie' : 'Tagesdatei'}`);
}
