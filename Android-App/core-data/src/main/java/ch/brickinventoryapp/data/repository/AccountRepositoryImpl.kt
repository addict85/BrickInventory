package ch.brickinventoryapp.data.repository

import ch.brickinventoryapp.contract.AndereBeendenAnfrage
import ch.brickinventoryapp.contract.ForgotPasswordRequest
import ch.brickinventoryapp.contract.LoginRequest
import ch.brickinventoryapp.contract.LoginResponse
import ch.brickinventoryapp.contract.PasskeyAnmeldungAnfrage
import ch.brickinventoryapp.contract.PasskeyOptionenAnfrage
import ch.brickinventoryapp.contract.PasswortAenderung
import ch.brickinventoryapp.contract.ProfilAenderung
import ch.brickinventoryapp.contract.QrAbholRequest
import ch.brickinventoryapp.contract.QrLoginRequest
import ch.brickinventoryapp.contract.QrVerwerfen
import ch.brickinventoryapp.contract.RegisterRequest
import ch.brickinventoryapp.contract.ZweiterFaktorAnfrage
import ch.brickinventoryapp.contract.mapping.admin
import ch.brickinventoryapp.contract.mapping.asDevice
import ch.brickinventoryapp.contract.mapping.asView
import ch.brickinventoryapp.data.RedemptionOutcome
import ch.brickinventoryapp.data.SwappedToken
import ch.brickinventoryapp.data.api.AccountApi
import ch.brickinventoryapp.data.classifyRedemption
import ch.brickinventoryapp.model.coroutines.BrickDispatchers
import ch.brickinventoryapp.model.coroutines.Dispatcher
import ch.brickinventoryapp.model.domain.AccountCreation
import ch.brickinventoryapp.model.domain.AccountOwner
import ch.brickinventoryapp.model.domain.AccountSettings
import ch.brickinventoryapp.model.domain.Condition
import ch.brickinventoryapp.model.domain.Confirmation
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
import ch.brickinventoryapp.model.ui.theme.Design
import ch.brickinventoryapp.model.util.catchUnlessCancelled
import ch.brickinventoryapp.model.util.parseInstant
import ch.brickinventoryapp.network.util.AppLog
import ch.brickinventoryapp.network.util.NetworkPolicy
import kotlinx.coroutines.CoroutineDispatcher
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
class AccountRepositoryImpl @Inject constructor(
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
     * success=false (like VouchersRepository.guthaben), otherwise
     * flag and sentence would be lost in safeCall. [passkey] replaces the code.
     */
    override suspend fun login(serverUrl: String, username: String, password: String, code: String?,
                      scope: String, passkey: JsonObject?): Outcome<LoginReply> {
        var routes = SecondFactorRoutes()
        val r = safeCall {
            // never_expires means „persistent up to the server's maximum lifetime“ (TOKEN_MAX_DAYS,
            // default 90), not „without an end“: the server caps it, the app signs out itself.
            val https = NetworkPolicy.isHttps(serverUrl)
            val response = if (passkey != null)
                api.loginWithPasskey(LoginRequest(username = username, password = password, passkey = passkey, scope = scope, neverExpires = https))
            else api.login(LoginRequest(username = username, password = password, code = code, scope = scope, neverExpires = https))
            if (response.code() == 401) {
                val body = response.errorBody()?.string()
                val parsed = body?.let { runCatching { json.decodeFromString<LoginResponse>(it) }.getOrNull() }
                body?.let { runCatching { json.decodeFromString<SecondFactorRoutes>(it) }.getOrNull() }?.let { routes = it }
                if (parsed?.zweiterFaktor == true) retrofit2.Response.success(parsed) else response
            } else response
        }
        return when (r) {
            is Outcome.Success -> Outcome.Success(LoginReply(r.data.asLogin(), routes.passkey), state = r.state, buffered = r.buffered)
            is Outcome.Failure -> r
        }
    }

    /** The options for the Credential Manager; [purpose] like PASSKEY_SIGN_IN. */
    override suspend fun passkeyOptions(purpose: String): Outcome<JsonObject> =
        safeCall { api.passkeyOptions(PasskeyOptionenAnfrage(zweck = purpose)) }.mapData { it.optionen }

    /** Without a password; the same token as with [login], with the same rules for expiry. */
    override suspend fun loginPasskey(serverUrl: String, response: JsonObject, scope: String): Outcome<Login> =
        safeCall { api.loginPasskey(PasskeyAnmeldungAnfrage(antwort = response, scope = scope,
            neverExpires = NetworkPolicy.isHttps(serverUrl))) }.mapData { it.asLogin() }

    override suspend fun qrLogin(token: String, label: String): Outcome<QrPairing> =
        safeCall { api.qrLogin(QrLoginRequest(token = token, label = label)) }
            .promised({ it.success && it.abholung.isNotEmpty() && it.code.isNotEmpty() }, { null }) {
                QrPairing(it.abholung, it.code, it.expiresIn)
            }

    override suspend fun pickUpQr(pickup: String, preview: Boolean): Outcome<QrPickupState> =
        safeCall { api.pickUpQr(QrAbholRequest(abholung = pickup, vorschau = preview)) }.mapData {
            QrPickupState(token = it.token, user = it.username ?: it.user?.username, waiting = it.wartet,
                preview = it.vorschau, error = it.error)
        }

    override suspend fun discardQr(pickup: String): Outcome<Unit> =
        safeCall { api.discardQr(QrVerwerfen(abholung = pickup)) }.withoutContent()

    override suspend fun getMe(): Outcome<AccountOwner?> = safeCall { api.getMe() }.mapData { r ->
        r.user?.let { AccountOwner(it.id, it.username, it.isAdmin, it.zweiterFaktorPflicht, parseInstant(r.tokenInfo?.hardExpiresAt)) }
    }

    // Create account and forgot password — both without an existing sign-in.
    override suspend fun getRegistrationStatus(): Outcome<RegistrationState> =
        safeCall { api.getRegistrationStatus() }.mapData {
            RegistrationState(it.enabled, it.passkey, it.passwortVergessen, it.mailVersand)
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
        safeCall { api.secondFactorStatus() }.promised({ it.success }, { it.error }) { SecondFactorStatus(it.aktiv, it.codesUebrig) }

    override suspend fun setUpSecondFactor(password: String): Outcome<SecondFactorSetup> =
        safeCall { api.setUpSecondFactor(ZweiterFaktorAnfrage(password = password)) }
            .promised({ it.success }, { it.error }) { SecondFactorSetup(it.geheimnis, it.otpauth) }

    override suspend fun secondFactorConfirm(code: String): Outcome<List<String>> =
        safeCall { api.secondFactorConfirm(ZweiterFaktorAnfrage(code = code)) }.promised({ it.success }, { it.error }) { it.codes }

    override suspend fun disableSecondFactor(password: String, code: String): Outcome<Unit> =
        safeCall { api.disableSecondFactor(ZweiterFaktorAnfrage(password = password, code = code)) }.done()

    override suspend fun secondFactorNewCodes(code: String): Outcome<List<String>> =
        safeCall { api.secondFactorNewCodes(ZweiterFaktorAnfrage(code = code)) }.promised({ it.success }, { it.error }) { it.codes }

    override suspend fun updateProfile(change: ProfileChange): Outcome<ProfileSaved> =
        safeCall {
            api.updateProfile(ProfilAenderung(username = change.user, email = change.email, firstName = change.firstName,
                lastName = change.lastName, passwordCurrent = change.passwordCurrent, code = change.code))
        }.promised({ it.success }) { ProfileSaved(newAddress = it.emailChanged == true, mailSent = it.emailSent == true) }

    override suspend fun changePassword(current: String, newValue: String, code: String?): Outcome<Unit> =
        safeCall { api.changePassword(PasswortAenderung(current = current, newPassword = newValue, code = code)) }.done()

    override suspend fun getTokens(): Outcome<List<DeviceView>> =
        safeCall { api.getTokens() }.promised({ it.success }, { it.error }) { r -> r.tokens.map { it.asDevice() } }

    override suspend fun revokeToken(tokenId: String, confirmation: Confirmation): Outcome<Int> =
        safeCall { api.revokeToken(tokenId, confirmation.asRequest()) }.mapData { it.deleted }

    override suspend fun endOther(confirmation: Confirmation): Outcome<Int> =
        safeCall { api.endOther(AndereBeendenAnfrage(password = confirmation.password, code = confirmation.code)) }
            .mapData { it.zugaenge }

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
     * network. What is then still open is caught up by data/Abmeldung.
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
            AccountSettings(e.currency, e.priceCondition, e.defaultPriceCondition, e.effectiveCondition)
        }

    /** The effective design: with a token the account's, otherwise the default. See AccountApi.getAppTheme. */
    override suspend fun getAppTheme(): Outcome<DesignState> =
        safeCall { api.getAppTheme() }.promised({ it.success }) { DesignState(it.theme, it.vorgabe, it.eigenes) }

    /** Set the own design; null resets to the admin's default ("" on the wire). */
    override suspend fun setOwnDesign(theme: Design?): Outcome<DesignState> =
        safeCall { api.setOwnDesign(mapOf("theme" to (theme?.identifier ?: ""))) }
            .promised({ it.success }) { DesignState(it.theme, it.vorgabe, it.eigenes) }

    override suspend fun updateSettings(currency: CurrencyCode, condition: Condition): Outcome<Unit> =
        safeCall { api.updateSettings(mapOf("currency" to currency.code, "price_condition" to condition.identifier)) }.done()

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
        secondFactor = zweiterFaktor, error = error)

private fun Confirmation.asRequest() = ZweiterFaktorAnfrage(password = password, code = code)

/** From the 401 response to the second factor: does a passkey work instead of the code? Not in the contract (the error carries extra fields freely). */
@Serializable
private data class SecondFactorRoutes(val passkey: Boolean = false)
