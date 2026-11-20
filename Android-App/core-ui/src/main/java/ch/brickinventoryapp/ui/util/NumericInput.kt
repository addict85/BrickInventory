package ch.brickinventoryapp.ui.util

import ch.brickinventoryapp.model.domain.Geld
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.input.KeyboardType
import java.text.DecimalFormatSymbols

/**
 * Zahlenfelder — eine Fassung für Tastatur und erlaubte Zeichen, für Setnummer,
 * Preise und Anzahlen.
 * Tastaturwahl und Zeichenfilter gehören zusammen: Die Tastatur ist nur eine Bitte, über
 * Zwischenablage oder Hardwaretastatur kommt trotzdem Text.
 */
object NumericInput {

    /**
     * Setnummer: ASCII-Buchstaben, Ziffern und der Varianten-Bindestrich — dieselben Zeichen
     * wie normalisiereSetNummer der Web-App. Nummern wie „llca30" oder „comcon001" sind echt;
     * ein reiner Ziffernfilter machte sie hier unerfassbar.
     */
    fun setNumber(eingabe: String): String =
        eingabe.filter { it in '0'..'9' || it in 'a'..'z' || it in 'A'..'Z' || it == '-' }

    // Dieselbe Regel wie isSetNumber() der Web-App: Der Filter oben lässt auch "-" oder "1--2" durch.
    private val setNumberPattern = Regex("""[A-Za-z]{0,12}\d{1,8}[A-Za-z0-9]{0,8}(-\d{1,3})?""")

    /** Ob [eingabe] wie eine Setnummer aussieht (z. B. 10294 oder 10294-1). */
    fun isSetNumber(eingabe: String): Boolean = setNumberPattern.matches(eingabe.trim())

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
            zerlege(roh, gruppe)?.let { (ganz, decimal, nach) -> return ganz + (decimal?.toString() ?: "") + nach }
        }
        val sb = StringBuilder()
        var separatorSet = false
        for (c in roh) {
            when {
                c.isDigit() -> sb.append(c)
                !separatorSet -> { sb.append(c); separatorSet = true }
            }
        }
        return sb.toString()
    }

    /**
     * Ein Betrag, gelesen wie readAmount der Web-App: „1.299,00" und „1,299.50" sind 1299
     * bzw. 1299,5, „149,95" ist 149,95. Ein einzelner Trenner vor genau drei Ziffern ist
     * Tausender nur, wenn er das Gruppenzeichen der App-Sprache ist. `null` bei leerer
     * oder unlesbarer Eingabe.
     */
    fun readAmount(roh: String, gruppe: Char = gruppenzeichen()): Double? =
        zerlege(roh, gruppe)?.let { (ganz, _, nach) -> (ganz.ifEmpty { "0" } + if (nach.isEmpty()) "" else ".$nach").toDouble() }

    /** Wie [readAmount], als Geld ohne Umweg über Double. */
    fun readMoney(roh: String, gruppe: Char = gruppenzeichen()): Geld? =
        zerlege(roh, gruppe)?.let { (ganz, _, nach) -> Geld.fromText(ganz.ifEmpty { "0" } + if (nach.isEmpty()) "" else ".$nach") }

    /** Ein Preisfeld darf leer sein (kein Preis); was drinsteht, muss ein Betrag sein. */
    fun priceInvalid(text: String, gruppe: Char = gruppenzeichen()): Boolean =
        text.isNotBlank() && readAmount(text, gruppe) == null

    /** Eine leere Menge heisst eins; was drinsteht, muss eine Zahl ab 1 sein (nicht 0, nicht über Int). */
    fun quantityInvalid(text: String): Boolean = text.isNotEmpty() && (text.toIntOrNull() ?: 0) < 1

    private fun gruppenzeichen(): Char = DecimalFormatSymbols.getInstance(appNumberLocale()).groupingSeparator

    private val CURRENCY = setOf('€', '$', '£')
    private val BETRAGSFORM = Regex("""[\d.,]*\d[\d.,]*""")
    private val THREE_DIGITS = Regex("""\d{3}""")
    private val FIRST_GROUP = Regex("""\d{1,3}""")

    /** (ganzer Teil ohne Gruppen, Dezimalzeichen oder null, Nachkommastellen); null, wenn es kein Betrag ist. */
    private fun zerlege(roh: String, gruppe: Char): Triple<String, Char?, String>? {
        val s = withoutCurrency(roh.filterNot { it.isWhitespace() || it == '\'' || it == '’' })
        if (!BETRAGSFORM.matches(s)) return null
        val letztes = maxOf(s.lastIndexOf(','), s.lastIndexOf('.'))
        val decimal = decimalSeparator(s, letztes, gruppe)
        val ganz = if (decimal != null) s.substring(0, letztes) else s
        val nach = if (decimal != null) s.substring(letztes + 1) else ""
        if (nach.any { it == '.' || it == ',' } || (decimal != null && decimal in ganz)) return null
        val groups = ganz.split('.', ',')
        if (groups.size > 1 && !groupsValid(groups)) return null
        return Triple(groups.joinToString(""), decimal, nach)
    }

    private fun withoutCurrency(s: String): String {
        val vorn = if (s.isNotEmpty() && s.first() in CURRENCY) s.drop(1) else s
        return if (vorn.isNotEmpty() && vorn.last() in CURRENCY) vorn.dropLast(1) else vorn
    }

    /** Das letzte Trennzeichen ist das Dezimalzeichen, ausser es steht mehrfach oder ist ein Gruppenzeichen vor drei Ziffern. */
    private fun decimalSeparator(s: String, letztes: Int, gruppe: Char): Char? {
        val separator = s.filter { it == '.' || it == ',' }
        val multipleEqual = separator.toSet().size == 1 && separator.length > 1
        val asGroup = separator.length == 1 && separator[0] == gruppe &&
            THREE_DIGITS.matches(s.substring(letztes + 1)) && !(s.startsWith("0.") || s.startsWith("0,"))
        return if (separator.isEmpty() || multipleEqual || asGroup) null else s[letztes]
    }

    private fun groupsValid(groups: List<String>): Boolean =
        FIRST_GROUP.matches(groups[0]) && groups.drop(1).all { THREE_DIGITS.matches(it) }

    /** Setnummer: Buchstaben kommen vor, also die Texttastatur, ohne Grossschreibung und Korrektur. */
    fun setNumberKeyboard(imeAction: ImeAction = ImeAction.Next) =
        KeyboardOptions(
            capitalization = KeyboardCapitalization.None, autoCorrectEnabled = false,
            keyboardType = KeyboardType.Ascii, imeAction = imeAction,
        )

    /** Ganze Zahlen (Menge). */
    fun ganzzahlTastatur(imeAction: ImeAction = ImeAction.Next) =
        KeyboardOptions(keyboardType = KeyboardType.Number, imeAction = imeAction)

    /** Kommazahlen (Preise). */
    fun priceKeyboard(imeAction: ImeAction = ImeAction.Done) =
        KeyboardOptions(keyboardType = KeyboardType.Decimal, imeAction = imeAction)
}
