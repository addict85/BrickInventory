package ch.brickinventoryapp.state

import ch.brickinventoryapp.data.testing.PathServer
import ch.brickinventoryapp.data.testing.TestApi
import ch.brickinventoryapp.data.testing.testFinancesRepository
import ch.brickinventoryapp.model.outcome.Outcome
import ch.brickinventoryapp.testing.Sources
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/**
 * Expired session and ImageLoader lifetime. The 401 is run against a test server; the
 * ImageLoader check reads the DI module and MainActivity. The background poll is
 * PollWhileVisibleTest (feature-management).
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
        paths.codes["/api/v2/stats"] = 401
        paths.codes["/api/v2/finance/pnl"] = 500
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
}
