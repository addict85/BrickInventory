package ch.brickinventoryapp.data

import ch.brickinventoryapp.data.repository.Outcome
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Test
import java.io.File
import ch.brickinventoryapp.testing.Sources
import ch.brickinventoryapp.testing.testManagementRepository
import ch.brickinventoryapp.testing.withRepo

/**
 * While the server starts, the app shows the progress — no error. The first
 * start of a new installation fetches the Rebrickable catalog and takes minutes; a
 * network message would make app or server look broken. Like the web app via
 * /v1/startup-status.
 *
 * The query runs against a test server; the evaluation in AppViewModel is executed by
 * AppViewModelTest, the display reads source text (device and Compose are missing here).
 *
 * Counter-check: in ManagementApi `@GET("api/v1/startup-status")`
 * to "…/startstatus" → red “the app queries the startup state”.
 * Counter-check: counter-checks/startstatus-ganzzahl.patch
 * makes progress an Int again → red “a progress with share is read”.
 */
class ServerStartTest {

    private fun read(rel: String) =
        File(Sources.root, "$rel").readText()
    private fun code(s: String) = s.lines()
        .joinToString("\n") { if (it.trim().startsWith("//") || it.trim().startsWith("*")) "" else it }

    @Test
    fun `the app queries the startup state`() = withRepo(::testManagementRepository) { paths, admin ->
        runBlocking { admin.getStartupStatus() }
        assertEquals(listOf("GET /api/v1/startup-status"), paths.requests.toList())
    }

    @Test
    fun `a progress with share is read`() = withRepo(::testManagementRepository) { paths, admin ->
        // The server reports steps including the share of the running one (2.37 of 8).
        paths.responses["/api/v1/startup-status"] = """{"ready":false,"step":"Teile","progress":2.37,"total":8}"""
        val r = runBlocking { admin.getStartupStatus() }
        assert(r is Outcome.Success) { "Startzustand nicht gelesen: $r" }
        assertEquals(2.37f / 8, (r as Outcome.Success).data.share!!, 0.0001f)
    }

    @Test
    fun `the sign-in shows the progress instead of the form`() {
        val s = code(read("login/ui/LoginGraph.kt"))
        assert(s.contains("ServerStartDisplay(serverStart)")) {
            "Die Anmeldung zeigt den Startfortschritt nicht"
        }
        // The jump into the gallery must stand OUTSIDE the if/else: the
        // switch to „finished" can come at any time.
        val display = s.indexOf("ServerStartDisplay(serverStart)")
        val jump = s.indexOf("LaunchedEffect(state.isLoggedIn)")
        assert(jump > display) { "Test veraltet — die Reihenfolge stimmt nicht mehr" }
        val between = s.substring(display, jump)
        assert(between.contains("} else LoginScreen(")) {
            "Anzeige und Formular stehen nicht als Entweder-Oder da"
        }
    }
}
