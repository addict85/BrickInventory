package ch.brickinventoryapp.ui.components

import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyPermanentlyInvalidatedException
import android.security.keystore.KeyProperties
import java.security.KeyPairGenerator
import java.security.KeyStore
import java.security.PrivateKey
import java.security.PublicKey
import java.security.Signature
import java.security.spec.ECGenParameterSpec

/**
 * Der Keystore-Schlüssel hinter dem Schrittschutz: EC P-256, signiert nur je
 * Benutzung nach starker Biometrie oder Gerätesperre (Dauer 0). Ein neu
 * eingerichteter Fingerabdruck macht ihn ungültig; dann entsteht ein neuer —
 * das Einrichten verlangte schon die Gerätesperre.
 */
internal object GeraeteSchluessel {
    private const val KEYSTORE = "AndroidKeyStore"
    private const val ALIAS = "schrittschutz"

    private fun speicher() = KeyStore.getInstance(KEYSTORE).apply { load(null) }

    /** Eine zum Signieren vorbereitete Signatur; signieren kann sie erst nach der Freigabe. */
    fun signatur(): Signature {
        val ks = speicher()
        val schluessel = ks.getKey(ALIAS, null) as? PrivateKey ?: erzeuge()
        return try {
            Signature.getInstance(Schrittfreigabe.SIGNATURVERFAHREN).apply { initSign(schluessel) }
        } catch (_: KeyPermanentlyInvalidatedException) {
            ks.deleteEntry(ALIAS)
            Signature.getInstance(Schrittfreigabe.SIGNATURVERFAHREN).apply { initSign(erzeuge()) }
        }
    }

    fun oeffentlich(): PublicKey = speicher().getCertificate(ALIAS).publicKey

    /** X.509 für den Server. Über [signatur], damit ein ungültig gewordener Schlüssel vorher ersetzt ist. */
    fun oeffentlichFuerServer(): ByteArray {
        signatur()
        return oeffentlich().encoded
    }

    private fun erzeuge(): PrivateKey {
        val gen = KeyPairGenerator.getInstance(KeyProperties.KEY_ALGORITHM_EC, KEYSTORE)
        gen.initialize(
            KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_SIGN)
                .setAlgorithmParameterSpec(ECGenParameterSpec("secp256r1"))
                .setDigests(KeyProperties.DIGEST_SHA256)
                .setUserAuthenticationRequired(true)
                .setUserAuthenticationParameters(0, KeyProperties.AUTH_BIOMETRIC_STRONG or KeyProperties.AUTH_DEVICE_CREDENTIAL)
                .build()
        )
        return gen.generateKeyPair().private
    }
}
