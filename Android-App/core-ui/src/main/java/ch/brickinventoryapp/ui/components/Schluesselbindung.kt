package ch.brickinventoryapp.ui.components

import ch.brickinventoryapp.model.schritt.Schluesselnonce
import ch.brickinventoryapp.model.schritt.Schrittantwort
import ch.brickinventoryapp.model.schritt.Schrittbindung
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.util.Base64

/** Der Keystore-Teil der Bindung; Robolectric kann keine Attestation, Tests setzen ihn ein. */
interface AttestierbarerSchluessel {
    /** Ein neuer Schlüssel mit [challenge] als Attestation-Challenge; seine Kette als DER, Blatt zuerst. */
    fun erzeugeMitAttestation(challenge: ByteArray): List<ByteArray>
}

/**
 * Nach der Anmeldung: Nonce holen, den Schlüssel mit ihr erzeugen und die Kette
 * hinterlegen. Die Nonce macht die Kette einmalig; ohne sie liesse sich die Kette
 * eines anderen Geräts wieder einreichen.
 */
class Schluesselbindung(
    private val bindung: Schrittbindung,
    private val schluessel: AttestierbarerSchluessel,
    private val keystore: CoroutineDispatcher = Dispatchers.Default,
) {
    sealed interface Ausgang {
        data object Gebunden : Ausgang
        /** Das Gerät kann keinen Schlüssel mit Attestation erzeugen. */
        data object OhneAttestation : Ausgang
        data class Abgelehnt(val meldung: String?) : Ausgang
    }

    suspend fun binde(): Ausgang {
        val nonce = when (val n = bindung.schluesselNonce()) {
            is Schluesselnonce.Nonce -> n.wert
            is Schluesselnonce.Abgelehnt -> return Ausgang.Abgelehnt(n.meldung)
        }
        val challenge = runCatching { Base64.getUrlDecoder().decode(nonce) }.getOrNull()
            ?: return Ausgang.Abgelehnt(null)
        val kette = withContext(keystore) { runCatching { schluessel.erzeugeMitAttestation(challenge) }.getOrNull() }
        // Ohne Attestation liefert der Keystore nur das selbstsignierte Zertifikat des Schlüssels.
        if (kette == null || kette.size < 2) return Ausgang.OhneAttestation
        return when (val r = bindung.hinterlegeKette(kette)) {
            Schrittantwort.Frei -> Ausgang.Gebunden
            is Schrittantwort.Abgelehnt -> Ausgang.Abgelehnt(r.meldung)
            is Schrittantwort.Challenge, Schrittantwort.NichtGebunden -> Ausgang.Abgelehnt(null)
        }
    }
}
