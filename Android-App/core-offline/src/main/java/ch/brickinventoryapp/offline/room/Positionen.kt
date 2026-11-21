package ch.brickinventoryapp.offline.room

/**
 * Positions for the keys [neu] if [alt] applied so far: staying rows keep
 * theirs, new ones take free ones before, between or after. Only if the order of the
 * staying ones tips over or no space is free, counting starts over from the front.
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
