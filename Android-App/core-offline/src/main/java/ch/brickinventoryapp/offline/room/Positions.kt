package ch.brickinventoryapp.offline.room

/**
 * Positions for the keys [newValue] if [old] applied so far: staying rows keep
 * theirs, new ones take free ones before, between or after. Only if the order of the
 * staying ones tips over or no space is free, counting starts over from the front.
 */
internal fun positions(old: Map<String, Int>, newValue: List<String>): List<Int> {
    val outcome = IntArray(newValue.size)
    var before: Int? = null
    var i = 0
    while (i < newValue.size) {
        val p = old[newValue[i]]
        if (p != null) {
            if (before != null && p <= before) return newValue.indices.toList()
            outcome[i] = p
            before = p
            i++
            continue
        }
        var j = i
        while (j < newValue.size && old[newValue[j]] == null) j++
        val count = j - i
        val after = if (j < newValue.size) old.getValue(newValue[j]) else null
        val start = when {
            after == null -> (before ?: -1) + 1
            before == null -> after - count
            after - before - 1 >= count -> before + 1
            else -> return newValue.indices.toList()
        }
        for (k in 0 until count) outcome[i + k] = start + k
        before = start + count - 1
        i = j
    }
    return outcome.toList()
}
