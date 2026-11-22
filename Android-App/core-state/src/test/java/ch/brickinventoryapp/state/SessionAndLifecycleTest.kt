package ch.brickinventoryapp.state

import ch.brickinventoryapp.data.repository.Outcome
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File
import ch.brickinventoryapp.testing.testFinancesRepository
import ch.brickinventoryapp.testing.PathServer
import ch.brickinventoryapp.testing.Sources
import ch.brickinventoryapp.testing.TestApi

/**
 * Expired session, ImageLoader lifetime, and background polling.
 *
 * The 401 is tested, run; the rest reads source code (device and
 * Compose are missing here).
 */
class SessionAndLifecycleTest {

    private fun read(rel: String): String {
        val f = File(Sources.root, "$rel")
        assert(f.exists()) { "Datei nicht gefunden: $rel" }
        return f.readText()
    }

    /** Hide the comments — the explanatory text names the checked patterns itself. */
    private fun code(src: String): String {
        val withoutBlocks = src.replace(Regex("""/\*.*?\*/""", RegexOption.DOT_MATCHES_ALL), "")
        return withoutBlocks.lines()
            .filterNot { it.trim().startsWith("//") }
            .joinToString("\n")
    }

    // ── Abgelaufene Sitzung (HTTP 401) ───────────────────────────────────────

    /**
     * A 401 can be told apart from an ordinary server error — otherwise
     * an expired token would go unrecognized. Run against a test server.
     * Counter-check: in safeCall() 401 mapped as Server instead of Abgewiesen → red.
     */
    @Test
    fun `safeCall reports 401 as rejected`() {
        val paths = PathServer()
        paths.codes["/api/v1/stats"] = 401
        paths.codes["/api/v1/finance/pnl"] = 500
        try {
            val finances = testFinancesRepository(TestApi.forTarget(paths.server))
            val expired = runBlocking { finances.getStats() } as Outcome.Failure
            val broken = runBlocking { finances.getPnl() } as Outcome.Failure
            assertTrue("Ein 401 trägt das Kennzeichen nicht", expired is Outcome.Failure.Rejected)
            assertFalse("Ein 500 gilt als abgelaufene Sitzung", broken is Outcome.Failure.Rejected)
        } finally {
            paths.server.shutdown()
        }
    }

    // ── ImageLoader-Lebensdauer ──────────────────────────────────────────────

    @Test
    fun `the ImageLoader is a singleton from the DI module`() {
        val di = code(Sources.di())
        assert(di.contains("fun provideImageLoader")) {
            "Kein ImageLoader-Provider in AppModule"
        }
        val act = code(read("app/MainActivity.kt"))
        assert(!act.contains("ImageLoader.Builder(")) {
            "MainActivity baut wieder einen eigenen ImageLoader. Bei jeder " +
                "Bildschirmdrehung entsteht dann eine zweite Instanz auf demselben " +
                "Disk-Cache-Verzeichnis, und der Memory-Cache ist jedes Mal leer — " +
                "alle sichtbaren Thumbnails werden neu dekodiert."
        }
        assert(act.contains("@Inject lateinit var imageLoader")) {
            "MainActivity injiziert den ImageLoader nicht"
        }
    }

    // ── Hintergrund-Polling ──────────────────────────────────────────────────

    @Test
    fun `the monitoring poll hangs on the lifecycle`() {
        val src = code(read("management/ui/screens/MonitoringScreen.kt"))
        assert(src.contains("repeatOnLifecycle")) {
            "Die 5s-Schleife im Monitoring läuft ohne repeatOnLifecycle. Ein " +
                "LaunchedEffect endet erst beim Verlassen des Screens, nicht beim " +
                "Wechsel in den Hintergrund — die App pollt dann weiter."
        }
        // The loop itself lives in the ViewModel (holdCurrent, MonitoringViewModelBehaviorTest).
        val loop = src.indexOf("mon.holdCurrent()")
        val guard = src.indexOf("repeatOnLifecycle")
        assert(loop >= 0) { "Poll-Schleife nicht gefunden — Test veraltet?" }
        assert(guard in 1 until loop) {
            "repeatOnLifecycle umschliesst die Poll-Schleife nicht"
        }
    }
}
