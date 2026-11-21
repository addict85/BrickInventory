package ch.brickinventoryapp.data.util

import java.io.File
import java.io.IOException
import javax.inject.Inject
import ch.brickinventoryapp.security.StoreCipher
import ch.brickinventoryapp.security.Ablageschluessel

/** The encrypted parts list in filesDir/pdf; older versions stored `teileliste.pdf` in plaintext. */
internal const val PART_LIST_FILE = "teileliste.bin"

/**
 * The parts list carries the whole inventory. On disk it therefore lies only
 * AES-GCM encrypted; plaintext exists only in memory while an app reads it via
 * the TeilelistenProvider. The binding to the purpose lets no other store
 * under this name count as the parts list.
 */
class Teilelistentresor(private val cipher: StoreCipher) {
    @Inject constructor(ablage: Ablageschluessel) : this(StoreCipher { ablage.fuer(PURPOSE) })

    /** Stores [pdf] encrypted; only the renaming makes the new list visible. */
    fun put(intern: File, extern: File?, pdf: ByteArray): File {
        val ziel = partListsStore(intern, extern)
        val tmp = File(ziel.parentFile, ziel.name + ".tmp")
        tmp.writeBytes(cipher.verschluessle(pdf, PURPOSE))
        if (!tmp.renameTo(ziel)) {
            tmp.delete()
            throw IOException("Teileliste nicht abgelegt")
        }
        return ziel
    }

    /** The plaintext or null if there is no (readable) parts list. */
    fun lies(intern: File): ByteArray? {
        val datei = File(File(intern, "pdf"), PART_LIST_FILE)
        if (!datei.isFile) return null
        // A locked keystore throws (StoreCipher): the provider then reports „no file“ instead of crashing.
        return runCatching { cipher.entschluessle(datei.readBytes(), PURPOSE) }.getOrNull()
    }

    private companion object {
        const val PURPOSE = "teileliste"
    }
}

/**
 * Copies at most [laenge] bytes from [inhalt] starting at [versatz] into [ziel] and returns
 * the count, 0 at the end. That is how the provider's proxy descriptor reads: the
 * target app may seek, the list lies only in memory meanwhile.
 */
internal fun readFromStorage(inhalt: ByteArray, versatz: Long, laenge: Int, ziel: ByteArray): Int {
    if (versatz < 0 || laenge < 0) throw IOException("Ungültiger Lesebereich")
    if (versatz >= inhalt.size) return 0
    val n = minOf(laenge.toLong(), inhalt.size - versatz, ziel.size.toLong()).toInt()
    System.arraycopy(inhalt, versatz.toInt(), ziel, 0, n)
    return n
}
