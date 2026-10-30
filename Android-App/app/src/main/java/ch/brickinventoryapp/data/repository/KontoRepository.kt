package ch.brickinventoryapp.data.repository

import ch.brickinventoryapp.data.api.KontoApi
import ch.brickinventoryapp.data.cache.ResponseCache
import ch.brickinventoryapp.data.model.*
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.RequestBody.Companion.toRequestBody
import kotlinx.serialization.decodeFromString
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Anmeldung und das eigene Konto: Profil, Passwort, zweiter Faktor, Geräte,
 * Design und Einstellungen. Erreichbar über `repo.konto.…`.
 */
@Singleton
class KontoRepository @Inject constructor(
    api: KontoApi,
    cache: ResponseCache,
) : RepoBasis<KontoApi>(api, cache) {

    // Kein Authorization-Header hier: Der OkHttp-Interceptor in di/ServerClient.kt
    // setzt "Bearer <token>" für alle Anfragen an unseren Server (aus dem
    // Speicher-Spiegel des PreferencesManagers). Einzige Ausnahme:
    // getCsvImportStatusDirect, wo der Foreground-Service den Token selbst mitgibt.

    /**
     * Verlangt der Server den zweiten Faktor, antwortet er mit 401 und
     * `zweiter_faktor: true`. Das wird hier zu einer gewöhnlichen Antwort mit
     * success=false umgebogen (wie GutscheineRepository.guthaben), sonst gingen
     * Kennzeichen und Satz in safeCall verloren.
     *
     * Einen Token ohne Ablauf nur über https: Im Klartext kann ihn jeder im WLAN
     * mitlesen, und dann soll er wenigstens verfallen.
     */
    suspend fun login(serverUrl: String, username: String, password: String, code: String? = null): Result<LoginResponse> =
        safeCall {
            val antwort = api.login(LoginRequest(username, password, code = code,
                neverExpires = ch.brickinventoryapp.util.NetworkPolicy.istHttps(serverUrl)))
            if (antwort.code() == 401) {
                val geparst = antwort.errorBody()?.string()?.let {
                    runCatching { nachsichtigesJson.decodeFromString<LoginResponse>(it) }.getOrNull()
                }
                if (geparst?.zweiterFaktor == true) retrofit2.Response.success(geparst) else antwort
            } else antwort
        }

    private val nachsichtigesJson = kotlinx.serialization.json.Json { ignoreUnknownKeys = true }

    suspend fun qrLogin(token: String): Result<LoginResponse> =
        safeCall { api.qrLogin(ch.brickinventoryapp.data.model.QrLoginRequest(token)) }

    suspend fun getMe(): Result<MeResponse> = safeCall { api.getMe() }

    // Konto anlegen und Passwort vergessen — beides ohne bestehende Anmeldung.
    suspend fun getRegistrationStatus(): Result<RegistrationStatusResponse> =
        safeCall { api.getRegistrationStatus() }

    suspend fun register(request: RegisterRequest): Result<RegisterResponse> =
        safeCall { api.register(request) }

    suspend fun forgotPassword(email: String): Result<ForgotPasswordResponse> =
        safeCall { api.forgotPassword(ForgotPasswordRequest(email)) }

    suspend fun getProfil(): Result<ProfilResponse> = safeCall { api.getProfil() }

    suspend fun zweiterFaktorStand(): Result<ZweiterFaktorStand> = safeCall { api.zweiterFaktorStand() }

    suspend fun zweiterFaktorEinrichten(passwort: String): Result<ZweiterFaktorEinrichtung> =
        safeCall { api.zweiterFaktorEinrichten(ZweiterFaktorAnfrage(password = passwort)) }

    suspend fun zweiterFaktorBestaetigen(code: String): Result<ZweiterFaktorCodes> =
        safeCall { api.zweiterFaktorBestaetigen(ZweiterFaktorAnfrage(code = code)) }

    suspend fun zweiterFaktorAbschalten(passwort: String, code: String): Result<GenericResponse> =
        safeCall { api.zweiterFaktorAbschalten(ZweiterFaktorAnfrage(password = passwort, code = code)) }

    suspend fun zweiterFaktorNeueCodes(code: String): Result<ZweiterFaktorCodes> =
        safeCall { api.zweiterFaktorNeueCodes(ZweiterFaktorAnfrage(code = code)) }

    suspend fun updateProfil(aenderung: ProfilAenderung): Result<GenericResponse> =
        safeCall { api.updateProfil(aenderung) }

    suspend fun changePassword(aktuell: String, neu: String): Result<GenericResponse> =
        safeCall { api.changePassword(PasswortAenderung(aktuell, neu)) }

    suspend fun getTokens(): Result<TokensResponse> = safeCall { api.getTokens() }

    suspend fun revokeToken(tokenId: String): Result<GenericResponse> =
        safeCall { api.revokeToken(tokenId) }

    suspend fun getSettings(): Result<SettingsResponse> =
        safeCall { api.getSettings() }

    /** Das wirksame Design: mit Token das des Kontos, sonst die Vorgabe. Siehe KontoApi.getAppTheme. */
    suspend fun getAppTheme(): Result<AppThemeResponse> = safeCall { api.getAppTheme() }

    /** Eigenes Design setzen; "" stellt auf die Vorgabe des Verwalters zurück. */
    suspend fun setzeEigenesDesign(theme: String): Result<AppThemeResponse> =
        safeCall { api.setzeEigenesDesign(mapOf("theme" to theme)) }

    suspend fun updateSettings(currency: String, condition: String): Result<GenericResponse> =
        safeCall { api.updateSettings(mapOf("currency" to currency, "price_condition" to condition)) }

    suspend fun getDefaultCondition(): Result<DefaultConditionResponse> = safeCall { api.getDefaultCondition() }

    // User-level: saves per-user default (empty string = revert to global)
    suspend fun setUserDefaultCondition(condition: String): Result<GenericAdminResponse> = safeCall { api.setUserDefaultCondition(mapOf("condition" to condition)) }
}
