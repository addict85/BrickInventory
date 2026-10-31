/**
 * Die Kurstabelle (Migration 0077) füllen: beim ersten Mal die ganze Reihe
 * der EZB, danach je Tag die neuen Kurse. Der Abruf läuft als Auftrag
 * (src/auftraege/auftraege.ts), damit ein Fehlschlag wiederholt wird und sichtbar bleibt.
 */
import * as db from '../../db/database';
import { stelleAuftragEin } from '../auftraege/dienst';
import { EZB_HISTORIE, EZB_TAGESKURSE, ezbAbruf, ersteZipDatei, historieLesen, tageskurseLesen,
         type Abruf, type Kurs } from '../../clients/ezb';

const BLOCK = 5000;

/** Kurse schreiben; ein vorhandener Tag wird überschrieben (die EZB korrigiert selten). */
export async function speichereKurse(kurse: Kurs[]): Promise<number> {
  let n = 0;
  for (let i = 0; i < kurse.length; i += BLOCK) {
    const teil = kurse.slice(i, i + BLOCK);
    const r = await db.run(
      `INSERT INTO wechselkurse (tag, waehrung, je_eur)
       SELECT * FROM unnest($1::date[], $2::char(3)[], $3::numeric[])
       ON CONFLICT (waehrung, tag) DO UPDATE SET je_eur = EXCLUDED.je_eur`,
      [teil.map(k => k.tag), teil.map(k => k.waehrung), teil.map(k => String(k.je_eur))]);
    n += r?.changes ?? 0;
  }
  return n;
}

/** Ist die Tabelle leer, die ganze Reihe; sonst nur die Tageskurse. */
export async function kurseNachladen(abruf: Abruf = ezbAbruf): Promise<{ quelle: 'historie' | 'tag'; kurse: number }> {
  const leer = !(await db.get('SELECT 1 AS da FROM wechselkurse LIMIT 1'));
  const kurse = leer
    ? historieLesen(ersteZipDatei(await abruf(EZB_HISTORIE)).toString('utf8'))
    : tageskurseLesen((await abruf(EZB_TAGESKURSE)).toString('utf8'));
  if (!kurse.length) throw new Error(`EZB lieferte keine Kurse (${leer ? 'Historie' : 'Tageskurse'})`);
  return { quelle: leer ? 'historie' : 'tag', kurse: await speichereKurse(kurse) };
}

/**
 * Den Abruf für einen Tag einstellen. Die EZB veröffentlicht gegen 16 Uhr MEZ;
 * 15:30 UTC liegt danach. Je Tag ein eigener Schlüssel: Ein gescheiterter
 * Versuch steht wieder als 'offen' da und darf den nächsten Tag nicht sperren.
 */
export async function planeKursabruf(jetzt = new Date(), morgen = false): Promise<string | null> {
  const ziel = new Date(Date.UTC(jetzt.getUTCFullYear(), jetzt.getUTCMonth(), jetzt.getUTCDate() + (morgen ? 1 : 0), 15, 30));
  const sek = Math.max(0, Math.round((ziel.getTime() - jetzt.getTime()) / 1000));
  return stelleAuftragEin('wechselkurse', {}, {
    schluessel: `wechselkurse:${ziel.toISOString().slice(0, 10)}`, nachSekunden: morgen ? sek : 0, maxVersuche: 6 });
}

/** Der Bearbeiter des Auftrags: erst den nächsten Tag einplanen, dann laden. */
export async function kursauftrag(abruf: Abruf = ezbAbruf): Promise<void> {
  await planeKursabruf(new Date(), true);
  const r = await kurseNachladen(abruf);
  console.log(`[wechselkurse] ${r.kurse} Kurse aus der EZB-${r.quelle === 'historie' ? 'Historie' : 'Tagesdatei'}`);
}
