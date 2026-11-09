package ch.brickinventoryapp.teile

import ch.brickinventoryapp.model.data.model.BrickColorsResponse
import ch.brickinventoryapp.model.data.model.FigValuationItem
import ch.brickinventoryapp.model.data.model.ManualFigsResponse
import ch.brickinventoryapp.model.data.model.ManualPartsResponse
import ch.brickinventoryapp.model.data.model.Minifig
import ch.brickinventoryapp.model.ui.model.FigurenKennzahlenAnsicht
import ch.brickinventoryapp.model.data.model.MinifigStatsResponse
import ch.brickinventoryapp.model.data.model.MinifigsResponse
import ch.brickinventoryapp.model.data.model.Part
import ch.brickinventoryapp.model.data.model.PartValuationItem
import ch.brickinventoryapp.model.data.model.PartsCategoriesResponse
import ch.brickinventoryapp.model.data.model.PartsFilterColorsResponse
import ch.brickinventoryapp.model.data.model.PartsResponse
import ch.brickinventoryapp.model.data.model.PartsStatsResponse
import ch.brickinventoryapp.data.repository.Ergebnis
import ch.brickinventoryapp.teile.ui.PartsUiState
import ch.brickinventoryapp.teile.ui.Teile
import ch.brickinventoryapp.teile.ui.TeileAbfrage
import ch.brickinventoryapp.teile.ui.TeileQuelle
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.delay
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Test
import ch.brickinventoryapp.model.data.Ersatzteilwahl
import ch.brickinventoryapp.model.ui.Listenansicht

/**
 * Teile- und Figurenliste als Ablauf geprüft, mit nachgebauter Quelle.
 *
 * Ersetzt die Quelltextprüfungen in TeileFilterTest, ManuelleListenFilterTest
 * und ServerComputedValuesTest, die nach Zeilen wie
 * `_partsState.value.partsColorFilter.ifBlank { null }` suchten.
 *
 * Gegenproben (am 27.10. gemessen, kotlinc gegen Teile.kt):
 *   A  in laden() `farbe = null` statt aus dem Zustand → rot: „die Filter
 *      reisen mit jeder Seite mit" (und der Test zur alten Antwort)
 *   B  vergissScroll() in setzeFarbe() entfernt → rot: „ein Filterwechsel
 *      vergisst die Scrollstelle"
 *   C  manuelleTeile(null) statt des Suchtexts → rot: „die manuellen
 *      Abschnitte bekommen denselben Suchtext"
 *   D  die Figurenkennzahlen in denselben Auftrag wie die Liste gelegt → rot:
 *      „die Figurenliste wartet nicht auf die Kennzahlen"
 *   E  teileJob?.cancel() in laden() entfernt → rot: „eine langsame alte
 *      Antwort überschreibt die neuere nicht"
 */
@OptIn(ExperimentalCoroutinesApi::class)
class TeileTest {

    private class Quelle : TeileQuelle {
        val abfragen = mutableListOf<TeileAbfrage>()
        val manuelleSuchen = mutableListOf<String?>()
        val figurSuchen = mutableListOf<String?>()
        val manuelleFigurSuchen = mutableListOf<String?>()
        var kennzahlAbrufe = 0
        /** Dauer je Abfrage; Standard: sofort. */
        var dauer: (TeileAbfrage) -> Long = { 0 }
        var kennzahlDauer = 0L

        override suspend fun seite(abfrage: TeileAbfrage): Ergebnis<PartsResponse> {
            abfragen += abfrage
            delay(dauer(abfrage))
            val nummer = "${abfrage.suche ?: "alle"}-${abfrage.farbe ?: "-"}-${abfrage.seite}"
            return Ergebnis.Success(PartsResponse(success = true, total = 2, parts = listOf(Part(partNumber = nummer))))
        }
        override suspend fun manuelleTeile(suche: String?): Ergebnis<ManualPartsResponse> {
            manuelleSuchen += suche
            return Ergebnis.Success(ManualPartsResponse(success = true, parts = listOf(PartValuationItem(partNumber = "m"))))
        }
        override suspend fun teileKennzahlen(): Ergebnis<PartsStatsResponse> = Ergebnis.Error.Server(503, "aus")
        override suspend fun filterFarben() = Ergebnis.Success(PartsFilterColorsResponse(success = true))
        override suspend fun kategorien() = Ergebnis.Success(PartsCategoriesResponse(success = true))
        override suspend fun alleFarben() = Ergebnis.Success(BrickColorsResponse(success = true))
        override suspend fun figurKennzahlen(): Ergebnis<MinifigStatsResponse> {
            kennzahlAbrufe++
            delay(kennzahlDauer)
            return Ergebnis.Error.Server(500, "Zählung gescheitert")
        }
        override suspend fun figuren(suche: String?): Ergebnis<MinifigsResponse> {
            figurSuchen += suche
            return Ergebnis.Success(MinifigsResponse(success = true, figs = listOf(Minifig(figNumber = "sw0001"))))
        }
        override suspend fun manuelleFiguren(suche: String?): Ergebnis<ManualFigsResponse> {
            manuelleFigurSuchen += suche
            return Ergebnis.Success(ManualFigsResponse(success = true, figs = listOf(FigValuationItem(figNumber = "m"))))
        }
    }

    private var vergessen = 0

    private fun TestScope.teile(q: Quelle) =
        Teile(scope = this, quelle = q, meldeFehler = {}, vergissScroll = { vergessen++ })

    @Test
    fun `die Filter reisen mit jeder Seite mit`() = runTest {
        val q = Quelle()
        val t = teile(q)
        t.setzeFarbe("5"); t.setzeKategorie("11"); t.setzeErsatzteile(Ersatzteilwahl.OHNE); t.setzeAnsicht(Listenansicht.TABELLE)
        advanceUntilIdle()
        t.laden(seite = 2); advanceUntilIdle()
        val zweite = q.abfragen.last()
        assertEquals(TeileAbfrage(suche = null, farbe = "5", kategorie = "11", ersatzteile = Ersatzteilwahl.OHNE,
            mitSets = true, seite = 2), zweite)
        assertEquals("Seite 2 wird angehängt, nicht ersetzt", 2, t.state.value.parts.size)
    }

    @Test
    fun `ein Filterwechsel vergisst die Scrollstelle`() = runTest {
        val t = teile(Quelle())
        t.setzeFarbe("5"); t.setzeKategorie("11"); t.setzeErsatzteile(Ersatzteilwahl.NUR); t.setzeSuche("stein")
        assertEquals(4, vergessen)
        t.setzeFarbe("5")
        assertEquals("Dieselbe Farbe noch einmal ist kein Wechsel", 4, vergessen)
        advanceUntilIdle()
    }

    @Test
    fun `die manuellen Abschnitte bekommen denselben Suchtext`() = runTest {
        val q = Quelle()
        val t = teile(q)
        t.setzeSuche("stein"); advanceUntilIdle()
        t.setzeFigurSuche("luke"); advanceUntilIdle()
        assertEquals(listOf<String?>("stein"), q.manuelleSuchen)
        assertEquals(listOf<String?>("luke"), q.manuelleFigurSuchen)
        assertEquals(listOf("m"), t.state.value.manualParts?.map { it.partNumber })
    }

    @Test
    fun `die Figurenliste wartet nicht auf die Kennzahlen und ein Fehlschlag laesst sie stehen`() = runTest {
        val q = Quelle().apply { kennzahlDauer = 5_000 }
        val t = teile(q)
        t.ladeFiguren()
        advanceTimeBy(10); runCurrent()
        assertEquals(listOf("sw0001"), t.state.value.minifigs.map { it.figNumber })
        assertFalse(t.state.value.minifigsLoading)
        advanceUntilIdle()
        assertEquals(listOf("sw0001"), t.state.value.minifigs.map { it.figNumber })
        assertEquals(FigurenKennzahlenAnsicht(), t.state.value.minifigStats)
    }

    @Test
    fun `beim Tippen fragt die Figurenliste einmal und zaehlt nicht neu`() = runTest {
        val q = Quelle()
        val t = teile(q)
        t.setzeFigurSuche("lu"); t.setzeFigurSuche("luk"); t.setzeFigurSuche("luke")
        advanceUntilIdle()
        assertEquals(listOf<String?>("luke"), q.figurSuchen)
        assertEquals(0, q.kennzahlAbrufe)
    }

    @Test
    fun `eine langsame alte Antwort ueberschreibt die neuere nicht`() = runTest {
        val q = Quelle().apply { dauer = { if (it.farbe == null) 1_000 else 10 } }
        val t = teile(q)
        t.laden(); runCurrent()
        t.setzeFarbe("5")
        advanceUntilIdle()
        assertEquals(listOf("alle-5-1"), t.state.value.parts.map { it.partNumber })
    }

    @Test
    fun `Abmelden raeumt auf, und eine spaete Antwort kommt nicht zurueck`() = runTest {
        val q = Quelle().apply { dauer = { 1_000 } }
        val t = teile(q)
        t.setzeFarbe("5"); runCurrent()
        t.zuruecksetzen()
        advanceUntilIdle()
        assertEquals(PartsUiState(), t.state.value)
    }
}
