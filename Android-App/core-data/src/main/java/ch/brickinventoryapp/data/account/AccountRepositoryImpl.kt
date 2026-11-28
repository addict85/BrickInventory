package ch.brickinventoryapp.data.account

import ch.brickinventoryapp.contract.EndOthersRequest
import ch.brickinventoryapp.contract.ForgotPasswordRequest
import ch.brickinventoryapp.contract.LoginRequest
import ch.brickinventoryapp.contract.LoginResponse
import ch.brickinventoryapp.contract.PasskeyLoginRequest
import ch.brickinventoryapp.contract.PasskeyOptionsRequest
import ch.brickinventoryapp.contract.PasswordChange
import ch.brickinventoryapp.contract.ProfileRequest
import ch.brickinventoryapp.contract.QrCollectRequest
import ch.brickinventoryapp.contract.QrDiscard
import ch.brickinventoryapp.contract.QrLoginRequest
import ch.brickinventoryapp.contract.RegisterRequest
import ch.brickinventoryapp.contract.SecondFactorRequest
import ch.brickinventoryapp.contract.mapping.admin
import ch.brickinventoryapp.contract.mapping.asDevice
import ch.brickinventoryapp.contract.mapping.asView
import ch.brickinventoryapp.data.RedemptionOutcome
import ch.brickinventoryapp.data.SwappedToken
import ch.brickinventoryapp.data.api.AccountApi
import ch.brickinventoryapp.data.classifyRedemption
import ch.brickinventoryapp.data.repository.done
import ch.brickinventoryapp.data.repository.mapData
import ch.brickinventoryapp.data.repository.promised
import ch.brickinventoryapp.data.repository.safeCall
import ch.brickinventoryapp.data.repository.withoutContent
import ch.brickinventoryapp.model.appearance.Design
import ch.brickinventoryapp.model.coroutines.BrickDispatchers
import ch.brickinventoryapp.model.coroutines.Dispatcher
import ch.brickinventoryapp.model.domain.AccountCreation
import ch.brickinventoryapp.model.domain.AccountOwner
import ch.brickinventoryapp.model.domain.AccountSettings
import ch.brickinventoryapp.model.domain.Condition
import ch.brickinventoryapp.model.domain.CurrencyCode
import ch.brickinventoryapp.model.domain.DesignState
import ch.brickinventoryapp.model.domain.DeviceView
import ch.brickinventoryapp.model.domain.Login
import ch.brickinventoryapp.model.domain.ProfileChange
import ch.brickinventoryapp.model.domain.ProfileSaved
import ch.brickinventoryapp.model.domain.ProfileView
import ch.brickinventoryapp.model.domain.QrPairing
import ch.brickinventoryapp.model.domain.QrPickupState
import ch.brickinventoryapp.model.domain.Registration
import ch.brickinventoryapp.model.domain.RegistrationState
import ch.brickinventoryapp.model.domain.SecondFactorSetup
import ch.brickinventoryapp.model.domain.SecondFactorStatus
import ch.brickinventoryapp.model.json.BrickJson
import ch.brickinventoryapp.model.outcome.Outcome
import ch.brickinventoryapp.model.util.catchUnlessCancelled
import ch.brickinventoryapp.model.util.parseInstant
import ch.brickinventoryapp.network.util.AppLog
import ch.brickinventoryapp.network.util.NetworkPolicy
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.decodeFromString
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Sign-in and the own account: profile, password, second factor, devices, design and settings — via Retrofit; the common fetch logic stands in Fetch.kt.
 */
@Singleton
internal class AccountRepositoryImpl @Inject constructor(
    private val api: AccountApi,
    /** For the blocking swap. */
    @param:Dispatcher(BrickDispatchers.IO) private val io: CoroutineDispatcher,
    private val json: Json = BrickJson,
) : AccountRepository {

    // No Authorization header here: the OkHttp interceptor in di/ServerClient.kt
    // sets "Bearer <token>" for all requests to our server (from the
    // in-memory mirror of the TokenStore), also for the SSE streams.

    /**
     * If the server requires the second factor, it answers with 401 and
     * `zweiter_faktor: true`. That is bent here into an ordinary response with
     * success=false (like the voucher balance), otherwise
     * flag and sentence would be lost in safeCall. [passkey] replaces the code.
     */
    override suspend fun login(serverUrl: String, username: String, password: String, code: String?,
                      scope: String, passkey: JsonObject?): Outcome<LoginReply> {
        var routes = SecondFactorRefusal()
        val r = safeCall {
            // never_expires means „persistent up to the server's maximum lifetime“ (TOKEN_MAX_DAYS,
            // default 90), not „without an end“: the server caps it, the app signs out itself.
            val https = NetworkPolicy.isHttps(serverUrl)
            val response = if (passkey != null)
                api.loginWithPasskey(LoginRequest(username = username, password = password, passkey = passkey, scope = scope, neverExpires = https))
            else api.login(LoginRequest(username = username, password = password, code = code, scope = scope, neverExpires = https))
            if (response.code() == 401) {
                val body = response.errorBody()?.string()
                body?.let { runCatching { json.decodeFromString<SecondFactorRefusal>(it) }.getOrNull() }?.let { routes = it }
                if (routes.secondFactor) retrofit2.Response.success(routes.asLoginResponse()) else response
            } else response
        }
        return when (r) {
            is Outcome.Success -> Outcome.Success(LoginReply(r.data.asLogin(), routes.passkey), state = r.state, buffered = r.buffered)
            is Outcome.Failure -> r
        }
    }

    /** The options for the Credential Manager; [purpose] like PASSKEY_SIGN_IN. */
    override suspend fun passkeyOptions(purpose: String): Outcome<JsonObject> =
        safeCall { api.passkeyOptions(PasskeyOptionsRequest(purpose = purpose)) }.mapData { it.options }

    /** Without a password; the same token as with [login], with the same rules for expiry. */
    override suspend fun loginPasskey(serverUrl: String, response: JsonObject, scope: String): Outcome<Login> =
        safeCall { api.loginPasskey(PasskeyLoginRequest(response = response, scope = scope,
            neverExpires = NetworkPolicy.isHttps(serverUrl))) }.mapData { it.asLogin() }

    override suspend fun qrLogin(token: String, label: String): Outcome<QrPairing> =
        safeCall { api.qrLogin(QrLoginRequest(token = token, label = label)) }
            .promised({ it.success && it.pickup.isNotEmpty() && it.code.isNotEmpty() }, { null }) {
                QrPairing(it.pickup, it.code, it.expiresIn)
            }

    override suspend fun pickUpQr(pickup: String, preview: Boolean): Outcome<QrPickupState> =
        safeCall { api.pickUpQr(QrCollectRequest(pickup = pickup, preview = preview)) }.mapData {
            QrPickupState(token = it.token, user = it.username ?: it.user?.username, waiting = it.waiting,
                preview = it.preview, error = it.error)
        }

    override suspend fun discardQr(pickup: String): Outcome<Unit> =
        safeCall { api.discardQr(QrDiscard(pickup = pickup)) }.withoutContent()

    override suspend fun getMe(): Outcome<AccountOwner?> = safeCall { api.getMe() }.mapData { r ->
        r.user?.let { AccountOwner(it.id, it.username, it.isAdmin, it.secondFactorRequired, parseInstant(r.tokenInfo?.hardExpiresAt)) }
    }

    // Create account and forgot password — both without an existing sign-in.
    override suspend fun getRegistrationStatus(): Outcome<RegistrationState> =
        safeCall { api.getRegistrationStatus() }.mapData {
            RegistrationState(it.enabled, it.passkey, it.forgotPassword, it.mailDelivery)
        }

    override suspend fun register(creation: AccountCreation): Outcome<Registration> =
        safeCall {
            api.register(RegisterRequest(username = creation.user, email = creation.email, firstName = creation.firstName,
                lastName = creation.lastName, password = creation.password, language = creation.language))
        }.promised({ it.success }, { it.error }) { Registration(it.message, it.consoleMode) }

    override suspend fun forgotPassword(email: String): Outcome<String?> =
        safeCall { api.forgotPassword(ForgotPasswordRequest(email = email)) }.promised({ it.success }, { it.error }) { it.message }

    override suspend fun getProfile(): Outcome<ProfileView> =
        safeCall { api.getProfile() }.promised({ it.user != null }, { it.error }) { it.user!!.asView() }

    override suspend fun secondFactorStatus(): Outcome<SecondFactorStatus> =
        safeCall { api.secondFactorStatus() }.promised({ it.success }, { it.error }) { SecondFactorStatus(it.active, it.codesLeft) }

    override suspend fun setUpSecondFactor(password: String?): Outcome<SecondFactorSetup> =
        safeCall { api.setUpSecondFactor(SecondFactorRequest(password = password)) }
            .promised({ it.success }, { it.error }) { SecondFactorSetup(it.secret, it.otpauth) }

    override suspend fun secondFactorConfirm(code: String): Outcome<List<String>> =
        safeCall { api.secondFactorConfirm(SecondFactorRequest(code = code)) }.promised({ it.success }, { it.error }) { it.codes }

    override suspend fun disableSecondFactor(): Outcome<Unit> =
        safeCall { api.disableSecondFactor(SecondFactorRequest()) }.done()

    override suspend fun secondFactorNewCodes(): Outcome<List<String>> =
        safeCall { api.secondFactorNewCodes(SecondFactorRequest()) }.promised({ it.success }, { it.error }) { it.codes }

    override suspend fun updateProfile(change: ProfileChange): Outcome<ProfileSaved> =
        safeCall {
            api.updateProfile(ProfileRequest(username = change.user, email = change.email, firstName = change.firstName,
                lastName = change.lastName))
        }.promised({ it.success }) { ProfileSaved(newAddress = it.emailChanged == true, mailSent = it.emailSent == true) }

    override suspend fun changePassword(current: String, newValue: String, code: String?): Outcome<Unit> =
        safeCall { api.changePassword(PasswordChange(current = current, newPassword = newValue, code = code)) }.done()

    override suspend fun getTokens(): Outcome<List<DeviceView>> =
        safeCall { api.getTokens() }.promised({ it.success }, { it.error }) { r -> r.tokens.map { it.asDevice() } }

    override suspend fun revokeToken(tokenId: String): Outcome<Int> =
        safeCall { api.revokeToken(tokenId, SecondFactorRequest()) }.mapData { it.deleted }

    override suspend fun endOther(): Outcome<Int> =
        safeCall { api.endOther(EndOthersRequest()) }
            .mapData { it.accesses }

    /**
     * Swap the token; [oldToken] explicitly goes along (see data/TokenSwap).
     * Synchronous on an IO thread, bypassing OkHttp's dispatcher (AccountApi.rotateToken).
     * The origin comes from the request that actually went: the new token is bound only to it.
     */
    override suspend fun rotateToken(oldToken: String): Outcome<SwappedToken> {
        var origin: String? = null
        val r = safeCall {
            kotlinx.coroutines.withContext(io) { api.rotateToken("Bearer $oldToken").execute() }
                .also { origin = NetworkPolicy.origin(it.raw().request.url.toString()) }
        }
        return when (r) {
            is Outcome.Success -> Outcome.Success(SwappedToken(r.data.token, origin), state = r.state, buffered = r.buffered)
            is Outcome.Failure -> r
        }
    }

    /**
     * Invalidate the token at the server before it disappears locally — otherwise it would stay
     * valid until it expires. At most [limitMs]: sign-out must not depend on the
     * network. What is then still open is caught up by data/Redemption.
     */
    override suspend fun logoutAtServer(limitMs: Long): Boolean =
        redeemAtServer(limitMs) == RedemptionOutcome.REDEEMED

    /** Like [logoutAtServer], but with the reason: only LATER makes a retry worthwhile. */
    override suspend fun redeemAtServer(limitMs: Long): RedemptionOutcome = catchUnlessCancelled {
        kotlinx.coroutines.withTimeoutOrNull(limitMs) { classifyRedemption(api.logout().code()) }
            ?: RedemptionOutcome.LATER.also {
                AppLog.warning("Abmelden", "Server antwortete nicht in $limitMs ms")
            }
    }.getOrElse { e ->
        AppLog.warning("Abmelden", "Token am Server nicht entwertet", e)
        RedemptionOutcome.LATER
    }

    override suspend fun getSettings(): Outcome<AccountSettings> =
        safeCall { api.getSettings() }.mapData {
            val e = it.settings
            AccountSettings(e.currency, e.priceCondition, e.defaultPriceCondition, e.effectiveCondition,
                e.removeEmptyVouchers)
        }

    /** The effective design: with a token the account's, otherwise the default. See AccountApi.getAppTheme. */
    override suspend fun getAppTheme(): Outcome<DesignState> =
        safeCall { api.getAppTheme() }.promised({ it.success }) { DesignState(it.theme, it.preset, it.own) }

    /** Set the own design; null resets to the admin's default ("" on the wire). */
    override suspend fun setOwnDesign(theme: Design?): Outcome<DesignState> =
        safeCall { api.setOwnDesign(mapOf("theme" to (theme?.identifier ?: ""))) }
            .promised({ it.success }) { DesignState(it.theme, it.preset, it.own) }

    override suspend fun updateSettings(currency: CurrencyCode, condition: Condition): Outcome<Unit> =
        safeCall { api.updateSettings(mapOf("currency" to currency.code, "price_condition" to condition.identifier)) }.done()

    /** Stored as "1"/"0" like every switch of the web app; the server checks the value. */
    override suspend fun setRemoveEmptyVouchers(on: Boolean): Outcome<Unit> =
        safeCall { api.updateSettings(mapOf("remove_empty_vouchers" to if (on) "1" else "0")) }.done()

    override suspend fun getDefaultCondition(): Outcome<Condition> = safeCall { api.getDefaultCondition() }.mapData { it.condition }

    // User-level: saves per-user default (empty string = revert to global)
    override suspend fun setUserDefaultCondition(condition: Condition?): Outcome<Unit> =
        safeCall { api.setUserDefaultCondition(mapOf("condition" to condition?.identifier.orEmpty())) }.promised({ it.success }) { }
}

/** The response to [AccountRepository.login]; [passkeyInsteadOfCode] if the server also
 * takes a passkey for the second factor. */
data class LoginReply(val response: Login, val passkeyInsteadOfCode: Boolean = false)

private fun LoginResponse.asLogin() =
    Login(success = success, token = token, user = user?.username, admin = admin,
        secondFactor = secondFactor, error = error)

/**
 * The 401 response to a missing second factor: an error body with extra fields, not a LoginResponse
 * (that one requires never_expires and cookie_missing, which a refusal does not carry). Not in the
 * contract: the error carries extra fields freely. [passkey]: a passkey works instead of the code.
 */
@Serializable
private data class SecondFactorRefusal(
    @SerialName("second_factor") val secondFactor: Boolean = false,
    val passkey: Boolean = false,
    val error: String? = null,
) {
    fun asLoginResponse() = LoginResponse(success = false, error = error, secondFactor = true, neverExpires = false, cookieMissing = false)
}
