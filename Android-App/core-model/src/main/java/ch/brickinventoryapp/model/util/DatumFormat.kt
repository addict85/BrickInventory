package ch.brickinventoryapp.model.util

import java.time.Instant
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.OffsetDateTime
import java.time.ZoneId
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter
import java.util.Locale

/**
 * ISO-Datum aus einer Serverantwort als kurzes Datum — eine Fassung für alle
 * Bildschirme und dieselbe Form wie fmtDatum() der Webapp (Intl, 2-stellig):
 * de „03.09.2026“, en „03/09/2026“, en-US „09/03/2026“. Ohne Zeitzonen-Umrechnung,
 * weil ein Erfassungsdatum ein Kalendertag ist und Stunden daraus den Vortag machten.
 *
 * @param iso z. B. "2026-09-03T15:00:32.194Z" oder "2026-09-03"
 * @param locale die Zahlen-Locale der App (appNumberLocale() in core-ui)
 * @param jahr [DateYear.VOLL], [DateYear.SHORT] („03.09.26“) oder [DateYear.OHNE] („03.09.“)
 * @return das formatierte Datum, oder null wenn nichts Brauchbares dasteht
 */
fun fmtDatum(iso: String?, locale: Locale, jahr: DateYear = DateYear.VOLL): String? {
    val tag = iso?.take(10) ?: return null
    val teile = tag.split("-")
    if (teile.size != 3) return null
    val (j, m, t) = teile
    if (j.length != 4 || m.length != 2 || t.length != 2) return null
    if (!(j + m + t).all { it.isDigit() }) return null
    val jj = when (jahr) { DateYear.VOLL -> j; DateYear.SHORT -> j.takeLast(2); DateYear.OHNE -> "" }
    return if (locale.language != "en") (if (jahr == DateYear.OHNE) "$t.$m." else "$t.$m.$jj")
    else englisch(t.toInt(), m.toInt(), jj, us = locale.country == "US")
}

/** Englisch mit Monatsnamen: „01/08/2026“ hiesse für US-Leser der 8. Januar. */
private fun englisch(tag: Int, month: Int, jj: String, us: Boolean): String? {
    val name = MONTHS_EN.getOrNull(month - 1) ?: return null
    return when {
        jj.isEmpty() -> if (us) "$name $tag" else "$tag $name"
        us -> "$name $tag, $jj"
        else -> "$tag $name $jj"
    }
}

private val MONTHS_EN = listOf("Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec")

/** Wie viel vom Jahr [fmtDatum] zeigt. */
enum class DateYear { VOLL, SHORT, OHNE }

/**
 * ISO-Zeitstempel aus einer Serverantwort als Uhrzeit — HH:MM:SS, für das
 * Protokoll der Verwaltung wie in der Webapp (public/js/logviewer.js): Ohne Zeit
 * ist „von eben oder von gestern?“ nicht zu beantworten.
 */
fun fmtUhrzeit(
    iso: String?,
    locale: Locale = Locale.getDefault(),
    twentyFour: Boolean = true,
): String? = fmtUhrzeit(timestamp(iso), locale, twentyFour)

/** Wie [fmtUhrzeit] für einen schon gelesenen Zeitpunkt. */
fun fmtUhrzeit(zeitpunkt: Instant?, locale: Locale = Locale.getDefault(), twentyFour: Boolean = true): String? =
    zeitpunkt?.let { timeOfDayFormat(locale, twentyFour, seconds = true).withZone(ZoneId.systemDefault()).format(it) }

/**
 * Ein Zeitpunkt des Servers; ohne Zone gilt UTC, ein blosser Tag ist dessen Beginn in UTC
 * (Kaufdaten setzt der Nutzer als Tag). Unlesbar heisst null.
 */
fun zeitpunkt(iso: String?): Instant? = timestamp(iso)
    ?: iso?.trim()?.let { runCatching { LocalDate.parse(it).atStartOfDay(ZoneOffset.UTC).toInstant() }.getOrNull() }

/** Nur mit Uhrzeit: Ein blosser Tag hat keine, [fmtUhrzeit] zeigt dann nichts statt Mitternacht. */
private fun timestamp(iso: String?): Instant? {
    if (iso.isNullOrBlank()) return null
    val text = iso.trim().replace(' ', 'T')
    return runCatching { OffsetDateTime.parse(text).toInstant() }
        .recoverCatching { LocalDateTime.parse(text).toInstant(ZoneOffset.UTC) }
        .getOrNull()
}

/**
 * Der Kalendertag in UTC, wie der Server ihn schreibt: [fmtDatum] rechnet nicht in die Zone
 * des Geräts um, weil Stunden aus einem Erfassungstag sonst den Vortag machten.
 */
fun Instant.calendarDay(): LocalDate = atOffset(ZoneOffset.UTC).toLocalDate()

/** Wie [fmtDatum] für einen schon gelesenen Zeitpunkt oder Tag. */
fun fmtDatum(zeit: Instant?, locale: Locale, jahr: DateYear = DateYear.VOLL): String? =
    zeit?.let { fmtDatum(it.calendarDay().toString(), locale, jahr) }

/**
 * Zeitpunkt eines zwischengespeicherten Stands, auf der Uhr dessen, der ihn
 * liest — wie [fmtUhrzeit]. Tag und Uhrzeit, weil „Stand von 14:03" ohne Tag
 * nicht sagt, ob es von heute ist.
 */
fun fmtStatus(
    millis: Long,
    locale: Locale,
    zone: ZoneId = ZoneId.systemDefault(),
    twentyFour: Boolean = true,
    jahr: DateYear = DateYear.VOLL,
): String {
    val zeit = Instant.ofEpochMilli(millis).atZone(zone)
    return fmtDatum(zeit.toLocalDate().toString(), locale, jahr) + " " + timeOfDayFormat(locale, twentyFour).format(zeit)
}

/**
 * Die Uhrzeit, wie das Gerät sie eingestellt hat: 24 Stunden („14:05“) oder 12 mit
 * Tageszeit in der Sprache der App („2:05 PM“). Fest „HH:mm“ zeigte einem Gerät auf
 * 12 Stunden eine andere Uhr als in der Statusleiste.
 */
fun timeOfDayFormat(locale: Locale, twentyFour: Boolean, seconds: Boolean = false): DateTimeFormatter =
    DateTimeFormatter.ofPattern(
        (if (twentyFour) "HH:mm" else "h:mm") + (if (seconds) ":ss" else "") + (if (twentyFour) "" else " a"),
        locale,
    )
