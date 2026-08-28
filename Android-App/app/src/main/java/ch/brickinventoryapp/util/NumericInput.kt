package ch.brickinventoryapp.util

import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType

/**
 * Zahlenfelder — eine Fassung für Tastatur UND erlaubte Zeichen.
 *
 * ── Marcos Wunsch ───────────────────────────────────────────────────────────
 * „Die Felder mit der Setnummer (beim Erfassen) sollen nur Zahlen erlauben, und
 * wenn darin geklickt wird, soll nur das Zahlenpad angezeigt werden. Bei allen
 * Preis- und Anzahlfeldern ebenfalls."
 *
 * ── Warum beides zusammengehört ─────────────────────────────────────────────
 * Die Tastaturwahl ist eine BITTE an die Tastatur-App, keine Zusicherung: Viele
 * Tastaturen zeigen auf `Number` trotzdem eine Umschalttaste zu Buchstaben, und
 * über Einfügen aus der Zwischenablage kommt ohnehin alles herein. Ohne Filter
 * landete dann Text im Feld; ohne Tastaturwahl müsste man auf dem Telefon jedes
 * Mal erst zu den Zahlen wechseln. Beides steht deshalb hier nebeneinander, und
 * die Aufrufer nehmen immer das Paar.
 *
 * ── Der Bindestrich bei der Setnummer ───────────────────────────────────────
 * „Nur Zahlen" heisst hier: keine BUCHSTABEN. Der Bindestrich bleibt erlaubt,
 * und zwar aus einem sachlichen Grund — LEGO-Setnummern tragen eine Variante
 * hinter dem Strich (10179-2, 75192-1). Verböte das Feld ihn, liesse sich jede
 * Variante ausser der ersten gar nicht mehr erfassen; die App ergänzt beim
 * Erfassen nur „-1", wenn keine Variante angegeben ist. Das Zahlenpad zeigt den
 * Strich auf praktisch allen Tastaturen mit an.
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
