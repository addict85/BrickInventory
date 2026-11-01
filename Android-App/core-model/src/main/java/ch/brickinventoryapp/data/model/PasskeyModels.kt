package ch.brickinventoryapp.data.model

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonObject

/**
 * Passkey-Anmeldung (routes/auth.ts, /auth/passkey/…). Optionen und Antwort
 * bleiben JSON: Der Credential Manager nimmt und liefert genau das WebAuthn-JSON,
 * das der Server schickt und prüft — die App liest darin nichts.
 */

const val PASSKEY_ANMELDEN = "anmelden"
const val PASSKEY_ZWEITER_FAKTOR = "zweiter_faktor"

@Serializable
data class PasskeyOptionenAnfrage(val zweck: String)

@Serializable
data class PasskeyOptionen(
    val success: Boolean = false,
    val optionen: JsonObject? = null,
    val error: String? = null,
)

/** Ohne Passwort; `mit_token`, weil der Server dem Browser keinen Token ausstellt. */
@Serializable
data class PasskeyAnmeldung(
    val antwort: JsonObject,
    val label: String = "Android App",
    @SerialName("never_expires") val neverExpires: Boolean = false,
    val scope: String = TOKEN_SCOPE_APP,
    @SerialName("mit_token") val mitToken: Boolean = true,
)

/** Wie [LoginRequest], nur mit dem Passkey an Stelle des Codes. */
@Serializable
data class PasskeyLoginRequest(
    val username: String,
    val password: String,
    val passkey: JsonObject,
    val label: String = "Android App",
    @SerialName("never_expires") val neverExpires: Boolean = false,
    val scope: String = TOKEN_SCOPE_APP,
)

/** Aus der 401-Antwort auf den zweiten Faktor: Geht statt des Codes ein Passkey? */
@Serializable
data class ZweiterFaktorWege(val passkey: Boolean = false)
