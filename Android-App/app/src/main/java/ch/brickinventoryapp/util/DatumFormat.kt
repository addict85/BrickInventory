package ch.brickinventoryapp.util

/**
 * ISO-Datum aus einer Serverantwort als kurzes Datum — eine Fassung für alle
 * Bildschirme, damit dasselbe Datum überall gleich aussieht.
 *
 * Ohne SimpleDateFormat: Gebraucht wird der Tag, und die ersten zehn Zeichen eines
 * ISO-Zeitstempels sind das Datum, gleich ob danach Millisekunden, ein Versatz
 * oder nichts folgt — kein Format, das nicht passen kann. Bewusst ohne
 * Zeitzonen-Umrechnung: Das Erfassungsdatum ist ein Kalendertag, und eine
 * Verschiebung um Stunden machte daraus den Vortag.
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
 * ISO-Zeitstempel aus einer Serverantwort als Uhrzeit — HH:MM:SS, für das
 * Protokoll der Verwaltung wie in der Webapp (public/js/logviewer.js): Ohne Zeit
 * ist „von eben oder von gestern?“ nicht zu beantworten.
 *
 * Hier wird umgerechnet, in [fmtDatum] nicht: Ein Erfassungsdatum ist ein
 * gewählter Kalendertag, ein Protokolleintrag ein Zeitpunkt, der auf die Uhr
 * dessen gehört, der ihn liest. Ohne Zeitzonen-Angabe im Text gilt UTC: Der Server
 * speichert `timestamptz` und schreibt das „Z“ mit.
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

/**
 * Zeitpunkt eines zwischengespeicherten Stands, auf der Uhr dessen, der ihn
 * liest — wie [fmtUhrzeit]. Tag und Uhrzeit, weil „Stand von 14:03" ohne Tag
 * nicht sagt, ob es von heute ist.
 */
fun fmtStand(millis: Long, zone: java.time.ZoneId = java.time.ZoneId.systemDefault()): String =
    java.time.format.DateTimeFormatter.ofPattern("dd.MM.yyyy HH:mm")
        .withZone(zone)
        .format(java.time.Instant.ofEpochMilli(millis))
