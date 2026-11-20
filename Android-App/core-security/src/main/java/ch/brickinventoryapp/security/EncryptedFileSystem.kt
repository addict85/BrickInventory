package ch.brickinventoryapp.security

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
import javax.crypto.Mac
import javax.crypto.spec.SecretKeySpec
import ch.brickinventoryapp.model.util.fangeAusserAbbruch

/**
 * Ein Dateisystem, das jede Datei mit [StoreCipher] verschlüsselt: für den
 * HTTP-Zwischenspeicher der Bilder und die Bauanleitungen, die sonst die Sammlung im
 * Klartext zeigten. In Abschnitten, weil OkHttp sein Journal fortschreibt; jeder ist an
 * Zweck, Dateiname und Lage gebunden. Ein Endmarker nach jedem flush und close macht eine
 * hinten gekürzte Datei unlesbar, statt sie als kürzere gelten zu lassen.
 */
class EncryptedFileSystem(
    delegate: FileSystem,
    private val cipher: StoreCipher,
    private val zweck: String,
    private val jitter: Jitter? = null,
) : ForwardingFileSystem(delegate) {

    /**
     * Dateinamen direkt unter [folder] liegen nur als HMAC mit [schluessel] auf der Platte:
     * OkHttp benennt Einträge nach dem MD5 der Adresse, und bekannte Adressen liessen sich
     * so nachrechnen. Gelistete Namen tragen [JITTERED] und werden nicht noch einmal gestreut.
     */
    class Jitter(val folder: Path, val schluessel: () -> ByteArray)

    override fun onPathParameter(path: Path, functionName: String, parameterName: String): Path = jittered(path)

    private fun jittered(path: Path): Path {
        val s = jitter ?: return path
        if (path.parent != s.folder || path.name.startsWith(JITTERED)) return path
        val mac = Mac.getInstance("HmacSHA256").apply { init(SecretKeySpec(s.schluessel(), "HmacSHA256")) }
        val name = mac.doFinal(path.name.toByteArray(Charsets.UTF_8)).take(NAME_LENGTH).joinToString("") { "%02x".format(it) }
        return s.folder / (JITTERED + name)
    }

    override fun source(file: Path): Source = Inbox(delegate.source(jittered(file)).buffer(), bindung(file))

    override fun sink(file: Path, mustCreate: Boolean): Sink =
        Ausgang(delegate.sink(jittered(file), mustCreate), bindung(file), 0L)

    override fun appendingSink(file: Path, mustExist: Boolean): Sink {
        val ab = delegate.metadataOrNull(jittered(file))?.size ?: 0L
        return Ausgang(delegate.appendingSink(jittered(file), mustExist), bindung(file), ab)
    }

    // Wahlfreier Zugriff läse Geheimtext als Inhalt; OkHttp braucht ihn nicht.
    override fun openReadOnly(file: Path): FileHandle = throw IOException("kein wahlfreier Zugriff: $file")

    override fun openReadWrite(file: Path, mustCreate: Boolean, mustExist: Boolean): FileHandle =
        throw IOException("kein wahlfreier Zugriff: $file")

    /** `.tmp`, `.bkp` (OkHttp) und `.part` (laufender Download) sind dieselbe Datei, nur noch nicht umbenannt. */
    private fun bindung(file: Path): String {
        var name = file.name
        while (true) {
            val extension = INTERMEDIATE_STATES.firstOrNull { name.endsWith(it) } ?: break
            name = name.dropLast(extension.length)
        }
        return "$zweck/$name"
    }

    private inner class Ausgang(private val ziel: Sink, private val bindung: String, private var situation: Long) : Sink {
        private val puffer = Buffer()

        // Fortgeschrieben endet die Datei schon mit einem Marker; eine neue braucht einen, auch leer.
        private var offen = situation == 0L

        override fun write(source: Buffer, byteCount: Long) {
            puffer.write(source, byteCount)
            while (puffer.size >= SECTION) schreibe(puffer.readByteArray(SECTION), "$bindung@$situation")
        }

        private fun schreibe(klar: ByteArray, aad: String) {
            val geheim = verschluessle(klar, aad)
            val satz = Buffer().writeInt(geheim.size).write(geheim)
            situation += satz.size
            ziel.write(satz, satz.size)
            offen = true
        }

        private fun closeAb() {
            if (puffer.size > 0) schreibe(puffer.readByteArray(), "$bindung@$situation")
            if (offen) {
                schreibe(ByteArray(0), "$bindung@$situation$END")
                offen = false
            }
        }

        override fun flush() {
            closeAb()
            ziel.flush()
        }

        override fun timeout(): Timeout = ziel.timeout()

        override fun close() {
            try {
                closeAb()
            } finally {
                ziel.close()
            }
        }
    }

    private inner class Inbox(private val quelle: BufferedSource, private val bindung: String) : Source {
        private val klar = Buffer()
        private var situation = 0L
        private var abgeschlossen = false

        override fun read(sink: Buffer, byteCount: Long): Long {
            while (klar.size == 0L) if (!next()) return -1L
            return klar.read(sink, byteCount)
        }

        private fun next(): Boolean {
            if (quelle.exhausted()) {
                if (!abgeschlossen) throw IOException("abgeschnitten: $bindung")
                return false
            }
            val laenge = quelle.readInt()
            if (laenge <= 0 || laenge > SECTION + 64) throw IOException("unlesbarer Abschnitt in $bindung")
            val satz = quelle.readByteArray(laenge.toLong())
            val inhalt = cipher.entschluessle(satz, "$bindung@$situation")
            if (inhalt != null) {
                klar.write(inhalt)
                abgeschlossen = false
            } else if (cipher.entschluessle(satz, "$bindung@$situation$END")?.isEmpty() == true) {
                abgeschlossen = true
            } else {
                throw IOException("Abschnitt gehört nicht zu $bindung")
            }
            situation += 4L + laenge
            return true
        }

        override fun timeout(): Timeout = quelle.timeout()

        override fun close() = quelle.close()
    }

    /** OkHttp fängt nur IOException; ein gesperrter Keystore soll den Abruf nicht abbrechen. */
    private fun verschluessle(klar: ByteArray, bindung: String): ByteArray =
        fangeAusserAbbruch { cipher.verschluessle(klar, bindung) }
            .getOrElse { throw it as? IOException ?: IOException("nicht verschlüsselt: $bindung", it) }

    companion object {
        /** Vorsilbe gestreuter Namen; was im gestreuten Ordner ohne sie liegt, stammt von früher. */
        const val JITTERED = "h-"
        private const val NAME_LENGTH = 16
        private const val SECTION = 64L * 1024
        private const val END = "#ende"
        private val INTERMEDIATE_STATES = listOf(".tmp", ".bkp", ".part")
    }
}

/**
 * Die Bild-Zwischenspeicher früherer Fassungen lagen im Klartext: Coils eigener fällt
 * weg, der von OkHttp (derselbe Ordner wie in NetzModule) nur, wenn sein Journal noch
 * lesbar ist. Beim Start, damit nach dem Update keine Kopie der Sammlung offen liegt.
 */
fun cleanPlaintextImageCachesOn(cacheDir: File) {
    File(cacheDir, "image_cache").deleteRecursively()
    val http = File(cacheDir, "image_http_cache")
    val klartext = listOf("journal", "journal.bkp").any { name ->
        runCatching { File(http, name).bufferedReader().use { it.readLine() } == "libcore.io.DiskLruCache" }.getOrDefault(false)
    }
    if (klartext) http.deleteRecursively()
    // Einträge unter lesbaren Namen (MD5 der Adresse) älterer Fassungen: Der Cache darf sie verlieren.
    http.listFiles()?.filter { !it.name.startsWith(EncryptedFileSystem.JITTERED) }?.forEach { it.deleteRecursively() }
}
