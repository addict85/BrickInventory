package ch.brickinventoryapp.ui.util

import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.input.KeyboardType
import ch.brickinventoryapp.model.domain.Money
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
    fun setNumber(input: String): String =
        input.filter { it in '0'..'9' || it in 'a'..'z' || it in 'A'..'Z' || it == '-' }

    // Same rule as the web app's isSetNumber(): the filter above also lets "-" or "1--2" through.
    private val setNumberPattern = Regex("""[A-Za-z]{0,12}\d{1,8}[A-Za-z0-9]{0,8}(-\d{1,3})?""")

    /** Whether [input] looks like a set number (e.g. 10294 or 10294-1). */
    fun isSetNumber(input: String): Boolean = setNumberPattern.matches(input.trim())

    /** Quantity: digits only. */
    fun quantity(input: String): String =
        input.filter { it.isDigit() }

    /**
     * Price: digits and ONE decimal separator.
     *
     * Both period and comma are allowed (German keyboards produce the comma), but only
     * once — „12.3.4" would otherwise be typeable and only surface on conversion. Exception: a
     * pasted amount with thousands grouping ("1.299,00") is turned into a plain number
     * ("1299,00"); cutting at the second separator would have made it 1,299.
     */
    fun price(input: String, group: Char = groupSeparator()): String {
        val raw = input.filter { it.isDigit() || it == '.' || it == ',' }
        if (raw.count { it == '.' || it == ',' } > 1) {
            split(raw, group)?.let { (whole, decimal, after) -> return whole + (decimal?.toString() ?: "") + after }
        }
        val sb = StringBuilder()
        var separatorSet = false
        for (c in raw) {
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
    fun readAmount(raw: String, group: Char = groupSeparator()): Double? =
        split(raw, group)?.let { (whole, _, after) -> (whole.ifEmpty { "0" } + if (after.isEmpty()) "" else ".$after").toDouble() }

    /** Like [readAmount], as money without the detour through Double. */
    fun readMoney(raw: String, group: Char = groupSeparator()): Money? =
        split(raw, group)?.let { (whole, _, after) -> Money.fromText(whole.ifEmpty { "0" } + if (after.isEmpty()) "" else ".$after") }

    /** A price field may be empty (no price); whatever is in it must be an amount. */
    fun priceInvalid(text: String, group: Char = groupSeparator()): Boolean =
        text.isNotBlank() && readAmount(text, group) == null

    /** An empty quantity means one; whatever is in it must be a number from 1 up (not 0, not over Int). */
    fun quantityInvalid(text: String): Boolean = text.isNotEmpty() && (text.toIntOrNull() ?: 0) < 1

    private fun groupSeparator(): Char = DecimalFormatSymbols.getInstance(appNumberLocale()).groupingSeparator

    private val CURRENCY = setOf('€', '$', '£')
    private val AMOUNT_SHAPE = Regex("""[\d.,]*\d[\d.,]*""")
    private val THREE_DIGITS = Regex("""\d{3}""")
    private val FIRST_GROUP = Regex("""\d{1,3}""")

    /** (integer part without grouping, decimal separator or null, decimal places); null if it isn't an amount. */
    private fun split(raw: String, group: Char): Triple<String, Char?, String>? {
        val s = withoutCurrency(raw.filterNot { it.isWhitespace() || it == '\'' || it == '’' })
        if (!AMOUNT_SHAPE.matches(s)) return null
        val last = maxOf(s.lastIndexOf(','), s.lastIndexOf('.'))
        val decimal = decimalSeparator(s, last, group)
        val whole = if (decimal != null) s.substring(0, last) else s
        val after = if (decimal != null) s.substring(last + 1) else ""
        if (after.any { it == '.' || it == ',' } || (decimal != null && decimal in whole)) return null
        val groups = whole.split('.', ',')
        if (groups.size > 1 && !groupsValid(groups)) return null
        return Triple(groups.joinToString(""), decimal, after)
    }

    private fun withoutCurrency(s: String): String {
        val front = if (s.isNotEmpty() && s.first() in CURRENCY) s.drop(1) else s
        return if (front.isNotEmpty() && front.last() in CURRENCY) front.dropLast(1) else front
    }

    /** The last separator is the decimal mark, unless it occurs several times or is a group mark before three digits. */
    private fun decimalSeparator(s: String, last: Int, group: Char): Char? {
        val separator = s.filter { it == '.' || it == ',' }
        val multipleEqual = separator.toSet().size == 1 && separator.length > 1
        val asGroup = separator.length == 1 && separator[0] == group &&
            THREE_DIGITS.matches(s.substring(last + 1)) && !(s.startsWith("0.") || s.startsWith("0,"))
        return if (separator.isEmpty() || multipleEqual || asGroup) null else s[last]
    }

    private fun groupsValid(groups: List<String>): Boolean =
        FIRST_GROUP.matches(groups[0]) && groups.drop(1).all { THREE_DIGITS.matches(it) }

    /** Set number: letters occur, so the text keyboard, without capitalization and correction. */
    fun setNumberKeyboard(imeAction: ImeAction = ImeAction.Next) =
        KeyboardOptions(
            capitalization = KeyboardCapitalization.None, autoCorrectEnabled = false,
            keyboardType = KeyboardType.Ascii, imeAction = imeAction,
        )

    /** Ganze Zahlen (Menge). */
    fun integerKeyboard(imeAction: ImeAction = ImeAction.Next) =
        KeyboardOptions(keyboardType = KeyboardType.Number, imeAction = imeAction)

    /** Kommazahlen (Preise). */
    fun priceKeyboard(imeAction: ImeAction = ImeAction.Done) =
        KeyboardOptions(keyboardType = KeyboardType.Decimal, imeAction = imeAction)
}
