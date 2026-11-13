package ch.brickinventoryapp.model.util

import java.time.Instant
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
 * @param jahr [DatumJahr.VOLL], [DatumJahr.KURZ] („03.09.26“) oder [DatumJahr.OHNE] („03.09.“)
 * @return das formatierte Datum, oder null wenn nichts Brauchbares dasteht
 */
fun fmtDatum(iso: String?, locale: Locale, jahr: DatumJahr = DatumJahr.VOLL): String? {
    val tag = iso?.take(10) ?: return null
    val teile = tag.split("-")
    if (teile.size != 3) return null
    val (j, m, t) = teile
    if (j.length != 4 || m.length != 2 || t.length != 2) return null
    if (!(j + m + t).all { it.isDigit() }) return null
    val jj = when (jahr) { DatumJahr.VOLL -> j; DatumJahr.KURZ -> j.takeLast(2); DatumJahr.OHNE -> "" }
    return if (locale.language != "en") (if (jahr == DatumJahr.OHNE) "$t.$m." else "$t.$m.$jj")
    else englisch(t.toInt(), m.toInt(), jj, us = locale.country == "US")
}

/** Englisch mit Monatsnamen: „01/08/2026“ hiesse für US-Leser der 8. Januar. */
private fun englisch(tag: Int, monat: Int, jj: String, us: Boolean): String? {
    val name = MONATE_EN.getOrNull(monat - 1) ?: return null
    return when {
        jj.isEmpty() -> if (us) "$name $tag" else "$tag $name"
        us -> "$name $tag, $jj"
        else -> "$tag $name $jj"
    }
}

private val MONATE_EN = listOf("Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec")

/** Wie viel vom Jahr [fmtDatum] zeigt. */
enum class DatumJahr { VOLL, KURZ, OHNE }

/**
 * ISO-Zeitstempel aus einer Serverantwort als Uhrzeit — HH:MM:SS, für das
 * Protokoll der Verwaltung wie in der Webapp (public/js/logviewer.js): Ohne Zeit
 * ist „von eben oder von gestern?“ nicht zu beantworten.
 */
fun fmtUhrzeit(
    iso: String?,
    locale: Locale = Locale.getDefault(),
    vierundzwanzig: Boolean = true,
): String? {
    if (iso.isNullOrBlank()) return null
    val zeitpunkt = runCatching { OffsetDateTime.parse(iso).toInstant() }
        .recoverCatching {
            LocalDateTime.parse(iso).toInstant(ZoneOffset.UTC)
        }
        .getOrNull() ?: return null
    return uhrzeitFormat(locale, vierundzwanzig, sekunden = true)
        .withZone(ZoneId.systemDefault())
        .format(zeitpunkt)
}

/**
 * Zeitpunkt eines zwischengespeicherten Stands, auf der Uhr dessen, der ihn
 * liest — wie [fmtUhrzeit]. Tag und Uhrzeit, weil „Stand von 14:03" ohne Tag
 * nicht sagt, ob es von heute ist.
 */
fun fmtStand(
    millis: Long,
    locale: Locale,
    zone: ZoneId = ZoneId.systemDefault(),
    vierundzwanzig: Boolean = true,
    jahr: DatumJahr = DatumJahr.VOLL,
): String {
    val zeit = Instant.ofEpochMilli(millis).atZone(zone)
    return fmtDatum(zeit.toLocalDate().toString(), locale, jahr) + " " + uhrzeitFormat(locale, vierundzwanzig).format(zeit)
}

/**
 * Die Uhrzeit, wie das Gerät sie eingestellt hat: 24 Stunden („14:05“) oder 12 mit
 * Tageszeit in der Sprache der App („2:05 PM“). Fest „HH:mm“ zeigte einem Gerät auf
 * 12 Stunden eine andere Uhr als in der Statusleiste.
 */
fun uhrzeitFormat(locale: Locale, vierundzwanzig: Boolean, sekunden: Boolean = false): DateTimeFormatter =
    DateTimeFormatter.ofPattern(
        (if (vierundzwanzig) "HH:mm" else "h:mm") + (if (sekunden) ":ss" else "") + (if (vierundzwanzig) "" else " a"),
        locale,
    )
