package ch.brickinventoryapp.util

/**
 * ISO-Datum aus einer Serverantwort als kurzes Datum.
 *
 * ── Warum das hier steht ────────────────────────────────────────────────────
 * Es gab die Umwandlung zweimal, in zwei verschiedenen Fassungen:
 *
 *   SetDetailScreen.kt   iso.take(10).split("-") → "TT.MM.JJJJ", vierstellig
 *   MinifigsScreen.kt    SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'")
 *                        → "TT.MM.JJ", zweistellig
 *
 * Dasselbe Datum sah in der App also an zwei Stellen unterschiedlich aus, und
 * die zweite Fassung scheiterte still an jedem Zeitstempel OHNE Millisekunden
 * (`runCatching { … }.getOrNull()` → null → gar kein Datum). Beim Bau der
 * Tabellenansicht wäre eine dritte Fassung dazugekommen.
 *
 * ── Warum ohne SimpleDateFormat ─────────────────────────────────────────────
 * Gebraucht wird der TAG, nicht die Uhrzeit. Die ersten zehn Zeichen eines
 * ISO-Zeitstempels sind das Datum — unabhängig davon, ob danach
 * Millisekunden, ein Zeitzonen-Versatz oder nichts folgt. Kein Format, das
 * passen muss, also auch keins, das nicht passen kann.
 *
 * Bewusst KEINE Zeitzonen-Umrechnung: Der Server liefert das Erfassungsdatum,
 * und eine Verschiebung um Stunden könnte daraus den Vortag machen — für ein
 * „erfasst am" wäre das falsch, nicht genauer.
 *
 * @param iso z. B. "2026-09-03T15:00:32.194Z" oder "2026-09-03"
 * @param zweistelligesJahr true für "03.09.26", false für "03.09.2026"
 * @return das formatierte Datum, oder null wenn nichts Brauchbares dasteht
 */
fun fmtDatum(iso: String?, zweistelligesJahr: Boolean = false): String? {
    val tag = iso?.take(10) ?: return null
    val teile = tag.split("-")
    if (teile.size != 3) return null
    val (jahr, monat, tagImMonat) = teile
    if (jahr.length != 4 || monat.length != 2 || tagImMonat.length != 2) return null
    if (!jahr.all { it.isDigit() } || !monat.all { it.isDigit() } || !tagImMonat.all { it.isDigit() }) return null
    return "$tagImMonat.$monat.${if (zweistelligesJahr) jahr.takeLast(2) else jahr}"
}
