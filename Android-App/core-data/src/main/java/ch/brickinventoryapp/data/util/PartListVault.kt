package ch.brickinventoryapp.data.util

import ch.brickinventoryapp.security.StoreCipher
import ch.brickinventoryapp.security.StoreKey
import java.io.File
import java.io.IOException
import javax.inject.Inject

/** The encrypted parts list in filesDir/pdf; older versions stored `partList.pdf` in plaintext. */
internal const val PART_LIST_FILE = "teileliste.bin"

/**
 * The parts list carries the whole inventory. On disk it therefore lies only
 * AES-GCM encrypted; plaintext exists only in memory while an app reads it via
 * the PartListsProvider. The binding to the purpose lets no other store
 * under this name count as the parts list.
 */
class PartListVault(private val cipher: StoreCipher) {
    @Inject constructor(store: StoreKey) : this(StoreCipher { store.forTarget(PURPOSE) })

    /** Stores [pdf] encrypted; only the renaming makes the new list visible. */
    fun put(intern: File, extern: File?, pdf: ByteArray): File {
        val target = partListsStore(intern, extern)
        val tmp = File(target.parentFile, target.name + ".tmp")
        tmp.writeBytes(cipher.encrypt(pdf, PURPOSE))
        if (!tmp.renameTo(target)) {
            tmp.delete()
            throw IOException("Teileliste nicht abgelegt")
        }
        return target
    }

    /** The plaintext or null if there is no (readable) parts list. */
    fun read(intern: File): ByteArray? {
        val file = File(File(intern, "pdf"), PART_LIST_FILE)
        if (!file.isFile) return null
        // A locked keystore throws (StoreCipher): the provider then reports „no file“ instead of crashing.
        return runCatching { cipher.decrypt(file.readBytes(), PURPOSE) }.getOrNull()
    }

    private companion object {
        const val PURPOSE = "teileliste"
    }
}

/**
 * Copies at most [length] bytes from [content] starting at [offset] into [target] and returns
 * the count, 0 at the end. That is how the provider's proxy descriptor reads: the
 * target app may seek, the list lies only in memory meanwhile.
 */
internal fun readFromStorage(content: ByteArray, offset: Long, length: Int, target: ByteArray): Int {
    if (offset < 0 || length < 0) throw IOException("Ungültiger Lesebereich")
    if (offset >= content.size) return 0
    val n = minOf(length.toLong(), content.size - offset, target.size.toLong()).toInt()
    System.arraycopy(content, offset.toInt(), target, 0, n)
    return n
}
