package ch.brickinventoryapp.data.repository

import ch.brickinventoryapp.util.fangeAusserAbbruch
import ch.brickinventoryapp.data.api.KontoApi
import ch.brickinventoryapp.data.cache.ResponseCache
import ch.brickinventoryapp.data.model.*
import kotlinx.serialization.decodeFromString
import kotlinx.serialization.json.JsonObject
import ch.brickinventoryapp.di.BrickDispatchers
import ch.brickinventoryapp.di.Dispatcher
import kotlinx.coroutines.CoroutineDispatcher
import javax.inject.Inject
import javax.inject.Singleton
import ch.brickinventoryapp.data.Entwertungsergebnis
import ch.brickinventoryapp.data.GetauschterToken
import ch.brickinventoryapp.data.einordnenEntwertung
import ch.brickinventoryapp.data.model.QrLoginRequest
import ch.brickinventoryapp.util.NetworkPolicy
import ch.brickinventoryapp.util.Protokoll

/**
 * Anmeldung und das eigene Konto: Profil, Passwort, zweiter Faktor, Geräte, Design und Einstellungen — über Retrofit; die gemeinsame Abruflogik steht in RepoBasis.kt.
 */
@Singleton
class KontoRepositoryImpl @Inject constructor(
    api: KontoApi,
    cache: ResponseCache,
    /** Für den blockierenden Tausch. */
    @param:Dispatcher(BrickDispatchers.IO) private val io: CoroutineDispatcher,
) : RepoBasis<KontoApi>(api, cache), KontoRepository {

    // Kein Authorization-Header hier: Der OkHttp-Interceptor in di/ServerClient.kt
    // setzt "Bearer <token>" für alle Anfragen an unseren Server (aus dem
    // Speicher-Spiegel des PreferencesManagers). Einzige Ausnahme:
    // getCsvImportStatusDirect, wo der Foreground-Service den Token selbst mitgibt.

    /**
     * Verlangt der Server den zweiten Faktor, antwortet er mit 401 und
     * `zweiter_faktor: true`. Das wird hier zu einer gewöhnlichen Antwort mit
     * success=false umgebogen (wie GutscheineRepository.guthaben), sonst gingen
     * Kennzeichen und Satz in safeCall verloren. [passkey] ersetzt den Code.
     * Ausführlich: docs/begruendungen/core-data/data/repository/KontoRepository.kt.md#login
     */
    override suspend fun login(serverUrl: String, username: String, password: String, code: String?,
                      scope: String, passkey: JsonObject?): Result<Anmeldeantwort> {
        var wege = ZweiterFaktorWege()
        val r = safeCall {
            val https = NetworkPolicy.istHttps(serverUrl)
            val antwort = if (passkey != null)
                api.loginMitPasskey(PasskeyLoginRequest(username, password, passkey, scope = scope, neverExpires = https))
            else api.login(LoginRequest(username, password, code = code, scope = scope, neverExpires = https))
            if (antwort.code() == 401) {
                val rumpf = antwort.errorBody()?.string()
                val geparst = rumpf?.let { runCatching { nachsichtigesJson.decodeFromString<LoginResponse>(it) }.getOrNull() }
                rumpf?.let { runCatching { nachsichtigesJson.decodeFromString<ZweiterFaktorWege>(it) }.getOrNull() }?.let { wege = it }
                if (geparst?.zweiterFaktor == true) retrofit2.Response.success(geparst) else antwort
            } else antwort
        }
        return when (r) {
            is Result.Success -> Result.Success(Anmeldeantwort(r.data, wege.passkey), stand = r.stand, gepuffert = r.gepuffert)
            is Result.Error -> r
        }
    }

    private val nachsichtigesJson = kotlinx.serialization.json.Json { ignoreUnknownKeys = true }

    /** Die Optionen für den Credential Manager; [zweck] wie PASSKEY_ANMELDEN. */
    override suspend fun passkeyOptionen(zweck: String): Result<PasskeyOptionen> =
        safeCall { api.passkeyOptionen(PasskeyOptionenAnfrage(zweck)) }

    /** Ohne Passwort; derselbe Token wie bei [login], mit denselben Regeln für den Ablauf. */
    override suspend fun passkeyAnmelden(serverUrl: String, antwort: JsonObject, scope: String): Result<LoginResponse> =
        safeCall { api.passkeyAnmelden(PasskeyAnmeldung(antwort, scope = scope,
            neverExpires = NetworkPolicy.istHttps(serverUrl))) }

    override suspend fun qrLogin(token: String): Result<LoginResponse> =
        safeCall { api.qrLogin(QrLoginRequest(token)) }

    override suspend fun getMe(): Result<MeResponse> = safeCall { api.getMe() }

    // Konto anlegen und Passwort vergessen — beides ohne bestehende Anmeldung.
    override suspend fun getRegistrationStatus(): Result<RegistrationStatusResponse> =
        safeCall { api.getRegistrationStatus() }

    override suspend fun register(request: RegisterRequest): Result<RegisterResponse> =
        safeCall { api.register(request) }

    override suspend fun forgotPassword(email: String): Result<ForgotPasswordResponse> =
        safeCall { api.forgotPassword(ForgotPasswordRequest(email)) }

    override suspend fun getProfil(): Result<ProfilResponse> = safeCall { api.getProfil() }

    override suspend fun zweiterFaktorStand(): Result<ZweiterFaktorStand> = safeCall { api.zweiterFaktorStand() }

    override suspend fun zweiterFaktorEinrichten(passwort: String): Result<ZweiterFaktorEinrichtung> =
        safeCall { api.zweiterFaktorEinrichten(ZweiterFaktorAnfrage(password = passwort)) }

    override suspend fun zweiterFaktorBestaetigen(code: String): Result<ZweiterFaktorCodes> =
        safeCall { api.zweiterFaktorBestaetigen(ZweiterFaktorAnfrage(code = code)) }

    override suspend fun zweiterFaktorAbschalten(passwort: String, code: String): Result<GenericResponse> =
        safeCall { api.zweiterFaktorAbschalten(ZweiterFaktorAnfrage(password = passwort, code = code)) }

    override suspend fun zweiterFaktorNeueCodes(code: String): Result<ZweiterFaktorCodes> =
        safeCall { api.zweiterFaktorNeueCodes(ZweiterFaktorAnfrage(code = code)) }

    override suspend fun updateProfil(aenderung: ProfilAenderung): Result<ProfilGespeichert> =
        safeCall { api.updateProfil(aenderung) }

    override suspend fun changePassword(aktuell: String, neu: String, code: String?): Result<GenericResponse> =
        safeCall { api.changePassword(PasswortAenderung(aktuell, neu, code)) }

    override suspend fun getTokens(): Result<TokensResponse> = safeCall { api.getTokens() }

    override suspend fun revokeToken(tokenId: String): Result<TokenWiderruf> =
        safeCall { api.revokeToken(tokenId) }

    /**
     * Den Token tauschen; [alterToken] geht ausdrücklich mit (siehe data/TokenTausch).
     * Synchron auf einem IO-Faden, am Dispatcher von OkHttp vorbei (KontoApi.tokenRotieren).
     * Die Herkunft kommt aus der Anfrage, die tatsächlich ging: Nur an sie ist der neue Token gebunden.
     */
    override suspend fun tokenRotieren(alterToken: String): Result<GetauschterToken> {
        var herkunft: String? = null
        val r = safeCall {
            kotlinx.coroutines.withContext(io) { api.tokenRotieren("Bearer $alterToken").execute() }
                .also { herkunft = NetworkPolicy.herkunft(it.raw().request.url.toString()) }
        }
        return when (r) {
            is Result.Success -> Result.Success(GetauschterToken(r.data, herkunft), stand = r.stand, gepuffert = r.gepuffert)
            is Result.Error -> r
        }
    }

    /**
     * Den Token am Server entwerten, bevor er lokal verschwindet — sonst bliebe er
     * gültig, bis er verfällt. Höchstens [grenzeMs]: Abmelden darf nicht am Netz
     * hängen. Was dann noch offen ist, holt data/Abmeldung nach.
     */
    override suspend fun abmeldenAmServer(grenzeMs: Long): Boolean =
        entwertenAmServer(grenzeMs) == Entwertungsergebnis.ENTWERTET

    /** Wie [abmeldenAmServer], aber mit dem Grund: Nur SPAETER lohnt eine Wiederholung. */
    override suspend fun entwertenAmServer(grenzeMs: Long): Entwertungsergebnis = fangeAusserAbbruch {
        kotlinx.coroutines.withTimeoutOrNull(grenzeMs) { einordnenEntwertung(api.logout().code()) }
            ?: Entwertungsergebnis.SPAETER.also {
                Protokoll.warnung("Abmelden", "Server antwortete nicht in $grenzeMs ms")
            }
    }.getOrElse { e ->
        Protokoll.warnung("Abmelden", "Token am Server nicht entwertet", e)
        Entwertungsergebnis.SPAETER
    }

    override suspend fun getSettings(): Result<SettingsResponse> =
        safeCall { api.getSettings() }

    /** Das wirksame Design: mit Token das des Kontos, sonst die Vorgabe. Siehe KontoApi.getAppTheme. */
    override suspend fun getAppTheme(): Result<AppThemeResponse> = safeCall { api.getAppTheme() }

    /** Eigenes Design setzen; "" stellt auf die Vorgabe des Verwalters zurück. */
    override suspend fun setzeEigenesDesign(theme: String): Result<AppThemeResponse> =
        safeCall { api.setzeEigenesDesign(mapOf("theme" to theme)) }

    override suspend fun updateSettings(currency: String, condition: String): Result<GenericResponse> =
        safeCall { api.updateSettings(mapOf("currency" to currency, "price_condition" to condition)) }

    override suspend fun getDefaultCondition(): Result<DefaultConditionResponse> = safeCall { api.getDefaultCondition() }

    // User-level: saves per-user default (empty string = revert to global)
    override suspend fun setUserDefaultCondition(condition: String): Result<GenericAdminResponse> = safeCall { api.setUserDefaultCondition(mapOf("condition" to condition)) }
}

/** Die Antwort auf [KontoRepository.login]; [passkeyStattCode], wenn der Server beim
 * zweiten Faktor auch einen Passkey nimmt. */
data class Anmeldeantwort(val antwort: LoginResponse, val passkeyStattCode: Boolean = false)
