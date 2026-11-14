package ch.brickinventoryapp.model.fach

// Werte, die der Server festlegt und die auch Fach- und Anzeigetypen brauchen; die
// Antworttypen selbst liegen in core-vertrag, das core-model kennt, nicht umgekehrt.

/** So steht ein vorhandener PIN in jeder Gutschein-Antwort; PUT nimmt ihn als „unverändert“. */

const val GUTSCHEIN_PIN_MASKE = "•••"

/** Ob [nummer] die Maske des Servers ist („…1234“) und nicht die Kartennummer. */
fun istGutscheinMaske(nummer: String): Boolean = nummer.startsWith("…")

/**
 * „Keine Farbe“ wie bei Rebrickable ([No Color/Any Color]) und auf dem Server
 * (utils/validate.ts). 0 ist Schwarz: Wer 0 für „keine“ schickt, macht aus
 * einem Teil ohne Farbangabe ein schwarzes.
 */
const val KEINE_FARBE = 9999
