package ch.brickinventoryapp.data

/**
 * Kontofilter des Haushalts, je Ansicht wie in der Webapp: In der Galerie den
 * Haushalt, in den Finanzen die eigenen Zahlen. Auf dem Gerät, weil es eine
 * Ansichtseinstellung ist. Werte: "all" (Vorgabe), "own", "subs" oder die ID eines
 * Kontos; übersetzt nur auf dem Server (scopeIds in utils/household.ts). Eine
 * fremde ID weist er ab — der Filter ist eine Ansichtshilfe, kein Zugriffsweg.
 */
object ScopeFilter {

    /**
     * Die Ansichten mit eigenem Filter. Die Schlüssel heissen wie in der Webapp
     * (js/14-scope.js), damit beide dieselbe Wahl unter demselben Namen speichern.
     */
    enum class View(val key: String) {
        GALLERY("gallery"), PARTS("parts"), MINIFIGS("minifigs"), FINANCE("finance"),
        MERKLISTE("merkliste")
    }

    const val ALL = "all"

    /**
     * Wert für die Anfrage, `null` solange nicht gefiltert wird: Das hält die Adressen
     * kurz und trifft im Repository den Zweig, der in der Ablage zwischenspeichert —
     * eine gefilterte Sicht darf dort nicht unter dem Schlüssel der vollen landen.
     */
    fun asQuery(value: String?): String? =
        if (value.isNullOrBlank() || value == ALL) null else value

    /**
     * Wert für die Anfrage, `null` solange nicht gefiltert wird. Kein Sonderwert „ohne
     * Lagerort“: „Was muss ich noch einräumen?“ ist eine andere Frage als „wo liegt
     * X?“ — wie in der Webapp.
     */
    fun lagerAsQuery(value: String?): String? =
        if (value.isNullOrBlank()) null else value

    /**
     * Zeigt eine gespeicherte Wahl auf ein entkoppeltes Konto, fällt sie auf „Alle“
     * zurück — sonst stünde ein leerer Eintrag da und die Liste bliebe unerklärlich
     * gefiltert.
     */
    fun sanitize(value: String, options: List<Pair<String, String>>): String =
        if (options.any { it.first == value }) value else ALL
}
