package ch.brickinventoryapp

import org.junit.Test

/**
 * Bilder und PDFs brauchen serverseitig eine Anmeldung — die App muss sie
 * mitschicken.
 *
 * ── Hintergrund ─────────────────────────────────────────────────────────────
 * Ab Server-Fassung 69 verlangt JEDE Bildadresse unter /images/… einen
 * gültigen Bearer-Token; vorher waren Set-Bilder ohne Anmeldung abrufbar
 * (Teile- und Minifiguren-Bilder schon immer mit). Anleitungen unter
 * /data/instructions/… waren durchgehend geschützt.
 *
 * Der Bild-Client hatte den Auth-Interceptor bereits — die Umstellung war
 * deshalb weitgehend unkritisch. Ein Pfad lief aber daran vorbei: Der
 * Herunterladen-Knopf im PDF-Betrachter startete über den System-Dienst
 * DownloadManager einen ZWEITEN, nicht authentifizierten Abruf derselben
 * Datei. Das Ergebnis war eine 401-Antwort, die als ".pdf" im Download-Ordner
 * landete — ohne Fehlermeldung, weil der DownloadManager den Statuscode nicht
 * prüft.
 *
 * Diese Tests halten die Kette fest.
 */
class MediaAuthTest {

    init {
        // Untergrenze (Nachtrag 118): Alle Prüfungen hier laufen über einen
        // eigenen Dateilauf und sammeln Verstösse. Fände er nichts, wären sie
        // allesamt grün, ohne etwas geprüft zu haben.
        check(Quellen.alle().size >= 60) { "Zu wenige Kotlin-Dateien — Pfad veraltet?" }
    }

    private fun read(rel: String): String {
        val f = java.io.File("src/main/java/ch/brickinventoryapp/$rel")
        assert(f.exists()) { "Datei nicht gefunden: $rel" }
        return f.readText()
    }

    private fun code(src: String): String {
        val s = src.replace(Regex("""/\*.*?\*/""", RegexOption.DOT_MATCHES_ALL), "")
        return s.lines().filterNot { it.trim().startsWith("//") }.joinToString("\n")
    }

    // ── Bilder ───────────────────────────────────────────────────────────────

    @Test
    fun `der Bild-Client haengt den Token an Anfragen an den eigenen Server`() {
        val di = code(read("di/AppModule.kt"))
        // Beide Clients entstehen aus derselben Fabrik — der Auth-Zweig darin
        // gilt also auch für den Bild-Client (isApiClient = false).
        assert(di.contains("""fun provideImageOkHttpClient""")) { "Bild-Client fehlt" }
        assert(di.contains("""buildInterceptorClient(prefs, isApiClient = false""")) {
            "Der Bild-Client muss aus derselben Fabrik kommen wie der API-Client — " +
            "sonst fehlt ihm der Authorization-Header"
        }
        assert(di.contains("""reqBuilder.header("Authorization", "Bearer ${'$'}token")""")) {
            "Kein Bearer-Header im gemeinsamen Interceptor"
        }
    }

    @Test
    fun `der Token geht nur an den eigenen Server, nicht an fremde Hosts`() {
        val di = code(read("di/AppModule.kt"))
        assert(di.contains("NetworkPolicy.isSameOrigin")) {
            "Ohne Origin-Vergleich ginge der Token auch an CDN-Adressen"
        }
        assert(!di.contains("urlStr.startsWith(serverUrl)")) {
            "Ein Präfixtest würde auch https://<serverUrl>.angreifer.tld treffen"
        }
    }

    @Test
    fun `eine 401 beim Bildladen meldet die abgelaufene Sitzung`() {
        val di = code(read("di/AppModule.kt"))
        assert(di.contains("response.code == 401") && di.contains("sessionExpired.notifyExpired()")) {
            "Sonst zeigt die Galerie nach Token-Ablauf stumm leere Kacheln"
        }
    }

    @Test
    fun `Bilder werden nicht am ImageLoader vorbei geladen`() {
        // Ein eigener HttpURLConnection- oder OkHttp-Aufruf für Bilder hätte den
        // Interceptor nicht und liefe damit ohne Token.
        for (rel in java.io.File("src/main/java/ch/brickinventoryapp").walkTopDown()
                .filter { it.extension == "kt" }) {
            val src = code(rel.readText())
            assert(!src.contains("HttpURLConnection")) {
                "${rel.name}: eigener HTTP-Aufruf — Bilder gehören über den ImageLoader"
            }
        }
    }

    @Test
    fun `der Bild-Cache wird beim Abmelden geleert`() {
        val session = code(read("ui/SessionFeature.kt"))
        assert(session.contains("imageLoader.memoryCache?.clear()")) { "Memory-Cache bleibt stehen" }
        assert(session.contains("imageLoader.diskCache?.clear()")) {
            "Sonst sieht der nächste Nutzer auf demselben Gerät die Bilder des vorherigen"
        }
    }

    // ── PDFs ─────────────────────────────────────────────────────────────────

    @Test
    fun `der PDF-Download kopiert die geladene Datei, statt neu zu laden`() {
        val viewer = code(read("ui/screens/PdfViewerScreen.kt"))
        assert(!viewer.contains("DownloadManager")) {
            "DownloadManager kennt den Bearer-Token nicht — der Abruf endet in einer 401, " +
            "die als PDF gespeichert wird"
        }
        assert(viewer.contains("savePdfToDownloads")) { "Kopier-Funktion fehlt" }
        assert(viewer.contains("MediaStore.Downloads")) {
            "Ab Android 10 ist der direkte Schreibzugriff auf Downloads/ gesperrt"
        }
    }

    @Test
    fun `der Herunterladen-Knopf erscheint erst, wenn die Datei geladen ist`() {
        val viewer = code(read("ui/screens/PdfViewerScreen.kt"))
        val actions = viewer.substringAfter("actions = {").substringBefore("            )")
        // Beide Knöpfe arbeiten auf s.file und dürfen nur im Zustand Ready sichtbar sein.
        assert(actions.contains("if (s is PdfLoadState.Ready)")) { "Ready-Prüfung fehlt" }
        val ready = actions.substringAfter("if (s is PdfLoadState.Ready)")
        assert(ready.contains("savePdfToDownloads(ctx, s.file, title)")) {
            "Der Herunterladen-Knopf muss innerhalb des Ready-Zweigs stehen — " +
            "vorher stand er ausserhalb und lud eigenständig neu"
        }
    }

    @Test
    fun `die Anzeige selbst laeuft ueber den authentifizierten Client`() {
        val viewer = code(read("ui/screens/PdfViewerScreen.kt"))
        // Geprüft wird die AUSSAGE, nicht der Wortlaut des Aufrufs: Der
        // Download läuft über den injizierten Client. Die frühere Fassung
        // suchte die Argumentliste zeichengenau und wurde in Nachtrag 115 rot,
        // als zwei Meldungstexte dazukamen und der Aufruf mehrzeilig wurde —
        // am Verhalten hatte sich nichts geändert. Dieselbe Sorte Test, die im
        // Manager schon einmal eine Sicherheitslücke festgeschrieben hat.
        val aufruf = Quellen.fenster(viewer, "downloadPdfWithResume(", 8)
        assert(aufruf.isNotEmpty()) { "Der Download-Aufruf fehlt ganz" }
        assert(aufruf.contains("httpClient")) {
            "Das PDF muss über den injizierten OkHttpClient geladen werden, nicht frei"
        }
        assert(!viewer.contains("OkHttpClient()")) {
            "Ein frei gebauter Client kennt den Bearer-Token nicht"
        }
    }

    // ── Pfade ────────────────────────────────────────────────────────────────

    @Test
    fun `die App baut keine Bildpfade selbst zusammen`() {
        // Seit Server-Fassung 68 liegen Teile- und Figurenbilder getrennt
        // (/images/parts/, /images/minifigs/) statt gemeinsam in
        // /data/part_images/. Die Adresse kommt fertig aus der API — wer sie
        // selbst zusammensetzt, bricht bei der nächsten Umsortierung.
        for (rel in java.io.File("src/main/java/ch/brickinventoryapp").walkTopDown()
                .filter { it.extension == "kt" }) {
            val src = code(rel.readText())
            assert(!src.contains("/data/part_images") && !src.contains("instructions/shared")) {
                "${rel.name}: alter Serverpfad fest verdrahtet"
            }
        }
    }

    // ── Erschöpfende when-Ausdrücke ──────────────────────────────────────────

    @Test
    fun `kein when ueber Result benutzt einen else-Zweig`() {
        // BrickRepository.kt hält ausdrücklich fest: Result ist versiegelt, und
        // jedes when darüber soll erschöpfend bleiben — damit ein künftiger
        // dritter Zustand überall als Compilerfehler auffällt statt still in
        // einem else zu verschwinden.
        //
        // Ist die Variable nullable deklariert (var x: Result<T>? = null, wie in
        // PdfExportManager für die Wiederholschleife), fehlt dem when der
        // null-Fall. Die Versuchung ist dann ein else — genau das soll hier
        // auffallen. Richtig ist ein expliziter `null ->`-Zweig.
        for (f in java.io.File("src/main/java/ch/brickinventoryapp").walkTopDown()
                .filter { it.extension == "kt" }) {
            val src = f.readText()
            var idx = src.indexOf("is Result.Success")
            while (idx >= 0) {
                val block = src.substring(idx, minOf(idx + 2000, src.length))
                val end = block.indexOf("\n            }")
                val body = if (end > 0) block.substring(0, end) else block
                // Beginnt im Fenster ein NEUES when, endet die Zuständigkeit
                // dieser Prüfung dort (Nachtrag 38). Vorher lief das
                // 2000-Zeichen-Fenster über das when-über-Result hinaus — in
                // PartsListFeature.kt bis in ein when über BEDINGUNGEN, wo ein
                // else-Zweig völlig korrekt und sogar nötig ist (kein sealed
                // type, also keine Erschöpfung möglich). Das wurde fälschlich
                // beanstandet und liess sich nur durch sinnlosen Umbau am Code
                // beheben.
                val naechstesWhen = body.indexOf("when ", 1)
                val bereich = if (naechstesWhen > 0) body.substring(0, naechstesWhen) else body
                assert(!bereich.contains("else ->")) {
                    "${f.name}: else-Zweig in einem when über Result — " +
                    "stattdessen einen expliziten null-Zweig ergänzen"
                }
                idx = src.indexOf("is Result.Success", idx + 1)
            }
        }
    }

    @Test
    fun `jedes AsyncImage benutzt den injizierten ImageLoader`() {
        // ── Woher dieser Test kommt ─────────────────────────────────────────
        // Im Set-Detail stand der Parameter als
        // @Suppress("UNUSED_PARAMETER") imageLoader: ImageLoader — durchgereicht,
        // aber nie benutzt; statt ihn einzusetzen war die Warnung
        // stummgeschaltet. Die AsyncImage-Aufrufe fielen dadurch auf Coils
        // Standard-Loader zurück, der den Bearer-Token nicht anhängt.
        //
        // Solange Set-Bilder ohne Anmeldung abrufbar waren, fiel das nicht auf.
        // Seit der Server für ALLE Bilder eine Anmeldung verlangt, antwortet er
        // mit 401 — der Detail-Dialog blieb leer, ohne Fehlermeldung. Genau die
        // Sorte Fehler, die kein Compiler und kein Typcheck findet.
        val offenders = mutableListOf<String>()
        for (f in java.io.File("src/main/java/ch/brickinventoryapp").walkTopDown()
                .filter { it.extension == "kt" }) {
            val src = f.readText()
            var i = src.indexOf("AsyncImage(")
            while (i >= 0) {
                val block = src.substring(i, minOf(i + 900, src.length))
                val end = block.indexOf("\n            )")
                val body = if (end > 0) block.substring(0, end) else block.take(600)
                if (!body.contains("imageLoader")) {
                    offenders.add("${f.name}:${src.substring(0, i).count { c -> c == '\n' } + 1}")
                }
                i = src.indexOf("AsyncImage(", i + 1)
            }
        }
        assert(offenders.isEmpty()) {
            "AsyncImage ohne imageLoader (Bilder bleiben nach 401 leer): ${offenders.joinToString()}"
        }
    }

    @Test
    fun `kein UNUSED_PARAMETER-Suppress auf einem ImageLoader`() {
        // Der Suppress war das Symptom: Er hat die Warnung beseitigt, die auf
        // genau diesen Fehler hingewiesen hätte.
        for (f in java.io.File("src/main/java/ch/brickinventoryapp").walkTopDown()
                .filter { it.extension == "kt" }) {
            val src = f.readText()
            assert(!Regex("""@Suppress\("UNUSED_PARAMETER"\)\s*imageLoader""").containsMatchIn(src)) {
                "${f.name}: imageLoader ist als unbenutzt markiert — dann fehlt der Auth-Header"
            }
        }
    }
}
