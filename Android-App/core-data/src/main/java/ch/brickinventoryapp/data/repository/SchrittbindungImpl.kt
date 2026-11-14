package ch.brickinventoryapp.data.repository

import ch.brickinventoryapp.data.api.GeraetApi
import ch.brickinventoryapp.vertrag.GeraeteKettenAnfrage
import ch.brickinventoryapp.model.schritt.Schluesselnonce
import ch.brickinventoryapp.model.schritt.Schrittaktion
import ch.brickinventoryapp.model.schritt.Schrittantwort
import ch.brickinventoryapp.model.schritt.Schrittbindung
import ch.brickinventoryapp.vertrag.SchrittChallengeAnfrage
import ch.brickinventoryapp.vertrag.SchrittFreigabeAnfrage
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
    private val api: GeraetApi,
) : Schrittbindung {

    override suspend fun challenge(aktion: Schrittaktion): Schrittantwort {
        val kennung = aktion.kennung ?: return Schrittantwort.NichtGebunden
        return when (val r = sicherAufrufen { api.schrittChallenge(SchrittChallengeAnfrage(kennung)) }) {
            is Ergebnis.Success -> Schrittantwort.Challenge(r.data.challenge, r.data.nachricht)
            is Ergebnis.Error -> Schrittantwort.Abgelehnt(r.message.ifBlank { null })
        }
    }

    override suspend fun freigeben(challenge: String, signatur: ByteArray): Schrittantwort {
        val anfrage = SchrittFreigabeAnfrage(challenge, Base64.getEncoder().encodeToString(signatur))
        return when (val r = sicherAufrufen { api.schrittFreigabe(anfrage) }) {
            is Ergebnis.Success -> Schrittantwort.Frei
            is Ergebnis.Error -> Schrittantwort.Abgelehnt(r.message.ifBlank { null })
        }
    }

    override suspend fun schluesselNonce(): Schluesselnonce = when (val r = sicherAufrufen { api.schluesselNonce() }) {
        is Ergebnis.Success -> Schluesselnonce.Nonce(r.data.nonce)
        is Ergebnis.Error -> Schluesselnonce.Abgelehnt(r.message.ifBlank { null })
    }

    /** Den Satz des Servers nur bei seiner Absage: Ein Netzfehler nach der Anmeldung ist keine Meldung wert. */
    override suspend fun hinterlegeKette(kette: List<ByteArray>): Schrittantwort {
        val anfrage = GeraeteKettenAnfrage(kette.map { Base64.getEncoder().encodeToString(it) })
        return when (val r = sicherAufrufen { api.hinterlegeKette(anfrage) }) {
            is Ergebnis.Success -> Schrittantwort.Frei
            is Ergebnis.Error -> Schrittantwort.Abgelehnt(if (r is Ergebnis.Error.Server) r.message.ifBlank { null } else null)
        }
    }
}
