package ch.brickinventoryapp.ui

/**
 * Was ein Bildschirm mit geladenem Inhalt zeigt. Ein Ladefehler, eine leere
 * Sammlung und eine Suche ohne Treffer verlangen Verschiedenes: „Erneut
 * versuchen“, „etwas erfassen“, „Filter lockern“. Ein Fehler darf nicht
 * aussehen wie eine leere Liste.
 */
enum class LoadingIndicator { LISTE, LOADS, FEHLER, NO_HITS, LEER }

/**
 * Geladener Inhalt geht vor: Ein gescheitertes Neuladen lässt die alte Liste
 * stehen (die Meldung kommt dann als Snackbar). Erst ohne Inhalt entscheidet,
 * ob noch geladen wird, ob es scheiterte, und ob ein Filter schuld ist.
 */
fun loadingIndicator(hatContent: Boolean, laedt: Boolean, fehler: String?, gefiltert: Boolean): LoadingIndicator =
    loadingIndicator(hatContent, laedt, gescheitert = fehler != null, gefiltert = gefiltert)

/** Dasselbe für Zustände, die eine Meldung statt eines fertigen Satzes tragen. */
fun loadingIndicator(hatContent: Boolean, laedt: Boolean, gescheitert: Boolean, gefiltert: Boolean): LoadingIndicator = when {
    hatContent -> LoadingIndicator.LISTE
    laedt -> LoadingIndicator.LOADS
    gescheitert -> LoadingIndicator.FEHLER
    gefiltert -> LoadingIndicator.NO_HITS
    else -> LoadingIndicator.LEER
}
