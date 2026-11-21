package ch.brickinventoryapp.update

import ch.brickinventoryapp.update.util.UPDATE_RELEASE_BASE
import ch.brickinventoryapp.update.util.UPDATE_RELEASE_ROOT
import ch.brickinventoryapp.update.util.descriptionKey
import ch.brickinventoryapp.update.util.checkedDescription
import ch.brickinventoryapp.update.util.isAllowedApkAddress
import ch.brickinventoryapp.update.util.checksumFits
import org.junit.Assert.assertEquals
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
import java.security.KeyFactory
import java.security.spec.X509EncodedKeySpec
import java.security.cert.CertificateFactory
import ch.brickinventoryapp.testing.Quellen

/**
 * Die Fassungsbeschreibung des Selbst-Updaters ist mit dem eigenen
 * Beschreibungsschlüssel signiert: Wer nur Schreibrecht am Repository hat, kann ein
 * Update weder unterdrücken noch auf ein anderes APK umleiten. Signiert wird wie im
 * Signierjob (`openssl dgst -sha256 -sign`, ECDSA P-256). Die Signatur des
 * APK-Schlüssels (Feld `signatur`, früherer Übergangsweg) gilt nicht mehr.
 *
 * Gegenproben:
 *   A  checkedDescription() ohne die Zeile `if (!echt) return null`
 *      → rot „ein fremder Schluessel …“, „veraenderte Daten …“ und „eine
 *      unsignierte version.json …“; gegenproben/update-beschreibung-ungeprueft.patch
 *   B  checksumFits() vergleicht nur als Präfix (`startsWith`) und ohne die
 *      Leer-Abfrage → rot „the APK must carry the signed checksum“
 *   C  isAllowedApkAddress() ohne VERSION_LABEL.matches → rot „nur Fassungsetiketten …“
 *   D  SignedDescription liest wieder das Feld `signatur` als Beschreibungssignatur
 *      (`@SerialName("signatur")`) → rot „the signature of the APK key no longer applies“;
 *      gegenproben/beschreibung-ohne-schluesseltrennung.patch
 *   E  descriptionKey() nur den ersten Block (`.take(1)`) → rot „waehrend
 *      eines Schluesselwechsels gelten alter und neuer Schluessel“
 */
class UpdateSignatureTest {

    private val b64 = Base64.getDecoder()
    private val own = ecKey()
    private val schluessel = descriptionKey(pem(own))

    private fun ecKey(): KeyPair = KeyPairGenerator.getInstance("EC").apply { initialize(256) }.generateKeyPair()

    /** Signiert wie der Signierjob: `openssl dgst -sha256 -sign` mit einem EC-Schlüssel. */
    private fun signiere(paar: KeyPair, daten: String = DATA): String = Base64.getEncoder().encodeToString(
        Signature.getInstance("SHA256withECDSA").run { initSign(paar.private); update(b64.decode(daten)); sign() })

    private fun pem(vararg pairs: KeyPair) = "# Kommentar wie in res/raw\n" + pairs.joinToString("\n") {
        "-----BEGIN PUBLIC KEY-----\n" + Base64.getMimeEncoder(64, "\n".toByteArray()).encodeToString(it.public.encoded) +
            "\n-----END PUBLIC KEY-----"
    }

    private fun shell(signatur: String, daten: String = DATA) =
        """{"daten":"$daten","beschreibungssignatur":"$signatur"}"""

    @Test
    fun `the description signed by the description key applies`() {
        val b = checkedDescription(shell(signiere(own)), schluessel)
        assertNotNull("Die wie mit openssl signierte Beschreibung wird nicht erkannt", b)
        assertEquals(200001234, b!!.versionCode)
        assertEquals("9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08", b.apkSha256)
        assertTrue(isAllowedApkAddress(b.apkUrl))
    }

    @Test
    fun `a foreign key does not apply`() {
        assertNull(checkedDescription(shell(signiere(ecKey())), schluessel))
        assertNull("Ohne Beschreibungsschlüssel gilt nichts", checkedDescription(shell(signiere(own)), emptyList()))
    }

    @Test
    fun `changed data does not apply`() {
        val echt = String(b64.decode(DATA))
        val umgeleitet = echt.replace("BrickInventory-200001234.apk", "Anderes-200001234.apk")
        val enc = Base64.getEncoder().encodeToString(umgeleitet.toByteArray())
        assertNull(checkedDescription(shell(signiere(own), daten = enc), schluessel))
    }

    @Test
    fun `an unsigned version-json does not apply`() {
        val alt = """{"versionCode":200009999,"versionName":"9","apkUrl":"$UPDATE_RELEASE_BASE/BrickInventory.apk"}"""
        assertNull(checkedDescription(alt, schluessel))
        assertNull(checkedDescription(shell(""), schluessel))
    }

    /**
     * FOREIGN_SIG ist eine gültige ECDSA-Signatur über DATA (openssl, Schlüssel von FOREIGN_ZERT).
     * Im Feld `signatur`, wo frühere Releases die APK-Signatur trugen, zählt sie nicht mehr;
     * nur im Feld des Beschreibungsschlüssels und nur, wenn die App diesen Schlüssel kennt.
     */
    @Test
    fun `the signature of the APK key no longer applies`() {
        val apkKey = CertificateFactory.getInstance("X.509")
            .generateCertificate(b64.decode(FOREIGN_ZERT).inputStream()).publicKey.encoded
        val oldForm = """{"daten":"$DATA","signatur":"$FOREIGN_SIG"}"""
        assertNull("Nur die APK-Signatur", checkedDescription(oldForm, schluessel))
        assertNull("Auch wenn die App den Schlüssel kennt", checkedDescription(oldForm, listOf(apkKey)))
        assertNotNull("Als Beschreibungssignatur eines bekannten Schlüssels gilt dieselbe Signatur",
            checkedDescription(shell(FOREIGN_SIG), listOf(apkKey)))
        val beide = """{"daten":"$DATA","signatur":"$FOREIGN_SIG","beschreibungssignatur":"${signiere(own)}"}"""
        assertNotNull("Ein überzähliges Feld älterer Releases stört nicht", checkedDescription(beide, schluessel))
    }

    @Test
    fun `during a key change old and new key apply`() {
        val alt = ecKey()
        val neu = ecKey()
        val beide = descriptionKey(pem(alt, neu))
        assertEquals(2, beide.size)
        assertNotNull(checkedDescription(shell(signiere(alt)), beide))
        assertNotNull(checkedDescription(shell(signiere(neu)), beide))
        assertNull("Nach dem Wechsel gilt der alte nicht mehr",
            checkedDescription(shell(signiere(alt)), descriptionKey(pem(neu))))
    }

    /** Die Datei, die die App liest: nur Kommentare oder lesbare EC-Schlüssel. */
    @Test
    fun `the app's key file contains only readable keys`() {
        val datei = File(Quellen.project, "core-resources/src/main/res/raw/beschreibungs_schluessel.pem")
        val text = datei.readText()
        val schluessel = descriptionKey(text)
        assertEquals("Ein Block ist kein lesbarer Schlüssel", text.split("-----BEGIN PUBLIC KEY-----").size - 1, schluessel.size)
        for (s in schluessel) KeyFactory.getInstance("EC").generatePublic(X509EncodedKeySpec(s))
    }

    @Test
    fun `the APK must carry the signed checksum`() {
        val datei = File.createTempFile("update", ".apk").apply { deleteOnExit(); writeText("test") }
        assertTrue(checksumFits(datei, "9F86D081884C7D659A2FEAA0C55AD015A3BF4F1B2B0B822CD15D6C15B0F00A08"))
        assertFalse(checksumFits(datei, "0".repeat(64)))
        assertFalse("Ohne Angabe kein Ja", checksumFits(datei, ""))
    }

    @Test
    fun `only version tags of the own repository are stores`() {
        assertTrue(isAllowedApkAddress("$UPDATE_RELEASE_ROOT/android-v1.2.3/BrickInventory-1.apk"))
        assertFalse(isAllowedApkAddress("$UPDATE_RELEASE_ROOT/v1.2.3/BrickInventory-1.apk"))
        assertFalse(isAllowedApkAddress("$UPDATE_RELEASE_ROOT/android-v1/x/BrickInventory-1.apk"))
        assertFalse(isAllowedApkAddress("https://github.com/fremd/BrickInventory/releases/download/android-v1/a.apk"))
        assertFalse(isAllowedApkAddress("$UPDATE_RELEASE_ROOT/android-v1/version.json"))
    }

    private companion object {
        const val DATA = "eyJ2ZXJzaW9uQ29kZSI6MjAwMDAxMjM0LCJ2ZXJzaW9uTmFtZSI6IjEuMi4zIiwiY29tbWl0IjoiYWJjMTIzIiwiYXBrVXJsIjoiaHR0cHM6Ly9naXRodWIuY29tL2FkZGljdDg1L0JyaWNrSW52ZW50b3J5L3JlbGVhc2VzL2Rvd25sb2FkL2FuZHJvaWQtdjEuMi4zL0JyaWNrSW52ZW50b3J5LTIwMDAwMTIzNC5hcGsiLCJhcGtTaXplIjo0LCJhcGtTaGEyNTYiOiI5Zjg2ZDA4MTg4NGM3ZDY1OWEyZmVhYTBjNTVhZDAxNWEzYmY0ZjFiMmIwYjgyMmNkMTVkNmMxNWIwZjAwYTA4In0="
        const val FOREIGN_SIG = "MEUCICxpNlfeZKJiYFssY1Y0oidsj3qSOYy7+dJYxAyzMpmXAiEAudJdUcUNyFfcGFF8I9J5F485yypcYqMinHVSQ/pPd48="
        const val FOREIGN_ZERT = "MIIBgjCCASegAwIBAgIUam714MVBMH9HVBhZ27KabjrdEWQwCgYIKoZIzj0EAwIwFTETMBEGA1UEAwwKVGVzdCBGcmVtZDAgFw0yNjExMDMyMDI3MzRaGA8yMTI2MTAxMDIwMjczNFowFTETMBEGA1UEAwwKVGVzdCBGcmVtZDBZMBMGByqGSM49AgEGCCqGSM49AwEHA0IABH/VX20YW0ACxwTIXTZn/yReY6tZQOyamKIe8oP3Lz8DZs/5zcmMveTGW3vHn4OJslkWucEiy5O08tfaGqPB4UmjUzBRMB0GA1UdDgQWBBSOWx82/zkcaDCVcHI/quYbEgi8ujAfBgNVHSMEGDAWgBSOWx82/zkcaDCVcHI/quYbEgi8ujAPBgNVHRMBAf8EBTADAQH/MAoGCCqGSM49BAMCA0kAMEYCIQCMzTT/HH3w526b01+VENywOxFaWS6enGmHF2pAcE79cwIhAPfrV5h7nChN4Qw2pZ+t/UnrfunYn/SsDteZRJeBW/Ko"
    }
}
