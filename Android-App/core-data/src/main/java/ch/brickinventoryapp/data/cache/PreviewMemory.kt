package ch.brickinventoryapp.data.cache

import android.content.Context
import ch.brickinventoryapp.security.StoreCipher
import ch.brickinventoryapp.security.StoreKey
import dagger.hilt.android.qualifiers.ApplicationContext
import java.io.File
import javax.crypto.Mac
import javax.crypto.spec.SecretKeySpec
import javax.inject.Inject
import javax.inject.Singleton

/** What the settings need from the preview store: show the usage, empty it. */
interface PreviewStore {
    fun occupied(): Long
    fun clearAll()
}

/**
 * Persistent store of the thumbnails — so that the tables stand without network.
 * Under filesDir instead of cacheDir: Android may empty the cache, and as an LRU paging through
 * the catalog displaced one's own collection.
 */
@Singleton
class PreviewMemory(
    /** The store folder; a function so that `context` is only asked on first access. */
    private val root: () -> File,
    private val cipher: StoreCipher,
    /** Key of the file names; without it one could compute the name from a known address. */
    private val names: () -> ByteArray,
) : PreviewStore {
    @Inject constructor(@ApplicationContext context: Context, store: StoreKey) :
        this({ File(context.filesDir, "vorschau") }, StoreCipher { store.forTarget("vorschau") }, { store.forTarget("namen") })

    companion object {
        /**
         * Upper limit of the store: nobody but us cleans up `filesDir`. 150 MB hold
         * over ten thousand images at about 15 kB per thumbnail.
         */
        const val MAX_BYTES = 150L * 1024 * 1024

        /**
         * When cleaning up, go down to four fifths instead of working just at the limit
         * every time.
         */
        private const val TARGET_SHARE = 0.8

        /**
         * This is how far warming may fill the store: 80 %. Not the same as
         * [TARGET_SHARE] (how deep cleaning up goes): the last fifth stays for what
         * someone really views, otherwise every real call would trigger a cleanup.
         */
        const val LIMIT_WARM_UP = MAX_BYTES / 5 * 4

        /**
         * Timestamp for speculatively fetched images, shortly after the epoch: cleanup removes
         * the oldest first, and a warmed image should go before one that was really
         * viewed. If it is viewed later, the tap in
         * NetworkModule rewrites it with `speculative = false` and gives it a real stamp.
         */
        private const val SPECULATIVE_TIME = 1000L

        /** Only thumbnails. The full resolution does not belong here — see [isPreview]. */
        private const val PREVIEW_FEATURE = "thumb"

        /** Subfolder of the store with hashed names; everything else next to it comes from older versions. */
        private const val ENCRYPTED = "v3"
    }

    private val folder: File by lazy {
        val basis = root()
        // A cache: plaintext (files) and v2 (names as SHA-256 of the address) are discarded.
        runCatching { basis.listFiles()?.filter { it.name != ENCRYPTED }?.forEach { it.deleteRecursively() } }
        File(basis, ENCRYPTED).also { it.mkdirs() }
    }

    /** Purpose and file name as AAD: a file under a foreign name does not count as this image. */
    private fun binding(file: File) = "vorschau/${file.name}"

    /**
     * Does this address belong to a thumbnail? Two forms from util/ImageUrls.kt:
     *
     * - the proxy with `&thumb=1`
     * - a locally stored file that the server named `_thumb`
     *
     * The full resolution stays out: it is viewed individually in the detail, not
     * in tables.
     */
    fun isPreview(address: String): Boolean =
        address.contains("${PREVIEW_FEATURE}=1") || address.contains("_$PREVIEW_FEATURE.")

    /**
     * The file name for an address: HMAC-SHA256 with [names], not the bare hash —
     * otherwise a name would reveal whether a known set image lies here.
     */
    private fun key(address: String): String =
        Mac.getInstance("HmacSHA256").apply { init(SecretKeySpec(names(), "HmacSHA256")) }
            .doFinal(address.toByteArray()).joinToString("") { "%02x".format(it) }

    private fun file(address: String) = File(folder, key(address))

    /**
     * Does this address already lie here? For warming, without reading the bytes —
     * the only question is whether it needs the network.
     */
    fun has(address: String): Boolean = file(address).let { it.isFile && it.length() > 0 }

    /**
     * The stored bytes — or null if they do not exist. An unreadable file
     * (different key, changed) is deleted, otherwise it would count as present when warming.
     */
    fun read(address: String): ByteArray? {
        val f = file(address)
        if (!f.isFile || f.length() == 0L) return null
        val raw = runCatching { f.readBytes() }.getOrNull() ?: return null
        return cipher.decrypt(raw, binding(f)) ?: run { f.delete(); null }
    }

    /**
     * Store bytes: first into a side file, then rename — otherwise after an
     * abort a half file would lie there that looks like an image.
     */
    fun write(address: String, bytes: ByteArray, speculative: Boolean = false) {
        if (bytes.isEmpty()) return
        runCatching {
            val target = file(address)
            val temp = File(folder, "${target.name}.tmp")
            temp.writeBytes(cipher.encrypt(bytes, binding(target)))
            if (!temp.renameTo(target)) temp.delete()
            // Prewarmed entries age at once; the reason is at SPECULATIVE_TIME.
            else if (speculative) target.setLastModified(SPECULATIVE_TIME)
        }
        cleanupIfNeeded()
    }

    /** How much lies here? For the display in the settings. */
    override fun occupied(): Long =
        runCatching { folder.listFiles()?.sumOf { it.length() } ?: 0L }.getOrDefault(0L)

    /** Throw everything away — for the button in the settings. */
    override fun clearAll() {
        runCatching { folder.listFiles()?.forEach { it.delete() } }
    }

    /**
     * Above the limit? Then throw away the oldest — by the last modification, because
     * many file systems no longer keep the access time. What is needed regularly
     * gets rewritten anyway.
     */
    private fun cleanupIfNeeded() {
        runCatching {
            val files = folder.listFiles()?.toList() ?: return
            var sum = files.sumOf { it.length() }
            if (sum <= MAX_BYTES) return
            val target = (MAX_BYTES * TARGET_SHARE).toLong()
            for (f in files.sortedBy { it.lastModified() }) {
                if (sum <= target) break
                val large = f.length()
                if (f.delete()) sum -= large
            }
        }
    }
}
