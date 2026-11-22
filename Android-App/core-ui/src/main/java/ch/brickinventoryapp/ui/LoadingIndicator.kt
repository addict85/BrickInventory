package ch.brickinventoryapp.ui

/**
 * What a screen with loaded content shows. A loading error, an empty
 * collection and a search with no results all need something different: „try
 * again“, „capture something“, „loosen the filter“. An error must not
 * look like an empty list.
 */
enum class LoadingIndicator { LIST, LOADS, ERROR, NO_HITS, EMPTY }

/**
 * Loaded content takes priority: a failed reload leaves the old list
 * standing (the message then comes as a snackbar). Only without content does it decide
 * whether loading is still happening, whether it failed, and whether a filter is to blame.
 */
fun loadingIndicator(hasContent: Boolean, loading: Boolean, error: String?, filtered: Boolean): LoadingIndicator =
    loadingIndicator(hasContent, loading, failed = error != null, filtered = filtered)

/** The same for states that carry a message instead of a finished string. */
fun loadingIndicator(hasContent: Boolean, loading: Boolean, failed: Boolean, filtered: Boolean): LoadingIndicator = when {
    hasContent -> LoadingIndicator.LIST
    loading -> LoadingIndicator.LOADS
    failed -> LoadingIndicator.ERROR
    filtered -> LoadingIndicator.NO_HITS
    else -> LoadingIndicator.EMPTY
}
