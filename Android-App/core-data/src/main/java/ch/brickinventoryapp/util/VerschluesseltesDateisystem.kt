package ch.brickinventoryapp.util

import okio.Buffer
import okio.BufferedSource
import okio.FileHandle
import okio.FileSystem
import okio.ForwardingFileSystem
import okio.Path
import okio.Sink
import okio.Source
import okio.Timeout
import okio.buffer
import java.io.File
import java.io.IOException

/**
 * Ein Dateisystem, das jede Datei mit [AblageChiffre] verschlüsselt: für den
 * HTTP-Zwischenspeicher der Bilder, dessen Inhalt sonst die Sammlung im Klartext neben
 * der verschlüsselten Datenbank zeigte. In Abschnitten, weil OkHttp sein Journal
 * fortschreibt; jeder Abschnitt ist an Zweck, Dateiname und Lage in der Datei gebunden.
 */
class VerschluesseltesDateisystem(
    delegate: FileSystem,
    private val chiffre: AblageChiffre,
    private val zweck: String,
) : ForwardingFileSystem(delegate) {

    override fun source(file: Path): Source = Eingang(delegate.source(file).buffer(), bindung(file))

    override fun sink(file: Path, mustCreate: Boolean): Sink = Ausgang(delegate.sink(file, mustCreate), bindung(file), 0L)

    override fun appendingSink(file: Path, mustExist: Boolean): Sink {
        val ab = delegate.metadataOrNull(file)?.size ?: 0L
        return Ausgang(delegate.appendingSink(file, mustExist), bindung(file), ab)
    }

    // Wahlfreier Zugriff läse Geheimtext als Inhalt; OkHttp braucht ihn nicht.
    override fun openReadOnly(file: Path): FileHandle = throw IOException("kein wahlfreier Zugriff: $file")

    override fun openReadWrite(file: Path, mustCreate: Boolean, mustExist: Boolean): FileHandle =
        throw IOException("kein wahlfreier Zugriff: $file")

    /** `.tmp` und `.bkp` sind Zwischenstände derselben Datei: OkHttp benennt sie nur um. */
    private fun bindung(file: Path): String {
        var name = file.name
        while (name.endsWith(".tmp") || name.endsWith(".bkp")) name = name.dropLast(4)
        return "$zweck/$name"
    }

    private inner class Ausgang(private val ziel: Sink, private val bindung: String, private var lage: Long) : Sink {
        private val puffer = Buffer()

        override fun write(source: Buffer, byteCount: Long) {
            puffer.write(source, byteCount)
            while (puffer.size >= ABSCHNITT) schreibe(ABSCHNITT)
        }

        private fun schreibe(laenge: Long) {
            val geheim = verschluessle(puffer.readByteArray(laenge), "$bindung@$lage")
            val satz = Buffer().writeInt(geheim.size).write(geheim)
            lage += satz.size
            ziel.write(satz, satz.size)
        }

        override fun flush() {
            if (puffer.size > 0) schreibe(puffer.size)
            ziel.flush()
        }

        override fun timeout(): Timeout = ziel.timeout()

        override fun close() {
            try {
                if (puffer.size > 0) schreibe(puffer.size)
            } finally {
                ziel.close()
            }
        }
    }

    private inner class Eingang(private val quelle: BufferedSource, private val bindung: String) : Source {
        private val klar = Buffer()
        private var lage = 0L

        override fun read(sink: Buffer, byteCount: Long): Long {
            while (klar.size == 0L) if (!naechster()) return -1L
            return klar.read(sink, byteCount)
        }

        private fun naechster(): Boolean {
            if (quelle.exhausted()) return false
            val laenge = quelle.readInt()
            if (laenge <= 0 || laenge > ABSCHNITT + 64) throw IOException("unlesbarer Abschnitt in $bindung")
            val inhalt = chiffre.entschluessle(quelle.readByteArray(laenge.toLong()), "$bindung@$lage")
                ?: throw IOException("Abschnitt gehört nicht zu $bindung")
            lage += 4L + laenge
            klar.write(inhalt)
            return true
        }

        override fun timeout(): Timeout = quelle.timeout()

        override fun close() = quelle.close()
    }

    /** OkHttp fängt nur IOException; ein gesperrter Keystore soll den Abruf nicht abbrechen. */
    private fun verschluessle(klar: ByteArray, bindung: String): ByteArray =
        try {
            chiffre.verschluessle(klar, bindung)
        } catch (e: IOException) {
            throw e
        } catch (e: Exception) {
            throw IOException("nicht verschlüsselt: $bindung", e)
        }

    private companion object {
        const val ABSCHNITT = 64L * 1024
    }
}

/**
 * Die Bild-Zwischenspeicher früherer Fassungen lagen im Klartext: Coils eigener fällt
 * weg, der von OkHttp (derselbe Ordner wie in NetzModule) nur, wenn sein Journal noch
 * lesbar ist. Beim Start, damit nach dem Update keine Kopie der Sammlung offen liegt.
 */
fun raeumeKlartextBildcachesAuf(cacheDir: File) {
    File(cacheDir, "image_cache").deleteRecursively()
    val http = File(cacheDir, "image_http_cache")
    val klartext = listOf("journal", "journal.bkp").any { name ->
        runCatching { File(http, name).bufferedReader().use { it.readLine() } == "libcore.io.DiskLruCache" }.getOrDefault(false)
    }
    if (klartext) http.deleteRecursively()
}
