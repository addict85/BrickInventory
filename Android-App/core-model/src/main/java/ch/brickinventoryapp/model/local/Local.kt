package ch.brickinventoryapp.model.local

/**
 * What lies locally; [state] is the time of the last server response, null = never loaded.
 * [discarded] counts rows that could no longer be read — they are missing in [list].
 */

data class Local<T>(val list: List<T>, val state: Long?, val discarded: Int = 0)

/**
 * The compartments the app keeps locally: lists and single responses (key figures,
 * catalog metadata). The name stands in the database — do not rename.
 */
enum class StockKind {
    SETS, WANTED_LIST, PARTS, FIGURES, MANUAL_PARTS, MANUAL_FIGURES, VOUCHERS, PRICE_ALARMS, STORAGE_LOCATIONS,
    METRICS, CATALOG_META,
}
