package ch.brickinventoryapp.util

import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.input.KeyboardType
import java.text.DecimalFormatSymbols

/**
 * Zahlenfelder — eine Fassung für Tastatur und erlaubte Zeichen, für Setnummer,
 * Preise und Anzahlen.
 * Ausführlich: docs/begruendungen/core-ui/util/NumericInput.kt.md#numericinput
 */
object NumericInput {

    /**
     * Setnummer: ASCII-Buchstaben, Ziffern und der Varianten-Bindestrich — dieselben Zeichen
     * wie normalisiereSetNummer der Web-App. Nummern wie „llca30" oder „comcon001" sind echt;
     * ein reiner Ziffernfilter machte sie hier unerfassbar.
     */
    fun setNumber(eingabe: String): String =
        eingabe.filter { it in '0'..'9' || it in 'a'..'z' || it in 'A'..'Z' || it == '-' }

    /** Menge: nur Ziffern. */
    fun quantity(eingabe: String): String =
        eingabe.filter { it.isDigit() }

    /**
     * Preis: Ziffern und EIN Dezimaltrennzeichen.
     *
     * Punkt und Komma sind beide erlaubt (deutsche Tastaturen liefern das Komma), aber nur
     * einmal — „12.3.4" wäre sonst tippbar und flöge erst beim Umwandeln auf. Ausnahme: Ein
     * eingefügter Betrag mit Tausendertrennung („1.299,00") wird zur schlichten Zahl
     * („1299,00"); das Abschneiden am zweiten Trenner machte daraus 1,299.
     */
    fun price(eingabe: String, gruppe: Char = gruppenzeichen()): String {
        val roh = eingabe.filter { it.isDigit() || it == '.' || it == ',' }
        if (roh.count { it == '.' || it == ',' } > 1) {
            zerlege(roh, gruppe)?.let { (ganz, dezimal, nach) -> return ganz + (dezimal?.toString() ?: "") + nach }
        }
        val sb = StringBuilder()
        var trennerGesetzt = false
        for (c in roh) {
            when {
                c.isDigit() -> sb.append(c)
                !trennerGesetzt -> { sb.append(c); trennerGesetzt = true }
            }
        }
        return sb.toString()
    }

    /**
     * Ein Betrag, gelesen wie leseBetrag der Web-App: „1.299,00" und „1,299.50" sind 1299
     * bzw. 1299,5, „149,95" ist 149,95. Ein einzelner Trenner vor genau drei Ziffern ist
     * Tausender nur, wenn er das Gruppenzeichen der App-Sprache ist. `null` bei leerer
     * oder unlesbarer Eingabe.
     */
    fun leseBetrag(roh: String, gruppe: Char = gruppenzeichen()): Double? =
        zerlege(roh, gruppe)?.let { (ganz, _, nach) -> (ganz.ifEmpty { "0" } + if (nach.isEmpty()) "" else ".$nach").toDouble() }

    /** Ein Preisfeld darf leer sein (kein Preis); was drinsteht, muss ein Betrag sein. */
    fun preisUngueltig(text: String, gruppe: Char = gruppenzeichen()): Boolean =
        text.isNotBlank() && leseBetrag(text, gruppe) == null

    /** Eine leere Menge heisst eins; was drinsteht, muss eine Zahl ab 1 sein (nicht 0, nicht über Int). */
    fun mengeUngueltig(text: String): Boolean = text.isNotEmpty() && (text.toIntOrNull() ?: 0) < 1

    private fun gruppenzeichen(): Char = DecimalFormatSymbols.getInstance(appNumberLocale()).groupingSeparator

    private val WAEHRUNG = setOf('€', '$', '£')
    private val BETRAGSFORM = Regex("""[\d.,]*\d[\d.,]*""")
    private val DREI_ZIFFERN = Regex("""\d{3}""")
    private val ERSTE_GRUPPE = Regex("""\d{1,3}""")

    /** (ganzer Teil ohne Gruppen, Dezimalzeichen oder null, Nachkommastellen); null, wenn es kein Betrag ist. */
    private fun zerlege(roh: String, gruppe: Char): Triple<String, Char?, String>? {
        val s = ohneWaehrung(roh.filterNot { it.isWhitespace() || it == '\'' || it == '’' })
        if (!BETRAGSFORM.matches(s)) return null
        val letztes = maxOf(s.lastIndexOf(','), s.lastIndexOf('.'))
        val dezimal = dezimalzeichen(s, letztes, gruppe)
        val ganz = if (dezimal != null) s.substring(0, letztes) else s
        val nach = if (dezimal != null) s.substring(letztes + 1) else ""
        if (nach.any { it == '.' || it == ',' } || (dezimal != null && dezimal in ganz)) return null
        val gruppen = ganz.split('.', ',')
        if (gruppen.size > 1 && !gruppenGueltig(gruppen)) return null
        return Triple(gruppen.joinToString(""), dezimal, nach)
    }

    private fun ohneWaehrung(s: String): String {
        val vorn = if (s.isNotEmpty() && s.first() in WAEHRUNG) s.drop(1) else s
        return if (vorn.isNotEmpty() && vorn.last() in WAEHRUNG) vorn.dropLast(1) else vorn
    }

    /** Das letzte Trennzeichen ist das Dezimalzeichen, ausser es steht mehrfach oder ist ein Gruppenzeichen vor drei Ziffern. */
    private fun dezimalzeichen(s: String, letztes: Int, gruppe: Char): Char? {
        val trenner = s.filter { it == '.' || it == ',' }
        val mehrfachGleich = trenner.toSet().size == 1 && trenner.length > 1
        val alsGruppe = trenner.length == 1 && trenner[0] == gruppe &&
            DREI_ZIFFERN.matches(s.substring(letztes + 1)) && !(s.startsWith("0.") || s.startsWith("0,"))
        return if (trenner.isEmpty() || mehrfachGleich || alsGruppe) null else s[letztes]
    }

    private fun gruppenGueltig(gruppen: List<String>): Boolean =
        ERSTE_GRUPPE.matches(gruppen[0]) && gruppen.drop(1).all { DREI_ZIFFERN.matches(it) }

    /** Setnummer: Buchstaben kommen vor, also die Texttastatur, ohne Grossschreibung und Korrektur. */
    fun setnummerTastatur(imeAction: ImeAction = ImeAction.Next) =
        KeyboardOptions(
            capitalization = KeyboardCapitalization.None, autoCorrectEnabled = false,
            keyboardType = KeyboardType.Ascii, imeAction = imeAction,
        )

    /** Ganze Zahlen (Menge). */
    fun ganzzahlTastatur(imeAction: ImeAction = ImeAction.Next) =
        KeyboardOptions(keyboardType = KeyboardType.Number, imeAction = imeAction)

    /** Kommazahlen (Preise). */
    fun preisTastatur(imeAction: ImeAction = ImeAction.Done) =
        KeyboardOptions(keyboardType = KeyboardType.Decimal, imeAction = imeAction)
}
