package ch.brickinventoryapp.data.api

import ch.brickinventoryapp.contract.AndereBeendenAnfrage
import ch.brickinventoryapp.contract.AndereBeendet
import ch.brickinventoryapp.contract.AppThemeResponse
import ch.brickinventoryapp.contract.DefaultConditionResponse
import ch.brickinventoryapp.contract.Erledigt
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

/**
 * Sign-in and the own account: profile, password, second factor, signed-in
 * devices, own design, own settings (AccountRepository). Some addresses
 * apply without a token because they are needed before the sign-in.
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
    suspend fun loginPasskey(@Body request: PasskeyAnmeldungAnfrage): Response<LoginResponse>

    @POST("api/v1/auth/logout")
    suspend fun logout(): Response<GenericResponse>

    // ── Create account and forgot password ──
    //
    // Without sign-in, because they are needed before there is a token; the server
    // keeps them before requireLogin (routes/auth.ts).
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

    // Second factor. The reset by an admin is deliberately missing
    // here — user management stands only in the web app.
    @GET("api/v1/auth/zweiter-faktor")
    suspend fun secondFactorStatus(): Response<ZweiterFaktorStand>

    @POST("api/v1/auth/zweiter-faktor/einrichten")
    suspend fun setUpSecondFactor(@Body request: ZweiterFaktorAnfrage): Response<ZweiterFaktorEinrichtung>

    @POST("api/v1/auth/zweiter-faktor/bestaetigen")
    suspend fun secondFactorConfirm(@Body request: ZweiterFaktorAnfrage): Response<ZweiterFaktorCodes>

    @POST("api/v1/auth/zweiter-faktor/abschalten")
    suspend fun disableSecondFactor(@Body request: ZweiterFaktorAnfrage): Response<GenericResponse>

    @POST("api/v1/auth/zweiter-faktor/codes")
    suspend fun secondFactorNewCodes(@Body request: ZweiterFaktorAnfrage): Response<ZweiterFaktorCodes>

    @GET("api/v1/auth/me")
    suspend fun getMe(): Response<MeResponse>

    // ── Signed-in devices ────────────────────────────────────────────────────
    // Both addresses existed already; they were only session-bound and thus
    // not reachable for the app. Since the token management they take
    // session OR bearer token (requireLoginOrToken), like the rest of /api/v1.
    @GET("api/v1/settings/tokens")
    suspend fun getTokens(): Response<TokensResponse>

    // @HTTP instead of @DELETE: Retrofit allows no body for @DELETE, and the
    // server signs out a foreign device only with password and code.
    @HTTP(method = "DELETE", path = "api/v1/settings/tokens/{tokenId}", hasBody = true)
    suspend fun revokeToken(
        @Path("tokenId") tokenId: String,
        @Body confirmation: ZweiterFaktorAnfrage,
    ): Response<TokenWiderruf>

    /** All other sign-ins and app accesses in one request: a code applies only once. */
    @POST("api/v1/settings/sessions/andere-beenden")
    suspend fun endOther(@Body request: AndereBeendenAnfrage): Response<AndereBeendet>

    /**
     * Swap the token (rotation). The old one explicitly goes along because the
     * swap must also run when it has only just been replaced (data/TokenSwap).
     * A `Call` for direct execution, not `suspend`: the rejected requests
     * wait in the interceptor and occupy the dispatcher; via it the swap would never get its turn.
     */
    @POST("api/v1/auth/token-rotieren")
    fun rotateToken(@Header("Authorization") bearer: String): retrofit2.Call<TokenRotation>

    /**
     * The design — without sign-in the admin's default (sign-in screen),
     * with a token the account's. The ServerGuard attaches the token.
     */
    @GET("api/v1/settings/theme")
    suspend fun getAppTheme(): Response<AppThemeResponse>

    /** Own design of the account; "" means „the admin's default“. */
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
    // Must run via /api/v1/ (bearer token) — the former
    // /api/settings/... path was session-only (requireLogin) and silently failed with a
    // token, so that the default set in the app never arrived.
    @POST("api/v1/settings/user/default-condition")
    suspend fun setUserDefaultCondition(
        @Body body: Map<String, String>
    ): Response<GenericAdminResponse>
}
