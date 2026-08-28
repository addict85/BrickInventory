import * as db from '../../db/database';
import { resolveImageLocal } from '../images';
import { asIds } from '../household';
import { ensureFresh } from '../partsSummary';
import { fetchMissingBlIds } from '../../routes/parts';
import { getAllSetParts, getRbKey, httpsGetRobust } from '../../clients/rebrickable';

/**
 * Was alle drei Domänen brauchen: Seitengrössen, Zustandsableitung aus
 * Erfassungen, Besitzer-Anreicherung.
 *
 * ── Warum aufgeteilt (Nachtrag 133) ────────────────────────────────────────
 * utils/handlers.ts fasste Sets, Teile und Minifiguren in 1313 Zeilen zusammen
 * — benannt nach seiner Rolle („handlers"), nicht nach seinem Inhalt, wie
 * zuvor schon js/07-admin.js. Die drei Domänen berühren sich kaum: Nur
 * getSets() liest Teile, und die Minifiguren-Kennzahlen lesen Sets. Beides
 * geht in EINE Richtung, es entsteht also kein Kreis.
 */

/**
 * Obergrenze für page_size — je Anfrage, unabhängig vom Abfrageweg.
 *
 * ── Woher die Zahl steht ────────────────────────────────────────────────────
 * Der Wert stand fünfmal als Literal im Code, und eine sechste Stelle hatte ihn
 * gar nicht: tryPartsSummary() reichte page_size ungeprüft ins LIMIT durch,
 * während die Live-Abfrage direkt daneben bei 500 deckelte. DIESELBE Anfrage
 * lieferte damit unterschiedlich viele Zeilen, je nachdem ob die
 * Zusammenfassung gerade frisch war — nachgestellt an 5000 Teilen mit
 * page_size=100000: 500 Zeilen über die Live-Abfrage, 5000 über die
 * Zusammenfassung. Ein Unterschied, der vom Cache-Zustand abhängt, ist beim
 * Suchen eines Fehlers das Letzte, was man vermutet.
 *
 * Als Konstante, damit die nächste Seitenabfrage sie nicht wieder vergisst.
 */
export const MAX_PAGE_SIZE = 500;

/**
 * Obergrenze, wenn ein Aufrufer GAR KEIN page_size schickt.
 *
 * Ohne Grenze liefert die Teile- und die Set-Liste den kompletten Bestand in
 * einer Antwort — bei 800 Sets sind das rund 270 KB, bei einer grossen
 * Teilesammlung ein Vielfaches, und alles davon liegt gleichzeitig im Speicher
 * des Workers und im Speicher des Clients.
 *
 * Beide echten Clients blättern längst (Webapp: PARTS_PAGE_SIZE in
 * public/js/03-parts.js, Android: page_size=500 mit onLoadMore) — die Grenze
 * hier trifft sie nicht. Sie fängt den Fall ab, dass ein Aufrufer das
 * Blättern vergisst: Statt der ganzen Tabelle bekommt er die erste Seite, und
 * `total` in derselben Antwort sagt ihm, dass es mehr gibt.
 */
export const UNPAGED_LIMIT = 2000;

/**
 * Obergrenze für die Teileliste EINES Sets (Filter set_number).
 *
 * ── Warum die normale Grenze hier zu klein ist ──────────────────────────────
 * Die Android-Set-Detailansicht fragt `page_size=2000` und holt NUR Seite 1.
 * clampPageSize deckelte das auf MAX_PAGE_SIZE = 500 — am laufenden Server
 * nachgestellt mit einem Set aus 915 Teilezeilen:
 *
 *   geliefert 500 von total 915, page_size (gemeldet) 2000
 *
 * Die App zeigte also gut die Hälfte der Teile, und die gemeldete
 * Seitengrösse behauptete, es seien alle angefragt worden. Auch die
 * PDF-Teileliste baut auf dieser Antwort auf.
 *
 * Ein Set ist eine begrenzte Menge — die grössten liegen bei rund 12 000
 * Teilen, nach Farbe gruppiert deutlich darunter. 5000 Zeilen sind hier also
 * eine Grenze gegen Unfug, keine Portionierung. Für die allgemeine Teileliste
 * (ohne set_number) bleibt es bei MAX_PAGE_SIZE; dort blättern beide Clients.
 */
export const SET_PARTS_MAX_PAGE_SIZE = 5000;

/** page_size auf einen brauchbaren Wert bringen: mindestens 1, höchstens MAX. */
function clampPageSize(value: any, fallback: number): number {
  return Math.min(MAX_PAGE_SIZE, Math.max(1, parseInt(String(value)) || fallback));
}

/** Manuell erfasste Teile (eigene Ansicht neben den Set-Teilen).
 *  Von /api/parts/manual UND /api/v1/parts/manual genutzt (Parität). */
/**
 * DIE Zustandsregel — für Sets, manuelle Teile und manuelle Minifiguren.
 *
 * Sobald EINE Erfassung gebraucht ist, gilt der Eintrag als gebraucht. Gibt es
 * Erfassungen, aber keine gebrauchte, ist er neu. Ohne Erfassungen zählt der
 * gespeicherte Wert.
 *
 * Steht bewusst an genau einer Stelle: Sie war früher in getSets() und getSet()
 * doppelt ausformuliert und lief dadurch auseinander. Ein Test hält fest, dass
 * `usedCount > 0 ? 'U'` im Code nur einmal vorkommt.
 */
function conditionFromAcquisitions(acqCount, usedCount, stored) {
  return usedCount > 0 ? 'U' : (acqCount > 0 ? 'N' : (stored || 'N'));
}

/**
 * WELCHE Zustände hat der Eintrag — für die Plaketten auf der Kachel.
 *
 * conditionFromAcquisitions() oben beantwortet „gilt das Ganze als gebraucht?"
 * und muss dafür einen einzelnen Wert liefern. Auf der Kachel ist das zu wenig:
 * Wer ein Exemplar neu und eines gebraucht gekauft hat, sah bisher nur
 * „Gebraucht" — die Neu-Erfassung war unsichtbar, obwohl sie mit ihrem eigenen
 * Preis in die Bewertung eingeht.
 *
 * Beide Funktionen stehen bewusst nebeneinander an dieser einen Stelle: Sie
 * müssen zusammenpassen, und getrennt gepflegt liefen sie in diesem Projekt
 * schon einmal auseinander.
 *
 * Reihenfolge immer Neu vor Gebraucht — nicht nach Häufigkeit, sonst tauschen
 * die Plaketten beim nächsten Kauf die Plätze.
 */
function conditionsFromAcquisitions(acqCount, usedCount, stored): ('N' | 'U')[] {
  const acq  = parseInt(acqCount)  || 0;
  const used = parseInt(usedCount) || 0;
  if (acq <= 0) return [stored === 'U' ? 'U' : 'N'];
  const out: ('N' | 'U')[] = [];
  if (acq - used > 0) out.push('N');
  if (used > 0)       out.push('U');
  return out.length ? out : ['N'];
}

/**
 * Angezeigter Zustand manuell erfasster Teile und Minifiguren.
 *
 * Dieselbe Regel wie bei Sets (getSetConditionAggregate): Sobald EINE Erfassung
 * gebraucht ist, gilt der Eintrag als gebraucht. Gibt es Erfassungen, aber
 * keine gebrauchte, ist er neu. Ohne Erfassungen zählt der gespeicherte Wert.
 *
 * Vorher lasen beide Funktionen nur die Stammtabelle. Wurden Kaufpreise
 * ausschliesslich mit „Gebraucht" erfasst, stand auf der Kachel trotzdem „Neu",
 * weil parts.condition beim Anlegen auf dem Vorgabewert stehen blieb.
 *
 * Eine Abfrage für die ganze Seite statt eine je Zeile.
 *
 * @param {'part'|'fig'} kind
 */
async function applyManualCondition(userId, rows, kind) {
  // Blickfeld statt einer einzelnen ID: Ein Hauptkonto sieht (und ändert)
  // auch die Daten seiner Unterkonten, alle anderen nur ihre eigenen. Die
  // Liste kommt von scopeIds() in utils/household.ts — hier wird sie nur
  // normalisiert, damit ältere Aufrufer mit einer nackten ID weiter gehen.
  const uids = asIds(userId as any);
  if (!rows?.length) return rows;

  const isPart = kind === 'part';
  const keyOf = (r) => isPart
    ? `${r.part_number}|${r.color_id || 0}`
    : String(r.fig_number);

  const acq = await db.all(
    isPart
      ? `SELECT part_number, color_id,
                COUNT(*) AS acq_count,
                COUNT(*) FILTER (WHERE condition = 'U') AS used_count,
                SUM(unit_price * quantity) FILTER (WHERE unit_price IS NOT NULL)::numeric
                  / NULLIF(SUM(quantity) FILTER (WHERE unit_price IS NOT NULL), 0) AS avg_purchase_price
           FROM part_acquisitions WHERE user_id = ANY($1)
          GROUP BY part_number, color_id`
      : `SELECT fig_number,
                COUNT(*) AS acq_count,
                COUNT(*) FILTER (WHERE condition = 'U') AS used_count,
                SUM(unit_price * quantity) FILTER (WHERE unit_price IS NOT NULL)::numeric
                  / NULLIF(SUM(quantity) FILTER (WHERE unit_price IS NOT NULL), 0) AS avg_purchase_price
           FROM minifig_acquisitions WHERE user_id = ANY($1)
          GROUP BY fig_number`,
    [uids]
  ).catch(() => []);

  const byKey = new Map<string, any>(acq.map((a: any) => [
    isPart ? `${a.part_number}|${a.color_id || 0}` : String(a.fig_number),
    a,
  ]));

  return rows.map(r => {
    const a = byKey.get(keyOf(r));
    const acqCount = parseInt(a?.acq_count) || 0;
    const usedCount = parseInt(a?.used_count) || 0;
    return {
      ...r,
      condition: conditionFromAcquisitions(acqCount, usedCount, r.condition),
      conditions: conditionsFromAcquisitions(acqCount, usedCount, r.condition),
      acq_count: acqCount,
      used_count: usedCount,
      // Mengengewichtet über die Erfassungen — die Kachel zeigte bisher den
      // Wert der Stammzeile, also den zuletzt geschriebenen Einzelpreis.
      avg_purchase_price: a?.avg_purchase_price != null ? parseFloat(a.avg_purchase_price) : null,
    };
  });
}

/** Kopf-/Übersichts-Statistik — von /api/settings/stats UND /api/v1/stats
 *  genutzt (Parität). Superset der historischen Felder beider Routen;
 *  total_parts ist ein Alias von total_pieces (v1-Altbestand). */
/**
 * Besitzer-Namen an Zeilen hängen, die eine `user_id` tragen.
 *
 * Nur im Haushalt: Im Einzelkonto stünde an jedem Eintrag „gehört mir", und
 * das ist Rauschen. Eine Abfrage für die ganze Liste, nicht eine je Zeile.
 *
 * Anders als bei Sets wird bei manuell erfassten Teilen und Minifiguren NICHT
 * verdichtet: Zwei Konten mit demselben Teil sind zwei Bestände mit eigener
 * Menge und eigenem Kaufpreis, und der Bearbeiten-Weg (Menge, Preis, Löschen)
 * führt immer auf genau eine Zeile. Sie zusammenzufalten hiesse, für jede
 * Änderung wieder auseinanderzunehmen, wem was gehört. Die Plakette macht
 * sichtbar, warum dasselbe Teil zweimal erscheint.
 */
async function withOwners(uids: number[], rows: any[]) {
  if (uids.length < 2 || !rows?.length) return rows;
  const owners = await db.all('SELECT id, username FROM users WHERE id = ANY($1)', [uids])
    .catch(() => []);
  const nameById = new Map(owners.map((u: any) => [parseInt(u.id), u.username]));
  return rows.map(r => r.user_id == null ? r : {
    ...r,
    owners: [{ id: parseInt(r.user_id), username: nameById.get(parseInt(r.user_id)) || String(r.user_id) }],
  });
}

export { clampPageSize, conditionFromAcquisitions, conditionsFromAcquisitions, applyManualCondition, withOwners };
