package ch.brickinventoryapp.ui.util

import android.text.format.DateFormat
import androidx.appcompat.app.AppCompatDelegate
import androidx.compose.runtime.Composable
import androidx.compose.ui.platform.LocalContext
import ch.brickinventoryapp.model.domain.CurrencyCode
import ch.brickinventoryapp.model.domain.Money
import ch.brickinventoryapp.model.util.DateYear
import ch.brickinventoryapp.model.util.fmtDatum
import ch.brickinventoryapp.model.util.numbersLocale
import java.text.NumberFormat
import java.time.Instant
import java.util.Currency
import java.util.Locale

/*
 * Numbers and amounts — one version for the whole app, kept in step with
 * the web app (locale() in `public/i18n.js`), so the same amount looks the
 * same everywhere. Amounts go through the platform's currency formatting:
 * the placement of symbol and amount is not something to get right by hand.
 */

/**
 * Number locale for the configured APP language (AppCompat, the same source as
 * LanguageManager), country from the device. Without an app language, the device's applies.
 */
fun appNumberLocale(): Locale {
    val device = Locale.getDefault()
    // There is no AppCompat state in the JVM test; then the device's applies.
    val app = try {
        AppCompatDelegate.getApplicationLocales().let { if (it.isEmpty) null else it[0] }
    } catch (_: Throwable) { null }
    return numbersLocale(app ?: device, device)
}

/**
 * Amount WITH currency — the counterpart to fmtN() in `public/js/01-core.js`.
 *
 * @param currencyCode ISO code from the server response (CHF, EUR, …). An
 *        unknown code must not break the display: then the code stands
 *        before the amount, as the web app also does for an unmapped one.
 */
fun fmtMoney(amount: Double, currencyCode: CurrencyCode?): String {
    val loc = appNumberLocale()
    return try {
        val nf = NumberFormat.getCurrencyInstance(loc)
        nf.currency = Currency.getInstance((currencyCode ?: CurrencyCode.EUR).code)
        nf.minimumFractionDigits = 2
        nf.maximumFractionDigits = 2
        withCurrencyGap(nf.format(amount))
    } catch (_: Exception) {
        "${currencyCode?.code.orEmpty()}\u00A0${fmtAmount(amount)}".trim()
    }
}

/** An amount of money, first rounded to cents like on the server (halves away from zero). */
fun fmtMoney(amount: Money, currencyCode: CurrencyCode?): String = fmtMoney(amount.onRappen().toDouble(), currencyCode)

/** Like [fmtMoney], "—" without an amount. */
fun fmtMoneyOrDash(amount: Money?, currencyCode: CurrencyCode?): String = amount?.let { fmtMoney(it, currencyCode) } ?: "—"

fun fmtMoneyWhole(amount: Money, currencyCode: CurrencyCode?): String = fmtMoneyWhole(amount.asDouble(), currencyCode)

/** Whole amount with currency ("CHF 1'720") — for chart axes, as the server delivers them. */
fun fmtMoneyWhole(amount: Double, currencyCode: CurrencyCode?): String = try {
    val nf = NumberFormat.getCurrencyInstance(appNumberLocale())
    nf.currency = Currency.getInstance((currencyCode ?: CurrencyCode.EUR).code)
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
fun fmtTag(iso: String?, year: DateYear = DateYear.FULL): String? = fmtDatum(iso, appNumberLocale(), year)

fun fmtTag(time: Instant?, year: DateYear = DateYear.FULL): String? = fmtDatum(time, appNumberLocale(), year)

/** Like fmtMoney, but from the API's string — `null`/unreadable gives "—". */
fun fmtMoneyOrDash(amount: String?, currencyCode: CurrencyCode?): String {
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

fun fmtAmount(amount: Money, minFractionDigits: Int = 2, maxFractionDigits: Int = 2): String =
    fmtAmount(amount.onRappen().toDouble(), minFractionDigits, maxFractionDigits)

/**
 * Amount for an input field: two decimal places in the app language's
 * decimal separator, without thousands grouping — that couldn't be told
 * apart from the decimal separator on save.
 */
fun fmtInput(v: Double): String {
    val nf = NumberFormat.getNumberInstance(appNumberLocale())
    nf.isGroupingUsed = false
    nf.minimumFractionDigits = 2
    nf.maximumFractionDigits = 2
    return nf.format(v)
}

fun fmtInput(amount: Money): String = fmtInput(amount.onRappen().toDouble())

/** Whole number with thousands grouping (piece counts, part counts). */
fun fmtInt(v: Int): String {
    val nf = NumberFormat.getNumberInstance(appNumberLocale())
    nf.maximumFractionDigits = 0
    return nf.format(v)
}

/**
 * Percentage with one decimal place and a sign as soon as it isn't zero —
 * one version for badges, chart and tiles. [percent] is the
 * value in percent (12.5 means 12.5 %). Where the sign sits and whether
 * with a space, the platform decides for the app language.
 */
fun fmtPercent(percent: Double): String {
    val nf = NumberFormat.getPercentInstance(appNumberLocale())
    nf.minimumFractionDigits = 1
    nf.maximumFractionDigits = 1
    // Round first: -0.04 would otherwise read "-0.0 %", a minus before a zero.
    val rounded = Math.round(percent * 10) / 10.0
    if (rounded == 0.0) return nf.format(0.0)
    val text = nf.format(rounded / 100.0)
    return if (rounded > 0) "+$text" else text
}

/** Does the device set the clock to 24 hours? Like the status bar, not by language. */
@Composable
fun twentyFourHours(): Boolean = DateFormat.is24HourFormat(LocalContext.current)
