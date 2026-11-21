package ch.brickinventoryapp.security

import ch.brickinventoryapp.model.util.fangeAusserAbbruch
import ch.brickinventoryapp.network.util.Protokoll
import java.util.concurrent.CopyOnWriteArrayList
import java.io.File
import java.io.IOException
import java.security.SecureRandom
import javax.crypto.Cipher
import javax.crypto.Mac
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec

/**
 * The key of the local stores (inventory, response cache, widget): 32 random bytes,
 * wrapped on disk only by the Keystore ([tresor], its own alias). One Keystore call
 * per process instead of one per file; encryption itself happens in software with a key
 * that is only readable in the app's memory. One derived key per purpose ([fuer]).
 */
class Ablageschluessel(private val datei: File, private val tresor: TokenEncryption) {
    @Volatile private var bekannt: ByteArray? = null

    /** Just newly created: whatever was encrypted with an earlier key is no longer readable. */
    @Volatile var newCreated: Boolean = false
        private set

    @Synchronized
    fun fetch(): ByteArray {
        bekannt?.let { return it }
        if (datei.isFile) {
            val umhuellt = datei.readText().trim()
            when (val finding = tresor.oeffne(umhuellt)) {
                is Tresorbefund.Readable -> hexToBytes(finding.klartext)?.takeIf { it.size == LENGTH }?.let {
                    if (tresor.veraltet(umhuellt)) wrapNew(finding.klartext)
                    bekannt = it
                    return it
                }
                // Don't create anew: that would tear down the encrypted database along with the outbox.
                Tresorbefund.Gesperrt -> throw IOException("Keystore gerade nicht bereit")
                Tresorbefund.Weg -> Unit
            }
        }
        val neu = ByteArray(LENGTH).also(SecureRandom()::nextBytes)
        // Same as when reading: a Keystore that doesn't encrypt while locked means „later“.
        val umhuellt = fangeAusserAbbruch { tresor.verschluessle(neu.joinToString("") { "%02x".format(it) }) }
            .getOrElse { throw IOException("Keystore gerade nicht bereit", it) }
        schreibe(umhuellt)
        newCreated = true
        bekannt = neu
        return neu
    }

    private fun schreibe(umhuellt: String) {
        datei.parentFile?.mkdirs()
        val tmp = File(datei.parentFile, datei.name + ".tmp")
        tmp.writeText(umhuellt)
        if (!tmp.renameTo(datei)) throw IOException("Ablageschlüssel nicht geschrieben")
    }

    /**
     * A key under the weaker vault of earlier versions is moved, on the first
     * readable access, under the one that only works unlocked. The same key, just wrapped
     * differently: the stores stay readable. If that fails (locked), on the next access.
     * The old alias only goes once the new wrapping is on disk.
     */
    private fun wrapNew(hex: String) {
        fangeAusserAbbruch { schreibe(tresor.verschluessle(hex)) }
            .onSuccess { fangeAusserAbbruch { tresor.forgetLegacyStock() } }
            .onFailure { Protokoll.warnung("Ablage", "Ablageschlüssel nicht umgeschlüsselt", it) }
    }

    /** Counts the renewals; whoever holds a derived key notices this way that it has gone stale. */
    @Volatile var stand: Long = 0
        private set

    private val beforeRenewal = CopyOnWriteArrayList<() -> Unit>()

    /** For stores that hold the key longer than one access (the database): close it and drop it. */
    fun beforeRenewal(listener: () -> Unit) { beforeRenewal += listener }

    /**
     * Crypto-shredding on sign-out: a new key makes everything unreadable that was
     * encrypted with the old one, including deleted remnants on flash. Under the lock, so that
     * nobody reopens with the old key in between.
     */
    @Synchronized
    fun renew() {
        beforeRenewal.forEach { it() }
        datei.delete()
        runCatching { tresor.vergiss() }
        bekannt = null
        stand++
        // Locked, the new one is only created on the next access: a sign-out in the background
        // should not fail just because the device isn't letting anything be encrypted right now.
        fangeAusserAbbruch { fetch() }
    }

    /** Derived with HMAC-SHA256: database and files don't share a key. */
    fun fuer(zweck: String): ByteArray = Mac.getInstance("HmacSHA256").run {
        init(SecretKeySpec(fetch(), "HmacSHA256"))
        doFinal(zweck.toByteArray(Charsets.UTF_8))
    }

    private companion object {
        const val LENGTH = 32
        fun hexToBytes(hex: String): ByteArray? =
            if (hex.length % 2 != 0 || hex.any { it !in "0123456789abcdef" }) null
            else ByteArray(hex.length / 2) { hex.substring(it * 2, it * 2 + 2).toInt(16).toByte() }
    }
}

/**
 * AES-256-GCM for the app's files. Format: marker ‖ IV ‖ ciphertext including tag. The
 * binding (purpose and file name) goes in as AAD: a file under a foreign name
 * fails the check instead of being read as the other one. Without a
 * marker a file counts as legacy plaintext; the caller discards it.
 */
class StoreCipher(private val schluessel: () -> ByteArray) {

    fun verschluessle(klartext: ByteArray, bindung: String): ByteArray {
        val iv = ByteArray(IV_LENGTH).also(SecureRandom()::nextBytes)
        val c = Cipher.getInstance(PROCEDURE)
        c.init(Cipher.ENCRYPT_MODE, SecretKeySpec(schluessel(), "AES"), GCMParameterSpec(TAG_BITS, iv))
        c.updateAAD(bindung.toByteArray(Charsets.UTF_8))
        return ID + iv + c.doFinal(klartext)
    }

    /** null if the data doesn't originate from here, has been altered, bound differently, or is under a different key. */
    fun entschluessle(daten: ByteArray, bindung: String): ByteArray? = oeffne(daten, ID, bindung)

    /**
     * Only for a one-time takeover: the version without binding (marker 1). Whoever
     * reads it this way immediately stores the data newly bound, so no legacy data remains.
     */
    fun entschluessleUnbound(daten: ByteArray): ByteArray? = oeffne(daten, ID_UNBOUND, null)

    // The key outside of runCatching: a locked Keystore (IOException) is not an
    // unreadable ciphertext; read as null, callers would delete the file.
    private fun oeffne(daten: ByteArray, kennung: ByteArray, bindung: String?): ByteArray? {
        if (daten.size <= kennung.size + IV_LENGTH || !daten.copyOfRange(0, kennung.size).contentEquals(kennung)) return null
        val k = SecretKeySpec(schluessel(), "AES")
        return runCatching {
            val c = Cipher.getInstance(PROCEDURE)
            c.init(Cipher.DECRYPT_MODE, k,
                GCMParameterSpec(TAG_BITS, daten, kennung.size, IV_LENGTH))
            if (bindung != null) c.updateAAD(bindung.toByteArray(Charsets.UTF_8))
            c.doFinal(daten, kennung.size + IV_LENGTH, daten.size - kennung.size - IV_LENGTH)
        }.getOrNull()
    }

    private companion object {
        const val PROCEDURE = "AES/GCM/NoPadding"
        const val IV_LENGTH = 12
        const val TAG_BITS = 128
        val ID = byteArrayOf('B'.code.toByte(), 'I'.code.toByte(), 'A'.code.toByte(), 2)
        val ID_UNBOUND = byteArrayOf('B'.code.toByte(), 'I'.code.toByte(), 'A'.code.toByte(), 1)
    }
}
