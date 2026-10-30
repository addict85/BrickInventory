package ch.brickinventoryapp.data.api

import ch.brickinventoryapp.data.model.*
import retrofit2.Response
import retrofit2.http.*

/**
 * Anmeldung und das eigene Konto: Profil, Passwort, zweiter Faktor, angemeldete
 * Geräte, eigenes Design, eigene Einstellungen (KontoRepository). Einige Adressen
 * gelten ohne Token, weil sie vor der Anmeldung gebraucht werden.
 */
interface KontoApi {

    @POST("api/v1/auth/login")
    suspend fun login(@Body request: LoginRequest): Response<LoginResponse>

    @POST("api/v1/auth/qr-login")
    suspend fun qrLogin(@Body request: QrLoginRequest): Response<LoginResponse>

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
    suspend fun getProfil(): Response<ProfilResponse>

    @PUT("api/v1/auth/profile")
    suspend fun updateProfil(@Body request: ProfilAenderung): Response<GenericResponse>

    @POST("api/v1/auth/change-password")
    suspend fun changePassword(@Body request: PasswortAenderung): Response<GenericResponse>

    // Zweiter Faktor. Das Zurücksetzen durch einen Verwalter fehlt hier
    // absichtlich — die Nutzerverwaltung steht nur in der Webapp.
    @GET("api/v1/auth/zweiter-faktor")
    suspend fun zweiterFaktorStand(): Response<ZweiterFaktorStand>

    @POST("api/v1/auth/zweiter-faktor/einrichten")
    suspend fun zweiterFaktorEinrichten(@Body request: ZweiterFaktorAnfrage): Response<ZweiterFaktorEinrichtung>

    @POST("api/v1/auth/zweiter-faktor/bestaetigen")
    suspend fun zweiterFaktorBestaetigen(@Body request: ZweiterFaktorAnfrage): Response<ZweiterFaktorCodes>

    @POST("api/v1/auth/zweiter-faktor/abschalten")
    suspend fun zweiterFaktorAbschalten(@Body request: ZweiterFaktorAnfrage): Response<GenericResponse>

    @POST("api/v1/auth/zweiter-faktor/codes")
    suspend fun zweiterFaktorNeueCodes(@Body request: ZweiterFaktorAnfrage): Response<ZweiterFaktorCodes>

    @GET("api/v1/auth/me")
    suspend fun getMe(): Response<MeResponse>

    // ── Angemeldete Geraete ──────────────────────────────────────────────────
    // Beide Adressen gab es schon; sie waren nur sitzungsgebunden und damit
    // fuer die App nicht erreichbar. Seit der Token-Verwaltung nehmen sie
    // Sitzung ODER Bearer-Token (requireLoginOrToken), wie der Rest von /api/v1.
    @GET("api/v1/settings/tokens")
    suspend fun getTokens(): Response<TokensResponse>

    @DELETE("api/v1/settings/tokens/{tokenId}")
    suspend fun revokeToken(@Path("tokenId") tokenId: String): Response<GenericResponse>

    /**
     * Das Design — ohne Anmeldung die Vorgabe des Verwalters (Anmeldebildschirm),
     * mit Token das des Kontos. Der ServerWaechter hängt den Token an.
     */
    @GET("api/v1/settings/theme")
    suspend fun getAppTheme(): Response<ch.brickinventoryapp.data.model.AppThemeResponse>

    /** Eigenes Design des Kontos; "" heisst „Vorgabe des Verwalters“. */
    @POST("api/v1/settings/user/theme")
    suspend fun setzeEigenesDesign(@Body body: Map<String, String>): Response<ch.brickinventoryapp.data.model.AppThemeResponse>

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
