package ch.brickinventoryapp.app

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
import ch.brickinventoryapp.data.util.Teilelistentresor
import ch.brickinventoryapp.security.StoreCipher
import ch.brickinventoryapp.testing.Quellen
import ch.brickinventoryapp.update.util.checkedDescription

/**
 * INVARIANTEN.md refers to source files and test classes; a reference to
 * something that was renamed or deleted misleads readers. Only checked
 * is that they exist, not whether the test still fully carries the rule.
 *
 * Checkable statements it checks itself: no FileProvider in the manifest, no unsigned
 * description, the parts list only encrypted on disk.
 *
 * Counter-checks:
 *   invarianten-verweis-ins-leere  a reference to `ui/GalleryFeature.kt` → red “every source file and
 *                                  test class named in INVARIANTEN …”
 *   invarianten-fileprovider-zurueck  „FileProvider nur `pdf/`“ again in INVARIANTEN → red, the same test
 *   invarianten-unsigniert-gilt    checkedDescription() accepts a wrapper without signature → red
 *                                  “no unsigned or foreign-signed description applies“
 *   invarianten-teileliste-klartext  Teilelistentresor.lege() writes the plaintext → red “the
 *                                  parts list lies on disk only encrypted”
 */
class InvariantsReferencesTest {

    /** `*` stands for any characters within a name, never across a slash. */
    private fun pattern(name: String) = Regex(name.split("*").joinToString("[^/]*") { Regex.escape(it) })

    private fun dateien(root: File) = root.walkTopDown().filter { it.isFile }
        .map { it.relativeTo(root).invariantSeparatorsPath }.toList()

    @Test
    fun `every source file and test class named in INVARIANTEN exists`() {
        val docs = File(Quellen.project, "INVARIANTEN.md").readText()
        val quellen = dateien(Quellen.root)
        val tests = dateien(Quellen.tests).map { it.substringAfterLast('/') }.toSet()
        val genannt = Regex("`([^`\\s]+\\.kt)`").findAll(docs).map { it.groupValues[1] }.toSet()
        val classes = Regex("""\b[A-Z][A-Za-z0-9]*Test\b""").findAll(docs).map { it.value }.toSet()
        assertTrue("Nur ${genannt.size} Dateien, ${classes.size} Testklassen gefunden — greift die Suche noch?",
            genannt.size >= 30 && classes.size >= 20)
        val fehlt = genannt.filter { d ->
            val m = pattern(d)
            quellen.none { m.matches(if ('/' in d) it else it.substringAfterLast('/')) }
        } + classes.filter { "$it.kt" !in tests }.map { "$it (Testklasse)" }
        assertTrue("jede in INVARIANTEN.md genannte Datei und Testklasse muss es geben; fehlt:\n  " +
            fehlt.joinToString("\n  "), fehlt.isEmpty())

        // Statements the code once refuted, and the structure behind „Kein FileProvider“.
        val outdated = listOf("FileProvider nur", "Klartext für die Ziel-App", "Unsignierte `version.json`")
        assertTrue("überholt in INVARIANTEN.md: ${outdated.filter { it in docs }}", outdated.none { it in docs })
        val manifest = Quellen.manifest.readText()
        assertTrue("INVARIANTEN.md sagt „Kein FileProvider“", "**Kein FileProvider.**" in docs)
        assertFalse("Das Manifest trägt einen FileProvider", "FileProvider" in manifest)
        val teileliste = Regex("""<provider[^>]*TeilelistenProvider[^>]*>""").find(manifest)?.value
        assertTrue("TeilelistenProvider nicht exportiert: $teileliste", teileliste?.contains("""android:exported="false"""") == true)
    }

    /** Signed like the job `beschreibung`: Base64 of the data and an ECDSA signature over it. */
    private fun shell(daten: String, signatur: ByteArray?) = Base64.getEncoder().let { b64 ->
        """{"daten":"${b64.encodeToString(daten.toByteArray())}"""" +
            (signatur?.let { ""","beschreibungssignatur":"${b64.encodeToString(it)}"""" } ?: "") + "}"
    }

    @Test
    fun `no unsigned or foreign-signed description applies`() {
        val own = KeyPairGenerator.getInstance("EC").apply { initialize(256) }.generateKeyPair()
        val fremd = KeyPairGenerator.getInstance("EC").apply { initialize(256) }.generateKeyPair()
        val daten = """{"versionCode":200,"versionName":"2.0","apkUrl":"https://x/a.apk","ausgestellt":1,"gueltigBis":2}"""
        fun signiert(mit: KeyPair) = Signature.getInstance("SHA256withECDSA")
            .run { initSign(mit.private); update(daten.toByteArray()); sign() }
        val schluessel = listOf(own.public.encoded)
        assertNotNull("Echt signiert gilt sie", checkedDescription(shell(daten, signiert(own)), schluessel))
        assertNull("Ohne Signatur", checkedDescription(shell(daten, null), schluessel))
        assertNull("Leere Signatur", checkedDescription(shell(daten, ByteArray(0)), schluessel))
        assertNull("Fremd signiert", checkedDescription(shell(daten, signiert(fremd)), schluessel))
        assertNull("Die unsignierte version.json", checkedDescription(daten, schluessel))
        assertNull("Ohne Beschreibungsschlüssel gilt nichts", checkedDescription(shell(daten, signiert(own)), emptyList()))
    }

    @Test
    fun `the parts list lies on disk only encrypted`() {
        val intern = File(System.getProperty("java.io.tmpdir"), "bim-teileliste-${System.nanoTime()}")
        try {
            val schluessel = ByteArray(32) { it.toByte() }
            val pdf = "%PDF-1.7 Teileliste 3001 rot x4".toByteArray()
            val datei = Teilelistentresor(StoreCipher { schluessel }).put(intern, null, pdf)
            val platte = datei.readBytes()
            assertFalse("Klartext auf der Platte", platte.decodeToString(throwOnInvalidSequence = false).contains("Teileliste 3001"))
            assertArrayEquals("Der Anbieter liest sie zurück", pdf, Teilelistentresor(StoreCipher { schluessel }).lies(intern))
            assertNull("Unter anderem Schlüssel unlesbar",
                Teilelistentresor(StoreCipher { ByteArray(32) { 7 } }).lies(intern))
        } finally {
            intern.deleteRecursively()
        }
    }
}
