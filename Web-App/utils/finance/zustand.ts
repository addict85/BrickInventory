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
 * Sobald EINE Erfassung gebraucht ist, gilt das Set als gebraucht; gibt es
 * Erfassungen ohne Gebraucht-Eintrag, ist es neu; ohne Erfassungen zählt der
 * gespeicherte Wert in sets.condition.
 *
 * Vorher richtete sich die Bewertung allein nach sets.condition. Weicht der
 * gespeicherte Wert von den Erfassungen ab — etwa weil ein Set nachträglich auf
 * „Neu" korrigiert wurde — zeigte die Kachel „Neu", der Marktpreis stammte aber
 * aus dem Gebraucht-Eintrag. Genau diese Abweichung war die Ursache für den
 * wiederholt zu niedrigen Preis.
 */
function effectiveCondition(set: any): 'N' | 'U' {
  const acqCount  = parseInt(set?.acq_count) || 0;
  const usedCount = parseInt(set?.used_count) || 0;
  if (usedCount > 0) return 'U';
  if (acqCount > 0)  return 'N';
  return set?.condition === 'U' ? 'U' : 'N';
}

export { effectiveCondition };
