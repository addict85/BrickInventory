package ch.brickinventoryapp.ui.components

import ch.brickinventoryapp.model.step.Schluesselnonce
import ch.brickinventoryapp.model.step.Schrittantwort
import ch.brickinventoryapp.model.step.Schrittbindung
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.util.Base64

/** Der Keystore-Teil der Bindung; Robolectric kann keine Attestation, Tests setzen ihn ein. */
interface AttestierbarerKey {
    /** Ein neuer Schlüssel mit [challenge] als Attestation-Challenge; seine Kette als DER, Blatt zuerst. */
    fun createWithAttestation(challenge: ByteArray): List<ByteArray>
}

/**
 * Nach der Anmeldung: Nonce holen, den Schlüssel mit ihr erzeugen und die Kette
 * hinterlegen. Die Nonce macht die Kette einmalig; ohne sie liesse sich die Kette
 * eines anderen Geräts wieder einreichen.
 */
class Schluesselbindung(
    private val bindung: Schrittbindung,
    private val schluessel: AttestierbarerKey,
    private val keystore: CoroutineDispatcher = Dispatchers.Default,
) {
    sealed interface Ausgang {
        data object Gebunden : Ausgang
        /** Das Gerät kann keinen Schlüssel mit Attestation erzeugen. */
        data object WithoutAttestation : Ausgang
        data class Rejected(val meldung: String?) : Ausgang
    }

    suspend fun bind(): Ausgang {
        val nonce = when (val n = bindung.schluesselNonce()) {
            is Schluesselnonce.Nonce -> n.wert
            is Schluesselnonce.Rejected -> return Ausgang.Rejected(n.meldung)
        }
        val challenge = runCatching { Base64.getUrlDecoder().decode(nonce) }.getOrNull()
            ?: return Ausgang.Rejected(null)
        val kette = withContext(keystore) { runCatching { schluessel.createWithAttestation(challenge) }.getOrNull() }
        // Ohne Attestation liefert der Keystore nur das selbstsignierte Zertifikat des Schlüssels.
        if (kette == null || kette.size < 2) return Ausgang.WithoutAttestation
        return when (val r = bindung.depositChain(kette)) {
            Schrittantwort.Free -> Ausgang.Gebunden
            is Schrittantwort.Rejected -> Ausgang.Rejected(r.meldung)
            is Schrittantwort.Challenge, Schrittantwort.NotBound -> Ausgang.Rejected(null)
        }
    }
}
