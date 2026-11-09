package ch.brickinventoryapp.data

import ch.brickinventoryapp.data.cache.ResponseCache
import ch.brickinventoryapp.data.repository.Ergebnis
import ch.brickinventoryapp.data.repository.SetsRepository
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File
import ch.brickinventoryapp.testing.PfadServer
import ch.brickinventoryapp.testing.ResponseCache
import ch.brickinventoryapp.testing.SetsRepository
import ch.brickinventoryapp.testing.TestApi

/**
 * Galerie: Suchen, Filtern, Sortieren und Blättern macht der SERVER.
 *
 * ── Marcos Vorgabe ──────────────────────────────────────────────────────────
 * „Beide Apps sollen den Filter auf dem Server anwenden. Passt zur vorherigen
 * Frage, dass Logiken immer zentral sein sollen und nicht doppelt
 * implementiert werden. UIs sollen nur das Rendering übernehmen."
 *
 * ── Was vorher war ──────────────────────────────────────────────────────────
 * Die App holte ALLE Sets und filterte im Gerät. Das war eine zweite Fassung
 * der Suche neben der des Servers — und sie konnte weniger:
 *
 *   • kein Jahr im Suchtext (die Webapp findet mit „2019" die Sets des Jahres)
 *   • gar keine Sortierung (die Webapp bietet neun Möglichkeiten)
 *   • die Themenliste entstand aus der GELADENEN Liste statt aus dem Bestand
 *
 * Der Test hält die Regel fest, nicht das Aussehen: Der Schirm bekommt Werte
 * und meldet Änderungen, er rechnet nicht. Das ist die Aussage, die beim
 * nächsten Umbau zählt — ein „schnelles" lokales Filtern wäre sofort wieder
 * die zweite Fassung.
 *
 * Dass der Schirm Werte nur meldet und nicht selbst filtert, prüft
 * GalerieMeldetNachObenTest (app) gezeichnet.
 *
 * Gegenprobe: in SetsRepository.getSets die Bedingung `ungefiltert` auf `true`
 * gesetzt → rot „der Ablage-Cache greift nur ungefiltert“.
 */
class GalleryServerFilterTest {

    /**
     * Sonst läge die Antwort eines Filters unter demselben Schlüssel wie die volle
     * Sicht, und offline erschiene der falsche Bestand. Ausgeführt: erst gefiltert,
     * dann ungefiltert abrufen, Server weg, und sehen, was die Platte liefert.
     */
    @Test
    fun `der Ablage-Cache greift nur ungefiltert`() {
        val pfade = PfadServer("/api/v1/sets" to """{"success":true,"total":1,"sets":[{"set_number":"75192-1","name":"Falke"}]}""")
        val ordner = File(System.getProperty("java.io.tmpdir"), "bim-galerie-${System.nanoTime()}").apply { mkdirs() }
        try {
            val sets = SetsRepository(TestApi.fuer(pfade.server), ResponseCache { ordner })
            runBlocking { sets.getSets(search = "Falke") }
            pfade.server.shutdown()
            val offline = runBlocking { sets.getSets() }
            assertTrue("Eine gefilterte Antwort lag unter dem Schlüssel der vollen Liste: $offline",
                offline is Ergebnis.Error)

            val neu = PfadServer("/api/v1/sets" to """{"success":true,"total":1,"sets":[{"set_number":"10294-1","name":"Titanic"}]}""")
            val sets2 = SetsRepository(TestApi.fuer(neu.server), ResponseCache { ordner })
            runBlocking { sets2.getSets() }
            neu.server.shutdown()
            val gespeichert = runBlocking { sets2.getSets() }
            assertEquals("Die volle Liste kommt offline von der Platte",
                "10294-1", (gespeichert as Ergebnis.Success).data.sets.single().setNumber)
        } finally {
            ordner.deleteRecursively()
        }
    }
}
