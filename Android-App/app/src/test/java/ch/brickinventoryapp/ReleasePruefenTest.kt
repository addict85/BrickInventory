package ch.brickinventoryapp

import org.junit.Assert.assertEquals
import org.junit.Test
import java.io.File
import java.util.concurrent.TimeUnit

/**
 * Die Prüfungen vor dem Veröffentlichen (tools/release-pruefen.py, sec7 N6),
 * ausgeführt gegen Ausgaben im Format von `apksigner verify --print-certs` und
 * gegen version.json-Dateien wie die des Release `apk-neuste`.
 *
 * Gegenproben (03.11.2026, gemessen, kotlinc und python3 lokal):
 *   A  in zertifikat() `fremd = []` → rot „ein fremdes Zertifikat …“
 *   B  in fassung() `neu >= alt_code` ohne Commit-Vergleich → rot „ein älterer
 *      oder gleich alter Stand …“
 *   C  das Muster auf `SHA256 digest` statt `SHA-256 digest` → rot „das hinterlegte
 *      Zertifikat wird angenommen“ (Rückgabe 2 statt 0)
 *   D  tools/release-zertifikat.sha256 ohne Wert → rot „die hinterlegte Datei nennt …“
 *   E  (sec8 N4) in beschreibung() `apkSha256` aus `soll` gestrichen → rot „die
 *      signierte Beschreibung muss genau dieses APK nennen“ (ein anderes APK ging durch)
 */
class ReleasePruefenTest {

    private val release = "a51ff2f425d94b6f31a06b7805013cc801791b28e58404dc26c7c8298380af06"
    private val fremd = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"

    private fun datei(inhalt: String): File = File.createTempFile("release", ".txt").apply {
        deleteOnExit(); writeText(inhalt)
    }

    private fun apksigner(vararg sha: String): File = datei(sha.mapIndexed { i, s ->
        "Signer #${i + 1} certificate DN: CN=Marco\nSigner #${i + 1} certificate SHA-256 digest: $s\n" +
            "Signer #${i + 1} certificate SHA-1 digest: 00\nSigner #${i + 1} certificate MD5 digest: 00\n"
    }.joinToString(""))

    private fun pruefe(vararg args: String): Int {
        val p = ProcessBuilder(listOf("python3", "../tools/release-pruefen.py") + args).redirectErrorStream(true).start()
        val text = p.inputStream.bufferedReader().readText()
        check(p.waitFor(30, TimeUnit.SECONDS)) { text }
        return p.exitValue()
    }

    @Test
    fun `das hinterlegte Zertifikat wird angenommen`() {
        assertEquals(0, pruefe("zertifikat", apksigner(release).path, datei("# Kommentar\n$release\n").path))
        val wieKeytool = release.uppercase().chunked(2).joinToString(":")
        assertEquals("Mit Doppelpunkten wie keytool", 0, pruefe("zertifikat", apksigner(release).path, datei(wieKeytool).path))
    }

    @Test
    fun `ein fremdes Zertifikat wird abgelehnt, auch neben dem echten`() {
        assertEquals(1, pruefe("zertifikat", apksigner(fremd).path, datei(release).path))
        assertEquals(1, pruefe("zertifikat", apksigner(release, fremd).path, datei(release).path))
        assertEquals("Ohne Zertifikat in der Ausgabe", 2, pruefe("zertifikat", datei("DOES NOT VERIFY").path, datei(release).path))
        assertEquals("Ohne Sollwert", 2, pruefe("zertifikat", apksigner(release).path, datei("# leer\n").path))
    }

    @Test
    fun `die hinterlegte Datei nennt das Release-Zertifikat`() {
        assertEquals(0, pruefe("zertifikat", apksigner(release).path, "../tools/release-zertifikat.sha256"))
    }

    private fun version(code: Long, commit: String) = datei("""{"versionCode":$code,"versionName":"x","commit":"$commit"}""").path

    @Test
    fun `nur ein neuerer Stand wird das neuste APK`() {
        assertEquals(0, pruefe("fassung", version(200001444, "aaa"), "200001445", "bbb"))
        assertEquals("Noch nichts veröffentlicht", 0, pruefe("fassung", "-", "200001445", "bbb"))
        assertEquals("Derselbe Commit noch einmal", 0, pruefe("fassung", version(200001444, "aaa"), "200001444", "aaa"))
    }

    @Test
    fun `ein aelterer oder gleich alter Stand eines anderen Commits wird abgelehnt`() {
        assertEquals(1, pruefe("fassung", version(200001444, "aaa"), "200001443", "bbb"))
        assertEquals(1, pruefe("fassung", version(200001444, "aaa"), "200001444", "bbb"))
        assertEquals(2, pruefe("fassung", datei("kaputt").path, "200001445", "bbb"))
        assertEquals(2, pruefe("fassung", version(200001444, "aaa"), "abc", "bbb"))
    }

    @Test
    fun `die signierte Beschreibung muss genau dieses APK nennen`() {
        val apk = datei("apk-inhalt")
        val anderes = datei("anderes-apk")
        val meta = datei("""{"elements":[{"versionCode":200001445,"versionName":"1.2.3"}]}""").path
        val ablage = "https://github.com/addict85/BrickInventory/releases/download/android-v1.2.3"
        // sha256("apk-inhalt"), Länge 10
        val sha = java.security.MessageDigest.getInstance("SHA-256").digest("apk-inhalt".toByteArray())
            .joinToString("") { "%02x".format(it) }
        fun daten(code: Long = 200001445, url: String = "$ablage/BrickInventory-200001445.apk", pruefsumme: String = sha) = datei(
            """{"versionCode":$code,"versionName":"1.2.3","commit":"bbb","apkUrl":"$url","apkSize":10,"apkSha256":"$pruefsumme"}"""
        ).path
        assertEquals(0, pruefe("beschreibung", daten(), apk.path, meta, "bbb", ablage))
        assertEquals("Ein anderes APK", 1, pruefe("beschreibung", daten(), anderes.path, meta, "bbb", ablage))
        assertEquals("Eine falsche Prüfsumme", 1, pruefe("beschreibung", daten(pruefsumme = "0".repeat(64)), apk.path, meta, "bbb", ablage))
        assertEquals("Der veränderliche Anhang statt des Fassungsanhangs", 1,
            pruefe("beschreibung", daten(url = "https://github.com/addict85/BrickInventory/releases/download/apk-neuste/BrickInventory.apk"),
                apk.path, meta, "bbb", ablage))
        assertEquals("Eine andere Fassung", 1, pruefe("beschreibung", daten(code = 200001444), apk.path, meta, "bbb", ablage))
        assertEquals("Ein anderer Commit", 1, pruefe("beschreibung", daten(), apk.path, meta, "ccc", ablage))
        assertEquals(2, pruefe("beschreibung", datei("kaputt").path, apk.path, meta, "bbb", ablage))
    }
}
