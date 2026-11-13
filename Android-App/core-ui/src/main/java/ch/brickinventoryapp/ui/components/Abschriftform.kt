package ch.brickinventoryapp.ui.components

/** Was beim Abtippen zählt: Buchstaben und Ziffern, ohne Doppelpunkte und Leerzeichen (wie Abschrift.von). */
internal fun abschriftZeichen(text: String): Int = text.count { it.isLetterOrDigit() }

/**
 * Die Abschrift in Paaren mit Doppelpunkt, wie die Webapp sie zeigt, und die Stelle für den
 * Cursor danach: hinter demselben getippten Zeichen wie vorher. Text mit anderen Zeichen
 * (ein eingefügtes Base64) bleibt, wie er ist.
 */
internal fun abschriftInPaaren(text: String, cursor: Int): Pair<String, Int> {
    if (text.any { it.uppercaseChar() !in HEX && it != ':' && !it.isWhitespace() }) return text to cursor
    val davor = text.take(cursor.coerceIn(0, text.length)).count { it.uppercaseChar() in HEX }
    val gepaart = text.uppercase().filter { it in HEX }.chunked(2).joinToString(":")
    return gepaart to if (davor == 0) 0 else davor + (davor - 1) / 2
}

private const val HEX = "0123456789ABCDEF"
