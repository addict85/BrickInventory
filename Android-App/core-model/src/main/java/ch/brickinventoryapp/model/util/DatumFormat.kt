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
 * ISO date from a server response as a short date — one version for all
 * screens and the same form as fmtDatum() of the web app (Intl, 2-digit):
 * de „03.09.2026“, en „03/09/2026“, en-US „09/03/2026“. Without time zone conversion,
 * because an acquisition date is a calendar day and hours would make it the previous day.
 *
 * @param iso e.g. "2026-09-03T15:00:32.194Z" or "2026-09-03"
 * @param locale the app's number locale (appNumberLocale() in core-ui)
 * @param jahr [DateYear.VOLL], [DateYear.SHORT] („03.09.26“) or [DateYear.OHNE] („03.09.“)
 * @return the formatted date, or null if nothing usable is there
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

/** English with month names: „01/08/2026“ would mean January 8 to US readers. */
private fun englisch(tag: Int, month: Int, jj: String, us: Boolean): String? {
    val name = MONTHS_EN.getOrNull(month - 1) ?: return null
    return when {
        jj.isEmpty() -> if (us) "$name $tag" else "$tag $name"
        us -> "$name $tag, $jj"
        else -> "$tag $name $jj"
    }
}

private val MONTHS_EN = listOf("Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec")

/** How much of the year [fmtDatum] shows. */
enum class DateYear { VOLL, SHORT, OHNE }

/**
 * ISO timestamp from a server response as time of day — HH:MM:SS, for the
 * admin log as in the web app (public/js/logviewer.js): without a time
 * „just now or from yesterday?“ cannot be answered.
 */
fun fmtUhrzeit(
    iso: String?,
    locale: Locale = Locale.getDefault(),
    twentyFour: Boolean = true,
): String? = fmtUhrzeit(timestamp(iso), locale, twentyFour)

/** Like [fmtUhrzeit] for an already read point in time. */
fun fmtUhrzeit(zeitpunkt: Instant?, locale: Locale = Locale.getDefault(), twentyFour: Boolean = true): String? =
    zeitpunkt?.let { timeOfDayFormat(locale, twentyFour, seconds = true).withZone(ZoneId.systemDefault()).format(it) }

/**
 * A point in time of the server; without zone UTC applies, a bare day is its start in UTC
 * (purchase dates are set by the user as a day). Unreadable means null.
 */
fun zeitpunkt(iso: String?): Instant? = timestamp(iso)
    ?: iso?.trim()?.let { runCatching { LocalDate.parse(it).atStartOfDay(ZoneOffset.UTC).toInstant() }.getOrNull() }

/** Only with time of day: a bare day has none, [fmtUhrzeit] then shows nothing instead of midnight. */
private fun timestamp(iso: String?): Instant? {
    if (iso.isNullOrBlank()) return null
    val text = iso.trim().replace(' ', 'T')
    return runCatching { OffsetDateTime.parse(text).toInstant() }
        .recoverCatching { LocalDateTime.parse(text).toInstant(ZoneOffset.UTC) }
        .getOrNull()
}

/**
 * The calendar day in UTC as the server writes it: [fmtDatum] does not convert into the zone
 * of the device, because hours would otherwise turn an acquisition day into the previous day.
 */
fun Instant.calendarDay(): LocalDate = atOffset(ZoneOffset.UTC).toLocalDate()

/** Like [fmtDatum] for an already read point in time or day. */
fun fmtDatum(zeit: Instant?, locale: Locale, jahr: DateYear = DateYear.VOLL): String? =
    zeit?.let { fmtDatum(it.calendarDay().toString(), locale, jahr) }

/**
 * Point in time of a cached state, on the clock of whoever
 * reads it — like [fmtUhrzeit]. Day and time, because „state from 14:03" without a day
 * does not say whether it is from today.
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
 * The time as the device has it set: 24 hours („14:05“) or 12 with
 * day period in the app's language („2:05 PM“). A fixed „HH:mm“ showed a device set to
 * 12 hours a different clock than in the status bar.
 */
fun timeOfDayFormat(locale: Locale, twentyFour: Boolean, seconds: Boolean = false): DateTimeFormatter =
    DateTimeFormatter.ofPattern(
        (if (twentyFour) "HH:mm" else "h:mm") + (if (seconds) ":ss" else "") + (if (twentyFour) "" else " a"),
        locale,
    )
