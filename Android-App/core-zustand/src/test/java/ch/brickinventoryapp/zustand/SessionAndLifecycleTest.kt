package ch.brickinventoryapp.zustand

import ch.brickinventoryapp.data.repository.FinanzenRepository
import ch.brickinventoryapp.data.repository.Ergebnis
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File
import ch.brickinventoryapp.testing.FinanzenRepository
import ch.brickinventoryapp.testing.PfadServer
import ch.brickinventoryapp.testing.Quellen
import ch.brickinventoryapp.testing.TestApi

/**
 * Abgelaufene Sitzung, ImageLoader-Lebensdauer und Hintergrund-Polling.
 *
 * Der 401 ist ausgeführt geprüft; der Rest liest Quelltext (Gerät und
 * Compose fehlen hier).
 */
class SessionAndLifecycleTest {

    private fun read(rel: String): String {
        val f = File(Quellen.wurzel, "$rel")
        assert(f.exists()) { "Datei nicht gefunden: $rel" }
        return f.readText()
    }

    /** Kommentare ausblenden — die Erklärtexte nennen die geprüften Muster selbst. */
    private fun code(src: String): String {
        val withoutBlocks = src.replace(Regex("""/\*.*?\*/""", RegexOption.DOT_MATCHES_ALL), "")
        return withoutBlocks.lines()
            .filterNot { it.trim().startsWith("//") }
            .joinToString("\n")
    }

    // ── Abgelaufene Sitzung (HTTP 401) ───────────────────────────────────────

    /**
     * Ein 401 ist von einem gewöhnlichen Serverfehler unterscheidbar — sonst bliebe
     * ein abgelaufener Token unerkannt. Ausgeführt gegen einen Testserver.
     * Gegenprobe: in sicherAufrufen() 401 als Server statt Abgewiesen → rot.
     */
    @Test
    fun `sicherAufrufen meldet 401 als abgewiesen`() {
        val pfade = PfadServer()
        pfade.codes["/api/v1/stats"] = 401
        pfade.codes["/api/v1/finance/pnl"] = 500
        try {
            val finanzen = FinanzenRepository(TestApi.fuer(pfade.server))
            val abgelaufen = runBlocking { finanzen.getStats() } as Ergebnis.Error
            val kaputt = runBlocking { finanzen.getPnl() } as Ergebnis.Error
            assertTrue("Ein 401 trägt das Kennzeichen nicht", abgelaufen is Ergebnis.Error.Abgewiesen)
            assertFalse("Ein 500 gilt als abgelaufene Sitzung", kaputt is Ergebnis.Error.Abgewiesen)
        } finally {
            pfade.server.shutdown()
        }
    }

    // ── ImageLoader-Lebensdauer ──────────────────────────────────────────────

    @Test
    fun `der ImageLoader ist ein Singleton aus dem DI-Modul`() {
        val di = code(Quellen.di())
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
    fun `der Monitoring-Poll haengt am Lifecycle`() {
        val src = code(read("verwaltung/ui/screens/MonitoringScreen.kt"))
        assert(src.contains("repeatOnLifecycle")) {
            "Die 5s-Schleife im Monitoring läuft ohne repeatOnLifecycle. Ein " +
                "LaunchedEffect endet erst beim Verlassen des Screens, nicht beim " +
                "Wechsel in den Hintergrund — die App pollt dann weiter."
        }
        // Die Schleife selbst steht im ViewModel (haltAktuell, MonitoringViewModelVerhaltenTest).
        val loop = src.indexOf("mon.haltAktuell()")
        val guard = src.indexOf("repeatOnLifecycle")
        assert(loop >= 0) { "Poll-Schleife nicht gefunden — Test veraltet?" }
        assert(guard in 1 until loop) {
            "repeatOnLifecycle umschliesst die Poll-Schleife nicht"
        }
    }
}
