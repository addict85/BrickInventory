package ch.brickinventoryapp.security

import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import java.security.KeyStore
import java.util.Base64
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * Encryption for the bearer token. The token opens an account on the server and expires
 * at the latest after TOKEN_MAX_DURATION_DAYS (core-data), earlier when unused.
 */

/** Where the keys live: on the device the AndroidKeyStore, in the test a bundle in memory. */
internal interface Keychain {
    fun fetch(alias: String): SecretKey?
    fun generate(alias: String, onlyUnlocked: Boolean): SecretKey
    fun delete(alias: String)
}

internal object AndroidKeychain : Keychain {
    private const val KEYSTORE = "AndroidKeyStore"

    private fun keystore() = KeyStore.getInstance(KEYSTORE).apply { load(null) }

    override fun fetch(alias: String): SecretKey? = (keystore().getEntry(alias, null) as? KeyStore.SecretKeyEntry)?.secretKey

    override fun generate(alias: String, onlyUnlocked: Boolean): SecretKey {
        val gen = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, KEYSTORE)
        // StrongBox (a dedicated security chip) where available: the key stays
        // protected even with a compromised TEE in the chip. Without a chip generateKey throws,
        // and then the Keystore behaves as before. The chip is slow; decryption
        // only happens for new ciphertext.
        try {
            gen.init(vaultSpec(alias, onlyUnlocked).setIsStrongBoxBacked(true).build())
            return gen.generateKey()
        } catch (_: java.security.ProviderException) {
            // StrongBoxUnavailableException is one of those; carry on without the chip.
        }
        gen.init(vaultSpec(alias, onlyUnlocked).build())
        return gen.generateKey()
    }

    override fun delete(alias: String) = keystore().deleteEntry(alias)
}

/**
 * The real implementation via the Android Keystore.
 *
 * Storage format: `a1:` Base64( IV ‖ ciphertext ), with AAD; older ciphertexts without `a1:`
 * and without AAD stay readable and count as [stale]. The Keystore chooses the IV
 * (setRandomizedEncryptionRequired stays on).
 */
// [alias]: the local stores wrap their key under one of their own (StoreKey).
internal class KeystoreTokenVault(
    private val alias: String = ALIAS,
    /** setUnlockedDeviceRequired: token and stores (UnlockVault), not trust (pins). */
    private val onlyUnlocked: Boolean = false,
    /** Legacy data: read-only. A missing key means „gone“; a new one could never open something old. */
    private val readOnly: Boolean = false,
    private val bund: Keychain = AndroidKeychain,
) : TokenEncryption {

    private fun key(): SecretKey? =
        bund.fetch(alias) ?: if (readOnly) null else bund.generate(alias, onlyUnlocked)

    override fun encrypt(plaintext: String): String {
        check(!readOnly) { "Altbestand verschlüsselt nicht" }
        val c = Cipher.getInstance(TRANSFORMATION)
        c.init(Cipher.ENCRYPT_MODE, key())
        c.updateAAD(AAD)
        val secret = c.doFinal(plaintext.toByteArray(Charsets.UTF_8))
        return PREFIX_AAD + Base64.getEncoder().encodeToString(c.iv + secret)
    }

    /** For callers who only know „readable or not“; a locked Keystore also reads as null here. */
    override fun decrypt(saved: String): String? = (open(saved) as? VaultFinding.Readable)?.plaintext

    // If the key is missing, the ciphertext is gone (null). KeyStoreException, ProviderException
    // and similar during startup, on the other hand, count as temporary (vaultErrorPermanent).
    override fun open(saved: String): VaultFinding = openWithRetry {
        val withAad = saved.startsWith(PREFIX_AAD)
        val raw = Base64.getDecoder().decode(saved.removePrefix(PREFIX_AAD))
        val k = key()
        if (raw.size <= IV_LENGTH || k == null) null else {
            val c = Cipher.getInstance(TRANSFORMATION)
            c.init(Cipher.DECRYPT_MODE, k, GCMParameterSpec(GCM_TAG_BITS, raw, 0, IV_LENGTH))
            if (withAad) c.updateAAD(AAD)
            String(c.doFinal(raw, IV_LENGTH, raw.size - IV_LENGTH), Charsets.UTF_8)
        }
    }

    override fun stale(saved: String): Boolean = !saved.startsWith(PREFIX_AAD)

    override fun forgetNow() = bund.delete(alias)

    companion object {
        private const val ALIAS = "brickinventory_auth_token"
        /** Its own alias: an existing key does not take on the condition retroactively. */
        const val ALIAS_UNLOCKED = "brickinventory_auth_token_entsperrt"
        private const val TRANSFORMATION = "AES/GCM/NoPadding"
        private const val IV_LENGTH = 12      // GCM-Standard
        private const val GCM_TAG_BITS = 128
        /** Base64 doesn't know a colon. Whoever strips `a1:` fails on the AAD, instead of reading it as legacy data. */
        private const val PREFIX_AAD = "a1:"
        private val AAD = "token".toByteArray(Charsets.UTF_8)
    }
}

/**
 * No user authentication: outbox, price alert and sign-out order run without a
 * user. [onlyUnlocked] locks the key as long as the device is locked; whatever
 * is then waiting in the background is described in readToken and redemptionStep.
 */
internal fun vaultSpec(alias: String, onlyUnlocked: Boolean): KeyGenParameterSpec.Builder =
    KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
        .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
        .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
        .setKeySize(256)
        .setUnlockedDeviceRequired(onlyUnlocked)
