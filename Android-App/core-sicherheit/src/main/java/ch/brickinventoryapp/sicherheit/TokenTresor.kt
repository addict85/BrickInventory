package ch.brickinventoryapp.sicherheit

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
internal interface Schluesselbund {
    fun hole(alias: String): SecretKey?
    fun erzeuge(alias: String, nurEntsperrt: Boolean): SecretKey
    fun loesche(alias: String)
}

internal object AndroidSchluesselbund : Schluesselbund {
    private const val KEYSTORE = "AndroidKeyStore"

    private fun keystore() = KeyStore.getInstance(KEYSTORE).apply { load(null) }

    override fun hole(alias: String): SecretKey? = (keystore().getEntry(alias, null) as? KeyStore.SecretKeyEntry)?.secretKey

    override fun erzeuge(alias: String, nurEntsperrt: Boolean): SecretKey {
        val gen = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, KEYSTORE)
        // StrongBox (eigener Sicherheitschip) wo vorhanden: Der Schlüssel bleibt
        // auch bei einer kompromittierten TEE im Chip. Ohne Chip wirft generateKey,
        // dann gilt der Keystore wie bisher. Der Chip ist langsam; entschlüsselt
        // wird nur bei neuem Geheimtext.
        try {
            gen.init(tresorSpezifikation(alias, nurEntsperrt).setIsStrongBoxBacked(true).build())
            return gen.generateKey()
        } catch (_: java.security.ProviderException) {
            // StrongBoxUnavailableException ist eine davon; weiter ohne Chip.
        }
        gen.init(tresorSpezifikation(alias, nurEntsperrt).build())
        return gen.generateKey()
    }

    override fun loesche(alias: String) = keystore().deleteEntry(alias)
}

/**
 * Die echte Umsetzung über den Android-Keystore.
 *
 * Ablageformat: `a1:` Base64( IV ‖ Geheimtext ), mit AAD; ältere Geheimtexte ohne `a1:`
 * und ohne AAD bleiben lesbar und gelten als [veraltet]. Den IV wählt der Keystore
 * (setRandomizedEncryptionRequired bleibt an).
 */
// [alias]: Die lokalen Ablagen umhüllen ihren Schlüssel unter einem eigenen (Ablageschluessel).
internal class KeystoreTokenTresor(
    private val alias: String = ALIAS,
    /** setUnlockedDeviceRequired: Token und Ablagen (EntsperrTresor), nicht das Vertrauen (Pins). */
    private val nurEntsperrt: Boolean = false,
    /** Altbestand: nur lesen. Ein fehlender Schlüssel heisst „weg“; ein neuer könnte nichts Altes öffnen. */
    private val nurLesen: Boolean = false,
    private val bund: Schluesselbund = AndroidSchluesselbund,
) : TokenVerschluesselung {

    private fun schluessel(): SecretKey? =
        bund.hole(alias) ?: if (nurLesen) null else bund.erzeuge(alias, nurEntsperrt)

    override fun verschluessle(klartext: String): String {
        check(!nurLesen) { "Altbestand verschlüsselt nicht" }
        val c = Cipher.getInstance(TRANSFORMATION)
        c.init(Cipher.ENCRYPT_MODE, schluessel())
        c.updateAAD(AAD)
        val geheim = c.doFinal(klartext.toByteArray(Charsets.UTF_8))
        return PRAEFIX_AAD + Base64.getEncoder().encodeToString(c.iv + geheim)
    }

    /** Für Aufrufer, die nur „lesbar oder nicht“ kennen; ein gesperrter Keystore ist hier auch null. */
    override fun entschluessle(gespeichert: String): String? = (oeffne(gespeichert) as? Tresorbefund.Lesbar)?.klartext

    // Fehlt der Schlüssel, ist der Geheimtext weg (null). KeyStoreException, ProviderException
    // u. Ä. beim Hochfahren dagegen gelten als vorübergehend (tresorFehlerDauerhaft).
    override fun oeffne(gespeichert: String): Tresorbefund = oeffneMitNeuversuch {
        val mitAad = gespeichert.startsWith(PRAEFIX_AAD)
        val roh = Base64.getDecoder().decode(gespeichert.removePrefix(PRAEFIX_AAD))
        val k = schluessel()
        if (roh.size <= IV_LAENGE || k == null) null else {
            val c = Cipher.getInstance(TRANSFORMATION)
            c.init(Cipher.DECRYPT_MODE, k, GCMParameterSpec(GCM_TAG_BITS, roh, 0, IV_LAENGE))
            if (mitAad) c.updateAAD(AAD)
            String(c.doFinal(roh, IV_LAENGE, roh.size - IV_LAENGE), Charsets.UTF_8)
        }
    }

    override fun veraltet(gespeichert: String): Boolean = !gespeichert.startsWith(PRAEFIX_AAD)

    override fun vergiss() = bund.loesche(alias)

    companion object {
        private const val ALIAS = "brickinventory_auth_token"
        /** Eigener Alias: Ein bestehender Schlüssel nimmt die Bedingung nachträglich nicht an. */
        const val ALIAS_ENTSPERRT = "brickinventory_auth_token_entsperrt"
        private const val TRANSFORMATION = "AES/GCM/NoPadding"
        private const val IV_LAENGE = 12      // GCM-Standard
        private const val GCM_TAG_BITS = 128
        /** Base64 kennt keinen Doppelpunkt. Wer `a1:` abschneidet, scheitert an der AAD, statt alt zu lesen. */
        private const val PRAEFIX_AAD = "a1:"
        private val AAD = "token".toByteArray(Charsets.UTF_8)
    }
}

/**
 * Keine Nutzerauthentifizierung: Ausgang, Preisalarm und Abmeldeauftrag laufen ohne
 * Nutzer. [nurEntsperrt] sperrt den Schlüssel, solange das Gerät gesperrt ist; was
 * dann im Hintergrund wartet, steht in liesToken und entwertungsSchritt.
 */
internal fun tresorSpezifikation(alias: String, nurEntsperrt: Boolean): KeyGenParameterSpec.Builder =
    KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
        .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
        .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
        .setKeySize(256)
        .setUnlockedDeviceRequired(nurEntsperrt)
