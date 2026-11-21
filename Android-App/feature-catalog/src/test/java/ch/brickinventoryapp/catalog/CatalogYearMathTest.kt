package ch.brickinventoryapp.catalog

import ch.brickinventoryapp.model.domain.JahrAnzahlAnsicht
import ch.brickinventoryapp.catalog.ui.CatalogYearMath
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Die Jahres-Leiste rechnet über die DISTRIBUTION, nicht linear.
 *
 * ── Der Fehler, den das verhindert ──────────────────────────────────────────
 * Hier stand vorher ein lineares Modell: oben yearMax, unten yearMin, die
 * Strecke dazwischen gleichmässig auf die Jahre verteilt; die Leiste zeigte
 * 1965 und lud die Sets von 1999.
 *
 * Die Annahme dahinter — in jedem Jahr läge gleich viel — stimmt nicht: Der
 * weitaus grösste Teil des Katalogs stammt aus den letzten Jahrzehnten.
 *
 * Die Zahlen unten sind dieser Fall im Kleinen: drei Jahrgänge, von denen der
 * neueste neunzig von hundert Sets stellt. Bei neun Zehnteln der Leiste steht
 * man deshalb IMMER NOCH im neuesten Jahrgang — linear gerechnet käme dort der
 * älteste heraus.
 *
 * Dieselbe Rechnung steht in der Webapp (js/katalog.js → _jahrAnPosition).
 * Dass beide sie haben und keine von beiden linear schätzt, prüft
 * Web-App/test/catalog-frontend.test.js über beide Quellbäume.
 */
class CatalogYearMathTest {

    private val H = 1000      // Leistenhöhe in px
    private val T = 36        // Griffhöhe in px

    /** Neueste zuerst — dieselbe Reihenfolge, in der die Liste steht. */
    private val DISTRIBUTION = listOf(
        JahrAnzahlAnsicht(2024, 90),
        JahrAnzahlAnsicht(2010, 7),
        JahrAnzahlAnsicht(1965, 3),
    )
    private val TOTAL = 100

    private fun jahr(share: Float) = CatalogYearMath.yearAnPosition(share, TOTAL, DISTRIBUTION)

    @Test
    fun `nine tenths down is not yet at the oldest year`() {
        // Linear käme hier 1965 heraus. Tatsächlich reicht der
        // Jahrgang 2024 bis zur laufenden Nummer 89, und 0.9 * 99 = 89.
        assertEquals(2024, jahr(0.9f))
    }

    @Test
    fun `the edges hit the first and the last year`() {
        assertEquals(2024, jahr(0f))
        assertEquals(1965, jahr(1f))
        // Ausserhalb wird geklemmt, nicht gerechnet.
        assertEquals(2024, jahr(-2f))
        assertEquals(1965, jahr(5f))
    }

    @Test
    fun `the boundary between two years lies at the right number`() {
        // Nummer 89 ist die letzte von 2024, Nummer 90 die erste von 2010.
        assertEquals(89, CatalogYearMath.numberFrom(0.9f, TOTAL))
        assertEquals(2024, jahr(89f / 99f))
        assertEquals(2010, jahr(90f / 99f))
    }

    @Test
    fun `the year falls with the position - never the other way round`() {
        var vorher = Int.MAX_VALUE
        for (i in 0..100) {
            val j = jahr(i / 100f)!!
            assertTrue("Bei $i% springt das Jahr zurück: $vorher -> $j", j <= vorher)
            vorher = j
        }
    }

    @Test
    fun `without a distribution or without sets there is no label`() {
        assertNull(CatalogYearMath.yearAnPosition(0.5f, TOTAL, emptyList()))
        assertNull(CatalogYearMath.yearAnPosition(0.5f, 0, DISTRIBUTION))
    }

    @Test
    fun `a loaded tile beats the calculation`() {
        // Erste Wahl wie in der Webapp: Ist die Stelle geladen, gilt ihr Jahr —
        // auch wenn die Verteilung etwas anderes ergäbe.
        assertEquals(1999, CatalogYearMath.yearFor(0.9f, TOTAL, DISTRIBUTION) { 1999 })
        // Nicht geladen -> die Rechnung.
        assertEquals(2024, CatalogYearMath.yearFor(0.9f, TOTAL, DISTRIBUTION) { null })
    }

    @Test
    fun `touch and handle position are inverse to each other`() {
        for (prozent in 0..100) {
            val share = prozent / 100f
            val offset = CatalogYearMath.thumbOffset(share, H, T)
            // Die Griffmitte an dieser Stelle ergibt wieder denselben Anteil.
            val zurueck = CatalogYearMath.shareFrom(offset + T / 2f, H, T)
            assertEquals("Anteil $share", share, zurueck, 0.002f)
        }
        assertEquals(0, CatalogYearMath.thumbOffset(0f, H, T))
        assertEquals(H - T, CatalogYearMath.thumbOffset(1f, H, T))
    }

    @Test
    fun `number and share are inverse to each other`() {
        for (n in 0 until TOTAL) {
            assertEquals(n, CatalogYearMath.numberFrom(CatalogYearMath.anteilAusNummer(n, TOTAL), TOTAL))
        }
        // Eine Liste mit einem einzigen Eintrag hat keine Strecke.
        assertEquals(0f, CatalogYearMath.anteilAusNummer(0, 1), 0f)
        assertEquals(0, CatalogYearMath.numberFrom(0.5f, 0))
    }

    @Test
    fun `degenerate cases do not crash`() {
        // Leiste kleiner als der Griff (extrem kleines Layout)
        val a = CatalogYearMath.shareFrom(10f, 20, T)
        assertTrue(a in 0f..1f)
        assertEquals(0, CatalogYearMath.thumbOffset(a, 20, T))
        // Verteilung deckt weniger ab als `total` — Sets ohne Jahr zählen in
        // `total` mit, stehen aber nicht in der Verteilung. Dann gilt der
        // letzte Jahrgang, genau wie in der Webapp.
        assertEquals(1965, CatalogYearMath.yearAnPosition(1f, 500, DISTRIBUTION))
    }
}
