package ch.brickinventoryapp.util

/**
 * ISO-Datum aus einer Serverantwort als kurzes Datum — eine Fassung für alle
 * Bildschirme und dieselbe Form wie fmtDatum() der Webapp (Intl, 2-stellig):
 * de „03.09.2026“, en „03/09/2026“, en-US „09/03/2026“. Ohne Zeitzonen-Umrechnung,
 * weil ein Erfassungsdatum ein Kalendertag ist und Stunden daraus den Vortag machten.
 *
 * @param iso z. B. "2026-09-03T15:00:32.194Z" oder "2026-09-03"
 * @param locale die Zahlen-Locale der App (appNumberLocale() in core-ui)
 * @param jahr [DatumJahr.VOLL], [DatumJahr.KURZ] („03.09.26“) oder [DatumJahr.OHNE] („03.09.“)
 * @return das formatierte Datum, oder null wenn nichts Brauchbares dasteht
 */
fun fmtDatum(iso: String?, locale: java.util.Locale, jahr: DatumJahr = DatumJahr.VOLL): String? {
    val tag = iso?.take(10) ?: return null
    val teile = tag.split("-")
    if (teile.size != 3) return null
    val (j, m, t) = teile
    if (j.length != 4 || m.length != 2 || t.length != 2) return null
    if (!(j + m + t).all { it.isDigit() }) return null
    val jj = when (jahr) { DatumJahr.VOLL -> j; DatumJahr.KURZ -> j.takeLast(2); DatumJahr.OHNE -> "" }
    return when {
        locale.language != "en" -> if (jahr == DatumJahr.OHNE) "$t.$m." else "$t.$m.$jj"
        locale.country == "US" -> if (jahr == DatumJahr.OHNE) "$m/$t" else "$m/$t/$jj"
        else -> if (jahr == DatumJahr.OHNE) "$t/$m" else "$t/$m/$jj"
    }
}

/** Wie viel vom Jahr [fmtDatum] zeigt. */
enum class DatumJahr { VOLL, KURZ, OHNE }

/**
 * ISO-Zeitstempel aus einer Serverantwort als Uhrzeit — HH:MM:SS, für das
 * Protokoll der Verwaltung wie in der Webapp (public/js/logviewer.js): Ohne Zeit
 * ist „von eben oder von gestern?“ nicht zu beantworten.
 * Ausführlich: docs/begruendungen/core-model/util/DatumFormat.kt.md#fmtuhrzeit
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
fun fmtStand(millis: Long, locale: java.util.Locale, zone: java.time.ZoneId = java.time.ZoneId.systemDefault()): String {
    val zeit = java.time.Instant.ofEpochMilli(millis).atZone(zone)
    return fmtDatum(zeit.toLocalDate().toString(), locale) + " " +
        java.time.format.DateTimeFormatter.ofPattern("HH:mm").format(zeit)
}
