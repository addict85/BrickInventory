package ch.brickinventoryapp

import ch.brickinventoryapp.data.model.BrickColorsResponse
import ch.brickinventoryapp.data.model.FigValuationItem
import ch.brickinventoryapp.data.model.ManualFigsResponse
import ch.brickinventoryapp.data.model.ManualPartsResponse
import ch.brickinventoryapp.data.model.Minifig
import ch.brickinventoryapp.data.model.MinifigStats
import ch.brickinventoryapp.data.model.MinifigStatsResponse
import ch.brickinventoryapp.data.model.MinifigsResponse
import ch.brickinventoryapp.data.model.Part
import ch.brickinventoryapp.data.model.PartValuationItem
import ch.brickinventoryapp.data.model.PartsCategoriesResponse
import ch.brickinventoryapp.data.model.PartsFilterColorsResponse
import ch.brickinventoryapp.data.model.PartsResponse
import ch.brickinventoryapp.data.model.PartsStatsResponse
import ch.brickinventoryapp.data.repository.Result
import ch.brickinventoryapp.ui.PartsUiState
import ch.brickinventoryapp.ui.Teile
import ch.brickinventoryapp.ui.TeileAbfrage
import ch.brickinventoryapp.ui.TeileQuelle
import kotlinx.coroutines.delay
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Test

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

        override suspend fun seite(abfrage: TeileAbfrage): Result<PartsResponse> {
            abfragen += abfrage
            delay(dauer(abfrage))
            val nummer = "${abfrage.suche ?: "alle"}-${abfrage.farbe ?: "-"}-${abfrage.seite}"
            return Result.Success(PartsResponse(success = true, total = 2, parts = listOf(Part(partNumber = nummer))))
        }
        override suspend fun manuelleTeile(suche: String?): Result<ManualPartsResponse> {
            manuelleSuchen += suche
            return Result.Success(ManualPartsResponse(success = true, parts = listOf(PartValuationItem(partNumber = "m"))))
        }
        override suspend fun teileKennzahlen(): Result<PartsStatsResponse> = Result.Error("aus")
        override suspend fun filterFarben() = Result.Success(PartsFilterColorsResponse(success = true))
        override suspend fun kategorien() = Result.Success(PartsCategoriesResponse(success = true))
        override suspend fun alleFarben() = Result.Success(BrickColorsResponse(success = true))
        override suspend fun figurKennzahlen(): Result<MinifigStatsResponse> {
            kennzahlAbrufe++
            delay(kennzahlDauer)
            return Result.Error("Zählung gescheitert")
        }
        override suspend fun figuren(suche: String?): Result<MinifigsResponse> {
            figurSuchen += suche
            return Result.Success(MinifigsResponse(success = true, figs = listOf(Minifig(figNumber = "sw0001"))))
        }
        override suspend fun manuelleFiguren(suche: String?): Result<ManualFigsResponse> {
            manuelleFigurSuchen += suche
            return Result.Success(ManualFigsResponse(success = true, figs = listOf(FigValuationItem(figNumber = "m"))))
        }
    }

    private var vergessen = 0

    private fun TestScope.teile(q: Quelle) =
        Teile(scope = this, quelle = q, meldeFehler = {}, vergissScroll = { vergessen++ })

    @Test
    fun `die Filter reisen mit jeder Seite mit`() = runTest {
        val q = Quelle()
        val t = teile(q)
        t.setzeFarbe("5"); t.setzeKategorie("11"); t.setzeErsatzteile("0"); t.setzeAnsicht("table")
        advanceUntilIdle()
        t.laden(seite = 2); advanceUntilIdle()
        val zweite = q.abfragen.last()
        assertEquals(TeileAbfrage(suche = null, farbe = "5", kategorie = "11", ersatzteile = "0",
            mitSets = "1", seite = 2), zweite)
        assertEquals("Seite 2 wird angehängt, nicht ersetzt", 2, t.state.value.parts.size)
    }

    @Test
    fun `ein Filterwechsel vergisst die Scrollstelle`() = runTest {
        val t = teile(Quelle())
        t.setzeFarbe("5"); t.setzeKategorie("11"); t.setzeErsatzteile("1"); t.setzeSuche("stein")
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
        assertEquals(MinifigStats(), t.state.value.minifigStats)
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
