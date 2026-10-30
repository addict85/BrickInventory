package ch.brickinventoryapp

import ch.brickinventoryapp.data.cache.ResponseCache
import ch.brickinventoryapp.data.repository.Result
import ch.brickinventoryapp.data.repository.SetsRepository
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

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
 * Gegenproben: in GalleryScreen wieder ein `sets.filter { … }` eingesetzt → der
 * erste Teilschritt wird rot (durchgeführt). In SetsRepository.getSets die
 * Bedingung `ungefiltert` auf `true` gesetzt → rot „der Ablage-Cache greift nur
 * ungefiltert“ (29.10.2026, gemessen).
 */
class GalleryServerFilterTest {

    private fun read(rel: String) =
        java.io.File("src/main/java/ch/brickinventoryapp/$rel").readText()

    /** Kommentare ausblenden — die Erklärtexte nennen die geprüften Muster selbst. */
    private fun code(s: String) = s.lines()
        .joinToString("\n") { if (it.trim().startsWith("//") || it.trim().startsWith("*")) "" else it }

    @Test
    fun `der Schirm filtert und sortiert die Liste nicht selbst`() {
        val s = code(read("ui/screens/GalleryScreen.kt"))
        for (muster in listOf("sets.filter", "sets.sortedBy", "sets.sortedWith", "sets.mapNotNull")) {
            assert(!s.contains(muster)) {
                "GalleryScreen bearbeitet die Liste selbst ($muster) — damit gibt es " +
                    "wieder zwei Fassungen der Suche, und die hier kann weniger"
            }
        }
        assert(!s.contains("debouncedQuery")) {
            "Die Entprellung gehört ins ViewModel, wo auch der Abruf und die " +
                "Filter-Generation liegen — sonst filtert der Schirm doch wieder mit"
        }
    }

    @Test
    fun `Suchtext, Thema und Sortierung werden nach oben gemeldet`() {
        val s = code(read("ui/screens/GalleryScreen.kt"))
        for (r in listOf("onQueryChange", "onThemeChange", "onSortChange", "onLoadMore")) {
            assert(s.contains(r)) { "Rückruf $r fehlt — der Wert käme nie beim Server an" }
        }
        // Die Themen kommen vom Server, NICHT aus der geladenen Seite —
        // abgeleitet schrumpfte die Liste beim Blaettern.
        //
        // Frueher stand die Regel als Parameter `themes: List<String>` im
        // Bildschirm. Seit die Bildschirme ihren Zustand selbst abholen
        // (Nachtrag 96/115) ist es ein Feld des Galerie-Zustands. Geprueft
        // wird deshalb die ABSICHT — Herkunft Zustand, keine eigene Ableitung
        // aus `sets` — statt der damaligen Schreibweise.
        // Wieder das FELD statt des Zustandsnamens — siehe AddExistingSetTest.
        assert(Regex("""\w+\.galleryThemes""").containsMatchIn(s)) {
            "Die Themenliste kommt nicht mehr aus dem Zustand (…galleryThemes)"
        }
        assert(!Regex("""themes[^\n]*=[^\n]*\bsets\b""").containsMatchIn(s)) {
            "Die Themenliste wird aus `sets` abgeleitet — dann schrumpft sie beim Blättern"
        }
    }

    @Test
    fun `die Sortierwerte sind die des Servers`() {
        val s = code(read("ui/screens/GalleryScreen.kt"))
        // Genau die Schlüssel aus SET_SORTS (utils/handlers.ts). Ein Wert, den
        // der Server nicht kennt, fiele dort still auf die Vorgabe zurück —
        // die Sortierung sähe aus, als täte sie nichts.
        for (w in listOf("added_desc", "added_asc", "name_asc", "num_asc",
                         "year_desc", "price_desc", "price_asc", "qty_desc", "qty_asc")) {
            assert(s.contains("\"$w\"")) { "Sortierwert $w fehlt in der Auswahl" }
        }
    }

    /**
     * Sonst läge die Antwort eines Filters unter demselben Schlüssel wie die volle
     * Sicht, und offline erschiene der falsche Bestand. Ausgeführt: erst gefiltert,
     * dann ungefiltert abrufen, Server weg, und sehen, was die Platte liefert.
     */
    @Test
    fun `der Ablage-Cache greift nur ungefiltert`() {
        val pfade = PfadServer("/api/v1/sets" to """{"success":true,"total":1,"sets":[{"set_number":"75192-1","name":"Falke"}]}""")
        val ordner = java.io.File(System.getProperty("java.io.tmpdir"), "bim-galerie-${System.nanoTime()}").apply { mkdirs() }
        try {
            val sets = SetsRepository(TestApi.fuer(pfade.server), ResponseCache { ordner })
            runBlocking { sets.getSets(search = "Falke") }
            pfade.server.shutdown()
            val offline = runBlocking { sets.getSets() }
            assertTrue("Eine gefilterte Antwort lag unter dem Schlüssel der vollen Liste: $offline",
                offline is Result.Error)

            val neu = PfadServer("/api/v1/sets" to """{"success":true,"total":1,"sets":[{"set_number":"10294-1","name":"Titanic"}]}""")
            val sets2 = SetsRepository(TestApi.fuer(neu.server), ResponseCache { ordner })
            runBlocking { sets2.getSets() }
            neu.server.shutdown()
            val gespeichert = runBlocking { sets2.getSets() }
            assertEquals("Die volle Liste kommt offline von der Platte",
                "10294-1", (gespeichert as Result.Success).data.sets.single().setNumber)
        } finally {
            ordner.deleteRecursively()
        }
    }
}
