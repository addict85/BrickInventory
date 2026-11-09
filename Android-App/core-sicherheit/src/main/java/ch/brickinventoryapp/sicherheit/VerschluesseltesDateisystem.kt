package ch.brickinventoryapp.sicherheit

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
import ch.brickinventoryapp.model.util.fangeAusserAbbruch

/**
 * Ein Dateisystem, das jede Datei mit [AblageChiffre] verschlüsselt: für den
 * HTTP-Zwischenspeicher der Bilder und die Bauanleitungen, die sonst die Sammlung im
 * Klartext zeigten. In Abschnitten, weil OkHttp sein Journal fortschreibt; jeder ist an
 * Zweck, Dateiname und Lage gebunden. Ein Endmarker nach jedem flush und close macht eine
 * hinten gekürzte Datei unlesbar, statt sie als kürzere gelten zu lassen.
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

    /** `.tmp`, `.bkp` (OkHttp) und `.part` (laufender Download) sind dieselbe Datei, nur noch nicht umbenannt. */
    private fun bindung(file: Path): String {
        var name = file.name
        while (true) {
            val endung = ZWISCHENSTAENDE.firstOrNull { name.endsWith(it) } ?: break
            name = name.dropLast(endung.length)
        }
        return "$zweck/$name"
    }

    private inner class Ausgang(private val ziel: Sink, private val bindung: String, private var lage: Long) : Sink {
        private val puffer = Buffer()

        // Fortgeschrieben endet die Datei schon mit einem Marker; eine neue braucht einen, auch leer.
        private var offen = lage == 0L

        override fun write(source: Buffer, byteCount: Long) {
            puffer.write(source, byteCount)
            while (puffer.size >= ABSCHNITT) schreibe(puffer.readByteArray(ABSCHNITT), "$bindung@$lage")
        }

        private fun schreibe(klar: ByteArray, aad: String) {
            val geheim = verschluessle(klar, aad)
            val satz = Buffer().writeInt(geheim.size).write(geheim)
            lage += satz.size
            ziel.write(satz, satz.size)
            offen = true
        }

        private fun schliesseAb() {
            if (puffer.size > 0) schreibe(puffer.readByteArray(), "$bindung@$lage")
            if (offen) {
                schreibe(ByteArray(0), "$bindung@$lage$ENDE")
                offen = false
            }
        }

        override fun flush() {
            schliesseAb()
            ziel.flush()
        }

        override fun timeout(): Timeout = ziel.timeout()

        override fun close() {
            try {
                schliesseAb()
            } finally {
                ziel.close()
            }
        }
    }

    private inner class Eingang(private val quelle: BufferedSource, private val bindung: String) : Source {
        private val klar = Buffer()
        private var lage = 0L
        private var abgeschlossen = false

        override fun read(sink: Buffer, byteCount: Long): Long {
            while (klar.size == 0L) if (!naechster()) return -1L
            return klar.read(sink, byteCount)
        }

        private fun naechster(): Boolean {
            if (quelle.exhausted()) {
                if (!abgeschlossen) throw IOException("abgeschnitten: $bindung")
                return false
            }
            val laenge = quelle.readInt()
            if (laenge <= 0 || laenge > ABSCHNITT + 64) throw IOException("unlesbarer Abschnitt in $bindung")
            val satz = quelle.readByteArray(laenge.toLong())
            val inhalt = chiffre.entschluessle(satz, "$bindung@$lage")
            if (inhalt != null) {
                klar.write(inhalt)
                abgeschlossen = false
            } else if (chiffre.entschluessle(satz, "$bindung@$lage$ENDE")?.isEmpty() == true) {
                abgeschlossen = true
            } else {
                throw IOException("Abschnitt gehört nicht zu $bindung")
            }
            lage += 4L + laenge
            return true
        }

        override fun timeout(): Timeout = quelle.timeout()

        override fun close() = quelle.close()
    }

    /** OkHttp fängt nur IOException; ein gesperrter Keystore soll den Abruf nicht abbrechen. */
    private fun verschluessle(klar: ByteArray, bindung: String): ByteArray =
        fangeAusserAbbruch { chiffre.verschluessle(klar, bindung) }
            .getOrElse { throw it as? IOException ?: IOException("nicht verschlüsselt: $bindung", it) }

    private companion object {
        const val ABSCHNITT = 64L * 1024
        const val ENDE = "#ende"
        val ZWISCHENSTAENDE = listOf(".tmp", ".bkp", ".part")
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
