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

/** The key behind the step guard; the server knows its public part. */
internal object DevicesKey : KeystoreKey("schrittschutz")

/** The key behind the app lock; its own, so discarding it doesn't affect the server's. */
internal object AppLockKey : KeystoreKey("app_sperre")

/**
 * A Keystore key EC P-256 that only signs per use after strong biometrics or
 * the screen lock (validity 0). A newly enrolled fingerprint invalidates it;
 * then a new one is created — setting it up already required the screen lock.
 */
internal open class KeystoreKey(private val alias: String) : Entsperrschluessel, AttestierbarerKey {
    private fun speicher() = KeyStore.getInstance(KEYSTORE).apply { load(null) }

    /** A signature prepared for signing; it can only sign after the release. */
    override fun signatur(): Signature {
        val ks = speicher()
        val schluessel = ks.getKey(alias, null) as? PrivateKey ?: erzeuge()
        return try {
            Signature.getInstance(Schrittfreigabe.SIGNATURVERFAHREN).apply { initSign(schluessel) }
        } catch (_: KeyPermanentlyInvalidatedException) {
            ks.deleteEntry(alias)
            Signature.getInstance(Schrittfreigabe.SIGNATURVERFAHREN).apply { initSign(erzeuge()) }
        }
    }

    override fun oeffentlich(): PublicKey = speicher().getCertificate(alias).publicKey

    override fun discard() = speicher().deleteEntry(alias)

    /** Always a new key: the challenge lives in its certificate, the old one carries a spent one. */
    override fun createWithAttestation(challenge: ByteArray): List<ByteArray> {
        val ks = speicher()
        ks.deleteEntry(alias)
        erzeuge(challenge)
        return ks.getCertificateChain(alias)?.map { it.encoded }.orEmpty()
    }

    private fun erzeuge(challenge: ByteArray? = null): PrivateKey = strongBoxFirst { strongBox ->
        val gen = KeyPairGenerator.getInstance(KeyProperties.KEY_ALGORITHM_EC, KEYSTORE)
        gen.initialize(
            KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_SIGN)
                .setAlgorithmParameterSpec(ECGenParameterSpec("secp256r1"))
                .setDigests(KeyProperties.DIGEST_SHA256)
                .setUserAuthenticationRequired(true)
                .setUserAuthenticationParameters(0, KeyProperties.AUTH_BIOMETRIC_STRONG or KeyProperties.AUTH_DEVICE_CREDENTIAL)
                .setIsStrongBoxBacked(strongBox)
                .apply { if (challenge != null) setAttestationChallenge(challenge) }
                .build()
        )
        gen.generateKeyPair().private
    }

    private companion object {
        const val KEYSTORE = "AndroidKeyStore"
    }
}
