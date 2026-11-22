package ch.brickinventoryapp.app

import org.junit.Assert.assertEquals
import org.junit.Test
import java.io.File
import java.security.KeyPairGenerator
import java.security.MessageDigest
import java.util.Base64
import java.util.concurrent.TimeUnit

/**
 * The checks before publishing (`tools/release-check.py`),
 * executed against outputs in the format of `apksigner verify --print-certs` and
 * against descriptions like the one in version-signiert.json of a release.
 *
 * Counter-checks:
 *   A  in certificate() `foreign = []` → red “a foreign certificate …”
 *   B  in version() `newValue >= alt_code` without commit comparison → red “an older
 *      or equally old state …”
 *   C  the pattern on `SHA256 digest` instead of `SHA-256 digest` → red “the stored
 *      certificate is accepted” (exit 2 instead of 0)
 *   D  tools/release-certificate.sha256 without a value → red “the stored file names …”
 *   E  in description() `apkSha256` deleted from `should` → red “the
 *      signed description must name exactly this APK” (another APK got through)
 *   F  in description() the line `wrong += deadline(…)` deleted → red
 *      “a description without a valid deadline is not published“;
 *      counter-checks/description-without-deadline.patch
 *   G  in key() the line `if geliefert[0] not in app`
 *      including return deleted → red “a description key the app does not
 *      know is rejected”; counter-checks/description-key-unchecked.patch
 *   H the transition path again with exit 0 →
 *      red “a description key the app does not know …” (transition invisible)
 */
class ReleaseCheckTest {

    private val release = "a51ff2f425d94b6f31a06b7805013cc801791b28e58404dc26c7c8298380af06"

    /** A public EC key as PEM, as `openssl pkey -pubout` writes it. */
    private fun pem(): String {
        val pair = KeyPairGenerator.getInstance("EC").apply { initialize(256) }.generateKeyPair()
        return "-----BEGIN PUBLIC KEY-----\n" +
            Base64.getMimeEncoder(64, "\n".toByteArray()).encodeToString(pair.public.encoded) +
            "\n-----END PUBLIC KEY-----\n"
    }
    private val foreign = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"

    private fun file(content: String): File = File.createTempFile("release", ".txt").apply {
        deleteOnExit(); writeText(content)
    }

    private fun apksigner(vararg sha: String): File = file(sha.mapIndexed { i, s ->
        "Signer #${i + 1} certificate DN: CN=Marco\nSigner #${i + 1} certificate SHA-256 digest: $s\n" +
            "Signer #${i + 1} certificate SHA-1 digest: 00\nSigner #${i + 1} certificate MD5 digest: 00\n"
    }.joinToString(""))

    private fun check(vararg args: String): Int {
        val p = ProcessBuilder(listOf("python3", "../tools/release-check.py") + args).redirectErrorStream(true).start()
        val text = p.inputStream.bufferedReader().readText()
        check(p.waitFor(30, TimeUnit.SECONDS)) { text }
        return p.exitValue()
    }

    @Test
    fun `the stored certificate is accepted`() {
        assertEquals(0, check("zertifikat", apksigner(release).path, file("# Kommentar\n$release\n").path))
        val howKeytool = release.uppercase().chunked(2).joinToString(":")
        assertEquals("with colons like keytool", 0, check("zertifikat", apksigner(release).path, file(howKeytool).path))
    }

    @Test
    fun `a foreign certificate is rejected, even next to the real one`() {
        assertEquals(1, check("zertifikat", apksigner(foreign).path, file(release).path))
        assertEquals(1, check("zertifikat", apksigner(release, foreign).path, file(release).path))
        assertEquals("without a certificate in the output", 2, check("zertifikat", file("DOES NOT VERIFY").path, file(release).path))
        assertEquals("without an expected value", 2, check("zertifikat", apksigner(release).path, file("# leer\n").path))
    }

    @Test
    fun `the stored file names the release certificate`() {
        assertEquals(0, check("zertifikat", apksigner(release).path, "../tools/release-certificate.sha256"))
    }

    @Test
    fun `a description key the app does not know is rejected`() {
        val old = pem()
        val newValue = pem()
        val app = file("# Kommentar\n$old$newValue").path
        assertEquals("one of the app's two keys", 0, check("schluessel", file(newValue).path, app))
        assertEquals("a foreign key", 1, check("schluessel", file(pem()).path, app))
        assertEquals("no description signature although the app requires one", 1, check("schluessel", "/gibt/es/nicht.pem", app))
        assertEquals("the app knows none yet: it would accept nothing, reported separately", 3,
            check("schluessel", file(newValue).path, file("# leer\n").path))
        assertEquals("a broken block", 2, check("schluessel", file(newValue).path, file("-----BEGIN PUBLIC KEY-----\n%%%\n-----END PUBLIC KEY-----").path))
    }

    @Test
    fun `the app's key file is readable for the workflow`() {
        val returnValue = check("schluessel", "/gibt/es/nicht.pem", "../core-resources/src/main/res/raw/description_key.pem")
        assertEquals("the workflow cannot read res/raw/description_key.pem", false, returnValue == 2)
    }

    private fun version(code: Long, commit: String) = file("""{"versionCode":$code,"versionName":"x","commit":"$commit"}""").path

    @Test
    fun `only a newer state becomes the newest APK`() {
        assertEquals(0, check("fassung", version(200001444, "aaa"), "200001445", "bbb"))
        assertEquals("nothing published yet", 0, check("fassung", "-", "200001445", "bbb"))
        assertEquals("the same commit once more", 0, check("fassung", version(200001444, "aaa"), "200001444", "aaa"))
    }

    @Test
    fun `an older or equally old state of another commit is rejected`() {
        assertEquals(1, check("fassung", version(200001444, "aaa"), "200001443", "bbb"))
        assertEquals(1, check("fassung", version(200001444, "aaa"), "200001444", "bbb"))
        assertEquals(2, check("fassung", file("kaputt").path, "200001445", "bbb"))
        assertEquals(2, check("fassung", version(200001444, "aaa"), "abc", "bbb"))
    }

    @Test
    fun `the signed description must name exactly this APK`() {
        val apk = file("apk-inhalt")
        val other = file("anderes-apk")
        val meta = file("""{"elements":[{"versionCode":200001445,"versionName":"1.2.3"}]}""").path
        val store = "https://github.com/addict85/BrickInventory/releases/download/android-v1.2.3"
        // sha256("apk-inhalt"), length 10
        val sha = MessageDigest.getInstance("SHA-256").digest("apk-inhalt".toByteArray())
            .joinToString("") { "%02x".format(it) }
        fun data(code: Long = 200001445, url: String = "$store/BrickInventory-200001445.apk", checksum: String = sha) = file(
            """{"versionCode":$code,"versionName":"1.2.3","commit":"bbb","apkUrl":"$url","apkSize":10,"apkSha256":"$checksum",""" +
                """"ausgestellt":$now,"gueltigBis":${now + 30 * TAG}}"""
        ).path
        assertEquals(0, check("beschreibung", data(), apk.path, meta, "bbb", store))
        assertEquals("another APK", 1, check("beschreibung", data(), other.path, meta, "bbb", store))
        assertEquals("a wrong checksum", 1, check("beschreibung", data(checksum = "0".repeat(64)), apk.path, meta, "bbb", store))
        assertEquals("the fixed link instead of the version attachment", 1,
            check("beschreibung", data(url = "https://github.com/addict85/BrickInventory/releases/latest/download/BrickInventory.apk"),
                apk.path, meta, "bbb", store))
        assertEquals("another version", 1, check("beschreibung", data(code = 200001444), apk.path, meta, "bbb", store))
        assertEquals("another commit", 1, check("beschreibung", data(), apk.path, meta, "ccc", store))
        assertEquals(2, check("beschreibung", file("kaputt").path, apk.path, meta, "bbb", store))
    }

    private val now = System.currentTimeMillis() / 1000

    @Test
    fun `a description without a valid deadline is not published`() {
        val apk = file("apk-inhalt")
        val meta = file("""{"elements":[{"versionCode":200001445,"versionName":"1.2.3"}]}""").path
        val store = "https://github.com/addict85/BrickInventory/releases/download/android-v1.2.3"
        val sha = MessageDigest.getInstance("SHA-256").digest("apk-inhalt".toByteArray())
            .joinToString("") { "%02x".format(it) }
        fun with(deadline: String) = check("beschreibung", file(
            """{"versionCode":200001445,"versionName":"1.2.3","commit":"bbb","apkUrl":"$store/BrickInventory-200001445.apk",""" +
                """"apkSize":10,"apkSha256":"$sha"$deadline}""").path, apk.path, meta, "bbb", store)
        assertEquals(0, with(""","ausgestellt":$now,"gueltigBis":${now + 30 * TAG}"""))
        assertEquals("without a deadline", 1, with(""))
        assertEquals("issued two days ago", 1, with(""","ausgestellt":${now - 2 * TAG},"gueltigBis":${now + 28 * TAG}"""))
        assertEquals("valid for 100 days", 1, with(""","ausgestellt":$now,"gueltigBis":${now + 100 * TAG}"""))
        assertEquals("valid until before issuing", 1, with(""","ausgestellt":$now,"gueltigBis":${now - 1}"""))
        assertEquals("as text instead of a number", 1, with(""","ausgestellt":"$now","gueltigBis":${now + TAG}"""))
    }

    private companion object {
        const val TAG = 86_400L
    }
}
