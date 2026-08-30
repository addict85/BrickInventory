package ch.brickinventoryapp

import org.junit.Test

/**
 * Absicherung der Review-Runde: abgelaufene Sitzung, ImageLoader-Lebensdauer,
 * Hintergrund-Polling und der entfernte tote Barcode-Zweitpfad.
 *
 * Alle Prüfungen lesen nur die Quelldateien — kein Gerät, kein Compose, kein
 * Netzwerk nötig.
 */
class SessionAndLifecycleTest {

    private fun read(rel: String): String {
        val f = java.io.File("src/main/java/ch/brickinventoryapp/$rel")
        assert(f.exists()) { "Datei nicht gefunden: $rel" }
        return f.readText()
    }

    private fun exists(rel: String) =
        java.io.File("src/main/java/ch/brickinventoryapp/$rel").exists()

    /**
     * Ein Kamera-Bildschirm samt seiner ausgelagerten Bildanalyse.
     *
     * Der Barcode-Scanner besteht seit Nachtrag 99 aus ZWEI Dateien: der
     * Bildschirm bindet die Vorschau, BarcodeAnalyzer.kt die ImageAnalysis.
     * Nur eine davon zu lesen fand die halbe Regel und meldete einen Verstoss,
     * den es nicht gibt.
     */
    private fun mitAnalyse(rel: String): String =
        read(rel) + if (rel.endsWith("BarcodeScannerScreen.kt"))
            "\n" + read("ui/screens/BarcodeAnalyzer.kt") else ""

    /** Kommentare ausblenden — die Erklärtexte nennen die geprüften Muster selbst. */
    private fun code(src: String): String {
        val withoutBlocks = src.replace(Regex("""/\*.*?\*/""", RegexOption.DOT_MATCHES_ALL), "")
        return withoutBlocks.lines()
            .filterNot { it.trim().startsWith("//") }
            .joinToString("\n")
    }

    // ── Abgelaufene Sitzung (HTTP 401) ───────────────────────────────────────

    /**
     * Alle Dateien der Datenschicht als EIN Text (Nachtrag 155).
     *
     * Vorher stand hier "data/repository/BrickRepository.kt" — ein Dateiname.
     * Die 78 Funktionen liegen seither in fuenf Klassen nach Sachgebieten,
     * die gemeinsame Mechanik in RepoBasis. Gemeint ist DIE DATENSCHICHT,
     * nicht eine Datei.
     */
    private fun datenschicht(): String =
        java.io.File("src/main/java/ch/brickinventoryapp/data/repository")
            .listFiles { f -> f.extension == "kt" }
            .orEmpty().sortedBy { it.name }
            .joinToString("\n") { it.readText() }

    @Test
    fun `safeCall markiert 401 als unauthorized`() {
        val src = code(datenschicht())
        assert(src.contains("val unauthorized: Boolean")) {
            "Result.Error kennt kein unauthorized-Flag — ein 401 ist dann nicht " +
                "von einem gewöhnlichen Serverfehler unterscheidbar"
        }
        assert(Regex("""unauthorized\s*=\s*response\.code\(\)\s*==\s*401""").containsMatchIn(src)) {
            "safeCall() setzt unauthorized nicht aus dem HTTP-Status — ein abgelaufener " +
                "Token bliebe unerkannt und die App auf ewig scheinbar eingeloggt"
        }
    }

    @Test
    fun `cached greift bei 401 NICHT auf den Plattenspeicher zurueck`() {
        val src = code(datenschicht())
        // Anker ohne Sichtbarkeitsmodifikator (Nachtrag 155): cached() ist nach
        // der Aufteilung `protected` in RepoBasis, damit die fuenf
        // Teil-Repositories herankommen. Geprueft ist hier die REIHENFOLGE im
        // Rumpf — erst die 401-Ausnahme, dann der Cache-Rueckgriff —, nicht wer
        // die Funktion sehen darf.
        val body = src.substringAfter("suspend fun <T : Any> cached(")
            .substringBefore("\n    }")
        val guard = body.indexOf("unauthorized")
        val fallback = body.indexOf("cache.get(")
        assert(guard >= 0) {
            "cached() prüft unauthorized nicht. Ohne diese Ausnahme deckt der bis zu " +
                "7 Tage alte Cache eine abgelaufene Sitzung zu: Der Nutzer sieht eine " +
                "scheinbar normale Galerie, obwohl keine Sitzung mehr besteht."
        }
        assert(fallback >= 0) { "cached() ohne cache.get() — Test veraltet?" }
        assert(guard < fallback) {
            "Die 401-Ausnahme steht NACH dem Cache-Rückgriff und wirkt damit nicht mehr"
        }
    }

    @Test
    fun `der Interceptor meldet 401 nur mit Token und nur fuer unseren Server`() {
        val src = code(read("di/AppModule.kt"))
        assert(src.contains("sessionExpired.notifyExpired()")) {
            "AppModule meldet keinen abgelaufenen Token — MainViewModel erfährt nie davon"
        }
        assert(Regex("""response\.code\s*==\s*401\s*&&\s*token\.isNotBlank\(\)\s*&&\s*isOurServer""")
            .containsMatchIn(src)) {
            "Die 401-Meldung ist nicht auf \"Token mitgeschickt UND eigener Server\" " +
                "eingeschränkt. Ohne diesen Schutz würde ein fehlgeschlagener " +
                "Login-Versuch (noch kein Token) oder ein 401 von einem fremden CDN " +
                "als abgelaufene Sitzung gewertet und den Nutzer ausloggen."
        }
    }

    @Test
    fun `MainViewModel loggt bei abgelaufener Sitzung aus`() {
        val src = code(read("ui/MainViewModel.kt"))
        assert(src.contains("sessionExpired.events.collect")) {
            "MainViewModel sammelt das SessionExpiredSignal nicht ein"
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
        val di = code(read("di/AppModule.kt"))
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
        val loop = src.indexOf("while (true) { loadJobs()")
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
        val feature = read("ui/BarcodeFeature.kt")
        val state = read("ui/UiState.kt")
        for (name in dead) {
            assert(!feature.contains(name)) { "$name ist in BarcodeFeature.kt zurück" }
            assert(!state.contains(name)) { "$name ist in AppUiState zurück" }
        }
    }

    /**
     * Der LIVE-Pfad muss bleiben: Scanner-Screen → vm.resolveBarcode() →
     * repo.resolveBarcode(). Er hat mit dem entfernten Zweitpfad nichts zu tun,
     * und an ihm hängt der Kamera-Autofokus (siehe INVARIANTEN.md).
     */
    @Test
    fun `der live genutzte Barcode-Pfad ist unberuehrt`() {
        assert(exists("ui/screens/BarcodeScannerScreen.kt")) {
            "BarcodeScannerScreen.kt fehlt — das ist der Screen mit dem Autofokus"
        }
        assert(code(read("ui/BarcodeFeature.kt")).contains("fun MainViewModel.resolveBarcode(")) {
            "resolveBarcode() fehlt — der live genutzte Auflösungspfad"
        }
        assert(code(read("nav/ToolsGraph.kt")).contains("vm.resolveBarcode(")) {
            "Der Scanner-Screen ruft resolveBarcode() nicht mehr auf"
        }
    }

    /**
     * Autofokus — dieselbe Regel wie in INVARIANTEN.md, hier noch einmal
     * geprüft, weil in dieser Runde eine Barcode-Datei gelöscht wurde und die
     * Regel schon mehrfach unbeabsichtigt gebrochen wurde.
     */
    @Test
    fun `der Kamera-Autofokus bleibt kontinuierlich und ohne Fokus-Pump`() {
        val src = mitAnalyse("ui/screens/BarcodeScannerScreen.kt")
        val hits = Regex("""CONTROL_AF_MODE_CONTINUOUS_PICTURE""").findAll(code(src)).count()
        assert(hits >= 2) {
            "CONTROL_AF_MODE_CONTINUOUS_PICTURE steht nur ${hits}x im Code. Der Modus " +
                "muss an BEIDEN Use Cases hängen (Preview UND ImageAnalysis) — CameraX " +
                "führt die Konfigurationen zu einem Repeating-Request zusammen, und bei " +
                "nur einer Angabe entscheidet je nach Gerät die andere mit."
        }
        val body = code(src)
        val pump = Regex("""(while\s*\(|delay\s*\(|Timer\(|fixedRate)[\s\S]{0,200}?startFocusAndMetering""")
        assert(!pump.containsMatchIn(body)) {
            "startFocusAndMetering steht in einer Schleife/hinter einem Timer " +
                "(\"Fokus-Pump\") — der Fokus wandert dann dauernd. Tap-to-Focus im " +
                "Touch-Listener ist in Ordnung, eine getaktete Wiederholung nicht."
        }
    }
}
