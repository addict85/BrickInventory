package ch.brickinventoryapp.app

import ch.brickinventoryapp.data.util.PartListVault
import ch.brickinventoryapp.security.StoreCipher
import ch.brickinventoryapp.testing.Sources
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/**
 * `INVARIANTEN.md` refers to source files and test classes; a reference to
 * something that was renamed or deleted misleads readers. Only checked
 * is that they exist, not whether the test still fully carries the rule.
 *
 * Checkable statements it checks itself: no FileProvider in the manifest, the parts list
 * only encrypted on disk.
 *
 * Counter-checks:
 *   invariants-dangling-reference  a reference to `ui/GalleryFeature.kt` → red “every source file and
 *                                  test class named in INVARIANTEN …”
 *   invariants-fileprovider-back  „FileProvider nur `pdf/`“ again in INVARIANTEN → red, the same test
 *   invariants-part-list-plaintext  PartListVault's write stores the plaintext → red “the
 *                                  parts list lies on disk only encrypted”
 */
class InvariantsReferencesTest {

    /** `*` stands for any characters within a name, never across a slash. */
    private fun pattern(name: String) = Regex(name.split("*").joinToString("[^/]*") { Regex.escape(it) })

    private fun files(root: File) = root.walkTopDown().filter { it.isFile }
        .map { it.relativeTo(root).invariantSeparatorsPath }.toList()

    @Test
    fun `every source file and test class named in INVARIANTEN exists`() {
        val docs = File(Sources.project, "INVARIANTEN.md").readText()
        val sources = files(Sources.root)
        val tests = files(Sources.tests).map { it.substringAfterLast('/') }.toSet()
        val named = Regex("`([^`\\s]+\\.kt)`").findAll(docs).map { it.groupValues[1] }.toSet()
        val classes = Regex("""\b[A-Z][A-Za-z0-9]*Test\b""").findAll(docs).map { it.value }.toSet()
        assertTrue("Only ${named.size} files, ${classes.size} test classes found — does the search still apply?",
            named.size >= 30 && classes.size >= 20)
        val missing = named.filter { d ->
            val m = pattern(d)
            sources.none { m.matches(if ('/' in d) it else it.substringAfterLast('/')) }
        } + classes.filter { "$it.kt" !in tests }.map { "$it (Testklasse)" }
        assertTrue("every file and test class named in INVARIANTEN.md must exist; missing:\n  " +
            missing.joinToString("\n  "), missing.isEmpty())

        // Statements the code once refuted, and the structure behind „Kein FileProvider“.
        val outdated = listOf("FileProvider nur", "Klartext für die Ziel-App", "Unsignierte `version.json`")
        assertTrue("outdated in INVARIANTEN.md: ${outdated.filter { it in docs }}", outdated.none { it in docs })
        val manifest = Sources.manifest.readText()
        assertTrue("INVARIANTEN.md says “no FileProvider”", "**Kein FileProvider.**" in docs)
        assertFalse("the manifest carries a FileProvider", "FileProvider" in manifest)
        val partList = Regex("""<provider[^>]*PartListsProvider[^>]*>""").find(manifest)?.value
        assertTrue("PartListsProvider not exported: $partList", partList?.contains("""android:exported="false"""") == true)
    }

    @Test
    fun `the parts list lies on disk only encrypted`() {
        val intern = File(System.getProperty("java.io.tmpdir"), "bim-teileliste-${System.nanoTime()}")
        try {
            val key = ByteArray(32) { it.toByte() }
            val pdf = "%PDF-1.7 Teileliste 3001 rot x4".toByteArray()
            val file = PartListVault(StoreCipher { key }).put(intern, null, pdf)
            val plate = file.readBytes()
            assertFalse("plain text on disk", plate.decodeToString(throwOnInvalidSequence = false).contains("Teileliste 3001"))
            assertArrayEquals("the provider reads it back", pdf, PartListVault(StoreCipher { key }).read(intern))
            assertNull("unreadable under another key",
                PartListVault(StoreCipher { ByteArray(32) { 7 } }).read(intern))
        } finally {
            intern.deleteRecursively()
        }
    }
}
