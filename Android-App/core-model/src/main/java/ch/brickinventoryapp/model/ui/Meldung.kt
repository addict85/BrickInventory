package ch.brickinventoryapp.model.ui

/**
 * Ein Satz in Bausteinen, für die Snackbar wie für Fehlerfelder im Zustand. ViewModel
 * und Datenschicht nennen Ressource und Werte; den Satz bildet erst die Oberfläche in
 * der Sprache, die sie gerade zeigt. Ein fertiger String im Zustand bliebe nach einem
 * Sprachwechsel in der alten Sprache stehen, und ein Test könnte nur Text vergleichen.
 */

sealed interface Meldung {
    /** Ein fertiger Satz, etwa der des Servers. */
    data class Text(val text: String) : Meldung

    /** Ein Satz aus den Ressourcen und seine Werte; ein Wert darf selbst eine Meldung sein. */
    data class Ressource(val id: Int, val werte: List<Any> = emptyList()) : Meldung

    /** Ein Mengensatz (plurals): [anzahl] wählt die Form, [werte] füllen sie. */
    data class Menge(val id: Int, val anzahl: Int, val werte: List<Any> = listOf(anzahl)) : Meldung
}
