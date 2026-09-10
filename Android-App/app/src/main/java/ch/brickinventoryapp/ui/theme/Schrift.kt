package ch.brickinventoryapp.ui.theme

import androidx.compose.ui.unit.sp

/**
 * Die Schriftgroessen-Skala der App.
 *
 * ── Warum es sie gibt ───────────────────────────────────────────────────────
 *
 * Dasselbe wie bei [Abstaende]: Die Groessen standen als blanke Zahlen in den
 * Bildschirmen. Gemessen waren es 119 Stellen mit 18 verschiedenen Werten —
 * 12 (24-mal), 13 (22-mal), 14 (13-mal), 8, 11, 10, 16, 18, 40 …
 *
 * Dass 12 und 13 fast gleich haeufig sind, ist der Befund: Zwei Groessen, die
 * sich um einen Punkt unterscheiden, sind nebeneinander nicht als Unterschied
 * lesbar — sie sind das Ergebnis von Einzelentscheidungen, nicht einer
 * Absicht.
 *
 * ── Was umgestellt wurde ────────────────────────────────────────────────────
 *
 * Nur die Stellen, die EXAKT auf die Skala fallen. 13, 11, 15, 17 und 18
 * bleiben als Zahl stehen: Sie auf 12 oder 14 zu ziehen waere eine sichtbare
 * Aenderung des Schriftbildes und gehoert nicht in einen Umbau, der nichts
 * verschieben soll. AbstandsskalaTest zaehlt sie mit.
 */
object Schrift {
    /** Fussnoten, Plaketten-Beschriftung. */
    val winzig = 10.sp

    /** Nebenangaben unter dem eigentlichen Text. */
    val klein = 12.sp

    /** Fliesstext. */
    val normal = 14.sp

    /** Hervorgehoben im Fliesstext. */
    val gross = 16.sp

    /** Ueberschrift eines Abschnitts. */
    val sehrGross = 20.sp

    /** Kennzahl, die allein steht. */
    val riesig = 24.sp
}
