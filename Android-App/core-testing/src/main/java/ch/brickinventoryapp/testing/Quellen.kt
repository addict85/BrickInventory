package ch.brickinventoryapp.testing

import java.io.File

/**
 * Shared paths and cuts for structural checks (module boundaries, manifest, build,
 * bans). Behavior is checked by a test that runs the code, not here.
 */
object Quellen {

    /** Android-App/, found from any module folder where Gradle starts the tests. */
    val project: File = generateSequence(File("").absoluteFile) { it.parentFile }
        .firstOrNull { File(it, "settings.gradle.kts").isFile }
        ?: error("settings.gradle.kts nicht gefunden über ${File("").absolutePath}")

    /** The Gradle modules with source code, each as a folder under [project]. */
    val module: List<File> = project.listFiles { f -> File(f, "build.gradle.kts").isFile }.orEmpty().sortedBy { it.name }

    /**
     * All main sources under ch/brickinventoryapp, merged across the modules.
     * The checks ask about the app's rules, not about the module a
     * file currently lives in; one copy per test run saves every check the search.
     */
    val root: File by lazy { vereint("src/main/java/ch/brickinventoryapp", "quellen") }

    /** All resources (app/ and core-resources/), likewise merged. */
    val res: File by lazy { vereint("src/main/res", "res") }

    /** The tests of all modules (without core-testing, whose helpers are main sources). */
    val tests: File by lazy { vereint("src/test/java/ch/brickinventoryapp", "tests") }

    /** The app's manifest — the only one; the libraries don't bring their own. */
    val manifest: File get() = File(project, "app/src/main/AndroidManifest.xml")

    private fun vereint(unterpfad: String, name: String): File {
        val ziel = kotlin.io.path.createTempDirectory("bim-$name-").toFile().apply { deleteOnExit() }
        var n = 0
        for (m in module) {
            val quelle = File(m, unterpfad)
            if (!quelle.isDirectory) continue
            quelle.walkTopDown().filter { it.isFile }.forEach { f ->
                val rel = f.relativeTo(quelle).path
                val z = File(ziel, rel)
                check(!z.exists()) { "$rel liegt in zwei Modulen" }
                f.copyTo(z); n++
            }
        }
        check(n > 0) { "Keine Dateien unter */$unterpfad in ${project.absolutePath}" }
        return ziel
    }

    /**
     * A workflow (default: the Android build run), without comment lines: a comment
     * that explains an old spelling names it and would otherwise be a find itself. The path holds,
     * because Gradle starts the tests from the module folder.
     */
    fun workflow(datei: String = "android.yml"): String {
        val f = File("../../.github/workflows/$datei")
        check(f.isFile) {
            "$datei nicht gefunden unter ${f.absolutePath}. Ohne die Datei " +
                "pruefen die Tests darauf nichts und waeren trotzdem gruen."
        }
        return f.readLines().filterNot { it.trimStart().startsWith("#") }.joinToString("\n")
    }

    /** A source file, relative to ch/brickinventoryapp/. */
    fun lies(rel: String): String = File(root, rel).readText()

    /**
     * The gallery, split across sibling files by section: a rule of the
     * screen applies to all of them, regardless of which file the section currently lives in.
     */
    fun galerie(): String = listOf("GalleryScreen.kt", "GalerieFilter.kt", "GalerieKarte.kt", "GalerieErfassen.kt")
        .joinToString("\n") { lies("collection/ui/screens/$it") }

    /** Screens that, like the gallery, are split across sibling files, with their parts. */
    private val distributed = mapOf(
        "parts/ui/screens/PartsScreen.kt" to listOf("TeileFilterBlatt.kt", "TeileKarte.kt"),
        "parts/ui/screens/MinifigsScreen.kt" to listOf("FigurenKarte.kt", "FigurenErfassen.kt"),
        "parts/ui/screens/PartsListScreen.kt" to listOf("BaulisteZeilen.kt"),
        "catalog/ui/screens/CatalogScreen.kt" to listOf("KatalogScrubber.kt", "KatalogKarte.kt"),
        "collection/ui/screens/MerklisteScreen.kt" to listOf("MerklisteDialoge.kt", "MerklisteZeile.kt"),
        "finances/ui/screens/GutscheineCard.kt" to listOf("GutscheinFormular.kt", "GutscheinKarte.kt"),
        "finances/ui/screens/PdfViewerScreen.kt" to listOf("PdfSeiten.kt"),
        "login/ui/screens/LoginScreen.kt" to listOf("LoginAnmelden.kt", "LoginRegistrieren.kt"),
        "login/ui/screens/SetupScreen.kt" to listOf("SetupQr.kt"),
    )

    /** The paths of a screen together with its parts; for an unsplit one, just itself. */
    fun screenFiles(rel: String): List<String> =
        listOf(rel) + distributed[rel].orEmpty().map { rel.substringBeforeLast('/') + "/" + it }

    /**
     * A screen together with its parts as one text: a rule of the whole screen
     * applies to all parts, regardless of which file a section currently lives in.
     */
    fun bildschirm(rel: String): String = screenFiles(rel).joinToString("\n") { lies(it) }

    /**
     * The Hilt module along with the network: AppModule, NetzModule and the shared
     * interceptor (ServerClient) live separately in the modules' di/ folders; whoever checks a rule of the
     * network path reads all three.
     */
    fun di(): String {
        val dateien = alle().filter { it.parentFile?.name == "di" }.sortedBy { it.name }
        check(dateien.size >= 3) { "Nur ${dateien.size} Dateien in */di/ gefunden" }
        return dateien.joinToString("\n") { it.readText() }
    }

    /**
     * All state classes: they live per scope in <stamm>/ui/Zustand*.kt. With a
     * lower bound, otherwise a renamed folder would check nothing and still be green.
     */
    fun states(): String {
        val dateien = alle().filter { it.parentFile?.name == "ui" && it.name.startsWith("Zustand") }
            .sortedBy { it.name }
        check(dateien.size >= 5) { "Nur ${dateien.size} Zustandsdateien in */ui/ gefunden" }
        return dateien.joinToString("\n") { it.readText() }
    }

    /**
     * All Kotlin source files of the main tree, with a lower bound: if a wrong path
     * found nothing, every collective check would stay green without having checked anything.
     */
    fun alle(): List<File> {
        val dateien = root.walkTopDown().filter { it.isFile && it.extension == "kt" }.toList()
        check(dateien.size >= 60) {
            "Nur ${dateien.size} Kotlin-Dateien unter ${root.absolutePath} gefunden. " +
                "Das ist zu wenig — vermutlich stimmt der Pfad nicht mehr. Alle Prüfungen, " +
                "die darauf aufbauen, wären sonst stillschweigend grün."
        }
        return dateien
    }

    /**
     * All source files below a subfolder, e.g. `"ui/screens"`. Compared via
     * invariantSeparatorsPath, because `path` returns backslashes on Windows and would otherwise find nothing.
     */
    fun unter(folder: String): List<File> {
        val pattern = "/${folder.trim('/')}/"
        val treffer = alle().filter { it.invariantSeparatorsPath.contains(pattern) }
        check(treffer.isNotEmpty()) {
            "Keine Kotlin-Dateien unter '$folder' gefunden — Ordner umbenannt? " +
                "Eine leere Liste würde jede darauf aufbauende Prüfung stillschweigend bestehen."
        }
        return treffer
    }

    /**
     * Comments and string literals replaced with spaces, lines and columns
     * stay intact: a find thus points to the real spot, and a file name inside a
     * string is not a call.
     */
    fun strip(src: String): String {
        val out = StringBuilder(src.length)
        var i = 0
        while (i < src.length) {
            val ende = endOfCommentOrText(src, i)
            if (ende == i) out.append(src[i++])
            else { for (c in src.substring(i, ende)) out.append(if (c == '\n') '\n' else ' '); i = ende }
        }
        return out.toString()
    }

    /** Where a comment or string literal starting at [i] ends; [i] if none starts there. */
    private fun endOfCommentOrText(src: String, i: Int): Int = when {
        src.startsWith("//", i) -> src.indexOf('\n', i).let { if (it < 0) src.length else it }
        src.startsWith("/*", i) -> src.indexOf("*/", i + 2).let { if (it < 0) src.length else it + 2 }
        src.startsWith("\"\"\"", i) -> src.indexOf("\"\"\"", i + 3).let { if (it < 0) src.length else it + 3 }
        src[i] == '"' -> endTheString(src, i)
        else -> i
    }

    private fun endTheString(src: String, i: Int): Int {
        var j = i + 1
        while (j < src.length && src[j] != '"') j += if (src[j] == '\\') 2 else 1
        return minOf(j + 1, src.length)
    }

    /**
     * Hide comments, line by line: Kotlin nests block comments, and a
     * pattern over the whole file would swallow the rest after an asterisk following a slash
     * inside a comment.
     */
    fun withoutComments(quelle: String): String = quelle.lines().joinToString("\n") { zeile ->
        val t = zeile.trim()
        if (t.startsWith("//") || t.startsWith("*") || t.startsWith("/*")) "" else zeile
    }

    /**
     * A section from the first occurrence of [ab], measured in lines without comments:
     * one more paragraph of explanation above the find spot thus shifts nothing.
     */
    fun fenster(quelle: String, ab: String, zeilen: Int): String {
        val clean = withoutComments(quelle)
        val i = clean.indexOf(ab)
        if (i < 0) return ""
        val abRow = clean.substring(0, i).count { it == '\n' }
        return clean.lines().drop(abRow).take(zeilen).joinToString("\n")
    }

    /**
     * The body of a function, from its signature to its closing
     * brace. More precise than a fixed window, for „does X appear in this
     * function?".
     */
    fun function(quelle: String, signatur: String): String {
        val clean = withoutComments(quelle)
        val i = clean.indexOf(signatur)
        if (i < 0) return ""
        val rest = clean.substring(i).lines()
        // Indentation of the signature line, not of the find spot: `internal` can come before `fun`.
        val rowsStart = clean.lastIndexOf('\n', i) + 1
        val indent = clean.substring(rowsStart).takeWhile { it == ' ' }
        val ende = rest.drop(1).indexOfFirst { it == "$indent}" }
        return if (ende < 0) rest.joinToString("\n") else rest.take(ende + 2).joinToString("\n")
    }

    /**
     * A camera screen together with everything that belongs to its camera: the camera consists of
     * several files, and whoever reads only one finds half the rule.
     */
    fun cameraSource(rel: String): String = buildString {
        append(bildschirm(rel))
        if (rel.endsWith("BarcodeScannerScreen.kt")) {
            append("\n"); append(lies("collection/ui/screens/BarcodeAnalyzer.kt"))
        }
        append("\n"); append(lies("ui/screens/KameraAufbau.kt"))
    }
}
