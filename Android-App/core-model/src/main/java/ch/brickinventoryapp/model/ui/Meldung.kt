package ch.brickinventoryapp.model.ui

/**
 * Eine flüchtige Meldung für die Snackbar. Wer keinen Context hat (Datenschicht,
 * Netz), gibt die Ressource mit ihren Werten; den Satz bildet die Oberfläche in der
 * Sprache, die sie gerade zeigt.
 */
sealed interface Meldung {
    /** Ein fertiger Satz, etwa der des Servers oder einer, den ein ViewModel gebildet hat. */
    data class Text(val text: String) : Meldung

    /** Ein Satz aus den Ressourcen und seine Werte. */
    data class Ressource(val id: Int, val werte: List<Any> = emptyList()) : Meldung
}
