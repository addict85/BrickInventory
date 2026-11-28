package ch.brickinventoryapp.security

import ch.brickinventoryapp.model.util.catchUnlessCancelled
import ch.brickinventoryapp.network.util.AppLog
import java.io.File
import java.io.IOException
import java.security.SecureRandom
import java.util.concurrent.CopyOnWriteArrayList
import javax.crypto.Cipher
import javax.crypto.Mac
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec

/**
 * The key of the local stores (inventory, response cache, widget): 32 random bytes,
 * wrapped on disk only by the Keystore ([vault], its own alias). One Keystore call
 * per process instead of one per file; encryption itself happens in software with a key
 * that is only readable in the app's memory. One derived key per purpose ([forTarget]).
 */
class StoreKey(private val file: File, private val vault: TokenEncryption) {
    @Volatile private var known: ByteArray? = null

    /** Just newly created: whatever was encrypted with an earlier key is no longer readable. */
    @Volatile var newCreated: Boolean = false
        private set

    // Callers get a copy: forgetInMemory() overwrites the cached bytes, and an encryption
    // running at that moment must not end up under an all-zero key. Whoever takes it
    // zeroes it after use, or the master key lingers on the heap until GC.
    @Synchronized
    fun fetch(): ByteArray = (known ?: load()).copyOf()

    private fun load(): ByteArray {
        if (file.isFile) {
            val wrapped = file.readText().trim()
            when (val finding = vault.open(wrapped)) {
                is VaultFinding.Readable -> hexToBytes(finding.plaintext)?.takeIf { it.size == LENGTH }?.let {
                    if (vault.stale(wrapped)) wrapNew(finding.plaintext)
                    known = it
                    return it
                }
                // Don't create anew: that would tear down the encrypted database along with the outbox.
                VaultFinding.LockedState -> throw IOException("Keystore gerade nicht bereit")
                VaultFinding.Gone -> Unit
            }
        }
        val newValue = ByteArray(LENGTH).also(SecureRandom()::nextBytes)
        // Same as when reading: a Keystore that doesn't encrypt while locked means „later“.
        val wrapped = catchUnlessCancelled { vault.encrypt(newValue.joinToString("") { "%02x".format(it) }) }
            .getOrElse { throw IOException("Keystore gerade nicht bereit", it) }
        write(wrapped)
        newCreated = true
        known = newValue
        return newValue
    }

    private fun write(wrapped: String) {
        file.parentFile?.mkdirs()
        val tmp = File(file.parentFile, file.name + ".tmp")
        tmp.writeText(wrapped)
        if (!tmp.renameTo(file)) throw IOException("Ablageschlüssel nicht geschrieben")
    }

    /**
     * A key under the weaker vault of earlier versions is moved, on the first
     * readable access, under the one that only works unlocked. The same key, just wrapped
     * differently: the stores stay readable. If that fails (locked), on the next access.
     * The old alias only goes once the new wrapping is on disk.
     */
    private fun wrapNew(hex: String) {
        catchUnlessCancelled { write(vault.encrypt(hex)) }
            .onSuccess { catchUnlessCancelled { vault.forgetLegacyStock() } }
            .onFailure { AppLog.warning("Ablage", "Ablageschlüssel nicht umgeschlüsselt", it) }
    }

    /**
     * Device locked: drop the key from memory. The next access reads it from disk again,
     * which the Keystore only allows unlocked (onlyUnlocked); until then it throws IOException
     * like any locked access. An open database keeps its own copy until it is closed.
     */
    @Synchronized
    fun forgetInMemory() {
        known?.fill(0)
        known = null
    }

    /** Counts the renewals; whoever holds a derived key notices this way that it has gone stale. */
    @Volatile var state: Long = 0
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
        file.delete()
        runCatching { vault.forgetNow() }
        known?.fill(0)
        known = null
        state++
        // Locked, the new one is only created on the next access: a sign-out in the background
        // should not fail just because the device isn't letting anything be encrypted right now.
        catchUnlessCancelled { fetch().fill(0) }
    }

    /** Derived with HMAC-SHA256: database and files don't share a key. */
    fun forTarget(purpose: String): ByteArray = derive(fetch(), purpose)

    private companion object {
        const val LENGTH = 32
        fun hexToBytes(hex: String): ByteArray? =
            if (hex.length % 2 != 0 || hex.any { it !in "0123456789abcdef" }) null
            else ByteArray(hex.length / 2) { hex.substring(it * 2, it * 2 + 2).toInt(16).toByte() }
    }
}

/** HMAC of [purpose] under [key]; [key] is a copy from [StoreKey.fetch] and is zeroed here. */
internal fun derive(key: ByteArray, purpose: String): ByteArray = try {
    // SecretKeySpec keeps its own clone, so zeroing ours does not break the MAC.
    Mac.getInstance("HmacSHA256").run {
        init(SecretKeySpec(key, "HmacSHA256"))
        doFinal(purpose.toByteArray(Charsets.UTF_8))
    }
} finally {
    key.fill(0)
}

/**
 * AES-256-GCM for the app's files. Format: marker ‖ IV ‖ ciphertext including tag. The
 * binding (purpose and file name) goes in as AAD: a file under a foreign name
 * fails the check instead of being read as the other one. Without a
 * marker a file counts as legacy plaintext; the caller discards it.
 */
class StoreCipher(
    /** Hands out a fresh array per call: it is zeroed once the cipher holds its own copy. */
    private val key: () -> ByteArray,
) {

    fun encrypt(plaintext: ByteArray, binding: String): ByteArray {
        val iv = ByteArray(IV_LENGTH).also(SecureRandom()::nextBytes)
        val c = Cipher.getInstance(PROCEDURE)
        c.init(Cipher.ENCRYPT_MODE, spec(), GCMParameterSpec(TAG_BITS, iv))
        c.updateAAD(binding.toByteArray(Charsets.UTF_8))
        return ID + iv + c.doFinal(plaintext)
    }

    /** null if the data doesn't originate from here, has been altered, bound differently, or is under a different key. */
    fun decrypt(data: ByteArray, binding: String): ByteArray? = open(data, ID, binding)

    /**
     * Only for a one-time takeover: the version without binding (marker 1). Whoever
     * reads it this way immediately stores the data newly bound, so no legacy data remains.
     */
    fun decryptUnbound(data: ByteArray): ByteArray? = open(data, ID_UNBOUND, null)

    // The key outside of runCatching: a locked Keystore (IOException) is not an
    // unreadable ciphertext; read as null, callers would delete the file.
    private fun open(data: ByteArray, identifier: ByteArray, binding: String?): ByteArray? {
        if (data.size <= identifier.size + IV_LENGTH || !data.copyOfRange(0, identifier.size).contentEquals(identifier)) return null
        val k = spec()
        return runCatching {
            val c = Cipher.getInstance(PROCEDURE)
            c.init(Cipher.DECRYPT_MODE, k,
                GCMParameterSpec(TAG_BITS, data, identifier.size, IV_LENGTH))
            if (binding != null) c.updateAAD(binding.toByteArray(Charsets.UTF_8))
            c.doFinal(data, identifier.size + IV_LENGTH, data.size - identifier.size - IV_LENGTH)
        }.getOrNull()
    }

    /** SecretKeySpec clones the bytes; the raw copy goes right away. */
    private fun spec(): SecretKeySpec {
        val raw = key()
        try {
            return SecretKeySpec(raw, "AES")
        } finally {
            raw.fill(0)
        }
    }

    private companion object {
        const val PROCEDURE = "AES/GCM/NoPadding"
        const val IV_LENGTH = 12
        const val TAG_BITS = 128
        val ID = byteArrayOf('B'.code.toByte(), 'I'.code.toByte(), 'A'.code.toByte(), 2)
        val ID_UNBOUND = byteArrayOf('B'.code.toByte(), 'I'.code.toByte(), 'A'.code.toByte(), 1)
    }
}
