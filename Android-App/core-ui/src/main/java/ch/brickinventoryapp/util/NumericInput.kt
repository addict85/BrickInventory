package ch.brickinventoryapp.util

import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.input.KeyboardType

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
