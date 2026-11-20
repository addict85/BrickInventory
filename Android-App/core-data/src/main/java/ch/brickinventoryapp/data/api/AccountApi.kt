package ch.brickinventoryapp.data.api

import ch.brickinventoryapp.contract.Erledigt
import ch.brickinventoryapp.contract.AndereBeendenAnfrage
import ch.brickinventoryapp.contract.AndereBeendet
import ch.brickinventoryapp.contract.DefaultConditionResponse
import ch.brickinventoryapp.contract.ForgotPasswordRequest
import ch.brickinventoryapp.contract.ForgotPasswordResponse
import ch.brickinventoryapp.contract.GenericAdminResponse
import ch.brickinventoryapp.contract.GenericResponse
import ch.brickinventoryapp.contract.LoginRequest
import ch.brickinventoryapp.contract.LoginResponse
import ch.brickinventoryapp.contract.MeResponse
import ch.brickinventoryapp.contract.PasskeyAnmeldungAnfrage
import ch.brickinventoryapp.contract.PasskeyOptionen
import ch.brickinventoryapp.contract.PasskeyOptionenAnfrage
import ch.brickinventoryapp.contract.PasswortAenderung
import ch.brickinventoryapp.contract.ProfilAenderung
import ch.brickinventoryapp.contract.ProfilGespeichert
import ch.brickinventoryapp.contract.ProfilResponse
import ch.brickinventoryapp.contract.QrAbholRequest
import ch.brickinventoryapp.contract.QrAbholung
import ch.brickinventoryapp.contract.QrLoginRequest
import ch.brickinventoryapp.contract.QrMeldung
import ch.brickinventoryapp.contract.QrVerwerfen
import ch.brickinventoryapp.contract.RegisterRequest
import ch.brickinventoryapp.contract.RegisterResponse
import ch.brickinventoryapp.contract.RegistrationStatusResponse
import ch.brickinventoryapp.contract.SettingsResponse
import ch.brickinventoryapp.contract.TokenRotation
import ch.brickinventoryapp.contract.TokenWiderruf
import ch.brickinventoryapp.contract.TokensResponse
import ch.brickinventoryapp.contract.ZweiterFaktorAnfrage
import ch.brickinventoryapp.contract.ZweiterFaktorCodes
import ch.brickinventoryapp.contract.ZweiterFaktorEinrichtung
import ch.brickinventoryapp.contract.ZweiterFaktorStand
import retrofit2.Response
import retrofit2.http.Body
import retrofit2.http.GET
import retrofit2.http.HTTP
import retrofit2.http.Header
import retrofit2.http.POST
import retrofit2.http.PUT
import retrofit2.http.Path
import ch.brickinventoryapp.contract.AppThemeResponse

/**
 * Anmeldung und das eigene Konto: Profil, Passwort, zweiter Faktor, angemeldete
 * Geräte, eigenes Design, eigene Einstellungen (AccountRepository). Einige Adressen
 * gelten ohne Token, weil sie vor der Anmeldung gebraucht werden.
 */
interface AccountApi {

    @POST("api/v1/auth/login")
    suspend fun login(@Body request: LoginRequest): Response<LoginResponse>

    @POST("api/v1/auth/qr-login")
    suspend fun qrLogin(@Body request: QrLoginRequest): Response<QrMeldung>

    @POST("api/v1/auth/qr-login/abholen")
    suspend fun pickUpQr(@Body request: QrAbholRequest): Response<QrAbholung>

    @POST("api/v1/auth/qr-login/verwerfen")
    suspend fun discardQr(@Body request: QrVerwerfen): Response<Erledigt>

    @POST("api/v1/auth/login")
    suspend fun loginWithPasskey(@Body request: LoginRequest): Response<LoginResponse>

    @POST("api/v1/auth/passkey/anmelden/optionen")
    suspend fun passkeyOptions(@Body request: PasskeyOptionenAnfrage): Response<PasskeyOptionen>

    @POST("api/v1/auth/passkey/anmelden")
    suspend fun signInPasskey(@Body request: PasskeyAnmeldungAnfrage): Response<LoginResponse>

    @POST("api/v1/auth/logout")
    suspend fun logout(): Response<GenericResponse>

    // ── Konto anlegen und Passwort vergessen ──
    //
    // Ohne Anmeldung, weil sie gebraucht werden, bevor es einen Token gibt; der Server
    // lässt sie vor requireLogin stehen (routes/auth.ts).
    @GET("api/v1/auth/registration-status")
    suspend fun getRegistrationStatus(): Response<RegistrationStatusResponse>

    @POST("api/v1/auth/register")
    suspend fun register(@Body request: RegisterRequest): Response<RegisterResponse>

    @POST("api/v1/auth/forgot-password")
    suspend fun forgotPassword(@Body request: ForgotPasswordRequest): Response<ForgotPasswordResponse>

    // ── Das eigene Konto ────────────────────────────────────────────────────
    @GET("api/v1/auth/profile")
    suspend fun getProfile(): Response<ProfilResponse>

    @PUT("api/v1/auth/profile")
    suspend fun updateProfile(@Body request: ProfilAenderung): Response<ProfilGespeichert>

    @POST("api/v1/auth/change-password")
    suspend fun changePassword(@Body request: PasswortAenderung): Response<GenericResponse>

    // Zweiter Faktor. Das Zurücksetzen durch einen Verwalter fehlt hier
    // absichtlich — die Nutzerverwaltung steht nur in der Webapp.
    @GET("api/v1/auth/zweiter-faktor")
    suspend fun secondFactorStatus(): Response<ZweiterFaktorStand>

    @POST("api/v1/auth/zweiter-faktor/einrichten")
    suspend fun setUpSecondFactor(@Body request: ZweiterFaktorAnfrage): Response<ZweiterFaktorEinrichtung>

    @POST("api/v1/auth/zweiter-faktor/bestaetigen")
    suspend fun zweiterFaktorBestaetigen(@Body request: ZweiterFaktorAnfrage): Response<ZweiterFaktorCodes>

    @POST("api/v1/auth/zweiter-faktor/abschalten")
    suspend fun disableSecondFactor(@Body request: ZweiterFaktorAnfrage): Response<GenericResponse>

    @POST("api/v1/auth/zweiter-faktor/codes")
    suspend fun secondFactorNewCodes(@Body request: ZweiterFaktorAnfrage): Response<ZweiterFaktorCodes>

    @GET("api/v1/auth/me")
    suspend fun getMe(): Response<MeResponse>

    // ── Angemeldete Geraete ──────────────────────────────────────────────────
    // Beide Adressen gab es schon; sie waren nur sitzungsgebunden und damit
    // fuer die App nicht erreichbar. Seit der Token-Verwaltung nehmen sie
    // Sitzung ODER Bearer-Token (requireLoginOrToken), wie der Rest von /api/v1.
    @GET("api/v1/settings/tokens")
    suspend fun getTokens(): Response<TokensResponse>

    // @HTTP statt @DELETE: Retrofit erlaubt bei @DELETE keinen Rumpf, und ein
    // fremdes Gerät meldet der Server nur mit Passwort und Code ab.
    @HTTP(method = "DELETE", path = "api/v1/settings/tokens/{tokenId}", hasBody = true)
    suspend fun revokeToken(
        @Path("tokenId") tokenId: String,
        @Body confirmation: ZweiterFaktorAnfrage,
    ): Response<TokenWiderruf>

    /** Alle übrigen Anmeldungen und App-Zugänge in einer Anfrage: Ein Code gilt nur einmal. */
    @POST("api/v1/settings/sessions/andere-beenden")
    suspend fun endOther(@Body anfrage: AndereBeendenAnfrage): Response<AndereBeendet>

    /**
     * Den Token tauschen (Rotation). Der alte geht ausdrücklich mit, weil der
     * Tausch auch dann laufen muss, wenn er gerade erst ersetzt wurde (data/TokenSwap).
     * Ein `Call` zum direkten Ausführen, nicht `suspend`: Die abgewiesenen Anfragen
     * warten im Interceptor und belegen den Dispatcher; über ihn käme der Tausch nie dran.
     */
    @POST("api/v1/auth/token-rotieren")
    fun rotateToken(@Header("Authorization") bearer: String): retrofit2.Call<TokenRotation>

    /**
     * Das Design — ohne Anmeldung die Vorgabe des Verwalters (Anmeldebildschirm),
     * mit Token das des Kontos. Der ServerWaechter hängt den Token an.
     */
    @GET("api/v1/settings/theme")
    suspend fun getAppTheme(): Response<AppThemeResponse>

    /** Eigenes Design des Kontos; "" heisst „Vorgabe des Verwalters“. */
    @POST("api/v1/settings/user/theme")
    suspend fun setOwnDesign(@Body body: Map<String, String>): Response<AppThemeResponse>

    @GET("api/v1/settings")
    suspend fun getSettings(): Response<SettingsResponse>

    @PUT("api/v1/settings")
    suspend fun updateSettings(
        @Body body: Map<String, String>
    ): Response<GenericResponse>

    @GET("api/v1/settings/default-condition")
    suspend fun getDefaultCondition(): Response<DefaultConditionResponse>

    // User-level default condition (each user can override).
    // Muss über /api/v1/ laufen (Bearer-Token) — der frühere
    // /api/settings/...-Pfad war session-only (requireLogin) und schlug mit
    // Token still fehl, sodass der in der App gesetzte Default nie ankam.
    @POST("api/v1/settings/user/default-condition")
    suspend fun setUserDefaultCondition(
        @Body body: Map<String, String>
    ): Response<GenericAdminResponse>
}
