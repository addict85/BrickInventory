package ch.brickinventoryapp.offline.room

/**
 * Positionen für die Schlüssel [neu], wenn bisher [alt] galt: Bleibende Zeilen behalten
 * ihre, neue nehmen freie davor, dazwischen oder dahinter. Nur wenn die Reihenfolge der
 * bleibenden kippt oder kein Platz frei ist, wird von vorn durchgezählt.
 */
internal fun positionen(alt: Map<String, Int>, neu: List<String>): List<Int> {
    val ergebnis = IntArray(neu.size)
    var vorher: Int? = null
    var i = 0
    while (i < neu.size) {
        val p = alt[neu[i]]
        if (p != null) {
            if (vorher != null && p <= vorher) return neu.indices.toList()
            ergebnis[i] = p
            vorher = p
            i++
            continue
        }
        var j = i
        while (j < neu.size && alt[neu[j]] == null) j++
        val anzahl = j - i
        val danach = if (j < neu.size) alt.getValue(neu[j]) else null
        val start = when {
            danach == null -> (vorher ?: -1) + 1
            vorher == null -> danach - anzahl
            danach - vorher - 1 >= anzahl -> vorher + 1
            else -> return neu.indices.toList()
        }
        for (k in 0 until anzahl) ergebnis[i + k] = start + k
        vorher = start + anzahl - 1
        i = j
    }
    return ergebnis.toList()
}
