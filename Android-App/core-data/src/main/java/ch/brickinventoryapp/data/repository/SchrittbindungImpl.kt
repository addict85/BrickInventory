package ch.brickinventoryapp.data.repository

import ch.brickinventoryapp.data.api.DeviceApi
import ch.brickinventoryapp.contract.GeraeteSchluesselAnfrage
import ch.brickinventoryapp.model.step.Schluesselnonce
import ch.brickinventoryapp.model.step.Schrittaktion
import ch.brickinventoryapp.model.step.Schrittantwort
import ch.brickinventoryapp.model.step.Schrittbindung
import ch.brickinventoryapp.contract.SchrittChallengeAnfrage
import ch.brickinventoryapp.contract.SchrittFreigabeAnfrage
import java.util.Base64
import javax.inject.Inject
import javax.inject.Singleton

/**
 * The step guard at the server. Every refusal, also a 404 or a network error, stops
 * the step: the server has known it for a long time, and a fallback to the check
 * on the device or to a key without attestation would be a path a third party
 * would only need to trigger.
 */
@Singleton
internal class SchrittbindungImpl @Inject constructor(
    private val api: DeviceApi,
) : Schrittbindung {

    override suspend fun challenge(aktion: Schrittaktion): Schrittantwort {
        val kennung = aktion.kennung ?: return Schrittantwort.NotBound
        return when (val r = sicherAufrufen { api.stepChallenge(SchrittChallengeAnfrage(kennung)) }) {
            is Ergebnis.Erfolg -> Schrittantwort.Challenge(r.data.challenge, r.data.nachricht)
            is Ergebnis.Fehler -> Schrittantwort.Rejected(r.message.ifBlank { null })
        }
    }

    override suspend fun freigeben(challenge: String, signatur: ByteArray): Schrittantwort {
        val anfrage = SchrittFreigabeAnfrage(challenge, Base64.getEncoder().encodeToString(signatur))
        return when (val r = sicherAufrufen { api.stepRelease(anfrage) }) {
            is Ergebnis.Erfolg -> Schrittantwort.Free
            is Ergebnis.Fehler -> Schrittantwort.Rejected(r.message.ifBlank { null })
        }
    }

    override suspend fun schluesselNonce(): Schluesselnonce = when (val r = sicherAufrufen { api.schluesselNonce() }) {
        is Ergebnis.Erfolg -> Schluesselnonce.Nonce(r.data.nonce)
        is Ergebnis.Fehler -> Schluesselnonce.Rejected(r.message.ifBlank { null })
    }

    /** The server's sentence only on its refusal: a network error after the sign-in is not worth a message. */
    override suspend fun depositChain(kette: List<ByteArray>): Schrittantwort {
        val anfrage = GeraeteSchluesselAnfrage(kette = kette.map { Base64.getEncoder().encodeToString(it) })
        return when (val r = sicherAufrufen { api.depositChain(anfrage) }) {
            is Ergebnis.Erfolg -> Schrittantwort.Free
            is Ergebnis.Fehler -> Schrittantwort.Rejected(if (r is Ergebnis.Fehler.Server) r.message.ifBlank { null } else null)
        }
    }
}
