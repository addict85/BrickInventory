package ch.brickinventoryapp.teile

import ch.brickinventoryapp.data.repository.Ergebnis
import ch.brickinventoryapp.model.data.model.BrickColorsResponse
import ch.brickinventoryapp.model.data.model.ManualFigsResponse
import ch.brickinventoryapp.model.data.model.ManualPartsResponse
import ch.brickinventoryapp.model.data.model.MinifigStatsResponse
import ch.brickinventoryapp.model.data.model.MinifigsResponse
import ch.brickinventoryapp.model.data.model.Part
import ch.brickinventoryapp.model.data.model.PartsCategoriesResponse
import ch.brickinventoryapp.model.data.model.PartsFilterColorsResponse
import ch.brickinventoryapp.model.data.model.PartsResponse
import ch.brickinventoryapp.model.data.model.PartsStatsResponse
import ch.brickinventoryapp.teile.ui.Teile
import ch.brickinventoryapp.teile.ui.TeileAbfrage
import ch.brickinventoryapp.teile.ui.TeileQuelle
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * Mit Kontofilter blättert die Teileliste am Server. Liefert der Server bei gleichen
 * Sortierwerten eine Zeile auf zwei Seiten, hängt Seite 2 sie nicht doppelt an — eine
 * Zeile doppelt wäre ein doppelter Schlüssel im Raster.
 *
 * Gegenprobe: in Teile.anhaengen `bisher + neu` ohne Abgleich → rot „keine Zeile doppelt“
 * (gegenproben/teile-seite-doppelt.patch).
 */
@OptIn(ExperimentalCoroutinesApi::class)
class TeileSeitenTest {

    private fun teil(nummer: String) = Part(partNumber = nummer, colorId = 4, colorName = "Red")

    private class Quelle(val seiten: Map<Int, List<Part>>) : TeileQuelle {
        override suspend fun seite(abfrage: TeileAbfrage) = Ergebnis.Success(PartsResponse(success = true,
            total = seiten.values.sumOf { it.size }, parts = seiten.getValue(abfrage.seite)))
        override suspend fun manuelleTeile(suche: String?) = Ergebnis.Success(ManualPartsResponse(success = true))
        override suspend fun teileKennzahlen(): Ergebnis<PartsStatsResponse> = Ergebnis.Error.Server(503, "")
        override suspend fun filterFarben() = Ergebnis.Success(PartsFilterColorsResponse(success = true))
        override suspend fun kategorien() = Ergebnis.Success(PartsCategoriesResponse(success = true))
        override suspend fun alleFarben() = Ergebnis.Success(BrickColorsResponse(success = true))
        override suspend fun figurKennzahlen(): Ergebnis<MinifigStatsResponse> = Ergebnis.Error.Server(503, "")
        override suspend fun figuren(suche: String?) = Ergebnis.Success(MinifigsResponse(success = true))
        override suspend fun manuelleFiguren(suche: String?) = Ergebnis.Success(ManualFigsResponse(success = true))
    }

    @Test
    fun `mit Kontofilter hängt Seite 2 keine Zeile doppelt an`() = runTest {
        val t = Teile(scope = backgroundScope,
            quelle = Quelle(mapOf(1 to listOf(teil("3001"), teil("3002")), 2 to listOf(teil("3002"), teil("3003")))),
            meldeFehler = {}, vergissScroll = {}, teileEingeschraenkt = { true })
        t.laden(); runCurrent()
        t.laden(seite = 2); runCurrent()
        assertEquals("keine Zeile doppelt, die fehlende kommt dazu", listOf("3001", "3002", "3003"),
            t.state.value.parts.map { it.partNumber })
    }
}
