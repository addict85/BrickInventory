package ch.brickinventoryapp.ui.components

/** What counts while typing it in: letters and digits, without colons and spaces (like Abschrift.von). */
internal fun transcriptChars(text: String): Int = text.count { it.isLetterOrDigit() }

/**
 * The transcript in pairs with colons, as the web app shows it, and the cursor
 * position afterwards: right after the same typed character as before. Text with other characters
 * (an inserted Base64) is left as it is.
 */
internal fun pairTranscriptIn(text: String, cursor: Int): Pair<String, Int> {
    if (text.any { it.uppercaseChar() !in HEX && it != ':' && !it.isWhitespace() }) return text to cursor
    val davor = text.take(cursor.coerceIn(0, text.length)).count { it.uppercaseChar() in HEX }
    val paired = text.uppercase().filter { it in HEX }.chunked(2).joinToString(":")
    return paired to if (davor == 0) 0 else davor + (davor - 1) / 2
}

private const val HEX = "0123456789ABCDEF"
