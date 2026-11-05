package ch.brickinventoryapp.data.repository

import ch.brickinventoryapp.data.Entwertungsergebnis
import ch.brickinventoryapp.data.GetauschterToken
import ch.brickinventoryapp.data.model.*
import kotlinx.serialization.json.JsonObject

/**
 * Das eigene Konto: Anmeldung, Profil, Einstellungen, zweiter Faktor, Token.
 * Eine Schnittstelle, damit ViewModels und Tests nicht an der Umsetzung mit
 * Retrofit und Ablage hängen (KontoRepositoryImpl).
 */
interface KontoRepository {
    suspend fun login(serverUrl: String, username: String, password: String, code: String? = null,
                      scope: String = TOKEN_SCOPE_APP, passkey: JsonObject? = null): Result<Anmeldeantwort>

    suspend fun passkeyOptionen(zweck: String): Result<PasskeyOptionen>

    suspend fun passkeyAnmelden(serverUrl: String, antwort: JsonObject, scope: String = TOKEN_SCOPE_APP): Result<LoginResponse>

    suspend fun qrLogin(token: String): Result<LoginResponse>

    suspend fun getMe(): Result<MeResponse>

    suspend fun getRegistrationStatus(): Result<RegistrationStatusResponse>

    suspend fun register(request: RegisterRequest): Result<RegisterResponse>

    suspend fun forgotPassword(email: String): Result<ForgotPasswordResponse>

    suspend fun getProfil(): Result<ProfilResponse>

    suspend fun zweiterFaktorStand(): Result<ZweiterFaktorStand>

    suspend fun zweiterFaktorEinrichten(passwort: String): Result<ZweiterFaktorEinrichtung>

    suspend fun zweiterFaktorBestaetigen(code: String): Result<ZweiterFaktorCodes>

    suspend fun zweiterFaktorAbschalten(passwort: String, code: String): Result<GenericResponse>

    suspend fun zweiterFaktorNeueCodes(code: String): Result<ZweiterFaktorCodes>

    suspend fun updateProfil(aenderung: ProfilAenderung): Result<ProfilGespeichert>

    suspend fun changePassword(aktuell: String, neu: String, code: String? = null): Result<GenericResponse>

    suspend fun getTokens(): Result<TokensResponse>

    suspend fun revokeToken(tokenId: String): Result<TokenWiderruf>

    suspend fun tokenRotieren(alterToken: String): Result<GetauschterToken>

    suspend fun abmeldenAmServer(grenzeMs: Long = 3_000): Boolean

    suspend fun entwertenAmServer(grenzeMs: Long = 3_000): Entwertungsergebnis

    suspend fun getSettings(): Result<SettingsResponse>

    suspend fun getAppTheme(): Result<AppThemeResponse>

    suspend fun setzeEigenesDesign(theme: String): Result<AppThemeResponse>

    suspend fun updateSettings(currency: String, condition: String): Result<GenericResponse>

    suspend fun getDefaultCondition(): Result<DefaultConditionResponse>

    suspend fun setUserDefaultCondition(condition: String): Result<GenericAdminResponse>
}
