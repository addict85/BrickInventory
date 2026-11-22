package ch.brickinventoryapp.update

import ch.brickinventoryapp.testing.Sources
import ch.brickinventoryapp.update.util.UPDATE_RELEASE_BASE
import ch.brickinventoryapp.update.util.UPDATE_RELEASE_ROOT
import ch.brickinventoryapp.update.util.checkedDescription
import ch.brickinventoryapp.update.util.checksumFits
import ch.brickinventoryapp.update.util.descriptionKey
import ch.brickinventoryapp.update.util.isAllowedApkAddress
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File
import java.security.KeyFactory
import java.security.KeyPair
import java.security.KeyPairGenerator
import java.security.Signature
import java.security.cert.CertificateFactory
import java.security.spec.X509EncodedKeySpec
import java.util.Base64

/**
 * The self-updater's version description is signed with its own
 * description key: whoever only has write access to the repository can neither
 * suppress an update nor redirect it to a different APK. Signed as in the
 * signing job (`openssl dgst -sha256 -sign`, ECDSA P-256). The APK key's
 * signature (field `signature`, a former transition path) no longer counts.
 *
 * Counter-checks:
 *   A  checkedDescription() without the line `if (!real) return null`
 *      → red „ein fremder Schluessel …“, „veraenderte Daten …“ and „eine unsignierte version.json …“
 * ; counter-checks/update-beschreibung-ungeprueft.patch
 *   B  checksumFits() compares only as a prefix (`startsWith`) and without the
 *      empty check → red „the APK must carry the signed checksum“
 *   C  isAllowedApkAddress() without VERSION_LABEL.matches → red „nur Fassungsetiketten …“
 *   D  SignedDescription reads the `signature` field as the description signature again
 *      (`@SerialName("signature")`) → red „the signature of the APK key no longer applies“;
 *      counter-checks/beschreibung-ohne-schluesseltrennung.patch
 *   E  descriptionKey() only the first block (`.take(1)`) → red „waehrend eines Schluesselwechsels gelten alter und neuer Schluessel“
 *   F  UpdateDescription reads the origin as `@SerialName("sha")` → red “the description signed by the description key applies”
 */
class UpdateSignatureTest {

    private val b64 = Base64.getDecoder()
    private val own = ecKey()
    private val key = descriptionKey(pem(own))

    private fun ecKey(): KeyPair = KeyPairGenerator.getInstance("EC").apply { initialize(256) }.generateKeyPair()

    /** Signed like the signing job: `openssl dgst -sha256 -sign` with an EC key. */
    private fun sign(pair: KeyPair, data: String = DATA): String = Base64.getEncoder().encodeToString(
        Signature.getInstance("SHA256withECDSA").run { initSign(pair.private); update(b64.decode(data)); sign() })

    private fun pem(vararg pairs: KeyPair) = "# Kommentar wie in res/raw\n" + pairs.joinToString("\n") {
        "-----BEGIN PUBLIC KEY-----\n" + Base64.getMimeEncoder(64, "\n".toByteArray()).encodeToString(it.public.encoded) +
            "\n-----END PUBLIC KEY-----"
    }

    private fun shell(signature: String, data: String = DATA) =
        """{"daten":"$data","beschreibungssignatur":"$signature"}"""

    @Test
    fun `the description signed by the description key applies`() {
        val b = checkedDescription(shell(sign(own)), key)
        assertNotNull("the description signed as with openssl is not recognized", b)
        assertEquals(200001234, b!!.versionCode)
        assertEquals("9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08", b.apkSha256)
        assertTrue(isAllowedApkAddress(b.apkUrl))
        assertEquals("the build's origin is read as `commit`", "abc123", b.commit)
    }

    @Test
    fun `a foreign key does not apply`() {
        assertNull(checkedDescription(shell(sign(ecKey())), key))
        assertNull("without a description key nothing counts", checkedDescription(shell(sign(own)), emptyList()))
    }

    @Test
    fun `changed data does not apply`() {
        val real = String(b64.decode(DATA))
        val redirected = real.replace("BrickInventory-200001234.apk", "Anderes-200001234.apk")
        val enc = Base64.getEncoder().encodeToString(redirected.toByteArray())
        assertNull(checkedDescription(shell(sign(own), data = enc), key))
    }

    @Test
    fun `an unsigned version-json does not apply`() {
        val old = """{"versionCode":200009999,"versionName":"9","apkUrl":"$UPDATE_RELEASE_BASE/BrickInventory.apk"}"""
        assertNull(checkedDescription(old, key))
        assertNull(checkedDescription(shell(""), key))
    }

    /**
     * FOREIGN_SIG is a valid ECDSA signature over DATA (openssl, key from FOREIGN_CERT).
     * In the `signature` field, where older releases carried the APK signature, it no longer counts;
     * only in the description key's field, and only if the app knows that key.
     */
    @Test
    fun `the signature of the APK key no longer applies`() {
        val apkKey = CertificateFactory.getInstance("X.509")
            .generateCertificate(b64.decode(FOREIGN_CERT).inputStream()).publicKey.encoded
        val oldForm = """{"daten":"$DATA","signatur":"$FOREIGN_SIG"}"""
        assertNull("only the APK signature", checkedDescription(oldForm, key))
        assertNull("even if the app knows the key", checkedDescription(oldForm, listOf(apkKey)))
        assertNotNull("the same signature counts as the description signature of a known key",
            checkedDescription(shell(FOREIGN_SIG), listOf(apkKey)))
        val both = """{"daten":"$DATA","signatur":"$FOREIGN_SIG","beschreibungssignatur":"${sign(own)}"}"""
        assertNotNull("a surplus field of older releases does no harm", checkedDescription(both, key))
    }

    @Test
    fun `during a key change old and new key apply`() {
        val old = ecKey()
        val newValue = ecKey()
        val both = descriptionKey(pem(old, newValue))
        assertEquals(2, both.size)
        assertNotNull(checkedDescription(shell(sign(old)), both))
        assertNotNull(checkedDescription(shell(sign(newValue)), both))
        assertNull("after the change the old one no longer counts",
            checkedDescription(shell(sign(old)), descriptionKey(pem(newValue))))
    }

    /** The file the app reads: only comments or readable EC keys. */
    @Test
    fun `the app's key file contains only readable keys`() {
        val file = File(Sources.project, "core-resources/src/main/res/raw/description_key.pem")
        val text = file.readText()
        val key = descriptionKey(text)
        assertEquals("a block is not a readable key", text.split("-----BEGIN PUBLIC KEY-----").size - 1, key.size)
        for (s in key) KeyFactory.getInstance("EC").generatePublic(X509EncodedKeySpec(s))
    }

    @Test
    fun `the APK must carry the signed checksum`() {
        val file = File.createTempFile("update", ".apk").apply { deleteOnExit(); writeText("test") }
        assertTrue(checksumFits(file, "9F86D081884C7D659A2FEAA0C55AD015A3BF4F1B2B0B822CD15D6C15B0F00A08"))
        assertFalse(checksumFits(file, "0".repeat(64)))
        assertFalse("without information no yes", checksumFits(file, ""))
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
        const val FOREIGN_CERT = "MIIBgjCCASegAwIBAgIUam714MVBMH9HVBhZ27KabjrdEWQwCgYIKoZIzj0EAwIwFTETMBEGA1UEAwwKVGVzdCBGcmVtZDAgFw0yNjExMDMyMDI3MzRaGA8yMTI2MTAxMDIwMjczNFowFTETMBEGA1UEAwwKVGVzdCBGcmVtZDBZMBMGByqGSM49AgEGCCqGSM49AwEHA0IABH/VX20YW0ACxwTIXTZn/yReY6tZQOyamKIe8oP3Lz8DZs/5zcmMveTGW3vHn4OJslkWucEiy5O08tfaGqPB4UmjUzBRMB0GA1UdDgQWBBSOWx82/zkcaDCVcHI/quYbEgi8ujAfBgNVHSMEGDAWgBSOWx82/zkcaDCVcHI/quYbEgi8ujAPBgNVHRMBAf8EBTADAQH/MAoGCCqGSM49BAMCA0kAMEYCIQCMzTT/HH3w526b01+VENywOxFaWS6enGmHF2pAcE79cwIhAPfrV5h7nChN4Qw2pZ+t/UnrfunYn/SsDteZRJeBW/Ko"
    }
}
