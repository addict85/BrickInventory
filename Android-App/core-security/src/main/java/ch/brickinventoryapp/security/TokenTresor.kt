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
 * Verschlüsselung für das Bearer-Token. Das Token öffnet ein Konto auf dem Server und läuft
 * erst nach TOKEN_IDLE_DAYS Untätigkeit ab.
 */

/** Wo die Schlüssel liegen: im Gerät der AndroidKeyStore, im Test ein Bund im Speicher. */
internal interface Keychain {
    fun fetch(alias: String): SecretKey?
    fun erzeuge(alias: String, onlyUnlocked: Boolean): SecretKey
    fun delete(alias: String)
}

internal object AndroidKeychain : Keychain {
    private const val KEYSTORE = "AndroidKeyStore"

    private fun keystore() = KeyStore.getInstance(KEYSTORE).apply { load(null) }

    override fun fetch(alias: String): SecretKey? = (keystore().getEntry(alias, null) as? KeyStore.SecretKeyEntry)?.secretKey

    override fun erzeuge(alias: String, onlyUnlocked: Boolean): SecretKey {
        val gen = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, KEYSTORE)
        // StrongBox (eigener Sicherheitschip) wo vorhanden: Der Schlüssel bleibt
        // auch bei einer kompromittierten TEE im Chip. Ohne Chip wirft generateKey,
        // dann gilt der Keystore wie bisher. Der Chip ist langsam; entschlüsselt
        // wird nur bei neuem Geheimtext.
        try {
            gen.init(vaultSpec(alias, onlyUnlocked).setIsStrongBoxBacked(true).build())
            return gen.generateKey()
        } catch (_: java.security.ProviderException) {
            // StrongBoxUnavailableException ist eine davon; weiter ohne Chip.
        }
        gen.init(vaultSpec(alias, onlyUnlocked).build())
        return gen.generateKey()
    }

    override fun delete(alias: String) = keystore().deleteEntry(alias)
}

/**
 * Die echte Umsetzung über den Android-Keystore.
 *
 * Ablageformat: `a1:` Base64( IV ‖ Geheimtext ), mit AAD; ältere Geheimtexte ohne `a1:`
 * und ohne AAD bleiben lesbar und gelten als [veraltet]. Den IV wählt der Keystore
 * (setRandomizedEncryptionRequired bleibt an).
 */
// [alias]: Die lokalen Ablagen umhüllen ihren Schlüssel unter einem eigenen (Ablageschluessel).
internal class KeystoreTokenVault(
    private val alias: String = ALIAS,
    /** setUnlockedDeviceRequired: Token und Ablagen (EntsperrVault), nicht das Vertrauen (Pins). */
    private val onlyUnlocked: Boolean = false,
    /** Altbestand: nur lesen. Ein fehlender Schlüssel heisst „weg“; ein neuer könnte nichts Altes öffnen. */
    private val readOnly: Boolean = false,
    private val bund: Keychain = AndroidKeychain,
) : TokenEncryption {

    private fun schluessel(): SecretKey? =
        bund.fetch(alias) ?: if (readOnly) null else bund.erzeuge(alias, onlyUnlocked)

    override fun verschluessle(klartext: String): String {
        check(!readOnly) { "Altbestand verschlüsselt nicht" }
        val c = Cipher.getInstance(TRANSFORMATION)
        c.init(Cipher.ENCRYPT_MODE, schluessel())
        c.updateAAD(AAD)
        val geheim = c.doFinal(klartext.toByteArray(Charsets.UTF_8))
        return PREFIX_AAD + Base64.getEncoder().encodeToString(c.iv + geheim)
    }

    /** Für Aufrufer, die nur „lesbar oder nicht“ kennen; ein gesperrter Keystore ist hier auch null. */
    override fun entschluessle(gespeichert: String): String? = (oeffne(gespeichert) as? Tresorbefund.Readable)?.klartext

    // Fehlt der Schlüssel, ist der Geheimtext weg (null). KeyStoreException, ProviderException
    // u. Ä. beim Hochfahren dagegen gelten als vorübergehend (vaultErrorPermanent).
    override fun oeffne(gespeichert: String): Tresorbefund = openWithRetry {
        val withAad = gespeichert.startsWith(PREFIX_AAD)
        val roh = Base64.getDecoder().decode(gespeichert.removePrefix(PREFIX_AAD))
        val k = schluessel()
        if (roh.size <= IV_LENGTH || k == null) null else {
            val c = Cipher.getInstance(TRANSFORMATION)
            c.init(Cipher.DECRYPT_MODE, k, GCMParameterSpec(GCM_TAG_BITS, roh, 0, IV_LENGTH))
            if (withAad) c.updateAAD(AAD)
            String(c.doFinal(roh, IV_LENGTH, roh.size - IV_LENGTH), Charsets.UTF_8)
        }
    }

    override fun veraltet(gespeichert: String): Boolean = !gespeichert.startsWith(PREFIX_AAD)

    override fun vergiss() = bund.delete(alias)

    companion object {
        private const val ALIAS = "brickinventory_auth_token"
        /** Eigener Alias: Ein bestehender Schlüssel nimmt die Bedingung nachträglich nicht an. */
        const val ALIAS_UNLOCKED = "brickinventory_auth_token_entsperrt"
        private const val TRANSFORMATION = "AES/GCM/NoPadding"
        private const val IV_LENGTH = 12      // GCM-Standard
        private const val GCM_TAG_BITS = 128
        /** Base64 kennt keinen Doppelpunkt. Wer `a1:` abschneidet, scheitert an der AAD, statt alt zu lesen. */
        private const val PREFIX_AAD = "a1:"
        private val AAD = "token".toByteArray(Charsets.UTF_8)
    }
}

/**
 * Keine Nutzerauthentifizierung: Ausgang, Preisalarm und Abmeldeauftrag laufen ohne
 * Nutzer. [onlyUnlocked] sperrt den Schlüssel, solange das Gerät gesperrt ist; was
 * dann im Hintergrund wartet, steht in readToken und redemptionStep.
 */
internal fun vaultSpec(alias: String, onlyUnlocked: Boolean): KeyGenParameterSpec.Builder =
    KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
        .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
        .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
        .setKeySize(256)
        .setUnlockedDeviceRequired(onlyUnlocked)
