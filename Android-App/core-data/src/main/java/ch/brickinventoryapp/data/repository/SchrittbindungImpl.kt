package ch.brickinventoryapp.data.repository

import ch.brickinventoryapp.data.api.GeraetApi
import ch.brickinventoryapp.model.data.model.GeraeteSchluesselAnfrage
import ch.brickinventoryapp.model.schritt.Schrittaktion
import ch.brickinventoryapp.model.schritt.Schrittantwort
import ch.brickinventoryapp.model.schritt.Schrittbindung
import ch.brickinventoryapp.model.data.model.SchrittChallengeAnfrage
import ch.brickinventoryapp.model.data.model.SchrittFreigabeAnfrage
import java.util.Base64
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Der Schrittschutz am Server. Nur ein 404 heisst „kennt ihn nicht“: Jede andere
 * Absage, auch ein Netzfehler, hält den Schritt an, sonst öffnete ein
 * abgeschnittener Server den Weg ohne Bindung.
 */
@Singleton
internal class SchrittbindungImpl @Inject constructor(
    private val api: GeraetApi,
) : Schrittbindung {

    override suspend fun challenge(aktion: Schrittaktion): Schrittantwort {
        val kennung = aktion.kennung ?: return Schrittantwort.NichtGebunden
        return when (val r = sicherAufrufen { api.schrittChallenge(SchrittChallengeAnfrage(kennung)) }) {
            is Ergebnis.Success -> Schrittantwort.Challenge(r.data.challenge, r.data.nachricht)
            is Ergebnis.Error -> if (r is Ergebnis.Error.Server && r.status == 404) Schrittantwort.NichtGebunden
                else Schrittantwort.Abgelehnt(r.message.ifBlank { null })
        }
    }

    override suspend fun freigeben(challenge: String, signatur: ByteArray): Schrittantwort {
        val anfrage = SchrittFreigabeAnfrage(challenge, Base64.getEncoder().encodeToString(signatur))
        return when (val r = sicherAufrufen { api.schrittFreigabe(anfrage) }) {
            is Ergebnis.Success -> Schrittantwort.Frei
            is Ergebnis.Error -> Schrittantwort.Abgelehnt(r.message.ifBlank { null })
        }
    }

    override suspend fun hinterlege(oeffentlich: ByteArray): Boolean =
        sicherAufrufen { api.hinterlegeSchluessel(GeraeteSchluesselAnfrage(Base64.getEncoder().encodeToString(oeffentlich))) } is Ergebnis.Success
}
