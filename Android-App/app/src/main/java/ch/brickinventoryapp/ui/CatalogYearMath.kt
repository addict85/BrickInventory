package ch.brickinventoryapp.ui

import ch.brickinventoryapp.data.model.JahrAnzahl
import kotlin.math.roundToInt

/**
 * Pure Mathematik der Jahres-Leiste (CatalogScreen) — als eigenes Objekt
 * extrahiert, damit sie ohne Compose/Android in JUnit-Tests prüfbar ist
 * (siehe app/src/test/.../CatalogYearMathTest.kt).
 *
 * ── Warum die Leiste jetzt an der POSITION hängt und nicht am Jahr ──────────
 *
 * Hier stand vorher ein lineares Modell: oben yearMax, unten yearMin, und die
 * Strecke dazwischen gleichmässig auf die Jahre verteilt. Genau dieses Modell
 * hat Marco in der Webapp gemeldet:
 *
 *   „Wenn dann die Bilder geladen werden, erscheinen sie von einem anderen
 *    Jahr als rechts im Scrollbalken angezeigt wird. Es wurden die Sets von
 *    1999 geladen, obwohl rechts 1965 steht."
 *
 * Der Grund ist eine Annahme, die niemand ausgesprochen hatte: dass zwischen
 * 1949 und 2027 in jedem Jahr gleich viel läge. Tatsächlich stammt der weitaus
 * grösste Teil des Katalogs aus den letzten Jahrzehnten; wer neun Zehntel
 * hinunterzieht, ist deshalb noch lange nicht bei den Sechzigern.
 *
 * Die Webapp rechnet seither über die tatsächliche VERTEILUNG (js/09-catalog.js
 * → _jahrAnPosition). Hier steht dieselbe Rechnung, Schritt für Schritt gleich,
 * damit beide Oberflächen an derselben Stelle dasselbe Jahr zeigen. Die
 * Verteilung kommt vom Server, weil nur der die Filter kennt.
 */
object CatalogYearMath {

    /**
     * Anteil (0..1) an der Leiste zu einer Berührung bei y Pixeln.
     *
     * Wie in der Webapp (js/15-scrollbar.js → rollen): Der Griff wird mittig
     * unter den Finger gelegt, dann wird auf die Spur ohne Griffhöhe
     * umgerechnet.
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
     * Das Jahr, das neben dem Griff steht — in derselben Reihenfolge wie die
     * Webapp (js/09-catalog.js → _jahrAnPosition):
     *
     *   Erste Wahl:  das Jahr der Kachel, die an dieser Stelle steht. Ist sie
     *                geladen, ist das die Wahrheit und keine Rechnung.
     *   Zweite Wahl: die Verteilung. Fuer noch leere Bereiche — dort weiss es
     *                auch die Webapp nicht besser.
     *
     * @param geladen liefert das Jahr zu einer laufenden Nummer, oder null,
     *        wenn diese Stelle noch nicht geladen ist
     */
    fun jahrFuer(
        anteil: Float, total: Int, verteilung: List<JahrAnzahl>,
        geladen: (Int) -> Int?
    ): Int? = geladen(nummerAus(anteil, total)) ?: jahrAnPosition(anteil, total, verteilung)

    /**
     * Welches Jahr liegt an diesem Anteil der Liste?
     *
     * Wortgleich zur Webapp (js/09-catalog.js → _jahrAnPosition): aus dem
     * Anteil wird eine laufende Nummer, und die wandert durch die Verteilung,
     * bis sie in einen Jahrgang fällt.
     *
     * `verteilung` enthält KEINE Jahrgänge ohne Jahr — beide Oberflächen
     * werfen die vorher weg. `total` zählt sie dagegen mit, deshalb kann die
     * Nummer über das Ende hinauslaufen; dann gilt der letzte Jahrgang. Das
     * ist dieselbe Abweichung wie in der Webapp und deshalb gewollt: Ein
     * eigener Sonderweg hier hiesse, dass die beiden an derselben Stelle
     * verschiedene Jahre zeigen.
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
