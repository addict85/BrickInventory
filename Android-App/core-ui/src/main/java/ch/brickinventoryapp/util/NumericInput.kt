package ch.brickinventoryapp.util

import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType

/**
 * Zahlenfelder — eine Fassung für Tastatur und erlaubte Zeichen, für Setnummer,
 * Preise und Anzahlen.
 *
 * Beides gehört zusammen: Die Tastaturwahl ist eine Bitte an die Tastatur-App,
 * keine Zusicherung — viele zeigen trotzdem eine Umschalttaste zu Buchstaben, und
 * über die Zwischenablage kommt alles herein. Ohne Filter landete Text im Feld;
 * ohne Tastaturwahl müsste man jedes Mal zu den Zahlen wechseln. Die Aufrufer
 * nehmen immer das Paar.
 *
 * Der Bindestrich bei der Setnummer bleibt erlaubt: LEGO-Setnummern tragen eine
 * Variante hinter dem Strich (10179-2, 75192-1), ohne ihn liesse sich nur die
 * erste erfassen. Die App ergänzt „-1“ nur, wenn keine Variante angegeben ist; das
 * Zahlenpad zeigt den Strich praktisch überall mit an.
 */
object NumericInput {

    /** Setnummer: Ziffern und der Varianten-Bindestrich. */
    fun setNumber(eingabe: String): String =
        eingabe.filter { it.isDigit() || it == '-' }

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
