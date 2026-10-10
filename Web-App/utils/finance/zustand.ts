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
 * Mit Migration 0032 ist die Abweichung keine Möglichkeit mehr: Es gibt nur
 * noch die Erfassungen. Der dritte Zweig, der auf `set.condition` zurückfiel,
 * ist damit entfallen — `acqCount` bleibt als Parameter erhalten, weil die
 * Aufrufer ihn mitliefern und er die Lage beschreibt.
 */
function effectiveCondition(set: any): 'N' | 'U' {
  const usedCount = parseInt(set?.used_count) || 0;
  return usedCount > 0 ? 'U' : 'N';
}

export { effectiveCondition };
