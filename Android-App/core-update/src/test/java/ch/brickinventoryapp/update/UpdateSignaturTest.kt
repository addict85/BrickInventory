package ch.brickinventoryapp.update

import ch.brickinventoryapp.update.util.UPDATE_RELEASE_BASIS
import ch.brickinventoryapp.update.util.UPDATE_RELEASE_WURZEL
import ch.brickinventoryapp.update.util.beschreibungsSchluessel
import ch.brickinventoryapp.update.util.gepruefteBeschreibung
import ch.brickinventoryapp.update.util.istErlaubteApkAdresse
import ch.brickinventoryapp.update.util.pruefsummePasst
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
 *   A  gepruefteBeschreibung() ohne die Zeile `if (!echt) return null`
 *      → rot „ein fremder Schluessel …“, „veraenderte Daten …“ und „eine
 *      unsignierte version.json …“; gegenproben/update-beschreibung-ungeprueft.patch
 *   B  pruefsummePasst() vergleicht nur als Präfix (`startsWith`) und ohne die
 *      Leer-Abfrage → rot „das APK muss die signierte Pruefsumme tragen“
 *   C  istErlaubteApkAdresse() ohne FASSUNGS_ETIKETT.matches → rot „nur Fassungsetiketten …“
 *   D  SignierteBeschreibung liest wieder das Feld `signatur` als Beschreibungssignatur
 *      (`@SerialName("signatur")`) → rot „die Signatur des APK-Schluessels gilt nicht mehr“;
 *      gegenproben/beschreibung-ohne-schluesseltrennung.patch
 *   E  beschreibungsSchluessel() nur den ersten Block (`.take(1)`) → rot „waehrend
 *      eines Schluesselwechsels gelten alter und neuer Schluessel“
 */
class UpdateSignaturTest {

    private val b64 = Base64.getDecoder()
    private val eigen = ecSchluessel()
    private val schluessel = beschreibungsSchluessel(pem(eigen))

    private fun ecSchluessel(): KeyPair = KeyPairGenerator.getInstance("EC").apply { initialize(256) }.generateKeyPair()

    /** Signiert wie der Signierjob: `openssl dgst -sha256 -sign` mit einem EC-Schlüssel. */
    private fun signiere(paar: KeyPair, daten: String = DATEN): String = Base64.getEncoder().encodeToString(
        Signature.getInstance("SHA256withECDSA").run { initSign(paar.private); update(b64.decode(daten)); sign() })

    private fun pem(vararg paare: KeyPair) = "# Kommentar wie in res/raw\n" + paare.joinToString("\n") {
        "-----BEGIN PUBLIC KEY-----\n" + Base64.getMimeEncoder(64, "\n".toByteArray()).encodeToString(it.public.encoded) +
            "\n-----END PUBLIC KEY-----"
    }

    private fun huelle(signatur: String, daten: String = DATEN) =
        """{"daten":"$daten","beschreibungssignatur":"$signatur"}"""

    @Test
    fun `die vom Beschreibungsschluessel signierte Beschreibung gilt`() {
        val b = gepruefteBeschreibung(huelle(signiere(eigen)), schluessel)
        assertNotNull("Die wie mit openssl signierte Beschreibung wird nicht erkannt", b)
        assertEquals(200001234, b!!.versionCode)
        assertEquals("9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08", b.apkSha256)
        assertTrue(istErlaubteApkAdresse(b.apkUrl))
    }

    @Test
    fun `ein fremder Schluessel gilt nicht`() {
        assertNull(gepruefteBeschreibung(huelle(signiere(ecSchluessel())), schluessel))
        assertNull("Ohne Beschreibungsschlüssel gilt nichts", gepruefteBeschreibung(huelle(signiere(eigen)), emptyList()))
    }

    @Test
    fun `veraenderte Daten gelten nicht`() {
        val echt = String(b64.decode(DATEN))
        val umgeleitet = echt.replace("BrickInventory-200001234.apk", "Anderes-200001234.apk")
        val enc = Base64.getEncoder().encodeToString(umgeleitet.toByteArray())
        assertNull(gepruefteBeschreibung(huelle(signiere(eigen), daten = enc), schluessel))
    }

    @Test
    fun `eine unsignierte version-json gilt nicht`() {
        val alt = """{"versionCode":200009999,"versionName":"9","apkUrl":"$UPDATE_RELEASE_BASIS/BrickInventory.apk"}"""
        assertNull(gepruefteBeschreibung(alt, schluessel))
        assertNull(gepruefteBeschreibung(huelle(""), schluessel))
    }

    /**
     * FREMD_SIG ist eine gültige ECDSA-Signatur über DATEN (openssl, Schlüssel von FREMD_ZERT).
     * Im Feld `signatur`, wo frühere Releases die APK-Signatur trugen, zählt sie nicht mehr;
     * nur im Feld des Beschreibungsschlüssels und nur, wenn die App diesen Schlüssel kennt.
     */
    @Test
    fun `die Signatur des APK-Schluessels gilt nicht mehr`() {
        val apkSchluessel = CertificateFactory.getInstance("X.509")
            .generateCertificate(b64.decode(FREMD_ZERT).inputStream()).publicKey.encoded
        val alteForm = """{"daten":"$DATEN","signatur":"$FREMD_SIG"}"""
        assertNull("Nur die APK-Signatur", gepruefteBeschreibung(alteForm, schluessel))
        assertNull("Auch wenn die App den Schlüssel kennt", gepruefteBeschreibung(alteForm, listOf(apkSchluessel)))
        assertNotNull("Als Beschreibungssignatur eines bekannten Schlüssels gilt dieselbe Signatur",
            gepruefteBeschreibung(huelle(FREMD_SIG), listOf(apkSchluessel)))
        val beide = """{"daten":"$DATEN","signatur":"$FREMD_SIG","beschreibungssignatur":"${signiere(eigen)}"}"""
        assertNotNull("Ein überzähliges Feld älterer Releases stört nicht", gepruefteBeschreibung(beide, schluessel))
    }

    @Test
    fun `waehrend eines Schluesselwechsels gelten alter und neuer Schluessel`() {
        val alt = ecSchluessel()
        val neu = ecSchluessel()
        val beide = beschreibungsSchluessel(pem(alt, neu))
        assertEquals(2, beide.size)
        assertNotNull(gepruefteBeschreibung(huelle(signiere(alt)), beide))
        assertNotNull(gepruefteBeschreibung(huelle(signiere(neu)), beide))
        assertNull("Nach dem Wechsel gilt der alte nicht mehr",
            gepruefteBeschreibung(huelle(signiere(alt)), beschreibungsSchluessel(pem(neu))))
    }

    /** Die Datei, die die App liest: nur Kommentare oder lesbare EC-Schlüssel. */
    @Test
    fun `die Schluesseldatei der App enthaelt nur lesbare Schluessel`() {
        val datei = File(Quellen.projekt, "core-ressourcen/src/main/res/raw/beschreibungs_schluessel.pem")
        val text = datei.readText()
        val schluessel = beschreibungsSchluessel(text)
        assertEquals("Ein Block ist kein lesbarer Schlüssel", text.split("-----BEGIN PUBLIC KEY-----").size - 1, schluessel.size)
        for (s in schluessel) KeyFactory.getInstance("EC").generatePublic(X509EncodedKeySpec(s))
    }

    @Test
    fun `das APK muss die signierte Pruefsumme tragen`() {
        val datei = File.createTempFile("update", ".apk").apply { deleteOnExit(); writeText("test") }
        assertTrue(pruefsummePasst(datei, "9F86D081884C7D659A2FEAA0C55AD015A3BF4F1B2B0B822CD15D6C15B0F00A08"))
        assertFalse(pruefsummePasst(datei, "0".repeat(64)))
        assertFalse("Ohne Angabe kein Ja", pruefsummePasst(datei, ""))
    }

    @Test
    fun `nur Fassungsetiketten des eigenen Repositorys sind Ablagen`() {
        assertTrue(istErlaubteApkAdresse("$UPDATE_RELEASE_WURZEL/android-v1.2.3/BrickInventory-1.apk"))
        assertFalse(istErlaubteApkAdresse("$UPDATE_RELEASE_WURZEL/v1.2.3/BrickInventory-1.apk"))
        assertFalse(istErlaubteApkAdresse("$UPDATE_RELEASE_WURZEL/android-v1/x/BrickInventory-1.apk"))
        assertFalse(istErlaubteApkAdresse("https://github.com/fremd/BrickInventory/releases/download/android-v1/a.apk"))
        assertFalse(istErlaubteApkAdresse("$UPDATE_RELEASE_WURZEL/android-v1/version.json"))
    }

    private companion object {
        const val DATEN = "eyJ2ZXJzaW9uQ29kZSI6MjAwMDAxMjM0LCJ2ZXJzaW9uTmFtZSI6IjEuMi4zIiwiY29tbWl0IjoiYWJjMTIzIiwiYXBrVXJsIjoiaHR0cHM6Ly9naXRodWIuY29tL2FkZGljdDg1L0JyaWNrSW52ZW50b3J5L3JlbGVhc2VzL2Rvd25sb2FkL2FuZHJvaWQtdjEuMi4zL0JyaWNrSW52ZW50b3J5LTIwMDAwMTIzNC5hcGsiLCJhcGtTaXplIjo0LCJhcGtTaGEyNTYiOiI5Zjg2ZDA4MTg4NGM3ZDY1OWEyZmVhYTBjNTVhZDAxNWEzYmY0ZjFiMmIwYjgyMmNkMTVkNmMxNWIwZjAwYTA4In0="
        const val FREMD_SIG = "MEUCICxpNlfeZKJiYFssY1Y0oidsj3qSOYy7+dJYxAyzMpmXAiEAudJdUcUNyFfcGFF8I9J5F485yypcYqMinHVSQ/pPd48="
        const val FREMD_ZERT = "MIIBgjCCASegAwIBAgIUam714MVBMH9HVBhZ27KabjrdEWQwCgYIKoZIzj0EAwIwFTETMBEGA1UEAwwKVGVzdCBGcmVtZDAgFw0yNjExMDMyMDI3MzRaGA8yMTI2MTAxMDIwMjczNFowFTETMBEGA1UEAwwKVGVzdCBGcmVtZDBZMBMGByqGSM49AgEGCCqGSM49AwEHA0IABH/VX20YW0ACxwTIXTZn/yReY6tZQOyamKIe8oP3Lz8DZs/5zcmMveTGW3vHn4OJslkWucEiy5O08tfaGqPB4UmjUzBRMB0GA1UdDgQWBBSOWx82/zkcaDCVcHI/quYbEgi8ujAfBgNVHSMEGDAWgBSOWx82/zkcaDCVcHI/quYbEgi8ujAPBgNVHRMBAf8EBTADAQH/MAoGCCqGSM49BAMCA0kAMEYCIQCMzTT/HH3w526b01+VENywOxFaWS6enGmHF2pAcE79cwIhAPfrV5h7nChN4Qw2pZ+t/UnrfunYn/SsDteZRJeBW/Ko"
    }
}
