package ch.brickinventoryapp.model.local

/**
 * What lies locally; [stand] is the time of the last server response, null = never loaded.
 * [verworfen] counts rows that could no longer be read — they are missing in [liste].
 */

data class Local<T>(val liste: List<T>, val stand: Long?, val verworfen: Int = 0)

/**
 * The compartments the app keeps locally: lists and single responses (key figures,
 * catalog metadata). The name stands in the database — do not rename.
 */
enum class StockKind {
    SETS, MERKLISTE, TEILE, FIGUREN, MANUELLE_TEILE, MANUELLE_FIGUREN, GUTSCHEINE, PREISALARME, LAGERORTE,
    KENNZAHLEN, KATALOG_META,
}
