/**
 * Löschen heisst: erst in den Papierkorb, dann weg (src/bestand/papierkorb.ts).
 * Eine Stelle für das Einzel-Löschen von Teil und Figur und für „alles
 * löschen", damit alle drei Wege dieselben Zeilen mitnehmen.
 */
import * as db from '../../db/database';
import { legeInPapierkorb } from './papierkorb';
import { loescheManuellesTeil, loescheManuelleFigur } from './gemeinsam';
import { deleteSet } from '../sets/abfragen';
import * as repo from './repository/loeschen';

/** Ein manuelles Teil samt Erfassungen. @returns die Papierkorb-id, oder null, wenn es keins gab */
export async function loescheTeil(besitzer: number, pn: string, cid: number): Promise<number | null> {
  return db.transaction(async (tx) => {
    const id = await legeInPapierkorb(tx, 'teil', besitzer, pn, cid);
    const r = await loescheManuellesTeil(tx, besitzer, pn, cid);
    if (r.changes === 0) return null;
    // Erfassungen mit: Die Finanzsummen lesen sie und zählten das Teil sonst weiter.
    await repo.loescheTeilErfassungen(tx, besitzer, pn, cid || 0);
    return id;
  });
}

/** Eine manuelle Minifigur samt Erfassungen. @returns die Papierkorb-id, oder null */
export async function loescheFigur(besitzer: number, fn: string): Promise<number | null> {
  return db.transaction(async (tx) => {
    const id = await legeInPapierkorb(tx, 'figur', besitzer, fn);
    const r = await loescheManuelleFigur(tx, besitzer, fn);
    if (r.changes === 0) return null;
    await repo.loescheFigurErfassungen(tx, besitzer, fn);
    return id;
  });
}

/**
 * Den ganzen eigenen Bestand in den Papierkorb: Sets (mit ihren Teilen und
 * Figuren), manuelle Teile, manuelle Figuren. Nur das EIGENE Konto — nie das
 * Blickfeld des Haushalts. Jedes Element einzeln, damit jedes einzeln
 * wiederherstellbar ist.
 */
export async function loescheAllesEigene(uid: number) {
  const sets = await repo.setsDesKontos(uid);
  const teile = await repo.manuelleTeileDesKontos(uid);
  const figuren = await repo.manuelleFigurenDesKontos(uid);
  const papierkorb: number[] = [];
  const n = { sets: 0, teile: 0, figuren: 0 };
  for (const s of sets) {
    const ids = await deleteSet([uid], s.set_number);
    if (ids) { papierkorb.push(...ids); n.sets++; }
  }
  for (const t of teile) {
    const id = await loescheTeil(uid, t.part_number, t.color_id);
    if (id !== null) { papierkorb.push(id); n.teile++; }
  }
  for (const f of figuren) {
    const id = await loescheFigur(uid, f.fig_number);
    if (id !== null) { papierkorb.push(id); n.figuren++; }
  }
  return { ...n, papierkorb };
}
