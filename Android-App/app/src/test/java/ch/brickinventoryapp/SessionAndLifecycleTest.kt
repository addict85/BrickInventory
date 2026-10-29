package ch.brickinventoryapp

import ch.brickinventoryapp.data.cache.ResponseCache
import ch.brickinventoryapp.data.repository.FinanzenRepository
import ch.brickinventoryapp.data.repository.Result
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Absicherung der Review-Runde: abgelaufene Sitzung, ImageLoader-Lebensdauer,
 * Hintergrund-Polling und der entfernte tote Barcode-Zweitpfad.
 *
 * Der 401 ist ausgeführt geprüft; der Rest liest Quelltext (Gerät und
 * Compose fehlen hier).
 */
class SessionAndLifecycleTest {

    private fun read(rel: String): String {
        val f = java.io.File("src/main/java/ch/brickinventoryapp/$rel")
        assert(f.exists()) { "Datei nicht gefunden: $rel" }
        return f.readText()
    }

    private fun exists(rel: String) =
        java.io.File("src/main/java/ch/brickinventoryapp/$rel").exists()

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
     * Gegenprobe (29.10.2026, gemessen): in RepoBasis.safeCall `unauthorized =
     * false` → rot.
     */
    @Test
    fun `safeCall markiert 401 als unauthorized`() {
        val pfade = PfadServer()
        pfade.codes["/api/v1/stats"] = 401
        pfade.codes["/api/v1/finance/pnl"] = 500
        try {
            val finanzen = FinanzenRepository(TestApi.fuer(pfade.server), ResponseCache { java.io.File(System.getProperty("java.io.tmpdir"), "bim-401") })
            val abgelaufen = runBlocking { finanzen.getStats() } as Result.Error
            val kaputt = runBlocking { finanzen.getPnl() } as Result.Error
            assertTrue("Ein 401 trägt das Kennzeichen nicht", abgelaufen.unauthorized)
            assertFalse("Ein 500 gilt als abgelaufene Sitzung", kaputt.unauthorized)
        } finally {
            pfade.server.shutdown()
        }
    }

    @Test
    fun `das AppViewModel loggt bei abgelaufener Sitzung aus`() {
        val src = code(read("ui/AppViewModel.kt"))
        assert(src.contains("sessionExpired.events.collect")) {
            "Das AppViewModel sammelt das SessionExpiredSignal nicht ein"
        }
        val block = src.substringAfter("sessionExpired.events.collect").substringBefore("\n        }")
        assert(block.contains("isLoggedIn")) {
            "Der Logout-Zweig prüft nicht, ob überhaupt eine Sitzung besteht"
        }
        assert(block.contains("logout()")) { "Es wird nicht ausgeloggt" }
    }

    // ── ImageLoader-Lebensdauer ──────────────────────────────────────────────

    @Test
    fun `der ImageLoader ist ein Singleton aus dem DI-Modul`() {
        val di = code(Quellen.di())
        assert(di.contains("fun provideImageLoader")) {
            "Kein ImageLoader-Provider in AppModule"
        }
        val act = code(read("MainActivity.kt"))
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
        val src = code(read("ui/screens/MonitoringScreen.kt"))
        assert(src.contains("repeatOnLifecycle")) {
            "Die 5s-Schleife im Monitoring läuft ohne repeatOnLifecycle. Ein " +
                "LaunchedEffect endet erst beim Verlassen des Screens, nicht beim " +
                "Wechsel in den Hintergrund — die App pollt dann weiter."
        }
        val loop = src.indexOf("while (true) { mon.ladeJobs()")
        val guard = src.indexOf("repeatOnLifecycle")
        assert(loop >= 0) { "Poll-Schleife nicht gefunden — Test veraltet?" }
        assert(guard in 1 until loop) {
            "repeatOnLifecycle umschliesst die Poll-Schleife nicht"
        }
    }

    // ── Entfernter toter Barcode-Zweitpfad ───────────────────────────────────

    @Test
    fun `der tote zweite Barcode-Pfad bleibt entfernt`() {
        assert(!exists("data/BarcodeResolver.kt")) {
            "BarcodeResolver.kt ist zurück. Die Klasse war nie erreichbar, und ihr " +
                "blockierender Call.execute() lief aus dem viewModelScope ohne " +
                "Dispatchers.IO — die Server-Abfrage darin hat nie funktioniert, der " +
                "Fehler wurde vom umgebenden catch verschluckt."
        }
        assert(!exists("ui/screens/BarcodeResultDialog.kt")) {
            "BarcodeResultDialog.kt ist zurück — der Dialog wurde von keinem Screen aufgerufen"
        }
        val dead = listOf(
            "startBarcodeScanner", "dismissBarcodeScanner",
            "onBarcodeDetected", "confirmBarcodeAdd",
            "barcodeScanning", "barcodeResolving",
            "barcodeResolvedSetNumber", "barcodeResolvedSet",
        )
        val feature = read("ui/viewmodel/ErfassungViewModel.kt")
        val state = Quellen.zustaende()
        for (name in dead) {
            assert(!feature.contains(name)) { "$name ist in ErfassungViewModel.kt zurück" }
            assert(!state.contains(name)) { "$name ist in AppUiState zurück" }
        }
    }

    /**
     * Der LIVE-Pfad muss bleiben: Scanner-Screen → erfassung.resolveBarcode() →
     * repo.resolveBarcode(). Er hat mit dem entfernten Zweitpfad nichts zu tun,
     * und an ihm hängt der Kamera-Autofokus (siehe INVARIANTEN.md).
     */
    @Test
    fun `der live genutzte Barcode-Pfad ist unberuehrt`() {
        assert(exists("ui/screens/BarcodeScannerScreen.kt")) {
            "BarcodeScannerScreen.kt fehlt — das ist der Screen mit dem Autofokus"
        }
        assert(code(read("ui/viewmodel/ErfassungViewModel.kt")).contains("fun resolveBarcode(")) {
            "resolveBarcode() fehlt — der live genutzte Auflösungspfad"
        }
        assert(code(read("nav/ToolsGraph.kt")).contains("erfassung.resolveBarcode(")) {
            "Der Scanner-Screen ruft resolveBarcode() nicht mehr auf"
        }
    }

    // Die Autofokus-Regel stand hier ein viertes Mal. Sie gehoert nicht zum
    // Thema dieser Datei (Sitzung und Lebenszyklus) und steht jetzt
    // vollstaendig in CameraFocusConfigTest.

}
