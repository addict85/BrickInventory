package ch.brickinventoryapp.model.data.model

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

/**
 * Der Schrittschutz, am Server gebunden (routes/api_v1/geraet.ts): Die App
 * hinterlegt nach der Anmeldung den öffentlichen Teil ihres Keystore-Schlüssels;
 * vor einem heiklen Schritt signiert sie eine Challenge des Servers.
 */
@Serializable
data class GeraeteSchluesselAnfrage(val oeffentlich: String)

@Serializable
data class GeraeteSchluesselAntwort(val success: Boolean)

@Serializable
data class SchrittChallengeAnfrage(val aktion: String)

@Serializable
data class SchrittChallenge(
    val success: Boolean,
    val challenge: String,
    val nachricht: String,
    @SerialName("gueltig_bis") val gueltigBis: String,
)

@Serializable
data class SchrittFreigabeAnfrage(val challenge: String, val signatur: String)

@Serializable
data class SchrittFreigabe(
    val success: Boolean,
    val aktion: String,
    @SerialName("gueltig_bis") val gueltigBis: String,
)
