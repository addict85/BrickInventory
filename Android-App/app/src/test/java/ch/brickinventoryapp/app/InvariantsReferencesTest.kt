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
import ch.brickinventoryapp.sicherheit.StoreCipher
import ch.brickinventoryapp.testing.Quellen
import ch.brickinventoryapp.update.util.checkedDescription

/**
 * INVARIANTEN.md verweist auf Quelldateien und Testklassen; ein Verweis auf
 * etwas, das umbenannt oder gelöscht wurde, führt Leser in die Irre. Geprüft
 * wird nur, dass es sie gibt, nicht, ob der Test die Regel noch ganz trägt.
 *
 * Prüfbare Aussagen prüft er selbst: kein FileProvider im Manifest, keine unsignierte
 * Beschreibung, die Teileliste nur verschlüsselt auf der Platte.
 *
 * Gegenproben:
 *   invarianten-verweis-ins-leere  ein Verweis auf `ui/GalleryFeature.kt` → rot „jede in
 *                                  INVARIANTEN genannte …“
 *   invarianten-fileprovider-zurueck  „FileProvider nur `pdf/`“ wieder in INVARIANTEN → rot, derselbe Test
 *   invarianten-unsigniert-gilt    checkedDescription() nimmt eine Hülle ohne Signatur → rot
 *                                  „keine unsignierte oder fremd signierte Beschreibung gilt“
 *   invarianten-teileliste-klartext  Teilelistentresor.lege() schreibt den Klartext → rot „die
 *                                  Teileliste liegt nur verschluesselt auf der Platte“
 */
class InvariantsReferencesTest {

    /** `*` steht für beliebige Zeichen innerhalb eines Namens, nie über einen Schrägstrich. */
    private fun pattern(name: String) = Regex(name.split("*").joinToString("[^/]*") { Regex.escape(it) })

    private fun dateien(root: File) = root.walkTopDown().filter { it.isFile }
        .map { it.relativeTo(root).invariantSeparatorsPath }.toList()

    @Test
    fun `jede in INVARIANTEN genannte Quelldatei und Testklasse gibt es`() {
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

        // Aussagen, die der Code einmal widerlegt hat, und die Struktur hinter „Kein FileProvider“.
        val outdated = listOf("FileProvider nur", "Klartext für die Ziel-App", "Unsignierte `version.json`")
        assertTrue("überholt in INVARIANTEN.md: ${outdated.filter { it in docs }}", outdated.none { it in docs })
        val manifest = Quellen.manifest.readText()
        assertTrue("INVARIANTEN.md sagt „Kein FileProvider“", "**Kein FileProvider.**" in docs)
        assertFalse("Das Manifest trägt einen FileProvider", "FileProvider" in manifest)
        val teileliste = Regex("""<provider[^>]*TeilelistenProvider[^>]*>""").find(manifest)?.value
        assertTrue("TeilelistenProvider nicht exportiert: $teileliste", teileliste?.contains("""android:exported="false"""") == true)
    }

    /** Signiert wie der Job `beschreibung`: Base64 der Daten und ECDSA-Signatur darüber. */
    private fun shell(daten: String, signatur: ByteArray?) = Base64.getEncoder().let { b64 ->
        """{"daten":"${b64.encodeToString(daten.toByteArray())}"""" +
            (signatur?.let { ""","beschreibungssignatur":"${b64.encodeToString(it)}"""" } ?: "") + "}"
    }

    @Test
    fun `keine unsignierte oder fremd signierte Beschreibung gilt`() {
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
    fun `die Teileliste liegt nur verschluesselt auf der Platte`() {
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
