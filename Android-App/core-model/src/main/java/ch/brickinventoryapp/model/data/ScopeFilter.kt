package ch.brickinventoryapp.model.data

/**
 * Account filter of the household, per view as in the web app: in the gallery the
 * household, in the finances the own numbers. On the device, because it is a
 * view setting. Values: "all" (default), "own", "subs" or the ID of an
 * account; translated only on the server (scopeIds in src/household/household.ts). A
 * foreign ID it rejects — the filter is a viewing aid, not an access path.
 */

object ScopeFilter {

    /**
     * The views with their own filter. The keys are named as in the web app
     * (js/account-filter.js), so that both store the same choice under the same name.
     */
    enum class View(val key: String) {
        GALLERY("gallery"), PARTS("parts"), MINIFIGS("minifigs"), FINANCE("finance"),
        WANTED_LIST("merkliste")
    }

    const val ALL = "all"

    /**
     * Value for the request, `null` as long as nothing is filtered: that keeps the addresses
     * short and hits the branch in the repository that caches in the store —
     * a filtered view must not end up there under the key of the full one.
     */
    fun asQuery(value: String?): String? =
        if (value.isNullOrBlank() || value == ALL) null else value

    /**
     * Value for the request, `null` as long as nothing is filtered. No special value „without
     * storage location“: „What do I still have to put away?“ is a different question from „where is
     * X?“ — as in the web app.
     */
    fun storageAsQuery(value: String?): String? =
        if (value.isNullOrBlank()) null else value

    /**
     * If a saved choice points to a decoupled account, it falls back to „All“
     * — otherwise an empty entry would stand there and the list would stay inexplicably
     * filtered.
     */
    fun sanitize(value: String, options: List<Pair<String, String>>): String =
        if (options.any { it.first == value }) value else ALL
}
