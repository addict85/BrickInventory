package ch.brickinventoryapp.data.api

import ch.brickinventoryapp.contract.AppThemeResponse
import ch.brickinventoryapp.contract.DefaultConditionResponse
import ch.brickinventoryapp.contract.Done
import ch.brickinventoryapp.contract.EndOthersRequest
import ch.brickinventoryapp.contract.ForgotPasswordRequest
import ch.brickinventoryapp.contract.ForgotPasswordResponse
import ch.brickinventoryapp.contract.GenericAdminResponse
import ch.brickinventoryapp.contract.GenericResponse
import ch.brickinventoryapp.contract.LoginRequest
import ch.brickinventoryapp.contract.LoginResponse
import ch.brickinventoryapp.contract.MeResponse
import ch.brickinventoryapp.contract.OthersEnded
import ch.brickinventoryapp.contract.PasskeyLoginRequest
import ch.brickinventoryapp.contract.PasskeyOptions
import ch.brickinventoryapp.contract.PasskeyOptionsRequest
import ch.brickinventoryapp.contract.PasswordChange
import ch.brickinventoryapp.contract.ProfileRequest
import ch.brickinventoryapp.contract.ProfileResponse
import ch.brickinventoryapp.contract.ProfileSavedResponse
import ch.brickinventoryapp.contract.QrCollectRequest
import ch.brickinventoryapp.contract.QrDiscard
import ch.brickinventoryapp.contract.QrLoginRequest
import ch.brickinventoryapp.contract.QrMessage
import ch.brickinventoryapp.contract.QrPickup
import ch.brickinventoryapp.contract.RegisterRequest
import ch.brickinventoryapp.contract.RegisterResponse
import ch.brickinventoryapp.contract.RegistrationStatusResponse
import ch.brickinventoryapp.contract.SecondFactorCodes
import ch.brickinventoryapp.contract.SecondFactorRequest
import ch.brickinventoryapp.contract.SecondFactorSetupResponse
import ch.brickinventoryapp.contract.SecondFactorStateResponse
import ch.brickinventoryapp.contract.SettingsResponse
import ch.brickinventoryapp.contract.TokenRevocation
import ch.brickinventoryapp.contract.TokenRotation
import ch.brickinventoryapp.contract.TokensResponse
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

    @POST("api/v2/auth/login")
    suspend fun login(@Body request: LoginRequest): Response<LoginResponse>

    @POST("api/v2/auth/qr-login")
    suspend fun qrLogin(@Body request: QrLoginRequest): Response<QrMessage>

    @POST("api/v2/auth/qr-login/collect")
    suspend fun pickUpQr(@Body request: QrCollectRequest): Response<QrPickup>

    @POST("api/v2/auth/qr-login/discard")
    suspend fun discardQr(@Body request: QrDiscard): Response<Done>

    @POST("api/v2/auth/login")
    suspend fun loginWithPasskey(@Body request: LoginRequest): Response<LoginResponse>

    @POST("api/v2/auth/passkey/login/options")
    suspend fun passkeyOptions(@Body request: PasskeyOptionsRequest): Response<PasskeyOptions>

    @POST("api/v2/auth/passkey/login")
    suspend fun loginPasskey(@Body request: PasskeyLoginRequest): Response<LoginResponse>

    @POST("api/v2/auth/logout")
    suspend fun logout(): Response<GenericResponse>

    // ── Create account and forgot password ──
    //
    // Without sign-in, because they are needed before there is a token; the server
    // keeps them before requireLogin (`routes/auth.ts`).
    @GET("api/v2/auth/registration-status")
    suspend fun getRegistrationStatus(): Response<RegistrationStatusResponse>

    @POST("api/v2/auth/register")
    suspend fun register(@Body request: RegisterRequest): Response<RegisterResponse>

    @POST("api/v2/auth/forgot-password")
    suspend fun forgotPassword(@Body request: ForgotPasswordRequest): Response<ForgotPasswordResponse>

    // ── The own account ────────────────────────────────────────────────────
    @GET("api/v2/auth/profile")
    suspend fun getProfile(): Response<ProfileResponse>

    @PUT("api/v2/auth/profile")
    suspend fun updateProfile(@Body request: ProfileRequest): Response<ProfileSavedResponse>

    @POST("api/v2/auth/change-password")
    suspend fun changePassword(@Body request: PasswordChange): Response<GenericResponse>

    // Second factor. The reset by an admin is deliberately missing
    // here — user management stands only in the web app.
    @GET("api/v2/auth/second-factor")
    suspend fun secondFactorStatus(): Response<SecondFactorStateResponse>

    @POST("api/v2/auth/second-factor/setup")
    suspend fun setUpSecondFactor(@Body request: SecondFactorRequest): Response<SecondFactorSetupResponse>

    @POST("api/v2/auth/second-factor/confirm")
    suspend fun secondFactorConfirm(@Body request: SecondFactorRequest): Response<SecondFactorCodes>

    @POST("api/v2/auth/second-factor/disable")
    suspend fun disableSecondFactor(@Body request: SecondFactorRequest): Response<GenericResponse>

    @POST("api/v2/auth/second-factor/codes")
    suspend fun secondFactorNewCodes(@Body request: SecondFactorRequest): Response<SecondFactorCodes>

    @GET("api/v2/auth/me")
    suspend fun getMe(): Response<MeResponse>

    // ── Signed-in devices ────────────────────────────────────────────────────
    // Both addresses existed already; they were only session-bound and thus
    // not reachable for the app. Since the token management they take
    // session OR bearer token (requireLoginOrToken), like the rest of /api/v2.
    @GET("api/v2/settings/tokens")
    suspend fun getTokens(): Response<TokensResponse>

    // @HTTP instead of @DELETE: Retrofit allows no body for @DELETE, and the server still
    // reads a JSON body there (password and code stay empty since the login suffices).
    @HTTP(method = "DELETE", path = "api/v2/settings/tokens/{tokenId}", hasBody = true)
    suspend fun revokeToken(
        @Path("tokenId") tokenId: String,
        @Body confirmation: SecondFactorRequest,
    ): Response<TokenRevocation>

    /** All other sign-ins and app accesses in one request: a code applies only once. */
    @POST("api/v2/settings/sessions/end-others")
    suspend fun endOther(@Body request: EndOthersRequest): Response<OthersEnded>

    /**
     * Swap the token (rotation). The old one explicitly goes along because the
     * swap must also run when it has only just been replaced (data/TokenSwap).
     * A `Call` for direct execution, not `suspend`: the rejected requests
     * wait in the interceptor and occupy the dispatcher; via it the swap would never get its turn.
     */
    @POST("api/v2/auth/rotate-token")
    fun rotateToken(@Header("Authorization") bearer: String): retrofit2.Call<TokenRotation>

    /**
     * The design — without sign-in the admin's default (sign-in screen),
     * with a token the account's. The ServerGuard attaches the token.
     */
    @GET("api/v2/settings/theme")
    suspend fun getAppTheme(): Response<AppThemeResponse>

    /** Own design of the account; "" means „the admin's default“. */
    @POST("api/v2/settings/user/theme")
    suspend fun setOwnDesign(@Body body: Map<String, String>): Response<AppThemeResponse>

    @GET("api/v2/settings")
    suspend fun getSettings(): Response<SettingsResponse>

    @PUT("api/v2/settings")
    suspend fun updateSettings(
        @Body body: Map<String, String>
    ): Response<GenericResponse>

    @GET("api/v2/settings/default-condition")
    suspend fun getDefaultCondition(): Response<DefaultConditionResponse>

    // User-level default condition (each user can override).
    // Must run via /api/v2/ (bearer token) — the former
    // /api/settings/... path was session-only (requireLogin) and silently failed with a
    // token, so that the default set in the app never arrived.
    @POST("api/v2/settings/user/default-condition")
    suspend fun setUserDefaultCondition(
        @Body body: Map<String, String>
    ): Response<GenericAdminResponse>
}
