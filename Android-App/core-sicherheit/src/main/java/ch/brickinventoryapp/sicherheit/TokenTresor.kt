package ch.brickinventoryapp.sicherheit

import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * Verschlüsselung für das Bearer-Token. Das Token öffnet ein Konto auf dem Server und läuft
 * erst nach TOKEN_IDLE_DAYS Untätigkeit ab.
 */

/**
 * Die echte Umsetzung über den Android-Keystore.
 *
 * Ablageformat: Base64( IV ‖ Geheimtext ). Der IV steht vorne, weil GCM ihn
 * zum Entschlüsseln braucht und er nicht geheim sein muss — geheim sein muss
 * nur, dass er sich nicht wiederholt, und dafür sorgt der Keystore selbst
 * (setRandomizedEncryptionRequired ist Vorgabe und bleibt an).
 */
// [alias]: Die lokalen Ablagen umhüllen ihren Schlüssel unter einem eigenen (Ablageschluessel).
internal class KeystoreTokenTresor(
    private val alias: String = ALIAS,
    /** setUnlockedDeviceRequired: Token und Ablagen (EntsperrTresor), nicht das Vertrauen (Pins). */
    private val nurEntsperrt: Boolean = false,
) : TokenVerschluesselung {

    private fun schluessel(): SecretKey {
        val ks = KeyStore.getInstance(KEYSTORE).apply { load(null) }
        (ks.getEntry(alias, null) as? KeyStore.SecretKeyEntry)?.let { return it.secretKey }

        val gen = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, KEYSTORE)
        // StrongBox (eigener Sicherheitschip) wo vorhanden: Der Schlüssel bleibt
        // auch bei einer kompromittierten TEE im Chip. Ohne Chip wirft generateKey,
        // dann gilt der Keystore wie bisher. Ein bestehender Schlüssel bleibt, wo er
        // ist. Der Chip ist langsam; entschlüsselt wird nur bei neuem Geheimtext.
        try {
            gen.init(spezifikation().setIsStrongBoxBacked(true).build())
            return gen.generateKey()
        } catch (_: java.security.ProviderException) {
            // StrongBoxUnavailableException ist eine davon; weiter ohne Chip.
        }
        gen.init(spezifikation().build())
        return gen.generateKey()
    }

    private fun spezifikation() = tresorSpezifikation(alias, nurEntsperrt)

    override fun verschluessle(klartext: String): String {
        val c = Cipher.getInstance(TRANSFORMATION)
        c.init(Cipher.ENCRYPT_MODE, schluessel())
        val geheim = c.doFinal(klartext.toByteArray(Charsets.UTF_8))
        val zusammen = c.iv + geheim
        return Base64.encodeToString(zusammen, Base64.NO_WRAP)
    }

    /** Für Aufrufer, die nur „lesbar oder nicht“ kennen; ein gesperrter Keystore ist hier auch null. */
    override fun entschluessle(gespeichert: String): String? = (oeffne(gespeichert) as? Tresorbefund.Lesbar)?.klartext

    // Ein fehlender Schlüssel wird in schluessel() neu erzeugt; der Geheimtext passt
    // dann nicht (AEADBadTag) und gilt als weg. KeyStoreException, ProviderException
    // u. Ä. beim Hochfahren dagegen als vorübergehend (tresorFehlerDauerhaft).
    override fun oeffne(gespeichert: String): Tresorbefund = oeffneMitNeuversuch {
        val roh = Base64.decode(gespeichert, Base64.NO_WRAP)
        if (roh.size <= IV_LAENGE) null else {
            val c = Cipher.getInstance(TRANSFORMATION)
            c.init(
                Cipher.DECRYPT_MODE,
                schluessel(),
                GCMParameterSpec(GCM_TAG_BITS, roh, 0, IV_LAENGE),
            )
            String(c.doFinal(roh, IV_LAENGE, roh.size - IV_LAENGE), Charsets.UTF_8)
        }
    }

    override fun vergiss() {
        KeyStore.getInstance(KEYSTORE).apply { load(null) }.deleteEntry(alias)
    }

    companion object {
        private const val KEYSTORE = "AndroidKeyStore"
        private const val ALIAS = "brickinventory_auth_token"
        /** Eigener Alias: Ein bestehender Schlüssel nimmt die Bedingung nachträglich nicht an. */
        const val ALIAS_ENTSPERRT = "brickinventory_auth_token_entsperrt"
        private const val TRANSFORMATION = "AES/GCM/NoPadding"
        private const val IV_LAENGE = 12      // GCM-Standard
        private const val GCM_TAG_BITS = 128
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
