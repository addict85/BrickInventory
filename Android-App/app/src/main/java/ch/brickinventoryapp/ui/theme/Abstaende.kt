package ch.brickinventoryapp.ui.theme

import androidx.compose.ui.unit.dp

/**
 * Die Abstandsskala der App — damit Abstände einen Namen haben statt als blanke
 * Zahlen in den Bildschirmen zu stehen, wie die CSS-Klassen der Webapp.
 *
 * Die Skala ist die übliche (Zweierschritt unten, Viererschritt oben). Die
 * Abstände im Baum bilden ein 2-dp-Kontinuum; 6, 10 und 14 einzeln zu benennen
 * wäre eine Umbenennung, keine Skala. Die Stellen, die nicht auf die Skala fallen,
 * stehen weiter als Zahl da: Sie zu verschieben ist eine Gestaltungsentscheidung
 * für den, der die App vor sich sieht. AbstandsskalaTest zählt sie und lässt die
 * Zahl nur sinken.
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
     * Der Seitenrand der Bildschirme — 14 dp. Kein Abstand zwischen Dingen, sondern
     * der Rand, an dem eine Seite beginnt; er steht vielfach im Baum
     * (ScopeFilterZeile, Suchfeld, Chip-Zeilen), und ihn auf 16 zu ziehen wäre eine
     * Gestaltungsänderung an all diesen Stellen. Der Name lässt neue Bildschirme sich
     * an demselben Wert ausrichten, ohne eine blanke 14 zu schreiben, die
     * AbstandsskalaTest zählt — und wandert der Rand einmal, dann an einer Stelle.
     */
    val rand = 14.dp
}
