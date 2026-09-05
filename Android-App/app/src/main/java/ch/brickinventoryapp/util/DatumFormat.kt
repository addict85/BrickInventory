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

/**
 * ISO-Zeitstempel aus einer Serverantwort als Uhrzeit — HH:MM:SS.
 *
 * ── Warum es das braucht ────────────────────────────────────────────────────
 * Das Protokoll der Verwaltung zeigte Stufe und Meldung, aber keine Uhrzeit.
 * Das Feld `logged_at` kommt seit jeher mit; die App hat es nie gelesen. Die
 * Weboberflaeche zeigt es (public/js/logviewer.js, toLocaleTimeString), und
 * ohne Zeitangabe ist eine Protokollzeile schwer zu gebrauchen: „Ist das von
 * eben oder von gestern?" ist die erste Frage, die man an ein Protokoll hat.
 *
 * ── Warum HIER umgerechnet wird und in [fmtDatum] nicht ─────────────────────
 * Das ist kein Widerspruch, sondern der Unterschied zwischen den beiden
 * Angaben. [fmtDatum] zeigt ein ERFASSUNGSDATUM — einen Kalendertag, den ein
 * Mensch gewaehlt hat; eine Verschiebung um Stunden koennte daraus den Vortag
 * machen, und das waere falsch, nicht genauer. Ein Protokolleintrag ist ein
 * ZEITPUNKT, und der gehoert auf die Uhr dessen, der ihn liest. Die Webapp
 * macht es genauso.
 *
 * Ohne Zeitzonen-Angabe im Text gilt UTC: Der Server speichert `timestamptz`
 * und schreibt das „Z" mit. Faellt es weg, ist das eine Serveraenderung und
 * keine lokale Zeit — die Annahme steht hier, damit sie nicht geraten wirkt.
 *
 * @return "14:03:07", oder null wenn nichts Brauchbares dasteht
 */
fun fmtUhrzeit(iso: String?): String? {
    if (iso.isNullOrBlank()) return null
    val zeitpunkt = runCatching { java.time.OffsetDateTime.parse(iso).toInstant() }
        .recoverCatching {
            java.time.LocalDateTime.parse(iso).toInstant(java.time.ZoneOffset.UTC)
        }
        .getOrNull() ?: return null
    return java.time.format.DateTimeFormatter.ofPattern("HH:mm:ss")
        .withZone(java.time.ZoneId.systemDefault())
        .format(zeitpunkt)
}
