package ch.brickinventoryapp.data.repository

import ch.brickinventoryapp.model.fach.Waehrung
import ch.brickinventoryapp.model.ui.theme.Design
import ch.brickinventoryapp.model.fach.Zustand
import ch.brickinventoryapp.model.util.fangeAusserAbbruch
import ch.brickinventoryapp.data.api.KontoApi
import ch.brickinventoryapp.model.data.model.*
import kotlinx.serialization.decodeFromString
import kotlinx.serialization.json.JsonObject
import ch.brickinventoryapp.model.koroutinen.BrickDispatchers
import ch.brickinventoryapp.model.koroutinen.Dispatcher
import kotlinx.coroutines.CoroutineDispatcher
import javax.inject.Inject
import javax.inject.Singleton
import ch.brickinventoryapp.data.Entwertungsergebnis
import ch.brickinventoryapp.data.GetauschterToken
import ch.brickinventoryapp.data.einordnenEntwertung
import ch.brickinventoryapp.model.data.model.QrAbholRequest
import ch.brickinventoryapp.model.data.model.QrAbholung
import ch.brickinventoryapp.model.data.model.QrLoginRequest
import ch.brickinventoryapp.model.data.model.QrMeldung
import ch.brickinventoryapp.netz.util.NetworkPolicy
import ch.brickinventoryapp.netz.util.Protokoll

/**
 * Anmeldung und das eigene Konto: Profil, Passwort, zweiter Faktor, Geräte, Design und Einstellungen — über Retrofit; die gemeinsame Abruflogik steht in Abruf.kt.
 */
@Singleton
class KontoRepositoryImpl @Inject constructor(
    private val api: KontoApi,
    /** Für den blockierenden Tausch. */
    @param:Dispatcher(BrickDispatchers.IO) private val io: CoroutineDispatcher,
) : KontoRepository {

    // Kein Authorization-Header hier: Der OkHttp-Interceptor in di/ServerClient.kt
    // setzt "Bearer <token>" für alle Anfragen an unseren Server (aus dem
    // Speicher-Spiegel der TokenAblage), auch für die SSE-Ströme.

    /**
     * Verlangt der Server den zweiten Faktor, antwortet er mit 401 und
     * `zweiter_faktor: true`. Das wird hier zu einer gewöhnlichen Antwort mit
     * success=false umgebogen (wie GutscheineRepository.guthaben), sonst gingen
     * Kennzeichen und Satz in sicherAufrufen verloren. [passkey] ersetzt den Code.
     */
    override suspend fun login(serverUrl: String, username: String, password: String, code: String?,
                      scope: String, passkey: JsonObject?): Ergebnis<Anmeldeantwort> {
        var wege = ZweiterFaktorWege()
        val r = sicherAufrufen {
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
            is Ergebnis.Success -> Ergebnis.Success(Anmeldeantwort(r.data, wege.passkey), stand = r.stand, gepuffert = r.gepuffert)
            is Ergebnis.Error -> r
        }
    }

    private val nachsichtigesJson = kotlinx.serialization.json.Json { ignoreUnknownKeys = true }

    /** Die Optionen für den Credential Manager; [zweck] wie PASSKEY_ANMELDEN. */
    override suspend fun passkeyOptionen(zweck: String): Ergebnis<PasskeyOptionen> =
        sicherAufrufen { api.passkeyOptionen(PasskeyOptionenAnfrage(zweck)) }

    /** Ohne Passwort; derselbe Token wie bei [login], mit denselben Regeln für den Ablauf. */
    override suspend fun passkeyAnmelden(serverUrl: String, antwort: JsonObject, scope: String): Ergebnis<LoginResponse> =
        sicherAufrufen { api.passkeyAnmelden(PasskeyAnmeldung(antwort, scope = scope,
            neverExpires = NetworkPolicy.istHttps(serverUrl))) }

    override suspend fun qrLogin(token: String, label: String): Ergebnis<QrMeldung> =
        sicherAufrufen { api.qrLogin(QrLoginRequest(token, label)) }

    override suspend fun qrAbholen(abholung: String, vorschau: Boolean): Ergebnis<QrAbholung> =
        sicherAufrufen { api.qrAbholen(QrAbholRequest(abholung, vorschau)) }

    override suspend fun qrVerwerfen(abholung: String): Ergebnis<GenericResponse> =
        sicherAufrufen { api.qrVerwerfen(QrVerwerfen(abholung)) }

    override suspend fun getMe(): Ergebnis<MeResponse> = sicherAufrufen { api.getMe() }

    // Konto anlegen und Passwort vergessen — beides ohne bestehende Anmeldung.
    override suspend fun getRegistrationStatus(): Ergebnis<RegistrationStatusResponse> =
        sicherAufrufen { api.getRegistrationStatus() }

    override suspend fun register(request: RegisterRequest): Ergebnis<RegisterResponse> =
        sicherAufrufen { api.register(request) }

    override suspend fun forgotPassword(email: String): Ergebnis<ForgotPasswordResponse> =
        sicherAufrufen { api.forgotPassword(ForgotPasswordRequest(email)) }

    override suspend fun getProfil(): Ergebnis<ProfilResponse> = sicherAufrufen { api.getProfil() }

    override suspend fun zweiterFaktorStand(): Ergebnis<ZweiterFaktorStand> = sicherAufrufen { api.zweiterFaktorStand() }

    override suspend fun zweiterFaktorEinrichten(passwort: String): Ergebnis<ZweiterFaktorEinrichtung> =
        sicherAufrufen { api.zweiterFaktorEinrichten(ZweiterFaktorAnfrage(password = passwort)) }

    override suspend fun zweiterFaktorBestaetigen(code: String): Ergebnis<ZweiterFaktorCodes> =
        sicherAufrufen { api.zweiterFaktorBestaetigen(ZweiterFaktorAnfrage(code = code)) }

    override suspend fun zweiterFaktorAbschalten(passwort: String, code: String): Ergebnis<GenericResponse> =
        sicherAufrufen { api.zweiterFaktorAbschalten(ZweiterFaktorAnfrage(password = passwort, code = code)) }

    override suspend fun zweiterFaktorNeueCodes(code: String): Ergebnis<ZweiterFaktorCodes> =
        sicherAufrufen { api.zweiterFaktorNeueCodes(ZweiterFaktorAnfrage(code = code)) }

    override suspend fun updateProfil(aenderung: ProfilAenderung): Ergebnis<ProfilGespeichert> =
        sicherAufrufen { api.updateProfil(aenderung) }

    override suspend fun changePassword(aktuell: String, neu: String, code: String?): Ergebnis<GenericResponse> =
        sicherAufrufen { api.changePassword(PasswortAenderung(aktuell, neu, code)) }

    override suspend fun getTokens(): Ergebnis<TokensResponse> = sicherAufrufen { api.getTokens() }

    override suspend fun revokeToken(tokenId: String, bestaetigung: ZweiterFaktorAnfrage): Ergebnis<TokenWiderruf> =
        sicherAufrufen { api.revokeToken(tokenId, bestaetigung) }

    override suspend fun andereBeenden(bestaetigung: ZweiterFaktorAnfrage): Ergebnis<AndereBeendet> =
        sicherAufrufen { api.andereBeenden(AndereBeendenAnfrage(bestaetigung.password, bestaetigung.code)) }

    /**
     * Den Token tauschen; [alterToken] geht ausdrücklich mit (siehe data/TokenTausch).
     * Synchron auf einem IO-Faden, am Dispatcher von OkHttp vorbei (KontoApi.tokenRotieren).
     * Die Herkunft kommt aus der Anfrage, die tatsächlich ging: Nur an sie ist der neue Token gebunden.
     */
    override suspend fun tokenRotieren(alterToken: String): Ergebnis<GetauschterToken> {
        var herkunft: String? = null
        val r = sicherAufrufen {
            kotlinx.coroutines.withContext(io) { api.tokenRotieren("Bearer $alterToken").execute() }
                .also { herkunft = NetworkPolicy.herkunft(it.raw().request.url.toString()) }
        }
        return when (r) {
            is Ergebnis.Success -> Ergebnis.Success(GetauschterToken(r.data, herkunft), stand = r.stand, gepuffert = r.gepuffert)
            is Ergebnis.Error -> r
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

    override suspend fun getSettings(): Ergebnis<SettingsResponse> =
        sicherAufrufen { api.getSettings() }

    /** Das wirksame Design: mit Token das des Kontos, sonst die Vorgabe. Siehe KontoApi.getAppTheme. */
    override suspend fun getAppTheme(): Ergebnis<AppThemeResponse> = sicherAufrufen { api.getAppTheme() }

    /** Eigenes Design setzen; null stellt auf die Vorgabe des Verwalters zurück ("" auf der Leitung). */
    override suspend fun setzeEigenesDesign(theme: Design?): Ergebnis<AppThemeResponse> =
        sicherAufrufen { api.setzeEigenesDesign(mapOf("theme" to (theme?.kennung ?: ""))) }

    override suspend fun updateSettings(currency: Waehrung, condition: Zustand): Ergebnis<GenericResponse> =
        sicherAufrufen { api.updateSettings(mapOf("currency" to currency.code, "price_condition" to condition.kennung)) }

    override suspend fun getDefaultCondition(): Ergebnis<DefaultConditionResponse> = sicherAufrufen { api.getDefaultCondition() }

    // User-level: saves per-user default (empty string = revert to global)
    override suspend fun setUserDefaultCondition(condition: Zustand?): Ergebnis<GenericAdminResponse> = sicherAufrufen { api.setUserDefaultCondition(mapOf("condition" to condition?.kennung.orEmpty())) }
}

/** Die Antwort auf [KontoRepository.login]; [passkeyStattCode], wenn der Server beim
 * zweiten Faktor auch einen Passkey nimmt. */
data class Anmeldeantwort(val antwort: LoginResponse, val passkeyStattCode: Boolean = false)
