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
import ch.brickinventoryapp.testing.Quellen

/**
 * Die Fassungsbeschreibung des Selbst-Updaters ist mit dem Release-Schlüssel
 * signiert: Wer nur Schreibrecht am Repository hat, kann ein Update weder
 * unterdrücken noch auf ein anderes APK umleiten. Die Signaturen sind mit openssl
 * erzeugt, genau wie im Signierjob (`openssl dgst -sha256 -sign`), einmal RSA wie
 * ein üblicher APK-Schlüssel, einmal ECDSA; die Zertifikate sind feste Testdaten.
 *
 * Gegenproben:
 *   A  gepruefteBeschreibung() ohne die Zeile `if (!echt) return null` (bis sec11: `if (zertifikate.none { … })`)
 *      → rot „ein fremder Schluessel …“, „veraenderte Daten …“ und „eine
 *      unsignierte version.json …“; gegenproben/update-beschreibung-ungeprueft.patch
 *   B  pruefsummePasst() vergleicht nur als Präfix (`startsWith`) und ohne die
 *      Leer-Abfrage → rot „das APK muss die signierte Pruefsumme tragen“
 *   C  istErlaubteApkAdresse() ohne FASSUNGS_ETIKETT.matches → rot „nur Fassungsetiketten …“
 * Gegenproben:
 *   D  gepruefteBeschreibung() nimmt die APK-Signatur auch dann, wenn die App
 *      Beschreibungsschlüssel kennt (`|| zertifikate.any { … }`) → rot „kennt die App
 *      einen Beschreibungsschluessel, gilt die APK-Signatur nicht mehr“;
 *      gegenproben/beschreibung-ohne-schluesseltrennung.patch
 *   E  beschreibungsSchluessel() nur den ersten Block (`.take(1)`) → rot „waehrend
 *      eines Schluesselwechsels gelten alter und neuer Schluessel“
 */
class UpdateSignaturTest {

    private val b64 = Base64.getDecoder()
    private val release = b64.decode(RELEASE_ZERT)
    private val fremd = b64.decode(FREMD_ZERT)

    private fun huelle(daten: String = DATEN, signatur: String = RELEASE_SIG) =
        """{"daten":"$daten","signatur":"$signatur"}"""

    @Test
    fun `die vom Release-Schluessel signierte Beschreibung gilt`() {
        val b = gepruefteBeschreibung(huelle(), listOf(release), emptyList())
        assertNotNull("Die mit openssl signierte Beschreibung wird nicht erkannt", b)
        assertEquals(200001234, b!!.versionCode)
        assertEquals("9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08", b.apkSha256)
        assertTrue(istErlaubteApkAdresse(b.apkUrl))
        assertNotNull("ECDSA wie RSA", gepruefteBeschreibung(huelle(signatur = FREMD_SIG), listOf(fremd), emptyList()))
    }

    @Test
    fun `ein fremder Schluessel gilt nicht`() {
        assertNull(gepruefteBeschreibung(huelle(signatur = FREMD_SIG), listOf(release), emptyList()))
        assertNull("Ohne bekannte Signierer gilt nichts", gepruefteBeschreibung(huelle(), emptyList(), emptyList()))
    }

    @Test
    fun `veraenderte Daten gelten nicht`() {
        val echt = String(b64.decode(DATEN))
        val umgeleitet = echt.replace("BrickInventory-200001234.apk", "Anderes-200001234.apk")
        val enc = Base64.getEncoder().encodeToString(umgeleitet.toByteArray())
        assertNull(gepruefteBeschreibung(huelle(daten = enc), listOf(release), emptyList()))
    }

    @Test
    fun `eine unsignierte version-json gilt nicht`() {
        val alt = """{"versionCode":200009999,"versionName":"9","apkUrl":"$UPDATE_RELEASE_BASIS/BrickInventory.apk"}"""
        assertNull(gepruefteBeschreibung(alt, listOf(release), emptyList()))
        assertNull(gepruefteBeschreibung(huelle(signatur = ""), listOf(release), emptyList()))
    }

    private fun ecSchluessel(): KeyPair = KeyPairGenerator.getInstance("EC").apply { initialize(256) }.generateKeyPair()

    /** Signiert wie der Signierjob: `openssl dgst -sha256 -sign` mit einem EC-Schlüssel. */
    private fun signiere(paar: KeyPair): String = Base64.getEncoder().encodeToString(
        Signature.getInstance("SHA256withECDSA").run { initSign(paar.private); update(b64.decode(DATEN)); sign() })

    private fun pem(vararg paare: KeyPair) = "# Kommentar wie in res/raw\n" + paare.joinToString("\n") {
        "-----BEGIN PUBLIC KEY-----\n" + Base64.getMimeEncoder(64, "\n".toByteArray()).encodeToString(it.public.encoded) +
            "\n-----END PUBLIC KEY-----"
    }

    private fun mitBeschreibungssignatur(signatur: String, apkSignatur: String = RELEASE_SIG) =
        """{"daten":"$DATEN","signatur":"$apkSignatur","beschreibungssignatur":"$signatur"}"""

    @Test
    fun `kennt die App einen Beschreibungsschluessel, gilt die APK-Signatur nicht mehr`() {
        val eigen = ecSchluessel()
        val schluessel = beschreibungsSchluessel(pem(eigen))
        assertNotNull("Vom Beschreibungsschlüssel signiert",
            gepruefteBeschreibung(mitBeschreibungssignatur(signiere(eigen)), listOf(release), schluessel))
        assertNull("Nur die APK-Signatur genügt nicht mehr", gepruefteBeschreibung(huelle(), listOf(release), schluessel))
        assertNull("Eine Beschreibungssignatur eines fremden Schlüssels gilt nicht",
            gepruefteBeschreibung(mitBeschreibungssignatur(signiere(ecSchluessel())), listOf(release), schluessel))
        assertNotNull("Ohne Beschreibungsschlüssel gilt der Übergangsweg",
            gepruefteBeschreibung(mitBeschreibungssignatur(signiere(eigen)), listOf(release), emptyList()))
    }

    @Test
    fun `waehrend eines Schluesselwechsels gelten alter und neuer Schluessel`() {
        val alt = ecSchluessel()
        val neu = ecSchluessel()
        val beide = beschreibungsSchluessel(pem(alt, neu))
        assertEquals(2, beide.size)
        assertNotNull(gepruefteBeschreibung(mitBeschreibungssignatur(signiere(alt)), emptyList(), beide))
        assertNotNull(gepruefteBeschreibung(mitBeschreibungssignatur(signiere(neu)), emptyList(), beide))
        assertNull("Nach dem Wechsel gilt der alte nicht mehr",
            gepruefteBeschreibung(mitBeschreibungssignatur(signiere(alt)), emptyList(), beschreibungsSchluessel(pem(neu))))
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
        const val RELEASE_SIG = "iYPUJs/PkzjqNlb1CJ0pXWFyozCV7RwL+QSJSP1KGxZN7EsK6sZ3U3Yxftmx+r31iJrivZTYYFNOR+bHOEWXWslIQOcKgC8bCLp/oVSH8LdtLqTzWPZo4pYpx/NZfnRPeW45qjU4n8DML6/B66ITSL6r+86M6y2vB5ORJvElCI8cr6WYa9oLEl8RyvhXCL8OY4ASH2YzrxFc3+m6OkKlRLZtusZueYl41w4bRDib8o4gEIq7/3wnrizvgfY6YzJQxGPDboFJtRkNgvzRj+3S7V5gTajm1Z+aK6o2q5mOUk42wd8V7sSKdXUj/kHXYSXwwEitnz3nSSuEsXaF43vXbg=="
        const val FREMD_SIG = "MEUCICxpNlfeZKJiYFssY1Y0oidsj3qSOYy7+dJYxAyzMpmXAiEAudJdUcUNyFfcGFF8I9J5F485yypcYqMinHVSQ/pPd48="
        const val RELEASE_ZERT = "MIIDETCCAfmgAwIBAgIUUdcxxvidtXz4EGzDgVi8DXFBjwAwDQYJKoZIhvcNAQELBQAwFzEVMBMGA1UEAwwMVGVzdCBSZWxlYXNlMCAXDTI2MTEwMzIwMjczNFoYDzIxMjYxMDEwMjAyNzM0WjAXMRUwEwYDVQQDDAxUZXN0IFJlbGVhc2UwggEiMA0GCSqGSIb3DQEBAQUAA4IBDwAwggEKAoIBAQC+i/kRVsCYt+IdBL5e0nKKxUvMNvCm2TBO7mQZSCnscrAKp16tLPd81GVHtQEfDcTAjeKGo0F5XkWLl3Sok4PAhLrytyZnYyzMLC0p/6HTIfNaKMR07mwutMdx7UXxctjsO3cfeeVE1BxDoa3kSFgQ2fFqYVxpjQDgPmsA7IXu3PO/kkPBe3BAh4BnSMsnsBcC0kKreQqFLsofAE7cliqhdLoCMDZwOZXcjG7D7TP+nMslzoVBNb1l8EAzUgtNEavobXaK/W/uhhU9Y3l6KnmOiaFwn4/pnNnJhinIg9fMu79sbzrCphS8V3Qf95sLrYAv9e/ookvu1rtCtskLM3KTAgMBAAGjUzBRMB0GA1UdDgQWBBRDJSTTq0WLq2uTAZPQDmti85MKYTAfBgNVHSMEGDAWgBRDJSTTq0WLq2uTAZPQDmti85MKYTAPBgNVHRMBAf8EBTADAQH/MA0GCSqGSIb3DQEBCwUAA4IBAQBcgLHUUkTlQJwPc5Nn1FBqpCY6HK/jWnZoE65eB/6zRtb3ReBByq4hPRKcVGJ6kOBLr8EWOtMeVpAvSwVqoFK2GA5frT2JrVB9YiBxksbDe6wQIq2zzdJythFOtoe/ckch9g76ztbl5YvB7xGIjMdwgBQ9ebbBAFddNdg4y7OpcaLcBXEfGVo2HiTwGnnfpaVjXRbAZfUSZ+a2WpoLY6EQm3KLp3oE+5jD1sOEvRdc0Qg0Gf3hTIbUdo6TD4hNi61aDjPHPxnHyzZEIJ4lAgdVpjPkyx6snHXC0gGE+eb0r0JhgDwIa1xHYiVOtlc7VGMTMoip/xcdbVOde/bRVkPl"
        const val FREMD_ZERT = "MIIBgjCCASegAwIBAgIUam714MVBMH9HVBhZ27KabjrdEWQwCgYIKoZIzj0EAwIwFTETMBEGA1UEAwwKVGVzdCBGcmVtZDAgFw0yNjExMDMyMDI3MzRaGA8yMTI2MTAxMDIwMjczNFowFTETMBEGA1UEAwwKVGVzdCBGcmVtZDBZMBMGByqGSM49AgEGCCqGSM49AwEHA0IABH/VX20YW0ACxwTIXTZn/yReY6tZQOyamKIe8oP3Lz8DZs/5zcmMveTGW3vHn4OJslkWucEiy5O08tfaGqPB4UmjUzBRMB0GA1UdDgQWBBSOWx82/zkcaDCVcHI/quYbEgi8ujAfBgNVHSMEGDAWgBSOWx82/zkcaDCVcHI/quYbEgi8ujAPBgNVHRMBAf8EBTADAQH/MAoGCCqGSM49BAMCA0kAMEYCIQCMzTT/HH3w526b01+VENywOxFaWS6enGmHF2pAcE79cwIhAPfrV5h7nChN4Qw2pZ+t/UnrfunYn/SsDteZRJeBW/Ko"
    }
}
