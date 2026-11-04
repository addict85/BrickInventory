package ch.brickinventoryapp

import ch.brickinventoryapp.util.AblageChiffre
import ch.brickinventoryapp.util.VerschluesseltesDateisystem
import ch.brickinventoryapp.util.raeumeKlartextBildcachesAuf
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
 * Der HTTP-Zwischenspeicher der Bilder liegt verschlüsselt (sec11 N1): Auf der Platte
 * stehen weder die Bilder noch ihre Adressen, und offline liefert er trotzdem.
 * Ausgeführt mit einem echten OkHttp-Cache gegen einen Testserver.
 *
 * Gegenproben (04.11.2026, gemessen mit kotlinc lokal):
 *   A  VerschluesseltesDateisystem reicht source/sink/appendingSink unverändert durch
 *      → rot „der Zwischenspeicher liegt verschluesselt …“;
 *      gegenproben/bildcache-klartext.patch
 *   B  bindung() ohne den Dateinamen (nur der Zweck) → rot „eine Datei unter fremdem
 *      Namen gilt nicht …“
 *   C  raeumeKlartextBildcachesAuf() ohne die Zeile `if (klartext) http.deleteRecursively()`
 *      → rot „ein Klartext-Zwischenspeicher aelterer Fassungen verschwindet …“
 */
class BildZwischenspeicherTest {

    private val ordner = File(System.getProperty("java.io.tmpdir"), "bim-bilder-${System.nanoTime()}")
    private val chiffre = AblageChiffre { ByteArray(32) { 7 } }
    private val fs = VerschluesseltesDateisystem(FileSystem.SYSTEM, chiffre, "bilder")
    private val server = MockWebServer()

    @After
    fun zu() {
        server.shutdown()
        ordner.deleteRecursively()
    }

    private fun client() = OkHttpClient.Builder().cache(Cache(fs, ordner.toOkioPath(), 4L * 1024 * 1024)).build()

    @Test
    fun `der Zwischenspeicher liegt verschluesselt und liefert offline trotzdem`() {
        // Grösser als ein Abschnitt (64 KiB), damit auch das Zusammensetzen geprüft ist.
        val bild = ("SAMMLUNG-75192-" + "x".repeat(200_000)).toByteArray()
        server.enqueue(MockResponse().setBody(Buffer().write(bild)).setHeader("Cache-Control", "max-age=0").setHeader("ETag", "\"1\""))
        server.start()
        val adresse = server.url("/api/v1/images/set/75192-1?thumb=1")

        val erster = client()
        erster.newCall(Request.Builder().url(adresse).build()).execute().use { assertArrayEquals(bild, it.body.bytes()) }
        erster.cache!!.close()

        val dateien = ordner.walkTopDown().filter { it.isFile }.toList()
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
    fun `ein Klartext-Zwischenspeicher aelterer Fassungen verschwindet, der verschluesselte bleibt`() {
        val cacheDir = File(ordner, "cache")
        val http = File(cacheDir, "image_http_cache")
        val coil = File(cacheDir, "image_cache").apply { mkdirs() }
        File(http, "journal").apply { parentFile.mkdirs(); writeText("libcore.io.DiskLruCache\n1\n201105\n2\n") }
        File(http, "abc.1").writeText("SAMMLUNG-75192")
        File(coil, "x.1").writeText("SAMMLUNG-75192")
        raeumeKlartextBildcachesAuf(cacheDir)
        assertFalse("Der Klartext-Zwischenspeicher von OkHttp bleibt liegen", http.exists())
        assertFalse("Coils Klartext-Zwischenspeicher bleibt liegen", coil.exists())

        fs.sink(File(http.apply { mkdirs() }, "journal").toOkioPath()).buffer().use { it.writeUtf8("libcore.io.DiskLruCache\n") }
        raeumeKlartextBildcachesAuf(cacheDir)
        assertTrue("Der verschlüsselte Zwischenspeicher gilt nicht als Klartext", File(http, "journal").exists())
    }

    @Test
    fun `eine Datei unter fremdem Namen gilt nicht, eine umbenannte Zwischenstufe schon`() {
        ordner.mkdirs()
        val a = File(ordner, "a.0").toOkioPath()
        fs.sink(File(ordner, "a.0.tmp").toOkioPath()).buffer().use { it.writeUtf8("Inhalt von a") }
        fs.atomicMove(File(ordner, "a.0.tmp").toOkioPath(), a)
        fs.appendingSink(a).buffer().use { it.writeUtf8(", fortgeschrieben") }
        assertEquals("Inhalt von a, fortgeschrieben", fs.source(a).buffer().use { it.readUtf8() })

        val b = File(ordner, "b.0")
        File(ordner, "a.0").copyTo(b)
        val gelesen = runCatching { fs.source(b.toOkioPath()).buffer().use { it.readUtf8() } }
        assertTrue("Die Kopie unter dem Namen b gilt als b", gelesen.exceptionOrNull() is IOException)
    }
}
