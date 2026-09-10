package ch.brickinventoryapp.ui.theme

import androidx.compose.ui.unit.dp

/**
 * Die Abstandsskala der App.
 *
 * ── Warum es sie gibt ───────────────────────────────────────────────────────
 *
 * Marcos Vorgabe fuer beide Oberflaechen: „saubere Architektur, clean Code,
 * saubere Strukturen und in den UIs einheitliche Ansichten." Die Webapp hat
 * ihre Abstaende in CSS-Klassen; die App hatte sie ueberhaupt nicht — sie
 * standen als blanke Zahlen in den Bildschirmen.
 *
 * ── Was gemessen wurde, bevor die Skala festgelegt wurde ────────────────────
 *
 * NICHT erfunden, sondern aus dem Baum gelesen. An den echten Abstandsstellen
 * (padding, Arrangement.spacedBy, Spacer) standen 479 Werte, verteilt so:
 *
 *     8 (106) · 6 (60) · 12 (54) · 4 (51) · 16 (44) · 10 (41) · 2 (28) ·
 *     14 (26) · 3 (12) · 24 (12) · 1 (9) · 5 (8) · 20 (7) · 32 (5) · …
 *
 * Das ist kein 4er- oder 8er-Raster, sondern ein 2-dp-Kontinuum: Jede gerade
 * Zahl von 2 bis 16 kommt haeufig vor. Eine „Skala", die 6, 10 und 14 einzeln
 * benennt, waere keine Skala, sondern eine Umbenennung — `Abstaende.ml` sagt
 * weniger als `10.dp`.
 *
 * Die Skala unten ist deshalb die UEBLICHE (Zweierschritt unten, Viererschritt
 * oben). 304 der 479 Stellen fallen exakt darauf und wurden umgestellt, ohne
 * dass sich etwas verschiebt.
 *
 * ── Was mit den uebrigen 175 ist ────────────────────────────────────────────
 *
 * Sie stehen weiterhin als Zahl da — allen voran 6 (60-mal), 10 (41-mal) und
 * 14 (26-mal). Sie auf die Skala zu ziehen waere eine GESTALTUNGSaenderung:
 * Jede dieser Stellen verschoebe sich sichtbar um ein bis zwei Punkte. Das ist
 * eine Entscheidung fuer den, der die App vor sich sieht, nicht fuer den, der
 * den Quelltext umschreibt.
 *
 * AbstandsskalaTest zaehlt sie und laesst die Zahl nur SINKEN. Damit sind sie
 * sichtbar, statt unsichtbar zu bleiben, und der naechste Schritt ist eine
 * bewusste Entscheidung statt eines Versehens.
 */
object Abstaende {
    /** Haarfein — Trennlinien, dicht gesetzte Plaketten. */
    val haar = 2.dp

    /** Der kleinste Abstand, der als Abstand gelesen wird. */
    val winzig = 4.dp

    /** Der haeufigste Abstand der App: zwischen Geschwistern in einer Reihe. */
    val klein = 8.dp

    /** Zwischen Gruppen innerhalb einer Karte. */
    val mittel = 12.dp

    /** Der Innenabstand einer Karte, der Rand einer Liste. */
    val gross = 16.dp

    /** Zwischen Abschnitten eines Bildschirms. */
    val sehrGross = 24.dp

    /** Vor und nach dem, was allein stehen soll. */
    val riesig = 32.dp
}
