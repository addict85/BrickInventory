package ch.brickinventoryapp.ui

/**
 * What a screen with loaded content shows. A loading error, an empty
 * collection and a search with no results all need something different: „try
 * again“, „capture something“, „loosen the filter“. An error must not
 * look like an empty list.
 */
enum class LoadingIndicator { LISTE, LOADS, FEHLER, NO_HITS, LEER }

/**
 * Loaded content takes priority: a failed reload leaves the old list
 * standing (the message then comes as a snackbar). Only without content does it decide
 * whether loading is still happening, whether it failed, and whether a filter is to blame.
 */
fun loadingIndicator(hatContent: Boolean, laedt: Boolean, fehler: String?, gefiltert: Boolean): LoadingIndicator =
    loadingIndicator(hatContent, laedt, gescheitert = fehler != null, gefiltert = gefiltert)

/** The same for states that carry a message instead of a finished string. */
fun loadingIndicator(hatContent: Boolean, laedt: Boolean, gescheitert: Boolean, gefiltert: Boolean): LoadingIndicator = when {
    hatContent -> LoadingIndicator.LISTE
    laedt -> LoadingIndicator.LOADS
    gescheitert -> LoadingIndicator.FEHLER
    gefiltert -> LoadingIndicator.NO_HITS
    else -> LoadingIndicator.LEER
}
