package ch.brickinventoryapp.data

import ch.brickinventoryapp.security.StoreCipher
import ch.brickinventoryapp.security.EncryptedFileSystem
import ch.brickinventoryapp.security.cleanPlaintextImageCachesOn
import okhttp3.Cache
import okhttp3.CacheControl
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okio.Buffer
import okio.FileSystem
import okio.Path.Companion.toOkioPath
import okio.buffer
import org.junit.After
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File
import java.io.IOException

/**
 * The HTTP cache of the images lies encrypted: on disk
 * stand neither the images nor their addresses, and offline it still delivers.
 * Executed with a real OkHttp cache against a test server.
 *
 * Counter-checks:
 *   A  EncryptedFileSystem passes source/sink/appendingSink through unchanged
 *      → red “the cache lies encrypted …”;
 *      gegenproben/bildcache-klartext.patch
 *   B  bindung() without the file name (only the purpose) → red “a file under a foreign
 *      name does not count …”
 *   C  cleanPlaintextImageCachesOn() without the line `if (klartext) http.deleteRecursively()`
 *      → red “a plain-text cache of older versions disappears …”
 *   D  in the input `if (!abgeschlossen) throw …`
 *      deleted → red “a file truncated at the end does not count …”;
 *      gegenproben/bildcache-ohne-endmarker.patch
 *   E  onPathParameter() passes the path through unhashed → red “the names in the
 *      cache do not reveal the addresses”; gegenproben/bildcache-namen-lesbar.patch
 *   F  cleanPlaintextImageCachesOn() without deleting unhashed names → red “a
 *      plain-text cache …”; gegenproben/bildcache-alte-namen-bleiben.patch
 */
class ImageCacheTest {

    private val folder = File(System.getProperty("java.io.tmpdir"), "bim-bilder-${System.nanoTime()}")
    private val cipher = StoreCipher { ByteArray(32) { 7 } }
    private val fs = EncryptedFileSystem(FileSystem.SYSTEM, cipher, "bilder")
    private val server = MockWebServer()

    @After
    fun zu() {
        server.shutdown()
        folder.deleteRecursively()
    }

    private fun client() = OkHttpClient.Builder().cache(Cache(fs, folder.toOkioPath(), 4L * 1024 * 1024)).build()

    private val jittered = EncryptedFileSystem(FileSystem.SYSTEM, cipher, "bilder",
        EncryptedFileSystem.Jitter(folder.toOkioPath()) { ByteArray(32) { 8 } })

    @Test
    fun `the names in the cache do not reveal the addresses`() {
        val bild = "SAMMLUNG-10179".toByteArray()
        server.enqueue(MockResponse().setBody(Buffer().write(bild)).setHeader("Cache-Control", "max-age=0"))
        server.start()
        val adresse = server.url("/api/v1/images/set/10179-1?thumb=1")
        val cache = Cache(jittered, folder.toOkioPath(), 4L * 1024 * 1024)
        val c = OkHttpClient.Builder().cache(cache).build()
        c.newCall(Request.Builder().url(adresse).build()).execute().use { assertArrayEquals(bild, it.body.bytes()) }
        cache.flush()

        // OkHttp names by the MD5 of the address (Cache.key); no name may carry it or „journal“.
        val md5 = Cache.key(adresse)
        val namen = folder.listFiles()!!.map { it.name }
        assertTrue("Der Zwischenspeicher hat nichts abgelegt: $namen", namen.size >= 3)
        assertTrue("Lesbare Namen: $namen", namen.all { it.startsWith(EncryptedFileSystem.JITTERED) && md5 !in it && "journal" !in it })

        server.shutdown()
        val offline = Request.Builder().url(adresse).cacheControl(CacheControl.FORCE_CACHE).build()
        c.newCall(offline).execute().use { assertArrayEquals("Offline kommt die Kopie trotzdem", bild, it.body.bytes()) }
        cache.evictAll()
        // Only the journal (including backup) remains; a doubly hashed name would leave the entries lying.
        assertTrue("Leeren findet die gestreuten Namen nicht: ${folder.list()?.toList()}", folder.listFiles()!!.size <= 2)
    }

    @Test
    fun `the cache lies encrypted and still delivers offline`() {
        // Larger than a section (64 KiB), so that the assembling is checked too.
        val bild = ("SAMMLUNG-75192-" + "x".repeat(200_000)).toByteArray()
        server.enqueue(MockResponse().setBody(Buffer().write(bild)).setHeader("Cache-Control", "max-age=0").setHeader("ETag", "\"1\""))
        server.start()
        val adresse = server.url("/api/v1/images/set/75192-1?thumb=1")

        val erster = client()
        erster.newCall(Request.Builder().url(adresse).build()).execute().use { assertArrayEquals(bild, it.body.bytes()) }
        erster.cache!!.close()

        val dateien = folder.walkTopDown().filter { it.isFile }.toList()
        assertTrue("Der Zwischenspeicher hat nichts abgelegt", dateien.size >= 3)
        for (f in dateien) {
            val roh = String(f.readBytes(), Charsets.ISO_8859_1)
            assertFalse("${f.name} trägt das Bild im Klartext", "SAMMLUNG-75192" in roh)
            assertFalse("${f.name} trägt die Adresse im Klartext", "75192-1" in roh)
        }

        server.shutdown()
        val offline = Request.Builder().url(adresse).cacheControl(CacheControl.FORCE_CACHE).build()
        client().newCall(offline).execute().use {
            assertEquals("Offline kommt die Kopie aus dem Zwischenspeicher", 200, it.code)
            assertArrayEquals(bild, it.body.bytes())
        }
    }

    @Test
    fun `a plain-text cache of older versions disappears, the encrypted one stays`() {
        val cacheDir = File(folder, "cache")
        val http = File(cacheDir, "image_http_cache")
        val coil = File(cacheDir, "image_cache").apply { mkdirs() }
        File(http, "journal").apply { parentFile!!.mkdirs(); writeText("libcore.io.DiskLruCache\n1\n201105\n2\n") }
        File(http, "abc.1").writeText("SAMMLUNG-75192")
        File(coil, "x.1").writeText("SAMMLUNG-75192")
        cleanPlaintextImageCachesOn(cacheDir)
        assertFalse("Der Klartext-Zwischenspeicher von OkHttp bleibt liegen", http.exists())
        assertFalse("Coils Klartext-Zwischenspeicher bleibt liegen", coil.exists())

        val neu = EncryptedFileSystem(FileSystem.SYSTEM, cipher, "bilder",
            EncryptedFileSystem.Jitter(http.apply { mkdirs() }.toOkioPath()) { ByteArray(32) { 8 } })
        neu.sink(File(http, "journal").toOkioPath()).buffer().use { it.writeUtf8("libcore.io.DiskLruCache\n") }
        // An encrypted entry of older versions under the MD5 name of the address.
        fs.sink(File(http, "0f343b0931126a20f133d67c2b018a3b.1").toOkioPath()).buffer().use { it.writeUtf8("x") }
        cleanPlaintextImageCachesOn(cacheDir)
        val bleibt = http.listFiles()!!.map { it.name }
        assertEquals("Nur der gestreute Zwischenspeicher bleibt: $bleibt", 1, bleibt.size)
        assertTrue(bleibt.single().startsWith(EncryptedFileSystem.JITTERED))
    }

    /** Without the end marker an image truncated by whole sections would count as complete. */
    @Test
    fun `a file truncated at the end does not count, a continued one does`() {
        folder.mkdirs()
        val f = File(folder, "bild.1")
        val inhalt = ByteArray(200_000) { (it % 251).toByte() }
        fs.sink(f.toOkioPath()).buffer().use { it.write(inhalt) }
        val ganz = f.readBytes()
        fun lies() = runCatching { fs.source(f.toOkioPath()).buffer().use { it.readByteArray() } }

        assertArrayEquals(inhalt, lies().getOrThrow())
        // Without the end marker (4 bytes length, 32 bytes identifier, IV and tag).
        f.writeBytes(ganz.copyOf(ganz.size - 36))
        assertTrue("Ohne Endmarker gilt die Datei", lies().exceptionOrNull() is IOException)
        // Only the first section (64 KiB plaintext) including length field.
        f.writeBytes(ganz.copyOf(4 + 65_536 + 32))
        assertTrue("Ein gekürztes Bild gilt", lies().exceptionOrNull() is IOException)
        f.writeBytes(ByteArray(0))
        assertTrue("Eine leere Datei gilt", lies().exceptionOrNull() is IOException)

        // The journal is flushed and continued after every line: every state ends with a marker.
        f.writeBytes(ganz)
        fs.appendingSink(f.toOkioPath()).buffer().use { aus ->
            aus.writeUtf8("CLEAN a\n").flush()
            aus.writeUtf8("CLEAN b\n").flush()
        }
        assertArrayEquals(inhalt + "CLEAN a\nCLEAN b\n".toByteArray(), lies().getOrThrow())
    }

    @Test
    fun `a file under a foreign name does not count, a renamed intermediate stage does`() {
        folder.mkdirs()
        val a = File(folder, "a.0").toOkioPath()
        fs.sink(File(folder, "a.0.tmp").toOkioPath()).buffer().use { it.writeUtf8("Inhalt von a") }
        fs.atomicMove(File(folder, "a.0.tmp").toOkioPath(), a)
        fs.appendingSink(a).buffer().use { it.writeUtf8(", fortgeschrieben") }
        assertEquals("Inhalt von a, fortgeschrieben", fs.source(a).buffer().use { it.readUtf8() })

        val b = File(folder, "b.0")
        File(folder, "a.0").copyTo(b)
        val gelesen = runCatching { fs.source(b.toOkioPath()).buffer().use { it.readUtf8() } }
        assertTrue("Die Kopie unter dem Namen b gilt als b", gelesen.exceptionOrNull() is IOException)
    }
}
