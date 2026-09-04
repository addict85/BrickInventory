package ch.brickinventoryapp

import ch.brickinventoryapp.data.model.JahrAnzahl
import ch.brickinventoryapp.ui.CatalogYearMath
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Die Jahres-Leiste rechnet über die VERTEILUNG, nicht linear.
 *
 * ── Der Fehler, den das verhindert ──────────────────────────────────────────
 * Hier stand vorher ein lineares Modell: oben yearMax, unten yearMin, die
 * Strecke dazwischen gleichmässig auf die Jahre verteilt. Genau das hatte
 * Marco in der Webapp gemeldet:
 *
 *   „Es wurden die Sets von 1999 geladen, obwohl rechts 1965 steht."
 *
 * Die Annahme dahinter — in jedem Jahr läge gleich viel — stimmt nicht: Der
 * weitaus grösste Teil des Katalogs stammt aus den letzten Jahrzehnten.
 *
 * Die Zahlen unten sind Marcos Fall im Kleinen: drei Jahrgänge, von denen der
 * neueste neunzig von hundert Sets stellt. Bei neun Zehnteln der Leiste steht
 * man deshalb IMMER NOCH im neuesten Jahrgang — linear gerechnet käme dort der
 * älteste heraus.
 *
 * Dieselbe Rechnung steht in der Webapp (js/09-catalog.js → _jahrAnPosition).
 * Dass beide sie haben und keine von beiden linear schätzt, prüft
 * Web-App/test/catalog-frontend.test.js über beide Quellbäume.
 */
class CatalogYearMathTest {

    private val H = 1000      // Leistenhöhe in px
    private val T = 36        // Griffhöhe in px

    /** Neueste zuerst — dieselbe Reihenfolge, in der die Liste steht. */
    private val VERTEILUNG = listOf(
        JahrAnzahl(2024, 90),
        JahrAnzahl(2010, 7),
        JahrAnzahl(1965, 3),
    )
    private val TOTAL = 100

    private fun jahr(anteil: Float) = CatalogYearMath.jahrAnPosition(anteil, TOTAL, VERTEILUNG)

    @Test
    fun `neun Zehntel hinunter ist noch nicht beim aeltesten Jahrgang`() {
        // Marcos Fall: linear käme hier 1965 heraus. Tatsächlich reicht der
        // Jahrgang 2024 bis zur laufenden Nummer 89, und 0.9 * 99 = 89.
        assertEquals(2024, jahr(0.9f))
    }

    @Test
    fun `die Raender treffen den ersten und den letzten Jahrgang`() {
        assertEquals(2024, jahr(0f))
        assertEquals(1965, jahr(1f))
        // Ausserhalb wird geklemmt, nicht gerechnet.
        assertEquals(2024, jahr(-2f))
        assertEquals(1965, jahr(5f))
    }

    @Test
    fun `die Grenze zwischen zwei Jahrgaengen liegt an der richtigen Nummer`() {
        // Nummer 89 ist die letzte von 2024, Nummer 90 die erste von 2010.
        assertEquals(89, CatalogYearMath.nummerAus(0.9f, TOTAL))
        assertEquals(2024, jahr(89f / 99f))
        assertEquals(2010, jahr(90f / 99f))
    }

    @Test
    fun `das Jahr faellt mit der Position - nie umgekehrt`() {
        var vorher = Int.MAX_VALUE
        for (i in 0..100) {
            val j = jahr(i / 100f)!!
            assertTrue("Bei $i% springt das Jahr zurück: $vorher -> $j", j <= vorher)
            vorher = j
        }
    }

    @Test
    fun `ohne Verteilung oder ohne Sets gibt es kein Etikett`() {
        assertNull(CatalogYearMath.jahrAnPosition(0.5f, TOTAL, emptyList()))
        assertNull(CatalogYearMath.jahrAnPosition(0.5f, 0, VERTEILUNG))
    }

    @Test
    fun `eine geladene Kachel schlaegt die Rechnung`() {
        // Erste Wahl wie in der Webapp: Ist die Stelle geladen, gilt ihr Jahr —
        // auch wenn die Verteilung etwas anderes ergäbe.
        assertEquals(1999, CatalogYearMath.jahrFuer(0.9f, TOTAL, VERTEILUNG) { 1999 })
        // Nicht geladen -> die Rechnung.
        assertEquals(2024, CatalogYearMath.jahrFuer(0.9f, TOTAL, VERTEILUNG) { null })
    }

    @Test
    fun `Beruehrung und Griffposition sind zueinander umgekehrt`() {
        for (prozent in 0..100) {
            val anteil = prozent / 100f
            val offset = CatalogYearMath.daumenOffset(anteil, H, T)
            // Die Griffmitte an dieser Stelle ergibt wieder denselben Anteil.
            val zurueck = CatalogYearMath.anteilAus(offset + T / 2f, H, T)
            assertEquals("Anteil $anteil", anteil, zurueck, 0.002f)
        }
        assertEquals(0, CatalogYearMath.daumenOffset(0f, H, T))
        assertEquals(H - T, CatalogYearMath.daumenOffset(1f, H, T))
    }

    @Test
    fun `Nummer und Anteil sind zueinander umgekehrt`() {
        for (n in 0 until TOTAL) {
            assertEquals(n, CatalogYearMath.nummerAus(CatalogYearMath.anteilAusNummer(n, TOTAL), TOTAL))
        }
        // Eine Liste mit einem einzigen Eintrag hat keine Strecke.
        assertEquals(0f, CatalogYearMath.anteilAusNummer(0, 1), 0f)
        assertEquals(0, CatalogYearMath.nummerAus(0.5f, 0))
    }

    @Test
    fun `entartete Faelle stuerzen nicht ab`() {
        // Leiste kleiner als der Griff (extrem kleines Layout)
        val a = CatalogYearMath.anteilAus(10f, 20, T)
        assertTrue(a in 0f..1f)
        assertEquals(0, CatalogYearMath.daumenOffset(a, 20, T))
        // Verteilung deckt weniger ab als `total` — Sets ohne Jahr zählen in
        // `total` mit, stehen aber nicht in der Verteilung. Dann gilt der
        // letzte Jahrgang, genau wie in der Webapp.
        assertEquals(1965, CatalogYearMath.jahrAnPosition(1f, 500, VERTEILUNG))
    }
}
