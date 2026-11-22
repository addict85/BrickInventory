package ch.brickinventoryapp.state

import ch.brickinventoryapp.data.repository.Outcome
import ch.brickinventoryapp.data.testing.PathServer
import ch.brickinventoryapp.data.testing.TestApi
import ch.brickinventoryapp.data.testing.testFinancesRepository
import ch.brickinventoryapp.testing.Sources
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/**
 * Expired session, ImageLoader lifetime, and background polling.
 *
 * The 401 is tested, run; the rest reads source code (device and
 * Compose are missing here).
 */
class SessionAndLifecycleTest {

    private fun read(rel: String): String {
        val f = File(Sources.root, "$rel")
        assert(f.exists()) { "File not found: $rel" }
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
            assertTrue("a 401 does not carry the marker", expired is Outcome.Failure.Rejected)
            assertFalse("a 500 counts as an expired session", broken is Outcome.Failure.Rejected)
        } finally {
            paths.server.shutdown()
        }
    }

    // ── ImageLoader-Lebensdauer ──────────────────────────────────────────────

    @Test
    fun `the ImageLoader is a singleton from the DI module`() {
        val di = code(Sources.di())
        assert(di.contains("fun provideImageLoader")) {
            "no ImageLoader provider in AppModule"
        }
        val act = code(read("app/MainActivity.kt"))
        assert(!act.contains("ImageLoader.Builder(")) {
            "MainActivity builds its own ImageLoader again. On every " +
                "screen rotation a second instance then arises on the same " +
                "disk cache directory, and the memory cache is empty every time — " +
                "all visible thumbnails are decoded again."
        }
        assert(act.contains("@Inject lateinit var imageLoader")) {
            "MainActivity does not inject the ImageLoader"
        }
    }

    // ── Hintergrund-Polling ──────────────────────────────────────────────────

    @Test
    fun `the monitoring poll hangs on the lifecycle`() {
        val src = code(read("management/ui/screens/MonitoringScreen.kt"))
        assert(src.contains("repeatOnLifecycle")) {
            "The 5 s loop in monitoring runs without repeatOnLifecycle. A " +
                "LaunchedEffect only ends when leaving the screen, not when " +
                "going to the background — the app then keeps polling."
        }
        // The loop itself lives in the ViewModel (holdCurrent, MonitoringViewModelBehaviorTest).
        val loop = src.indexOf("mon.holdCurrent()")
        val guard = src.indexOf("repeatOnLifecycle")
        assert(loop >= 0) { "poll loop not found — test outdated?" }
        assert(guard in 1 until loop) {
            "repeatOnLifecycle does not enclose the poll loop"
        }
    }
}
