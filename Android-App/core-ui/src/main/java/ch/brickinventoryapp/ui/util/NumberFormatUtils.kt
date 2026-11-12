package ch.brickinventoryapp.ui.util

import ch.brickinventoryapp.model.fach.Waehrung
import androidx.appcompat.app.AppCompatDelegate
import android.text.format.DateFormat
import androidx.compose.runtime.Composable
import androidx.compose.ui.platform.LocalContext
import java.text.NumberFormat
import java.util.Currency
import java.util.Locale
import ch.brickinventoryapp.model.util.DatumJahr
import ch.brickinventoryapp.model.util.fmtDatum
import ch.brickinventoryapp.model.util.zahlenLocale

/*
 * Zahlen und Beträge — eine Fassung für die ganze App, gleichgezogen mit der
 * Webapp (locale() in public/i18n.js), damit derselbe Betrag überall gleich
 * aussieht. Beträge laufen über die Währungs-Formatierung der Plattform: Die
 * Stellung von Symbol und Betrag trifft man von Hand nicht.
 */

/**
 * Zahlen-Locale zur eingestellten APP-Sprache (AppCompat, dieselbe Quelle wie
 * LanguageManager), das Land vom Gerät. Ohne App-Sprache gilt die des Geräts.
 */
fun appNumberLocale(): Locale {
    val geraet = Locale.getDefault()
    // Im JVM-Test gibt es keinen AppCompat-Zustand; dann gilt das Gerät.
    val app = try {
        AppCompatDelegate.getApplicationLocales().let { if (it.isEmpty) null else it[0] }
    } catch (_: Throwable) { null }
    return zahlenLocale(app ?: geraet, geraet)
}

/**
 * Betrag MIT Währung — das Gegenstück zu fmtN() in public/js/01-core.js.
 *
 * @param currencyCode ISO-Code aus der Server-Antwort (CHF, EUR, …). Ein
 *        unbekannter Code darf die Anzeige nicht sprengen: dann steht der Code
 *        vor dem Betrag, wie es die Webapp bei fehlender Zuordnung auch tut.
 */
fun fmtMoney(amount: Double, currencyCode: Waehrung?): String {
    val loc = appNumberLocale()
    return try {
        val nf = NumberFormat.getCurrencyInstance(loc)
        nf.currency = Currency.getInstance((currencyCode ?: Waehrung.EUR).code)
        nf.minimumFractionDigits = 2
        nf.maximumFractionDigits = 2
        mitWaehrungsAbstand(nf.format(amount))
    } catch (_: Exception) {
        "${currencyCode?.code.orEmpty()}\u00A0${fmtAmount(amount)}".trim()
    }
}

/** Ganzer Betrag mit Währung („CHF 1'720“) — für Diagrammachsen, wie sie der Server liefert. */
fun fmtMoneyGanz(amount: Double, currencyCode: Waehrung?): String = try {
    val nf = NumberFormat.getCurrencyInstance(appNumberLocale())
    nf.currency = Currency.getInstance((currencyCode ?: Waehrung.EUR).code)
    nf.minimumFractionDigits = 0
    nf.maximumFractionDigits = 0
    mitWaehrungsAbstand(nf.format(amount))
} catch (_: IllegalArgumentException) {
    "${currencyCode?.code.orEmpty()}\u00A0${fmtAmount(amount, 0, 0)}".trim()
}

/**
 * Ein Code aus Buchstaben („CHF“) klebt in en-GB am Betrag („CHF812.50“), Intl im
 * Web schreibt „CHF 812.50“. Ein festes Leerzeichen dazwischen, damit beide gleich
 * aussehen und die Zeile nicht zwischen Code und Zahl umbricht. Symbole wie € bleiben.
 */
fun mitWaehrungsAbstand(text: String): String =
    text.replace(Regex("""(?<=\p{L})(?=[-−]?\d)|(?<=\d)(?=\p{L})"""), "\u00A0")

/** Ein Tag aus der Serverantwort in der Form der App-Sprache — siehe fmtDatum. */
fun fmtTag(iso: String?, jahr: DatumJahr = DatumJahr.VOLL): String? = fmtDatum(iso, appNumberLocale(), jahr)

/** Wie fmtMoney, aber aus dem String der API — `null`/unlesbar ergibt „—". */
fun fmtMoneyOrDash(amount: String?, currencyCode: Waehrung?): String {
    val v = amount?.toDoubleOrNull() ?: return "—"
    return fmtMoney(v, currencyCode)
}

/** Betrag OHNE Währung — für Stellen, an denen die Währung schon danebensteht. */
fun fmtAmount(v: Double, minFractionDigits: Int = 2, maxFractionDigits: Int = 2): String {
    val nf = NumberFormat.getNumberInstance(appNumberLocale())
    nf.minimumFractionDigits = minFractionDigits
    nf.maximumFractionDigits = maxFractionDigits
    return nf.format(v)
}

/**
 * Betrag für ein Eingabefeld: zwei Nachkommastellen im Dezimalzeichen der
 * App-Sprache, ohne Tausendertrennung — die liesse sich beim Speichern nicht
 * vom Dezimalzeichen unterscheiden.
 */
fun fmtEingabe(v: Double): String {
    val nf = NumberFormat.getNumberInstance(appNumberLocale())
    nf.isGroupingUsed = false
    nf.minimumFractionDigits = 2
    nf.maximumFractionDigits = 2
    return nf.format(v)
}

/** Ganze Zahl mit Tausendertrennung (Stückzahlen, Teilezahlen). */
fun fmtInt(v: Int): String {
    val nf = NumberFormat.getNumberInstance(appNumberLocale())
    nf.maximumFractionDigits = 0
    return nf.format(v)
}

/**
 * Prozentzahl mit einer Nachkommastelle und Vorzeichen, sobald sie nicht null
 * ist — eine Fassung für Plaketten, Diagramm und Kacheln. [prozent] ist der
 * Wert in Prozent (12.5 heisst 12,5 %). Wo das Zeichen steht und ob mit
 * Abstand, entscheidet die Plattform für die App-Sprache.
 */
fun fmtProzent(prozent: Double): String {
    val nf = NumberFormat.getPercentInstance(appNumberLocale())
    nf.minimumFractionDigits = 1
    nf.maximumFractionDigits = 1
    // Erst runden: -0.04 hiesse sonst „-0.0 %“, ein Minus vor einer Null.
    val gerundet = Math.round(prozent * 10) / 10.0
    if (gerundet == 0.0) return nf.format(0.0)
    val text = nf.format(gerundet / 100.0)
    return if (gerundet > 0) "+$text" else text
}

/** Stellt das Gerät die Uhr auf 24 Stunden? Wie die Statusleiste, nicht nach der Sprache. */
@Composable
fun vierundzwanzigStunden(): Boolean = DateFormat.is24HourFormat(LocalContext.current)
