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
import ch.brickinventoryapp.model.util.catchUnlessCancelled

/**
 * A file system that encrypts every file with [StoreCipher]: for the
 * HTTP cache of the images and the building instructions, which otherwise showed the collection in
 * plaintext. In sections, because OkHttp keeps appending to its journal; each one is bound to
 * purpose, file name and location. An end marker after every flush and close makes a
 * file truncated at the end unreadable, instead of letting it count as shorter.
 */
class EncryptedFileSystem(
    delegate: FileSystem,
    private val cipher: StoreCipher,
    private val purpose: String,
    private val jitter: Jitter? = null,
) : ForwardingFileSystem(delegate) {

    /**
     * File names directly under [folder] are stored on disk only as an HMAC with [key]:
     * OkHttp names entries after the MD5 of the address, and known addresses could
     * be recomputed that way. Listed names carry [JITTERED] and are not hashed again.
     */
    class Jitter(val folder: Path, val key: () -> ByteArray)

    override fun onPathParameter(path: Path, functionName: String, parameterName: String): Path = jittered(path)

    private fun jittered(path: Path): Path {
        val s = jitter ?: return path
        if (path.parent != s.folder || path.name.startsWith(JITTERED)) return path
        val mac = Mac.getInstance("HmacSHA256").apply { init(SecretKeySpec(s.key(), "HmacSHA256")) }
        val name = mac.doFinal(path.name.toByteArray(Charsets.UTF_8)).take(NAME_LENGTH).joinToString("") { "%02x".format(it) }
        return s.folder / (JITTERED + name)
    }

    override fun source(file: Path): Source = Inbox(delegate.source(jittered(file)).buffer(), binding(file))

    override fun sink(file: Path, mustCreate: Boolean): Sink =
        Outbox(delegate.sink(jittered(file), mustCreate), binding(file), 0L)

    override fun appendingSink(file: Path, mustExist: Boolean): Sink {
        val ab = delegate.metadataOrNull(jittered(file))?.size ?: 0L
        return Outbox(delegate.appendingSink(jittered(file), mustExist), binding(file), ab)
    }

    // Random access would read ciphertext as content; OkHttp doesn't need it.
    override fun openReadOnly(file: Path): FileHandle = throw IOException("kein wahlfreier Zugriff: $file")

    override fun openReadWrite(file: Path, mustCreate: Boolean, mustExist: Boolean): FileHandle =
        throw IOException("kein wahlfreier Zugriff: $file")

    /** `.tmp`, `.bkp` (OkHttp) and `.part` (an ongoing download) are the same file, just not yet renamed. */
    private fun binding(file: Path): String {
        var name = file.name
        while (true) {
            val extension = INTERMEDIATE_STATES.firstOrNull { name.endsWith(it) } ?: break
            name = name.dropLast(extension.length)
        }
        return "$purpose/$name"
    }

    private inner class Outbox(private val target: Sink, private val binding: String, private var situation: Long) : Sink {
        private val buffer = Buffer()

        // If appended to, the file already ends with a marker; a new one needs one too, even empty.
        private var open = situation == 0L

        override fun write(source: Buffer, byteCount: Long) {
            buffer.write(source, byteCount)
            while (buffer.size >= SECTION) write(buffer.readByteArray(SECTION), "$binding@$situation")
        }

        private fun write(clear: ByteArray, aad: String) {
            val secret = encrypt(clear, aad)
            val sentence = Buffer().writeInt(secret.size).write(secret)
            situation += sentence.size
            target.write(sentence, sentence.size)
            open = true
        }

        private fun finish() {
            if (buffer.size > 0) write(buffer.readByteArray(), "$binding@$situation")
            if (open) {
                write(ByteArray(0), "$binding@$situation$END")
                open = false
            }
        }

        override fun flush() {
            finish()
            target.flush()
        }

        override fun timeout(): Timeout = target.timeout()

        override fun close() {
            try {
                finish()
            } finally {
                target.close()
            }
        }
    }

    private inner class Inbox(private val source: BufferedSource, private val binding: String) : Source {
        private val clear = Buffer()
        private var situation = 0L
        private var completed = false

        override fun read(sink: Buffer, byteCount: Long): Long {
            while (clear.size == 0L) if (!next()) return -1L
            return clear.read(sink, byteCount)
        }

        private fun next(): Boolean {
            if (source.exhausted()) {
                if (!completed) throw IOException("abgeschnitten: $binding")
                return false
            }
            val length = source.readInt()
            if (length <= 0 || length > SECTION + 64) throw IOException("unlesbarer Abschnitt in $binding")
            val sentence = source.readByteArray(length.toLong())
            val content = cipher.decrypt(sentence, "$binding@$situation")
            if (content != null) {
                clear.write(content)
                completed = false
            } else if (cipher.decrypt(sentence, "$binding@$situation$END")?.isEmpty() == true) {
                completed = true
            } else {
                throw IOException("Abschnitt gehört nicht zu $binding")
            }
            situation += 4L + length
            return true
        }

        override fun timeout(): Timeout = source.timeout()

        override fun close() = source.close()
    }

    /** OkHttp only catches IOException; a locked Keystore should not abort the fetch. */
    private fun encrypt(clear: ByteArray, binding: String): ByteArray =
        catchUnlessCancelled { cipher.encrypt(clear, binding) }
            .getOrElse { throw it as? IOException ?: IOException("nicht verschlüsselt: $binding", it) }

    companion object {
        /** Prefix of hashed names; whatever lies in the hashed folder without it is from before. */
        const val JITTERED = "h-"
        private const val NAME_LENGTH = 16
        private const val SECTION = 64L * 1024
        private const val END = "#ende"
        private val INTERMEDIATE_STATES = listOf(".tmp", ".bkp", ".part")
    }
}

/**
 * The image caches of earlier versions lay in plaintext: Coil's own one is simply
 * dropped, the one from OkHttp (the same folder as in NetworkModule) only if its journal is still
 * readable. At startup, so that no copy of the collection is left open after the update.
 */
fun cleanPlaintextImageCachesOn(cacheDir: File) {
    File(cacheDir, "image_cache").deleteRecursively()
    val http = File(cacheDir, "image_http_cache")
    val plaintext = listOf("journal", "journal.bkp").any { name ->
        runCatching { File(http, name).bufferedReader().use { it.readLine() } == "libcore.io.DiskLruCache" }.getOrDefault(false)
    }
    if (plaintext) http.deleteRecursively()
    // Entries under readable names (MD5 of the address) from older versions: the cache may lose them.
    http.listFiles()?.filter { !it.name.startsWith(EncryptedFileSystem.JITTERED) }?.forEach { it.deleteRecursively() }
}
