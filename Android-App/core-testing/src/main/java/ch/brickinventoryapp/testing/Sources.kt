package ch.brickinventoryapp.testing

import java.io.File

/**
 * Shared paths and cuts for structural checks (module boundaries, manifest, build,
 * bans). Behavior is checked by a test that runs the code, not here.
 */
object Sources {

    /** Android-App/, found from any module folder where Gradle starts the tests. */
    val project: File = generateSequence(File("").absoluteFile) { it.parentFile }
        .firstOrNull { File(it, "settings.gradle.kts").isFile }
        ?: error("settings.gradle.kts not found above ${File("").absolutePath}")

    /** The Gradle modules with source code, each as a folder under [project]. */
    val module: List<File> = project.listFiles { f -> File(f, "build.gradle.kts").isFile }.orEmpty().sortedBy { it.name }

    /**
     * All main sources under ch/brickinventoryapp, merged across the modules.
     * The checks ask about the app's rules, not about the module a
     * file currently lives in; one copy per test run saves every check the search.
     */
    val root: File by lazy { merged("src/main/java/ch/brickinventoryapp", "quellen") }

    /** All resources (app/ and core-resources/), likewise merged. */
    val res: File by lazy { merged("src/main/res", "res") }

    /** The tests of all modules (without core-testing, whose helpers are main sources). */
    val tests: File by lazy { merged("src/test/java/ch/brickinventoryapp", "tests") }

    /** The app's manifest — the only one; the libraries don't bring their own. */
    val manifest: File get() = File(project, "app/src/main/AndroidManifest.xml")

    private fun merged(subPath: String, name: String): File {
        // deleteOnExit() removes only an empty folder; each test JVM left a full copy of the sources in /tmp.
        val target = kotlin.io.path.createTempDirectory("bim-$name-").toFile()
        Runtime.getRuntime().addShutdownHook(Thread { target.deleteRecursively() })
        var n = 0
        for (m in module) {
            val source = File(m, subPath)
            if (!source.isDirectory) continue
            source.walkTopDown().filter { it.isFile }.forEach { f ->
                val rel = f.relativeTo(source).path
                val z = File(target, rel)
                check(!z.exists()) { "$rel lies in two modules" }
                f.copyTo(z); n++
            }
        }
        check(n > 0) { "No files under */$subPath in ${project.absolutePath}" }
        return target
    }

    /**
     * A workflow (default: the Android build run), without comment lines: a comment
     * that explains an old spelling names it and would otherwise be a find itself. The path holds,
     * because Gradle starts the tests from the module folder.
     */
    fun workflow(file: String = "android.yml"): String {
        val f = File("../../.github/workflows/$file")
        check(f.isFile) {
            "$file not found under ${f.absolutePath}. Without the file " +
                "the tests on it check nothing and would still be green."
        }
        return f.readLines().filterNot { it.trimStart().startsWith("#") }.joinToString("\n")
    }

    /** A source file, relative to ch/brickinventoryapp/. */
    fun read(rel: String): String = File(root, rel).readText()

    /**
     * The gallery, split across sibling files by section: a rule of the
     * screen applies to all of them, regardless of which file the section currently lives in.
     */
    fun gallery(): String = listOf("GalleryScreen.kt", "GalleryFilter.kt", "GalleryCard.kt", "GalleryRecord.kt")
        .joinToString("\n") { read("collection/ui/screens/$it") }

    /** Screens that, like the gallery, are split across sibling files, with their parts. */
    private val distributed = mapOf(
        "parts/ui/screens/PartsScreen.kt" to listOf("PartsFilterSheet.kt", "PartsCard.kt"),
        "parts/ui/screens/MinifigsScreen.kt" to listOf("FiguresCard.kt", "FiguresRecord.kt"),
        "parts/ui/screens/PartsListScreen.kt" to listOf("BuildListRows.kt"),
        "catalog/ui/screens/CatalogScreen.kt" to listOf("CatalogScrubber.kt", "CatalogCard.kt"),
        "collection/ui/screens/WantedListScreen.kt" to listOf("WantedListDialogs.kt", "WantedListRow.kt"),
        "finances/ui/screens/VouchersCard.kt" to listOf("VoucherForm.kt", "VoucherCard.kt"),
        "finances/ui/screens/PdfViewerScreen.kt" to listOf("PdfPages.kt"),
        "login/ui/screens/LoginScreen.kt" to listOf("LoginFields.kt", "LoginRegister.kt"),
        "login/ui/screens/SetupScreen.kt" to listOf("SetupQr.kt"),
    )

    /** The paths of a screen together with its parts; for an unsplit one, just itself. */
    fun screenFiles(rel: String): List<String> =
        listOf(rel) + distributed[rel].orEmpty().map { rel.substringBeforeLast('/') + "/" + it }

    /**
     * A screen together with its parts as one text: a rule of the whole screen
     * applies to all parts, regardless of which file a section currently lives in.
     */
    fun screen(rel: String): String = screenFiles(rel).joinToString("\n") { read(it) }

    /**
     * The Hilt module along with the network: AppModule, NetworkModule and the shared
     * interceptor (ServerClient) live separately in the modules' di/ folders; whoever checks a rule of the
     * network path reads all three.
     */
    fun di(): String {
        val files = all().filter { it.parentFile?.name == "di" }.sortedBy { it.name }
        check(files.size >= 3) { "Only ${files.size} files found in */di/" }
        return files.joinToString("\n") { it.readText() }
    }

    /**
     * All state classes: they live per scope in <root>/ui/<Area>States.kt. With a
     * lower bound, otherwise a renamed folder would check nothing and still be green.
     */
    fun states(): String {
        val files = all().filter { it.parentFile?.name == "ui" && it.name.endsWith("States.kt") }
            .sortedBy { it.name }
        check(files.size >= 5) { "Only ${files.size} state files found in */ui/" }
        return files.joinToString("\n") { it.readText() }
    }

    /**
     * All Kotlin source files of the main tree, with a lower bound: if a wrong path
     * found nothing, every collective check would stay green without having checked anything.
     */
    fun all(): List<File> {
        val files = root.walkTopDown().filter { it.isFile && it.extension == "kt" }.toList()
        check(files.size >= 60) {
            "Only ${files.size} Kotlin files found under ${root.absolutePath}. " +
                "That is too few — the path is probably wrong. All checks " +
                "that build on it would otherwise be silently green."
        }
        return files
    }

    /**
     * All source files below a subfolder, e.g. `"ui/screens"`. Compared via
     * invariantSeparatorsPath, because `path` returns backslashes on Windows and would otherwise find nothing.
     */
    fun below(folder: String): List<File> {
        val pattern = "/${folder.trim('/')}/"
        val hits = all().filter { it.invariantSeparatorsPath.contains(pattern) }
        check(hits.isNotEmpty()) {
            "No Kotlin files found under '$folder' — folder renamed? " +
                "An empty list would let every check building on it pass silently."
        }
        return hits
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
            val end = endOfCommentOrText(src, i)
            if (end == i) out.append(src[i++])
            else { for (c in src.substring(i, end)) out.append(if (c == '\n') '\n' else ' '); i = end }
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
    fun withoutComments(source: String): String = source.lines().joinToString("\n") { row ->
        val t = row.trim()
        if (t.startsWith("//") || t.startsWith("*") || t.startsWith("/*")) "" else row
    }

    /**
     * A section from the first occurrence of [ab], measured in lines without comments:
     * one more paragraph of explanation above the find spot thus shifts nothing.
     */
    fun window(source: String, ab: String, rows: Int): String {
        val clean = withoutComments(source)
        val i = clean.indexOf(ab)
        if (i < 0) return ""
        val abRow = clean.substring(0, i).count { it == '\n' }
        return clean.lines().drop(abRow).take(rows).joinToString("\n")
    }

    /**
     * The body of a function, from its signature to its closing
     * brace. More precise than a fixed window, for „does X appear in this
     * function?".
     */
    fun function(source: String, signature: String): String {
        val clean = withoutComments(source)
        val i = clean.indexOf(signature)
        if (i < 0) return ""
        val rest = clean.substring(i).lines()
        // Indentation of the signature line, not of the find spot: `internal` can come before `fun`.
        val rowsStart = clean.lastIndexOf('\n', i) + 1
        val indent = clean.substring(rowsStart).takeWhile { it == ' ' }
        val end = rest.drop(1).indexOfFirst { it == "$indent}" }
        return if (end < 0) rest.joinToString("\n") else rest.take(end + 2).joinToString("\n")
    }

    /**
     * A camera screen together with everything that belongs to its camera: the camera consists of
     * several files, and whoever reads only one finds half the rule.
     */
    fun cameraSource(rel: String): String = buildString {
        append(screen(rel))
        if (rel.endsWith("BarcodeScannerScreen.kt")) {
            append("\n"); append(read("collection/ui/screens/BarcodeAnalyzer.kt"))
        }
        append("\n"); append(read("ui/screens/CameraSetup.kt"))
    }
}
