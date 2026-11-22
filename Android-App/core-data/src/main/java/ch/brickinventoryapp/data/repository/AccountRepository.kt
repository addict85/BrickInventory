package ch.brickinventoryapp.data.repository

import ch.brickinventoryapp.data.RedemptionOutcome
import ch.brickinventoryapp.data.SwappedToken
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
import ch.brickinventoryapp.model.domain.TOKEN_SCOPE_APP
import ch.brickinventoryapp.model.ui.theme.Design
import kotlinx.serialization.json.JsonObject

/**
 * The own account: sign-in, profile, settings, second factor, token.
 * An interface so that ViewModels and tests do not depend on the implementation with
 * Retrofit and store (AccountRepositoryImpl).
 */
interface AccountRepository {
    suspend fun login(serverUrl: String, username: String, password: String, code: String? = null,
                      scope: String = TOKEN_SCOPE_APP, passkey: JsonObject? = null): Outcome<LoginReply>

    suspend fun passkeyOptions(purpose: String): Outcome<JsonObject>

    suspend fun loginPasskey(serverUrl: String, response: JsonObject, scope: String = TOKEN_SCOPE_APP): Outcome<Login>

    suspend fun qrLogin(token: String, label: String): Outcome<QrPairing>
    /** [preview]: after confirmation in the browser only the account, no token yet. */
    suspend fun pickUpQr(pickup: String, preview: Boolean = false): Outcome<QrPickupState>
    /** The no after the preview: the pairing is refused afterwards. */
    suspend fun discardQr(pickup: String): Outcome<Unit>

    suspend fun getMe(): Outcome<AccountOwner?>

    suspend fun getRegistrationStatus(): Outcome<RegistrationState>

    suspend fun register(creation: AccountCreation): Outcome<Registration>

    suspend fun forgotPassword(email: String): Outcome<String?>

    suspend fun getProfile(): Outcome<ProfileView>

    suspend fun secondFactorStatus(): Outcome<SecondFactorStatus>

    suspend fun setUpSecondFactor(password: String): Outcome<SecondFactorSetup>

    suspend fun secondFactorConfirm(code: String): Outcome<List<String>>

    suspend fun disableSecondFactor(password: String, code: String): Outcome<Unit>

    suspend fun secondFactorNewCodes(code: String): Outcome<List<String>>

    suspend fun updateProfile(change: ProfileChange): Outcome<ProfileSaved>

    suspend fun changePassword(current: String, newValue: String, code: String? = null): Outcome<Unit>

    suspend fun getTokens(): Outcome<List<DeviceView>>

    /** How many tokens were invalidated; 0 if it was already gone. */
    suspend fun revokeToken(tokenId: String, confirmation: Confirmation): Outcome<Int>

    /** How many accesses were ended. */
    suspend fun endOther(confirmation: Confirmation): Outcome<Int>

    suspend fun rotateToken(oldToken: String): Outcome<SwappedToken>

    suspend fun logoutAtServer(limitMs: Long = 3_000): Boolean

    suspend fun redeemAtServer(limitMs: Long = 3_000): RedemptionOutcome

    suspend fun getSettings(): Outcome<AccountSettings>

    suspend fun getAppTheme(): Outcome<DesignState>

    suspend fun setOwnDesign(theme: Design?): Outcome<DesignState>

    suspend fun updateSettings(currency: CurrencyCode, condition: Condition): Outcome<Unit>

    suspend fun getDefaultCondition(): Outcome<Condition>

    /** null: back to the server's default. */
    suspend fun setUserDefaultCondition(condition: Condition?): Outcome<Unit>
}
