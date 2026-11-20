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
 * Der Schrittschutz am Server. Jede Absage, auch ein 404 oder ein Netzfehler, hält
 * den Schritt an: Der Server kennt ihn seit Langem, und ein Rückfall auf die Prüfung
 * im Gerät oder einen Schlüssel ohne Attestation wäre ein Weg, den ein Dritter
 * nur auszulösen bräuchte.
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

    /** Den Satz des Servers nur bei seiner Absage: Ein Netzfehler nach der Anmeldung ist keine Meldung wert. */
    override suspend fun depositChain(kette: List<ByteArray>): Schrittantwort {
        val anfrage = GeraeteSchluesselAnfrage(kette = kette.map { Base64.getEncoder().encodeToString(it) })
        return when (val r = sicherAufrufen { api.depositChain(anfrage) }) {
            is Ergebnis.Erfolg -> Schrittantwort.Free
            is Ergebnis.Fehler -> Schrittantwort.Rejected(if (r is Ergebnis.Fehler.Server) r.message.ifBlank { null } else null)
        }
    }
}
