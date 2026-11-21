package ch.brickinventoryapp.data

import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Test
import java.io.File
import ch.brickinventoryapp.testing.PfadServer
import ch.brickinventoryapp.testing.Quellen
import ch.brickinventoryapp.testing.testSetCatalogRepository
import ch.brickinventoryapp.testing.TestApi

/**
 * Ein bereits erfasstes Set wird geöffnet, nicht stillschweigend erhöht — gleich ob
 * über Barcode, Texterkennung oder Nummer. Die Regel liegt auf dem Server
 * (utils/setAdd.ts): Das Erfassen antwortet mit `action = "exists"` und schreibt
 * nichts, damit sie nicht zwischen den Clients auseinanderläuft.
 *
 * Ausgeführt geprüft wird das in EntryViewModelTest (Nummern-Weg,
 * Scanner, Texterkennung, Fehler der Vorabfrage). Hier: die Vorabfrage gegen
 * einen Testserver und die Struktur, dass die Galerie den Auslöser auswertet.
 *
 * Gegenprobe: an getSetExists ein
 * `@Query("accounts") accounts: String? = "own"` → rot „die Existenzprüfung
 * schickt keinen Kontofilter mit“.
 */
class AddExistingSetTest {

    /** Kommentare ausblenden — die Erklärtexte nennen die geprüften Muster selbst. */
    private fun code(s: String) = s.lines()
        .joinToString("\n") { if (it.trim().startsWith("//") || it.trim().startsWith("*")) "" else it }

    /**
     * Die Frage lautet „habe ich das schon?", nicht „sehe ich das gerade?". Ohne
     * accounts nimmt der Server sein Standard-Blickfeld — Haupt- UND Unterkonten, und
     * ein Set eines Unterkontos gilt als vorhanden.
     */
    @Test
    fun `the existence check sends no account filter`() {
        val paths = PfadServer("/api/v1/sets/exists/75192-1" to """{"success":true,"exists":false}""")
        try {
            val sets = testSetCatalogRepository(TestApi.fuer(paths.server))
            runBlocking { sets.getSetExists("75192-1") }
            assertEquals(listOf("GET /api/v1/sets/exists/75192-1"), paths.requests.toList())
        } finally {
            paths.server.shutdown()
        }
    }

    @Test
    fun `the trigger is also evaluated and reset again`() {
        // Ein gesetzter Auslöser ohne Empfänger wäre wirkungslos — und ohne
        // Zurücksetzen liesse sich dasselbe Set kein zweites Mal öffnen.
        // Der Erfassungsrahmen wertet aus, der Graph navigiert.
        val nav = code(File(Quellen.root, "collection/ui/Erfassungsrahmen.kt").readText() + "\n" +
            File(Quellen.root, "collection/ui/SammlungGraph.kt").readText())
        // Geprueft wird das FIELD, nicht der Name des Zustands davor.
        assert(Regex("""\w+\.gefundenesSet""").containsMatchIn(nav)) {
            "die Galerie beobachtet den Auslöser nicht — es passiert dann gar nichts"
        }
        assert(nav.contains("gallerySearchFoundConsumed()")) {
            "der Auslöser wird nicht zurückgesetzt"
        }
        assert(nav.contains("SammlungZiel.SetDetail(")) {
            "es wird nicht zur Detailansicht navigiert"
        }
    }
}
