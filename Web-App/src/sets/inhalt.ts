/** Stammdaten, Teile- und Figurenliste eines Sets. */
import { stelleAuftragEin } from '../auftraege';
import { proxyImageUrl, importPartsForSet, setNummerImBlickfeld, neuestesInventar, figurenAusKatalog, getMinifigInfo, getSetMinifigs, getAllSetParts, type RbSetTeil, ersteBlNummer, merkeFigur, merkeSetFiguren } from '../katalog';
import { zaehleAnfrage } from '../konto';
import { findSetInScope } from './erfassen';
import { istErsatzteil } from '../infra/validate';
import { mitVersion, ohneVersion } from '../infra/setNummer';
import { fachfehler } from '../infra/fehlerTexte';
import * as repo from './repository/setDetail';
import type { KatalogTeil, ListenTeil, SetStamm } from './zeilen';
import { versuche, wertOder } from '../infra/ergebnis';
import type { SetsKontext } from './kontext';

/** Ohne Eintrag null. */
export async function setInfo(sk: SetsKontext, setNumber: string): Promise<SetStamm | null> {
  return (await repo.setStamm(sk.db, mitVersion(setNumber))) ?? null;
}

/** Was das fragende Konto über eine Nummer erfahren darf: Ein fremder Platzhalter
 * antwortet wie eine nie erfasste Nummer, sonst verriete er die Erfassung eines anderen. */
export async function setInfoFuerKonto(sk: SetsKontext, uid: number, setNumber: string) {
  const n = mitVersion(setNumber);
  const stamm = await setInfo(sk, n);
  const fremderPlatzhalter = !!stamm?.platzhalter && !(await setNummerImBlickfeld(uid, n));
  if (!stamm || fremderPlatzhalter) return { set_number: n, name: n, im_katalog: false as const };
  const { platzhalter: _platzhalter, ...row } = stamm;
  return { set_number: n, ...row, name: row.name || n, im_katalog: true as const };
}

function katalogDesSets(sk: SetsKontext, setNumber: string): Promise<KatalogTeil[]> {
  return repo.katalogTeileDesSets(sk.db, mitVersion(setNumber));
}

/** Ungeblättert; die Seitenangaben stehen da, weil die App sie mit der Teileliste des Bestands teilt. */
const eineSeite = (n: number) => ({ total: n, page: 1, page_size: n });

export const QUELLE_GESTOERT = 'quelle_gestoert';

export async function teilelisteDesSets(sk: SetsKontext, setNum: string, anreichern: (sn: string) => Promise<unknown>) {
  const n = mitVersion(setNum), bare = ohneVersion(n);
  const invId = await neuestesInventar(setNum);
  let teile: ListenTeil[] = [];
  let source = 'db';
  if (invId) {
    teile = await repo.inventarTeileDesSets(sk.db, invId);
  }
  if (!teile.length) {
    source = 'api';
    // Ist Rebrickable gestört, sagt die Antwort das; eine leere Liste hiesse „das Set hat keine Teile“.
    const mit = await versuche('sets:getAllSetParts', getAllSetParts(n));
    const rb = mit.ok && mit.wert ? mit : await versuche('sets:getAllSetParts', getAllSetParts(bare));
    if (!rb.ok) return { parts: [], source: QUELLE_GESTOERT, error: rb.fehler.grund, ...eineSeite(0) };
    teile = (rb.wert || []).map((r: RbSetTeil) => ({
      part_number: r.part.part_num, bl_part_number: ersteBlNummer(r.part.external_ids) || r.part.part_num,
      part_name: r.part.name || r.part.part_num, color_id: r.color.id, color_name: r.color.name || '',
      color_hex: r.color.rgb || null, rb_image_url: r.part.part_img_url || null,
      total_quantity: r.quantity, is_spare: !!r.is_spare }));
  }
  if (!teile.length) return { parts: [], source: 'not_found', ...eineSeite(0) };

  const katalog = new Map<string, KatalogTeil>();
  const merke = (zeilen: KatalogTeil[]) => { for (const r of zeilen) katalog.set(`${r.part_number}|${r.color_id}`, r); };
  merke(await katalogDesSets(sk, setNum));
  if (teile.some(p => !katalog.has(`${p.part_number}|${p.color_id}`))) {
    await versuche('sets:enrichSetParts', anreichern(setNum));
    merke(await katalogDesSets(sk, setNum));
  }

  // Schlüssel ist die Rebrickable-Nummer samt Farbe: Formvarianten teilen sich oft eine BrickLink-Nummer und
  // dürfen nicht verschmelzen.
  const zeilen = new Map<string, {
    part_number: string; bl_part_number: string; part_name: string; color_id: number; bl_color_id: number | null;
    color_name: string; color_hex: string | null; image_url: string | null; total_quantity: number; is_spare: boolean;
  }>();
  for (const p of teile) {
    const key = `${p.part_number}|${p.color_id}`;
    const cat = katalog.get(key);
    const menge = parseInt(String(p.total_quantity)) || 0;
    const bild = cat?.image_local || (cat?.image_url ? proxyImageUrl(cat.image_url) : null) || p.rb_image_url || null;
    const da = zeilen.get(key);
    if (da) { da.total_quantity += menge; continue; }
    zeilen.set(key, {
      part_number: p.part_number, bl_part_number: cat?.bl_part_number || p.bl_part_number || p.part_number,
      part_name: cat?.part_name || p.part_name || p.part_number, color_id: p.color_id,
      bl_color_id: p.bl_color_id ?? null, color_name: cat?.color_name || p.color_name || '',
      color_hex: cat?.color_hex || p.color_hex || null, image_url: bild, total_quantity: menge,
      is_spare: istErsatzteil(p.is_spare) });
  }
  await versuche(`sets:bilder einstellen ${setNum}`,
    stelleAuftragEin('bilder', { set_number: setNum }, { schluessel: `bilder:${n}`, maxVersuche: 3 }));
  return { parts: [...zeilen.values()], source, ...eineSeite(zeilen.size) };
}

/** Was nicht aus dem Katalog kam, schreibt ein Nachlauf hinein. */
export async function figurenlisteDesSets(sk: SetsKontext, setNum: string) {
  const n = mitVersion(setNum), bare = ohneVersion(n);
  const ausgabe = (f: { fig_number: string; fig_name?: string | null; quantity?: number | null; image_url?: string | null }) => ({
    fig_number: f.fig_number, fig_name: f.fig_name || f.fig_number, quantity: f.quantity || 1,
    total_quantity: f.quantity || 1, image_url: proxyImageUrl(f.image_url),
    // Dieselbe Form wie eine Figur des Bestands, ohne Zustände und Besitzer.
    source: 'set', conditions: [] as string[], owners: [] as { id: number; username: string }[] });

  const katalog = await figurenAusKatalog(setNum);
  if (katalog.length) return { figs: katalog.map(ausgabe), source: 'catalog' };

  type Fig = { fig_number: string; fig_name: string | null; quantity: number; image_url: string | null };
  let figs: Fig[] = [];
  const invId = await neuestesInventar(setNum);
  if (invId) {
    figs = await repo.inventarFigurenDesSets(sk.db, invId);
  }
  if (!figs.length) {
    const mit = await versuche('sets:getSetMinifigs', getSetMinifigs(n));
    const rb = mit.ok && mit.wert ? mit : await versuche('sets:getSetMinifigs', getSetMinifigs(bare));
    if (!rb.ok) return { figs: [], source: QUELLE_GESTOERT, error: rb.fehler.grund };
    figs = rb.wert || [];
  }
  if (!figs.length) return { figs: [], source: 'not_found' };
  setImmediate(() => { void versuche('sets:figurenkatalog schreiben', figurenMerken(n, figs)); });
  return { figs: figs.map(ausgabe), source: 'csv_cache' };
}

async function figurenMerken(n: string, figs: Array<{ fig_number: string; fig_name: string | null; quantity: number; image_url: string | null }>) {
  for (const f of figs) {
    let bild = f.image_url || null;
    if (!bild) bild = wertOder(await versuche('sets:minifigur-info', getMinifigInfo(f.fig_number)), null)?.image_url || null;
    await merkeFigur(f.fig_number, f.fig_name, bild);
    await merkeSetFiguren(n, [{ figNumber: f.fig_number, quantity: f.quantity }]);
  }
}

/** Nur zu Sets im Blickfeld und gedrosselt: Jeder Import kann Rebrickable-Kontingent kosten. */
export async function teileDesSetsImportieren(sk: SetsKontext, uid: number, sn: string): Promise<number> {
  const set = await findSetInScope(sk, uid, sn);
  if (!set) fachfehler('nicht_gefunden', 'set_nicht_gefunden');
  const takt = await zaehleAnfrage('teile-import', `konto:${uid}`, 60 * 60 * 1000);
  if (takt.count > 30) fachfehler('zu_viele', 'zu_viele_anfragen', { minuten: takt.waitMin });
  return importPartsForSet(set.set_number, set.owner_user_id);
}

/** Die Route kennt den Auftragsweg der Teile nicht; ohne Inventar reichert der Job-Prozess an. */
export function teilelisteMitNacharbeit(sk: SetsKontext, setNum: string) {
  return teilelisteDesSets(sk, setNum, sn => sk.nacharbeit.setTeileAnreichern(sn));
}
