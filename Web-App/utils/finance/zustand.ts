/**
 * Der Zustand eines Sets — die eine Regel, nach der Preis UND Gewinnrechnung
 * entscheiden, ob „neu" oder „gebraucht" gilt.
 *
 * Eigene Datei, weil sie von beiden Seiten des Finanzteils gebraucht wird:
 * von der Bewertung (welcher Marktpreis gilt) und von der Gewinnrechnung
 * (welcher Kaufpreis zaehlt). Stuende sie in einer der beiden, muesste die
 * andere sie von dort holen — und die Richtung waere willkuerlich.
 */

/**
 * Zustand eines Sets nach derselben Regel wie die Anzeige
 * (utils/handlers.ts → getSetConditionAggregate):
 * Sobald EINE Erfassung gebraucht ist, gilt das Set als gebraucht; sonst neu.
 *
 * Vorher richtete sich die Bewertung allein nach sets.condition. Weicht der
 * gespeicherte Wert von den Erfassungen ab — etwa weil ein Set nachträglich auf
 * „Neu" korrigiert wurde — zeigte die Kachel „Neu", der Marktpreis stammte aber
 * aus dem Gebraucht-Eintrag. Genau diese Abweichung war die Ursache für den
 * wiederholt zu niedrigen Preis.
 *
 * ── Was Migration 0032 daran geändert hat, und was nicht ───────────────────
 *
 * Für SETS gibt es die Abweichung nicht mehr: Die Spalte ist weg, die
 * Set-Abfragen liefern hier gar keinen gespeicherten Wert mehr, und der dritte
 * Zweig unten kann für sie nicht greifen.
 *
 * Für manuell erfasste TEILE und MINIFIGUREN greift er weiter, und er muss es:
 * `parts.condition` und `minifigs.condition` gibt es noch, und bei einem Stück
 * ohne Kaufpreis-Erfassung ist dieser Wert die einzige Auskunft. GEMESSEN, als
 * der Zweig kurzzeitig fehlte: „Teil 3002 (gespeichert U, ohne Erfassung):
 * /parts/manual sagt U, die Bewertung sagt N" — also genau das
 * Auseinanderlaufen zwischen Liste und Bewertung, gegen das diese Funktion
 * geschrieben wurde (manuell-zustand-eine-regel-db.test.js).
 *
 * Der Zweig fällt mit den beiden Spalten, nicht vorher.
 */
function effectiveCondition(set: any): 'N' | 'U' {
  const acqCount  = parseInt(set?.acq_count)  || 0;
  const usedCount = parseInt(set?.used_count) || 0;
  if (acqCount > 0) return usedCount > 0 ? 'U' : 'N';
  return set?.condition === 'U' ? 'U' : 'N';
}

export { effectiveCondition };
