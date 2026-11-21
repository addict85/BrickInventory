package ch.brickinventoryapp.ui.util

import ch.brickinventoryapp.model.domain.Geld
import ch.brickinventoryapp.model.domain.Waehrung
import androidx.appcompat.app.AppCompatDelegate
import android.text.format.DateFormat
import androidx.compose.runtime.Composable
import androidx.compose.ui.platform.LocalContext
import java.text.NumberFormat
import java.time.Instant
import java.util.Currency
import java.util.Locale
import ch.brickinventoryapp.model.util.DateYear
import ch.brickinventoryapp.model.util.fmtDatum
import ch.brickinventoryapp.model.util.numbersLocale

/*
 * Numbers and amounts — one version for the whole app, kept in step with
 * the web app (locale() in public/i18n.js), so the same amount looks the
 * same everywhere. Amounts go through the platform's currency formatting:
 * the placement of symbol and amount is not something to get right by hand.
 */

/**
 * Number locale for the configured APP language (AppCompat, the same source as
 * LanguageManager), country from the device. Without an app language, the device's applies.
 */
fun appNumberLocale(): Locale {
    val geraet = Locale.getDefault()
    // There is no AppCompat state in the JVM test; then the device's applies.
    val app = try {
        AppCompatDelegate.getApplicationLocales().let { if (it.isEmpty) null else it[0] }
    } catch (_: Throwable) { null }
    return numbersLocale(app ?: geraet, geraet)
}

/**
 * Amount WITH currency — the counterpart to fmtN() in public/js/01-core.js.
 *
 * @param currencyCode ISO code from the server response (CHF, EUR, …). An
 *        unknown code must not break the display: then the code stands
 *        before the amount, as the web app also does for an unmapped one.
 */
fun fmtMoney(amount: Double, currencyCode: Waehrung?): String {
    val loc = appNumberLocale()
    return try {
        val nf = NumberFormat.getCurrencyInstance(loc)
        nf.currency = Currency.getInstance((currencyCode ?: Waehrung.EUR).code)
        nf.minimumFractionDigits = 2
        nf.maximumFractionDigits = 2
        withCurrencyGap(nf.format(amount))
    } catch (_: Exception) {
        "${currencyCode?.code.orEmpty()}\u00A0${fmtAmount(amount)}".trim()
    }
}

/** An amount of money, first rounded to cents like on the server (halves away from zero). */
fun fmtMoney(betrag: Geld, currencyCode: Waehrung?): String = fmtMoney(betrag.onRappen().toDouble(), currencyCode)

/** Like [fmtMoney], "—" without an amount. */
fun fmtMoneyOrDash(betrag: Geld?, currencyCode: Waehrung?): String = betrag?.let { fmtMoney(it, currencyCode) } ?: "—"

fun fmtMoneyWhole(betrag: Geld, currencyCode: Waehrung?): String = fmtMoneyWhole(betrag.asDouble(), currencyCode)

/** Whole amount with currency ("CHF 1'720") — for chart axes, as the server delivers them. */
fun fmtMoneyWhole(amount: Double, currencyCode: Waehrung?): String = try {
    val nf = NumberFormat.getCurrencyInstance(appNumberLocale())
    nf.currency = Currency.getInstance((currencyCode ?: Waehrung.EUR).code)
    nf.minimumFractionDigits = 0
    nf.maximumFractionDigits = 0
    withCurrencyGap(nf.format(amount))
} catch (_: IllegalArgumentException) {
    "${currencyCode?.code.orEmpty()}\u00A0${fmtAmount(amount, 0, 0)}".trim()
}

/**
 * A code made of letters ("CHF") sticks to the amount in en-GB ("CHF812.50"), Intl in
 * the web writes "CHF 812.50". A fixed space in between, so both look the same
 * and the line doesn't break between code and number. Symbols like € stay as they are.
 */
fun withCurrencyGap(text: String): String =
    text.replace(Regex("""(?<=\p{L})(?=[-−]?\d)|(?<=\d)(?=\p{L})"""), "\u00A0")

/** A date from the server response in the form of the app language — see fmtDatum. */
fun fmtTag(iso: String?, jahr: DateYear = DateYear.VOLL): String? = fmtDatum(iso, appNumberLocale(), jahr)

fun fmtTag(zeit: Instant?, jahr: DateYear = DateYear.VOLL): String? = fmtDatum(zeit, appNumberLocale(), jahr)

/** Like fmtMoney, but from the API's string — `null`/unreadable gives "—". */
fun fmtMoneyOrDash(amount: String?, currencyCode: Waehrung?): String {
    val v = amount?.toDoubleOrNull() ?: return "—"
    return fmtMoney(v, currencyCode)
}

/** Amount WITHOUT currency — for places where the currency already stands next to it. */
fun fmtAmount(v: Double, minFractionDigits: Int = 2, maxFractionDigits: Int = 2): String {
    val nf = NumberFormat.getNumberInstance(appNumberLocale())
    nf.minimumFractionDigits = minFractionDigits
    nf.maximumFractionDigits = maxFractionDigits
    return nf.format(v)
}

fun fmtAmount(betrag: Geld, minFractionDigits: Int = 2, maxFractionDigits: Int = 2): String =
    fmtAmount(betrag.onRappen().toDouble(), minFractionDigits, maxFractionDigits)

/**
 * Amount for an input field: two decimal places in the app language's
 * decimal separator, without thousands grouping — that couldn't be told
 * apart from the decimal separator on save.
 */
fun fmtEingabe(v: Double): String {
    val nf = NumberFormat.getNumberInstance(appNumberLocale())
    nf.isGroupingUsed = false
    nf.minimumFractionDigits = 2
    nf.maximumFractionDigits = 2
    return nf.format(v)
}

fun fmtEingabe(betrag: Geld): String = fmtEingabe(betrag.onRappen().toDouble())

/** Whole number with thousands grouping (piece counts, part counts). */
fun fmtInt(v: Int): String {
    val nf = NumberFormat.getNumberInstance(appNumberLocale())
    nf.maximumFractionDigits = 0
    return nf.format(v)
}

/**
 * Percentage with one decimal place and a sign as soon as it isn't zero —
 * one version for badges, chart and tiles. [prozent] is the
 * value in percent (12.5 means 12.5 %). Where the sign sits and whether
 * with a space, the platform decides for the app language.
 */
fun fmtProzent(prozent: Double): String {
    val nf = NumberFormat.getPercentInstance(appNumberLocale())
    nf.minimumFractionDigits = 1
    nf.maximumFractionDigits = 1
    // Round first: -0.04 would otherwise read "-0.0 %", a minus before a zero.
    val gerundet = Math.round(prozent * 10) / 10.0
    if (gerundet == 0.0) return nf.format(0.0)
    val text = nf.format(gerundet / 100.0)
    return if (gerundet > 0) "+$text" else text
}

/** Does the device set the clock to 24 hours? Like the status bar, not by language. */
@Composable
fun twentyFourHours(): Boolean = DateFormat.is24HourFormat(LocalContext.current)
