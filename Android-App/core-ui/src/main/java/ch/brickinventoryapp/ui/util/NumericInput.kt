package ch.brickinventoryapp.ui.util

import ch.brickinventoryapp.model.domain.Geld
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.input.KeyboardType
import java.text.DecimalFormatSymbols

/**
 * Number fields — one version for keyboard and allowed characters, for set number,
 * prices and quantities.
 * Keyboard choice and character filter belong together: the keyboard is only a request, text
 * still comes in via clipboard or hardware keyboard regardless.
 */
object NumericInput {

    /**
     * Set number: ASCII letters, digits and the variant hyphen — the same characters
     * as the web app's normalizeSetNumber. Numbers like „llca30" or „comcon001" are real;
     * a plain digit filter would make them unenterable here.
     */
    fun setNumber(eingabe: String): String =
        eingabe.filter { it in '0'..'9' || it in 'a'..'z' || it in 'A'..'Z' || it == '-' }

    // Same rule as the web app's isSetNumber(): the filter above also lets "-" or "1--2" through.
    private val setNumberPattern = Regex("""[A-Za-z]{0,12}\d{1,8}[A-Za-z0-9]{0,8}(-\d{1,3})?""")

    /** Whether [eingabe] looks like a set number (e.g. 10294 or 10294-1). */
    fun isSetNumber(eingabe: String): Boolean = setNumberPattern.matches(eingabe.trim())

    /** Quantity: digits only. */
    fun quantity(eingabe: String): String =
        eingabe.filter { it.isDigit() }

    /**
     * Price: digits and ONE decimal separator.
     *
     * Both period and comma are allowed (German keyboards produce the comma), but only
     * once — „12.3.4" would otherwise be typeable and only surface on conversion. Exception: a
     * pasted amount with thousands grouping ("1.299,00") is turned into a plain number
     * ("1299,00"); cutting at the second separator would have made it 1,299.
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
     * An amount, read like the web app's readAmount: "1.299,00" and "1,299.50" are 1299
     * resp. 1299.5, "149,95" is 149.95. A single separator before exactly three digits is
     * a thousands separator only if it is the app language's grouping character. `null` for
     * empty or unreadable input.
     */
    fun readAmount(roh: String, gruppe: Char = gruppenzeichen()): Double? =
        zerlege(roh, gruppe)?.let { (ganz, _, nach) -> (ganz.ifEmpty { "0" } + if (nach.isEmpty()) "" else ".$nach").toDouble() }

    /** Like [readAmount], as money without the detour through Double. */
    fun readMoney(roh: String, gruppe: Char = gruppenzeichen()): Geld? =
        zerlege(roh, gruppe)?.let { (ganz, _, nach) -> Geld.fromText(ganz.ifEmpty { "0" } + if (nach.isEmpty()) "" else ".$nach") }

    /** A price field may be empty (no price); whatever is in it must be an amount. */
    fun priceInvalid(text: String, gruppe: Char = gruppenzeichen()): Boolean =
        text.isNotBlank() && readAmount(text, gruppe) == null

    /** An empty quantity means one; whatever is in it must be a number from 1 up (not 0, not over Int). */
    fun quantityInvalid(text: String): Boolean = text.isNotEmpty() && (text.toIntOrNull() ?: 0) < 1

    private fun gruppenzeichen(): Char = DecimalFormatSymbols.getInstance(appNumberLocale()).groupingSeparator

    private val CURRENCY = setOf('€', '$', '£')
    private val BETRAGSFORM = Regex("""[\d.,]*\d[\d.,]*""")
    private val THREE_DIGITS = Regex("""\d{3}""")
    private val FIRST_GROUP = Regex("""\d{1,3}""")

    /** (integer part without grouping, decimal separator or null, decimal places); null if it isn't an amount. */
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
