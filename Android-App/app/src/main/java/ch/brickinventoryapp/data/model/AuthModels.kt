package ch.brickinventoryapp.data.model

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

/**
 * Anmeldung, Konto und Sitzung.
 *
 * ── Warum diese Datei existiert (Nachtrag 155) ──────────────────────────────
 *
 * Alle 92 Datenklassen der App standen in EINER Datei, Models.kt, mit 1158
 * Zeilen. Jede Aenderung an irgendeinem Modell beruehrte dieselbe Datei — bei
 * parallelen Aenderungen ein sicherer Konflikt, und beim Suchen war der Weg
 * immer derselbe: eine Datei oeffnen und scrollen.
 *
 * Aufgeteilt wurde entlang der Sachgebiete. Die Klassen selbst sind WORTGLEICH
 * uebernommen: Es wurde nichts umbenannt, nichts zusammengefasst und kein Feld
 * angefasst. Sie liegen weiter im Paket ch.brickinventoryapp.data.model, also
 * aendert sich fuer keinen Aufrufer etwas — Kotlin bindet an das Paket, nicht
 * an die Datei.
 */

@Serializable
data class LoginRequest(val username: String, val password: String, val label: String = "Android App")

@Serializable
data class QrLoginRequest(val token: String)

@Serializable
data class LoginResponse(
    val success: Boolean,
    val token: String? = null,
    val user: User? = null,
    val error: String? = null
)

@Serializable
data class User(
    val id: Int,
    val username: String,
    @SerialName("is_admin") val isAdmin: Boolean = false
)

@Serializable
data class UserSettings(
    val currency: String = "EUR",
    @SerialName("price_condition") val priceCondition: String = "N",
    @SerialName("price_cache_ttl") val priceCacheTtl: String = "24",
    @SerialName("default_price_condition") val defaultPriceCondition: String = "N",
    @SerialName("user_default_condition") val userDefaultCondition: String? = null,
    @SerialName("effective_condition") val effectiveCondition: String = "N", // resolved: user→global→'N'
    @SerialName("app_theme") val appTheme: String = "classic" // global vom Admin gewähltes Design
)

@Serializable
data class SettingsResponse(
    val success: Boolean,
    val settings: UserSettings = UserSettings(),
    val error: String? = null
)

@Serializable
data class MeResponse(
    val success: Boolean,
    val user: User? = null
)
