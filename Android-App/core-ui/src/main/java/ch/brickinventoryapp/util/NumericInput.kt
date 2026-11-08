package ch.brickinventoryapp.util

import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType

/**
 * Zahlenfelder — eine Fassung für Tastatur und erlaubte Zeichen, für Setnummer,
 * Preise und Anzahlen.
 * Ausführlich: docs/begruendungen/core-ui/util/NumericInput.kt.md#numericinput
 */
object NumericInput {

    /** Setnummer: Ziffern und der Varianten-Bindestrich. */
    fun setNumber(eingabe: String): String =
        eingabe.filter { it.isDigit() || it == '-' }

    // Dieselbe Regel wie istSetnummer() der Web-App: Der Filter oben lässt auch "-" oder "1--2" durch.
    private val setnummerMuster = Regex("""[A-Za-z]{0,12}\d{1,8}[A-Za-z0-9]{0,8}(-\d{1,3})?""")

    /** Ob [eingabe] wie eine Setnummer aussieht (z. B. 10294 oder 10294-1). */
    fun istSetnummer(eingabe: String): Boolean = setnummerMuster.matches(eingabe.trim())

    /** Menge: nur Ziffern. */
    fun quantity(eingabe: String): String =
        eingabe.filter { it.isDigit() }

    /**
     * Preis: Ziffern und EIN Dezimaltrennzeichen.
     *
     * Punkt und Komma sind beide erlaubt (deutsche Tastaturen liefern das
     * Komma), aber nur einmal — „12.3.4" wäre sonst tippbar und flöge erst beim
     * Umwandeln auf, dann als stiller Null-Preis.
     */
    fun price(eingabe: String): String {
        val sb = StringBuilder()
        var trennerGesetzt = false
        for (c in eingabe) {
            when {
                c.isDigit() -> sb.append(c)
                (c == '.' || c == ',') && !trennerGesetzt -> { sb.append(c); trennerGesetzt = true }
            }
        }
        return sb.toString()
    }

    /** Ganze Zahlen (Setnummer, Menge). */
    fun ganzzahlTastatur(imeAction: ImeAction = ImeAction.Next) =
        KeyboardOptions(keyboardType = KeyboardType.Number, imeAction = imeAction)

    /** Kommazahlen (Preise). */
    fun preisTastatur(imeAction: ImeAction = ImeAction.Done) =
        KeyboardOptions(keyboardType = KeyboardType.Decimal, imeAction = imeAction)
}
