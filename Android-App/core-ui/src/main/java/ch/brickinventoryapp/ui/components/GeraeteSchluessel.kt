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

/** Der Schlüssel hinter dem Schrittschutz; der Server kennt seinen öffentlichen Teil. */
internal object GeraeteSchluessel : KeystoreSchluessel("schrittschutz")

/** Der Schlüssel hinter der App-Sperre; ein eigener, damit Verwerfen den des Servers nicht trifft. */
internal object AppSperreSchluessel : KeystoreSchluessel("app_sperre")

/**
 * Ein Keystore-Schlüssel EC P-256, der nur je Benutzung nach starker Biometrie oder
 * Gerätesperre signiert (Dauer 0). Ein neu eingerichteter Fingerabdruck macht ihn
 * ungültig; dann entsteht ein neuer — das Einrichten verlangte schon die Gerätesperre.
 */
internal open class KeystoreSchluessel(private val alias: String) : Entsperrschluessel, AttestierbarerSchluessel {
    private fun speicher() = KeyStore.getInstance(KEYSTORE).apply { load(null) }

    /** Eine zum Signieren vorbereitete Signatur; signieren kann sie erst nach der Freigabe. */
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

    override fun verwerfe() = speicher().deleteEntry(alias)

    /** Immer ein neuer Schlüssel: Die Challenge steht in seinem Zertifikat, der alte trägt eine verbrauchte. */
    override fun erzeugeMitAttestation(challenge: ByteArray): List<ByteArray> {
        val ks = speicher()
        ks.deleteEntry(alias)
        erzeuge(challenge)
        return ks.getCertificateChain(alias)?.map { it.encoded }.orEmpty()
    }

    private fun erzeuge(challenge: ByteArray? = null): PrivateKey = strongBoxZuerst { strongBox ->
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
