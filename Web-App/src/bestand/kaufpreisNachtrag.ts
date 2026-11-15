import { setzeGeschaetztenPreis } from './acquisitions';
import { versuche } from '../infra/ergebnis';
import { setTimeout as warte } from 'node:timers/promises';
import type { BestandKontext } from './kontext';

function log(msg: string) {
  console.log(`  [purchase-price-backfill] ${msg}`);
}

/** Erfassungen ohne Kaufpreis (BrickLink am Tageslimit) bekommen den Marktpreis. Jede Zeile wird
 * versucht; gescheiterte lassen den Schritt am Ende scheitern, damit run() ihn meldet. */
async function jeZeile<Z>(art: string, rows: Z[], f: (z: Z) => Promise<boolean>): Promise<void> {
  if (!rows.length) return;
  log(`${art} ohne Kaufpreis: ${rows.length}`);
  let done = 0;
  const fehler: unknown[] = [];
  for (const row of rows) {
    try {
      if (await f(row)) done++;
    } catch (e) {
      fehler.push(e);
    }
    await warte(1500); // Tageskontingent von BrickLink schonen
  }
  log(`${art} nachgetragen: ${done} von ${rows.length}`);
  if (fehler.length) throw new AggregateError(fehler, `${art}: ${fehler.length} von ${rows.length} gescheitert`);
}

async function backfillAcquisitions(k: BestandKontext) {
  await jeZeile('Erfassungen', await k.nachtrag.setErfassungenOhnePreis(), async row => {
    const price = await k.finanzen.aktuellerMarktpreis(row.set_number, row.user_id, row.condition || null);
    return !!price && (await setzeGeschaetztenPreis(k, 'set', row.id, price));
  });
}

// Dieselbe Lücke wie bei den Sets, für Teile- und Figuren-Erfassungen.
async function backfillTeileErfassungen(k: BestandKontext) {
  await jeZeile('Teile-Erfassungen', await k.nachtrag.teilErfassungenOhnePreis(), async row => {
    const price = await k.finanzen.aktuellerTeilMarktpreis(
      row.part_number,
      row.color_id,
      row.user_id,
      row.condition || null,
    );
    return !!price && (await setzeGeschaetztenPreis(k, 'part', row.id, price));
  });
}

async function backfillFigurenErfassungen(k: BestandKontext) {
  await jeZeile('Figuren-Erfassungen', await k.nachtrag.figurErfassungenOhnePreis(), async row => {
    // Die eigene BrickLink-Nummer des Kontos vor der gemeinsamen.
    const price = await k.finanzen.aktuellerFigurMarktpreis(
      row.fig_number,
      row.user_id,
      await k.katalog.blAbrufNummer('fig', row.fig_number, row.user_id),
      row.condition || null,
    );
    return !!price && (await setzeGeschaetztenPreis(k, 'fig', row.id, price));
  });
}

/** Jeder Schritt läuft; danach wirft der Lauf, damit der Auftrag ihn wiederholt und zeigt. */
async function run(k: BestandKontext) {
  log('Starte Migration bestehender Elemente ohne Kaufpreis…');
  const schritte: [string, () => Promise<unknown>][] = [
    ['set-erfassungen', () => backfillAcquisitions(k)],
    ['figuren-erfassungen', () => backfillFigurenErfassungen(k)],
    ['teile-erfassungen', () => backfillTeileErfassungen(k)],
    ['teilfarbenbilder', () => k.katalog.teilfarbenbilderNachtragen()],
  ];
  const ohne: string[] = [];
  for (const [name, schritt] of schritte)
    if (!(await versuche(`kaufpreis-nachtrag:${name}`, schritt)).ok) ohne.push(name);
  if (ohne.length) throw new Error(`Kaufpreis-Nachtrag gescheitert: ${ohne.join(', ')}`);
  log('Migration abgeschlossen.');
}

export { run };
