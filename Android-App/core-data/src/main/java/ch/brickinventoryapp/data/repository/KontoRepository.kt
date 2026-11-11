package ch.brickinventoryapp.data.repository

import ch.brickinventoryapp.model.fach.Waehrung
import ch.brickinventoryapp.model.ui.theme.Design
import ch.brickinventoryapp.model.fach.Zustand
import ch.brickinventoryapp.data.Entwertungsergebnis
import ch.brickinventoryapp.data.GetauschterToken
import ch.brickinventoryapp.model.data.model.*
import kotlinx.serialization.json.JsonObject

/**
 * Das eigene Konto: Anmeldung, Profil, Einstellungen, zweiter Faktor, Token.
 * Eine Schnittstelle, damit ViewModels und Tests nicht an der Umsetzung mit
 * Retrofit und Ablage hängen (KontoRepositoryImpl).
 */
interface KontoRepository {
    suspend fun login(serverUrl: String, username: String, password: String, code: String? = null,
                      scope: String = TOKEN_SCOPE_APP, passkey: JsonObject? = null): Ergebnis<Anmeldeantwort>

    suspend fun passkeyOptionen(zweck: String): Ergebnis<PasskeyOptionen>

    suspend fun passkeyAnmelden(serverUrl: String, antwort: JsonObject, scope: String = TOKEN_SCOPE_APP): Ergebnis<LoginResponse>

    suspend fun qrLogin(token: String, label: String): Ergebnis<QrMeldung>
    /** [vorschau]: nach der Bestätigung im Browser nur das Konto, noch kein Token. */
    suspend fun qrAbholen(abholung: String, vorschau: Boolean = false): Ergebnis<QrAbholung>
    /** Das Nein nach der Vorschau: Die Kopplung ist danach abgelehnt. */
    suspend fun qrVerwerfen(abholung: String): Ergebnis<GenericResponse>

    suspend fun getMe(): Ergebnis<MeResponse>

    suspend fun getRegistrationStatus(): Ergebnis<RegistrationStatusResponse>

    suspend fun register(request: RegisterRequest): Ergebnis<RegisterResponse>

    suspend fun forgotPassword(email: String): Ergebnis<ForgotPasswordResponse>

    suspend fun getProfil(): Ergebnis<ProfilResponse>

    suspend fun zweiterFaktorStand(): Ergebnis<ZweiterFaktorStand>

    suspend fun zweiterFaktorEinrichten(passwort: String): Ergebnis<ZweiterFaktorEinrichtung>

    suspend fun zweiterFaktorBestaetigen(code: String): Ergebnis<ZweiterFaktorCodes>

    suspend fun zweiterFaktorAbschalten(passwort: String, code: String): Ergebnis<GenericResponse>

    suspend fun zweiterFaktorNeueCodes(code: String): Ergebnis<ZweiterFaktorCodes>

    suspend fun updateProfil(aenderung: ProfilAenderung): Ergebnis<ProfilGespeichert>

    suspend fun changePassword(aktuell: String, neu: String, code: String? = null): Ergebnis<GenericResponse>

    suspend fun getTokens(): Ergebnis<TokensResponse>

    suspend fun revokeToken(tokenId: String, bestaetigung: ZweiterFaktorAnfrage): Ergebnis<TokenWiderruf>

    suspend fun andereBeenden(bestaetigung: ZweiterFaktorAnfrage): Ergebnis<AndereBeendet>

    suspend fun tokenRotieren(alterToken: String): Ergebnis<GetauschterToken>

    suspend fun abmeldenAmServer(grenzeMs: Long = 3_000): Boolean

    suspend fun entwertenAmServer(grenzeMs: Long = 3_000): Entwertungsergebnis

    suspend fun getSettings(): Ergebnis<SettingsResponse>

    suspend fun getAppTheme(): Ergebnis<AppThemeResponse>

    suspend fun setzeEigenesDesign(theme: Design?): Ergebnis<AppThemeResponse>

    suspend fun updateSettings(currency: Waehrung, condition: Zustand): Ergebnis<GenericResponse>

    suspend fun getDefaultCondition(): Ergebnis<DefaultConditionResponse>

    /** null: zurück auf die Vorgabe des Servers. */
    suspend fun setUserDefaultCondition(condition: Zustand?): Ergebnis<GenericAdminResponse>
}
