package ch.brickinventoryapp.zustand

import ch.brickinventoryapp.model.data.ScopeFilter
import ch.brickinventoryapp.testing.FigurenRepository
import ch.brickinventoryapp.testing.HaushaltRepository
import ch.brickinventoryapp.testing.Kontosicht
import ch.brickinventoryapp.testing.PfadServer
import ch.brickinventoryapp.testing.ResponseCache
import ch.brickinventoryapp.testing.SetsRepository
import ch.brickinventoryapp.testing.SpeicherAblage
import ch.brickinventoryapp.testing.TeileRepository
import ch.brickinventoryapp.testing.TestApi
import ch.brickinventoryapp.zustand.ui.Blickfeld
import ch.brickinventoryapp.zustand.ui.bildAdressenDerSammlung
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/**
 * Welche Bilder vorgewärmt werden, gegen einen Testserver: die Kacheln aller Reiter der
 * eigenen Sammlung (Sets, Teile, Figuren, manuell erfasste Teile und Figuren), jeweils
 * aus der Quelle des Reiters — mit Kontofilter die Kontosicht — und nichts aus dem
 * Katalog, dessen rund 25'000 Sets die Grenze um ein Vielfaches sprengten.
 *
 * Gegenproben (Patches unter gegenproben/):
 *   vorwaermen-ohne-blickfeld  die Teile ohne Kontofilter geholt → rot „vorgewärmt wird …“
 *   vorwaermen-ohne-figuren    die Figuren nicht mehr gesammelt → rot „vorgewärmt wird …“
 */
class SammlungVorwaermenTest {

    private val antworten = arrayOf(
        "/api/v1/sets" to """{"success":true,"total":1,"sets":[{"set_number":"75192-1","name":"Falke","image_local":"/b/set_thumb.jpg"}]}""",
        "/api/v1/parts" to """{"success":true,"total":1,"parts":[{"part_number":"3001","color_id":5,"part_name":"Brick","color_name":"Red","image_local":"/b/teil_thumb.jpg","total_quantity":2}]}""",
        "/api/v1/minifigs" to """{"success":true,"figs":[{"fig_number":"sw0001","fig_name":"Luke","image_local":"/b/figur_thumb.jpg","quantity":1}]}""",
        "/api/v1/parts/manual" to """{"success":true,"parts":[{"id":9,"part_number":"3002","part_name":"Brick 2x3","color_id":5,"color_name":"Red","quantity":1,"image_local":"/b/mteil_thumb.jpg"}]}""",
        "/api/v1/minifigs/manual" to """{"success":true,"figs":[{"id":3,"fig_number":"sw0002","fig_name":"Han","quantity":1,"image_local":"/b/mfigur_thumb.jpg"}]}""",
    )

    @Test
    fun `vorgewaermt wird jeder Reiter der Sammlung im Blickfeld, nicht der Katalog`() {
        val pfade = PfadServer(*antworten)
        val ordner = File(System.getProperty("java.io.tmpdir"), "bim-sammlung-${System.nanoTime()}").apply { mkdirs() }
        try {
            val api = TestApi.fuer(pfade.server)
            val cache = ResponseCache { ordner }
            val teile = TeileRepository(api, cache)
            val blickfeld = Blickfeld(SpeicherAblage(), HaushaltRepository(api, cache), teile)
            val adressen = runBlocking {
                for (v in listOf(ScopeFilter.View.GALLERY, ScopeFilter.View.PARTS, ScopeFilter.View.MINIFIGS)) blickfeld.setzeKonto(v, "own")
                bildAdressenDerSammlung(SetsRepository(api, cache), teile, FigurenRepository(api, cache), Kontosicht(api), blickfeld,
                    "https://brick.example")
            }
            assertEquals(listOf("set", "teil", "figur", "mteil", "mfigur").map { "https://brick.example/b/${it}_thumb.jpg" },
                adressen)
            val gefragt = pfade.anfragen.toList()
            assertEquals(setOf("/api/v1/sets", "/api/v1/parts", "/api/v1/minifigs", "/api/v1/parts/manual", "/api/v1/minifigs/manual"),
                gefragt.map { it.substringAfter(' ').substringBefore('?') }.toSet())
            assertTrue("Ohne Kontofilter: $gefragt", gefragt.all { "accounts=own" in it })
            assertTrue("Nur lesend: $gefragt", gefragt.all { it.startsWith("GET ") })
        } finally {
            pfade.server.shutdown()
            ordner.deleteRecursively()
        }
    }
}
