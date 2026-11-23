package ch.brickinventoryapp.app

import ch.brickinventoryapp.data.util.PartListVault
import ch.brickinventoryapp.security.StoreCipher
import ch.brickinventoryapp.testing.Sources
import ch.brickinventoryapp.update.util.checkedDescription
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File
import java.security.KeyPair
import java.security.KeyPairGenerator
import java.security.Signature
import java.util.Base64

/**
 * `INVARIANTEN.md` refers to source files and test classes; a reference to
 * something that was renamed or deleted misleads readers. Only checked
 * is that they exist, not whether the test still fully carries the rule.
 *
 * Checkable statements it checks itself: no FileProvider in the manifest, no unsigned
 * description, the parts list only encrypted on disk.
 *
 * Counter-checks:
 *   invariants-dangling-reference  a reference to `ui/GalleryFeature.kt` → red “every source file and
 *                                  test class named in INVARIANTEN …”
 *   invariants-fileprovider-back  „FileProvider nur `pdf/`“ again in INVARIANTEN → red, the same test
 *   invariants-unsigned-counts    checkedDescription() accepts a wrapper without signature → red
 *                                  “no unsigned or foreign-signed description applies“
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

    /** Signed like the job `description`: Base64 of the data and an ECDSA signature over it. */
    private fun shell(data: String, signature: ByteArray?) = Base64.getEncoder().let { b64 ->
        """{"daten":"${b64.encodeToString(data.toByteArray())}"""" +
            (signature?.let { ""","beschreibungssignatur":"${b64.encodeToString(it)}"""" } ?: "") + "}"
    }

    @Test
    fun `no unsigned or foreign-signed description applies`() {
        val own = KeyPairGenerator.getInstance("EC").apply { initialize(256) }.generateKeyPair()
        val foreign = KeyPairGenerator.getInstance("EC").apply { initialize(256) }.generateKeyPair()
        val data = """{"versionCode":200,"versionName":"2.0","apkUrl":"https://x/a.apk","ausgestellt":1,"gueltigBis":2}"""
        fun signed(with: KeyPair) = Signature.getInstance("SHA256withECDSA")
            .run { initSign(with.private); update(data.toByteArray()); sign() }
        val key = listOf(own.public.encoded)
        assertNotNull("genuinely signed it counts", checkedDescription(shell(data, signed(own)), key))
        assertNull("without a signature", checkedDescription(shell(data, null), key))
        assertNull("empty signature", checkedDescription(shell(data, ByteArray(0)), key))
        assertNull("signed by someone else", checkedDescription(shell(data, signed(foreign)), key))
        assertNull("the unsigned version.json", checkedDescription(data, key))
        assertNull("without a description key nothing counts", checkedDescription(shell(data, signed(own)), emptyList()))
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
