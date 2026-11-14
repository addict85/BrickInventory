package ch.brickinventoryapp.data

import ch.brickinventoryapp.data.repository.Ergebnis
import ch.brickinventoryapp.data.repository.VerwaltungRepository
import ch.brickinventoryapp.vertrag.abbildung.alsAnsicht
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Test
import java.io.File
import ch.brickinventoryapp.testing.Quellen
import ch.brickinventoryapp.testing.VerwaltungRepository
import ch.brickinventoryapp.testing.mitRepo

/**
 * Waehrend der Server startet, zeigt die App den Fortschritt — keinen Fehler. Der erste
 * Start einer Neuinstallation holt den Rebrickable-Katalog und dauert Minuten; eine
 * Netzmeldung liesse App oder Server kaputt aussehen. Wie die Webapp über
 * /v1/startup-status.
 *
 * Die Abfrage läuft gegen einen Testserver; die Auswertung im AppViewModel führt
 * AppViewModelTest aus, die Anzeige liest Quelltext (Gerät und Compose fehlen hier).
 *
 * Gegenprobe: in VerwaltungApi `@GET("api/v1/startup-status")`
 * auf "…/startstatus" → rot „die App fragt den Startzustand ab“.
 * Gegenprobe: gegenproben/startstatus-ganzzahl.patch
 * macht progress wieder zu Int → rot „ein Fortschritt mit Anteil wird gelesen“.
 */
class ServerStartTest {

    private fun read(rel: String) =
        File(Quellen.wurzel, "$rel").readText()
    private fun code(s: String) = s.lines()
        .joinToString("\n") { if (it.trim().startsWith("//") || it.trim().startsWith("*")) "" else it }

    @Test
    fun `die App fragt den Startzustand ab`() = mitRepo(::VerwaltungRepository) { pfade, admin ->
        runBlocking { admin.getStartupStatus() }
        assertEquals(listOf("GET /api/v1/startup-status"), pfade.anfragen.toList())
    }

    @Test
    fun `ein Fortschritt mit Anteil wird gelesen`() = mitRepo(::VerwaltungRepository) { pfade, admin ->
        // Der Server meldet Schritte samt Anteil des laufenden (2.37 von 8).
        pfade.antworten["/api/v1/startup-status"] = """{"ready":false,"step":"Teile","progress":2.37,"total":8}"""
        val r = runBlocking { admin.getStartupStatus() }
        assert(r is Ergebnis.Success) { "Startzustand nicht gelesen: $r" }
        assertEquals(2.37f / 8, (r as Ergebnis.Success).data.alsAnsicht().anteil!!, 0.0001f)
    }

    @Test
    fun `die Anmeldung zeigt den Fortschritt statt des Formulars`() {
        val s = code(read("anmeldung/ui/AnmeldungGraph.kt"))
        assert(s.contains("ServerStartAnzeige(serverStart)")) {
            "Die Anmeldung zeigt den Startfortschritt nicht"
        }
        // Der Sprung in die Galerie muss AUSSERHALB des if/else stehen: Der
        // Wechsel auf „fertig" kann jederzeit kommen.
        val anzeige = s.indexOf("ServerStartAnzeige(serverStart)")
        val sprung = s.indexOf("LaunchedEffect(state.isLoggedIn)")
        assert(sprung > anzeige) { "Test veraltet — die Reihenfolge stimmt nicht mehr" }
        val dazwischen = s.substring(anzeige, sprung)
        assert(dazwischen.contains("} else LoginScreen(")) {
            "Anzeige und Formular stehen nicht als Entweder-Oder da"
        }
    }
}
