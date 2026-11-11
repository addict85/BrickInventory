package ch.brickinventoryapp.data

import ch.brickinventoryapp.sicherheit.AblageChiffre
import ch.brickinventoryapp.sicherheit.VerschluesseltesDateisystem
import ch.brickinventoryapp.sicherheit.raeumeKlartextBildcachesAuf
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
 * Der HTTP-Zwischenspeicher der Bilder liegt verschlüsselt: Auf der Platte
 * stehen weder die Bilder noch ihre Adressen, und offline liefert er trotzdem.
 * Ausgeführt mit einem echten OkHttp-Cache gegen einen Testserver.
 *
 * Gegenproben:
 *   A  VerschluesseltesDateisystem reicht source/sink/appendingSink unverändert durch
 *      → rot „der Zwischenspeicher liegt verschluesselt …“;
 *      gegenproben/bildcache-klartext.patch
 *   B  bindung() ohne den Dateinamen (nur der Zweck) → rot „eine Datei unter fremdem
 *      Namen gilt nicht …“
 *   C  raeumeKlartextBildcachesAuf() ohne die Zeile `if (klartext) http.deleteRecursively()`
 *      → rot „ein Klartext-Zwischenspeicher aelterer Fassungen verschwindet …“
 *   D  im Eingang `if (!abgeschlossen) throw …`
 *      gestrichen → rot „eine hinten gekuerzte Datei gilt nicht …“;
 *      gegenproben/bildcache-ohne-endmarker.patch
 *   E  onPathParameter() reicht den Pfad ungestreut durch → rot „die Namen im
 *      Zwischenspeicher verraten die Adressen nicht“; gegenproben/bildcache-namen-lesbar.patch
 *   F  raeumeKlartextBildcachesAuf() ohne das Löschen ungestreuter Namen → rot „ein
 *      Klartext-Zwischenspeicher …“; gegenproben/bildcache-alte-namen-bleiben.patch
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

    private val gestreut = VerschluesseltesDateisystem(FileSystem.SYSTEM, chiffre, "bilder",
        VerschluesseltesDateisystem.Streuung(ordner.toOkioPath()) { ByteArray(32) { 8 } })

    @Test
    fun `die Namen im Zwischenspeicher verraten die Adressen nicht`() {
        val bild = "SAMMLUNG-10179".toByteArray()
        server.enqueue(MockResponse().setBody(Buffer().write(bild)).setHeader("Cache-Control", "max-age=0"))
        server.start()
        val adresse = server.url("/api/v1/images/set/10179-1?thumb=1")
        val cache = Cache(gestreut, ordner.toOkioPath(), 4L * 1024 * 1024)
        val c = OkHttpClient.Builder().cache(cache).build()
        c.newCall(Request.Builder().url(adresse).build()).execute().use { assertArrayEquals(bild, it.body.bytes()) }
        cache.flush()

        // OkHttp benennt nach dem MD5 der Adresse (Cache.key); kein Name darf ihn oder „journal“ tragen.
        val md5 = Cache.key(adresse)
        val namen = ordner.listFiles()!!.map { it.name }
        assertTrue("Der Zwischenspeicher hat nichts abgelegt: $namen", namen.size >= 3)
        assertTrue("Lesbare Namen: $namen", namen.all { it.startsWith(VerschluesseltesDateisystem.GESTREUT) && md5 !in it && "journal" !in it })

        server.shutdown()
        val offline = Request.Builder().url(adresse).cacheControl(CacheControl.FORCE_CACHE).build()
        c.newCall(offline).execute().use { assertArrayEquals("Offline kommt die Kopie trotzdem", bild, it.body.bytes()) }
        cache.evictAll()
        // Übrig bleibt nur das Journal (samt Sicherung); ein doppelt gestreuter Name liesse die Einträge liegen.
        assertTrue("Leeren findet die gestreuten Namen nicht: ${ordner.list()?.toList()}", ordner.listFiles()!!.size <= 2)
    }

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
        File(http, "journal").apply { parentFile!!.mkdirs(); writeText("libcore.io.DiskLruCache\n1\n201105\n2\n") }
        File(http, "abc.1").writeText("SAMMLUNG-75192")
        File(coil, "x.1").writeText("SAMMLUNG-75192")
        raeumeKlartextBildcachesAuf(cacheDir)
        assertFalse("Der Klartext-Zwischenspeicher von OkHttp bleibt liegen", http.exists())
        assertFalse("Coils Klartext-Zwischenspeicher bleibt liegen", coil.exists())

        val neu = VerschluesseltesDateisystem(FileSystem.SYSTEM, chiffre, "bilder",
            VerschluesseltesDateisystem.Streuung(http.apply { mkdirs() }.toOkioPath()) { ByteArray(32) { 8 } })
        neu.sink(File(http, "journal").toOkioPath()).buffer().use { it.writeUtf8("libcore.io.DiskLruCache\n") }
        // Ein verschlüsselter Eintrag älterer Fassungen unter dem MD5-Namen der Adresse.
        fs.sink(File(http, "0f343b0931126a20f133d67c2b018a3b.1").toOkioPath()).buffer().use { it.writeUtf8("x") }
        raeumeKlartextBildcachesAuf(cacheDir)
        val bleibt = http.listFiles()!!.map { it.name }
        assertEquals("Nur der gestreute Zwischenspeicher bleibt: $bleibt", 1, bleibt.size)
        assertTrue(bleibt.single().startsWith(VerschluesseltesDateisystem.GESTREUT))
    }

    /** Ohne Endmarker gälte ein um ganze Abschnitte gekürztes Bild als vollständig. */
    @Test
    fun `eine hinten gekuerzte Datei gilt nicht, eine fortgeschriebene schon`() {
        ordner.mkdirs()
        val f = File(ordner, "bild.1")
        val inhalt = ByteArray(200_000) { (it % 251).toByte() }
        fs.sink(f.toOkioPath()).buffer().use { it.write(inhalt) }
        val ganz = f.readBytes()
        fun lies() = runCatching { fs.source(f.toOkioPath()).buffer().use { it.readByteArray() } }

        assertArrayEquals(inhalt, lies().getOrThrow())
        // Ohne den Endmarker (4 Bytes Länge, 32 Bytes Kennung, IV und Tag).
        f.writeBytes(ganz.copyOf(ganz.size - 36))
        assertTrue("Ohne Endmarker gilt die Datei", lies().exceptionOrNull() is IOException)
        // Nur der erste Abschnitt (64 KiB Klartext) samt Längenfeld.
        f.writeBytes(ganz.copyOf(4 + 65_536 + 32))
        assertTrue("Ein gekürztes Bild gilt", lies().exceptionOrNull() is IOException)
        f.writeBytes(ByteArray(0))
        assertTrue("Eine leere Datei gilt", lies().exceptionOrNull() is IOException)

        // Das Journal wird nach jeder Zeile geflusht und fortgeschrieben: Jeder Stand endet mit einem Marker.
        f.writeBytes(ganz)
        fs.appendingSink(f.toOkioPath()).buffer().use { aus ->
            aus.writeUtf8("CLEAN a\n").flush()
            aus.writeUtf8("CLEAN b\n").flush()
        }
        assertArrayEquals(inhalt + "CLEAN a\nCLEAN b\n".toByteArray(), lies().getOrThrow())
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
