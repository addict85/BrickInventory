package ch.brickinventoryapp.util

import androidx.appcompat.app.AppCompatDelegate
import java.text.NumberFormat
import java.util.Currency
import java.util.Locale

/*
 * Zahlen und Beträge — eine Fassung für die ganze App, gleichgezogen mit der
 * Webapp (locale() in public/i18n.js), damit derselbe Betrag überall gleich
 * aussieht. Beträge laufen über die Währungs-Formatierung der Plattform: Die
 * Stellung von Symbol und Betrag trifft man von Hand nicht.
 */

/**
 * Wie das Web: die Landesform des Geräts, wenn sie zur App-Sprache passt
 * (de-DE schreibt 4.894,77, de-CH 4’894.77), sonst de-CH bzw. en-GB.
 */
fun zahlenLocale(sprache: Locale, geraet: Locale): Locale {
    val ziel = if (sprache.language == "de") "de" else "en"
    val land = sprache.country.takeIf { sprache.language == ziel && it.length == 2 }
        ?: geraet.country.takeIf { geraet.language == ziel && it.length == 2 }
    return Locale.forLanguageTag(if (land != null) "$ziel-$land" else if (ziel == "de") "de-CH" else "en-GB")
}

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
fun fmtMoney(amount: Double, currencyCode: String?): String {
    val loc = appNumberLocale()
    return try {
        val nf = NumberFormat.getCurrencyInstance(loc)
        nf.currency = Currency.getInstance(currencyCode ?: "EUR")
        nf.minimumFractionDigits = 2
        nf.maximumFractionDigits = 2
        nf.format(amount)
    } catch (_: Exception) {
        "${currencyCode.orEmpty()} ${fmtAmount(amount)}".trim()
    }
}

/** Wie fmtMoney, aber aus dem String der API — `null`/unlesbar ergibt „—". */
fun fmtMoneyOrDash(amount: String?, currencyCode: String?): String {
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
