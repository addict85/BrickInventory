package ch.brickinventoryapp.ui

import ch.brickinventoryapp.data.model.JahrAnzahl
import kotlin.math.roundToInt

/**
 * Reine Mathematik der Jahres-Leiste (CatalogScreen) — ein eigenes Objekt, damit
 * sie ohne Compose in JUnit prüfbar ist (CatalogYearMathTest).
 *
 * Die Leiste hängt an der Position, nicht linear am Jahr: Der grösste Teil des
 * Katalogs stammt aus den letzten Jahrzehnten, wer neun Zehntel hinunterzieht, ist
 * noch lange nicht bei den Sechzigern — ein lineares Modell zeigte neben geladenen
 * Sets von 1999 die Zahl 1965. Gerechnet wird über die tatsächliche Verteilung,
 * Schritt für Schritt wie in der Webapp (js/09-catalog.js → _jahrAnPosition),
 * damit beide an derselben Stelle dasselbe Jahr zeigen. Die Verteilung kommt vom
 * Server, weil nur der die Filter kennt.
 */
object CatalogYearMath {

    /**
     * Anteil (0..1) an der Leiste zu einer Berührung bei y Pixeln. Wie in der Webapp
     * (js/15-scrollbar.js → rollen): Der Griff liegt mittig unter dem Finger,
     * umgerechnet wird auf die Spur ohne Griffhöhe.
     */
    fun anteilAus(y: Float, heightPx: Int, thumbHeightPx: Int): Float {
        val spur = (heightPx - thumbHeightPx).coerceAtLeast(1)
        return ((y - thumbHeightPx / 2f) / spur).coerceIn(0f, 1f)
    }

    /** Vertikaler Offset (Pixel) der Griff-Oberkante zu einem Anteil. */
    fun daumenOffset(anteil: Float, heightPx: Int, thumbHeightPx: Int): Int =
        (anteil.coerceIn(0f, 1f) * (heightPx - thumbHeightPx).coerceAtLeast(0)).roundToInt()

    /** Laufende Nummer im Gesamtergebnis zu einem Anteil. */
    fun nummerAus(anteil: Float, total: Int): Int {
        if (total <= 0) return 0
        return (anteil.coerceIn(0f, 1f) * (total - 1)).roundToInt()
    }

    /** Anteil zu einer laufenden Nummer — die Gegenrichtung zu nummerAus. */
    fun anteilAusNummer(nummer: Int, total: Int): Float {
        if (total <= 1) return 0f
        return (nummer.toFloat() / (total - 1)).coerceIn(0f, 1f)
    }

    /**
     * Das Jahr, das neben dem Griff steht — in derselben Reihenfolge wie die Webapp
     * (js/09-catalog.js → _jahrAnPosition):
     *
     *   Erste Wahl:  das Jahr der Kachel an dieser Stelle. Ist sie geladen, ist das die Wahrheit und keine Rechnung.
     *   Zweite Wahl: die Verteilung, für noch leere Bereiche.
     *
     * @param geladen liefert das Jahr zu einer laufenden Nummer, oder null, wenn diese
     *         Stelle noch nicht geladen ist
     */
    fun jahrFuer(
        anteil: Float, total: Int, verteilung: List<JahrAnzahl>,
        geladen: (Int) -> Int?
    ): Int? = geladen(nummerAus(anteil, total)) ?: jahrAnPosition(anteil, total, verteilung)

    /**
     * Welches Jahr liegt an diesem Anteil der Liste? Wie in der Webapp
     * (js/09-catalog.js → _jahrAnPosition): Aus dem Anteil wird eine laufende Nummer,
     * die durch die Verteilung wandert, bis sie in einen Jahrgang fällt.
     *
     * `verteilung` enthält keine Sets ohne Jahr, `total` zählt sie mit — läuft die
     * Nummer über das Ende, gilt der letzte Jahrgang. Dieselbe Abweichung wie in der
     * Webapp, gewollt: Ein Sonderweg hier zeigte an derselben Stelle ein anderes Jahr.
     *
     * @return das Jahr, oder null wenn es nichts zu zeigen gibt
     */
    fun jahrAnPosition(anteil: Float, total: Int, verteilung: List<JahrAnzahl>): Int? {
        if (verteilung.isEmpty() || total <= 0) return null
        var nummer = nummerAus(anteil, total)
        for (eintrag in verteilung) {
            if (nummer < eintrag.n) return eintrag.year
            nummer -= eintrag.n
        }
        return verteilung.last().year
    }
}
