package ch.brickinventoryapp.data

import ch.brickinventoryapp.testing.Sources
import org.junit.Test

/**
 * Images and PDFs need sign-in on the server side — the app must send it
 * along.
 *
 * ── Background ──────────────────────────────────────────────────────────────
 * From server version 69 on, EVERY image address under /images/… requires a
 * valid bearer token; before, set images were fetchable without sign-in
 * (part and minifigure images always with it). Instructions under
 * /data/instructions/… were protected throughout.
 *
 * The image client already had the auth interceptor — the switch was
 * therefore largely uncritical. One path went around it though: the
 * download button in the PDF viewer started, via the system service
 * DownloadManager, a SECOND, unauthenticated fetch of the same
 * file. The result was a 401 response that landed as ".pdf" in the download folder
 * — without an error message, because DownloadManager does not check the
 * status code.
 *
 * These tests pin down the bans along the chain; the download button (PdfDownloadTest,
 * feature-finances) and the instruction client (InstructionDownloadTest) run.
 */
class MediaAuthTest {

    init {
        // Lower bound: all checks here run over their
        // own file walk and collect violations. If it found nothing, they would
        // all be green without having checked anything.
        check(Sources.all().size >= 60) { "Too few Kotlin files — path outdated?" }
    }

    private fun code(src: String): String {
        val s = src.replace(Regex("""/\*.*?\*/""", RegexOption.DOT_MATCHES_ALL), "")
        return s.lines().filterNot { it.trim().startsWith("//") }.joinToString("\n")
    }

    // ── Images ───────────────────────────────────────────────────────────────

    @Test
    fun `images are not loaded bypassing the ImageLoader`() {
        // An own HttpURLConnection or OkHttp call for images would not have the
        // interceptor and would thus run without a token.
        for (rel in Sources.root.walkTopDown()
                .filter { it.extension == "kt" }) {
            val src = code(rel.readText())
            assert(!src.contains("HttpURLConnection")) {
                "${rel.name}: its own HTTP call — images belong to the ImageLoader"
            }
        }
    }

    // That signing out clears the image cache is checked, executed, by LogoutCleansEverythingTest (app).

    // ── Paths ────────────────────────────────────────────────────────────────

    @Test
    fun `the app does not assemble image paths itself`() {
        // Since server version 68 part and figure images lie separately
        // (/images/parts/, /images/minifigs/) instead of together in
        // /data/part_images/. The address comes ready from the API — whoever
        // assembles it themselves breaks at the next re-sorting.
        for (rel in Sources.root.walkTopDown()
                .filter { it.extension == "kt" }) {
            val src = code(rel.readText())
            assert(!src.contains("/data/part_images") && !src.contains("instructions/shared")) {
                "${rel.name}: alter Serverpfad fest verdrahtet"
            }
        }
    }

    // ── Exhaustive when expressions ──────────────────────────────────────────

    @Test
    fun `no when over Result uses an else branch`() {
        // BrickRepository.kt states explicitly: Result is sealed, and
        // every when over it shall stay exhaustive — so that a future
        // third state stands out everywhere as a compiler error instead of silently
        // disappearing in an else.
        //
        // If the variable is declared nullable (var x: Result<T>? = null, as in
        // PdfExportManager for the retry loop), the when lacks the
        // null case. The temptation is then an else — exactly that shall stand
        // out here. Correct is an explicit `null ->` branch.
        for (f in Sources.root.walkTopDown()
                .filter { it.extension == "kt" }) {
            val src = f.readText()
            var idx = src.indexOf("is Ergebnis.Erfolg")
            while (idx >= 0) {
                val block = src.substring(idx, minOf(idx + 2000, src.length))
                val end = block.indexOf("\n            }")
                val body = if (end > 0) block.substring(0, end) else block
                // If a NEW when begins in the window, the responsibility
                // of this check ends there. Before, the
                // 2000-character window ran past the when-over-Result — in
                // PartsListFeature.kt into a when over CONDITIONS, where an
                // else branch is entirely correct and even necessary (no sealed
                // type, thus no exhaustiveness possible). That was wrongly
                // flagged and could only be fixed by pointless rebuilding of the
                // code.
                val nextWhen = body.indexOf("when ", 1)
                val area = if (nextWhen > 0) body.substring(0, nextWhen) else body
                assert(!area.contains("else ->")) {
                    "${f.name}: else branch in a when over Result — " +
                    "add an explicit null branch instead"
                }
                idx = src.indexOf("is Ergebnis.Erfolg", idx + 1)
            }
        }
    }

    @Test
    fun `every AsyncImage uses the injected ImageLoader`() {
        // An AsyncImage without the injected loader falls back to Coil's default loader,
        // which does not attach the bearer token; the server then answers with 401,
        // and the area stays empty without an error message.
        val offenders = mutableListOf<String>()
        for (f in Sources.root.walkTopDown()
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
            "AsyncImage without imageLoader (images stay empty after 401): ${offenders.joinToString()}"
        }
    }

    @Test
    fun `no UNUSED_PARAMETER suppress on an ImageLoader`() {
        // The suppress was the symptom: it removed the warning that would have
        // pointed to exactly this error.
        for (f in Sources.root.walkTopDown()
                .filter { it.extension == "kt" }) {
            val src = f.readText()
            assert(!Regex("""@Suppress\("UNUSED_PARAMETER"\)\s*imageLoader""").containsMatchIn(src)) {
                "${f.name}: imageLoader is marked as unused — then the auth header is missing"
            }
        }
    }
}
