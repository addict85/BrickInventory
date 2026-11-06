package ch.brickinventoryapp.ui.theme

import androidx.compose.ui.unit.dp

/**
 * Die Abstandsskala der App — damit Abstände einen Namen haben statt als blanke
 * Zahlen in den Bildschirmen zu stehen, wie die CSS-Klassen der Webapp.
 * Ausführlich: docs/begruendungen/core-ui/ui/theme/Abstaende.kt.md#abstaende
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

    /**
     * Der Seitenrand der Bildschirme — 14 dp. Kein Abstand zwischen Dingen, sondern der Rand,
     * an dem eine Seite beginnt; er steht vielfach im Baum (ScopeFilterZeile, Suchfeld,
     * Chip-Zeilen), und ihn auf 16 zu ziehen wäre eine Gestaltungsänderung an all diesen
     * Stellen.
     * Ausführlich: docs/begruendungen/core-ui/ui/theme/Abstaende.kt.md#rand
     */
    val rand = 14.dp
}
