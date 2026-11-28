// Generated from Web-App/docs/openapi-v2.json by Web-App/scripts/contract-kotlin-dtos.js.
// Do not edit by hand: npm run contract:kotlin (in the Web-App folder).
@file:Suppress("ConstructorParameterNaming", "MatchingDeclarationName", "LongParameterList")
@file:OptIn(ExperimentalSerializationApi::class)

package ch.brickinventoryapp.contract

import ch.brickinventoryapp.model.domain.TOKEN_SCOPE_APP
import kotlinx.serialization.EncodeDefault
import kotlinx.serialization.ExperimentalSerializationApi
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonObject

@Serializable
data class AccountActive(
    @SerialName("success") val success: Boolean,
    @SerialName("is_active") val isActive: Boolean,
    @SerialName("effective_at") val effectiveAt: String = "",
)

@Serializable
data class AccountInList(
    @SerialName("id") val id: Int,
    @SerialName("username") val username: String,
    @SerialName("is_admin") val isAdmin: Boolean,
    @SerialName("is_active") val isActive: Boolean,
    @SerialName("created_at") val createdAt: String?,
    @SerialName("second_factor") val secondFactor: Boolean,
    @SerialName("awaiting_confirmation") val awaitingConfirmation: Boolean,
    @SerialName("announced") val announced: List<AccountInListAnnouncedEntry>,
)

@Serializable
data class AccountInListAnnouncedEntry(
    @SerialName("type") val type: String,
    @SerialName("effective_at") val effectiveAt: String,
)

@Serializable
data class AccountList(
    @SerialName("success") val success: Boolean,
    @SerialName("users") val users: List<AccountInList>,
)

@Serializable
data class AppToken(
    @SerialName("token_id") val tokenId: String,
    @SerialName("label") val label: String?,
    @SerialName("created_at") val createdAt: String?,
    @SerialName("last_used") val lastUsed: String?,
    @SerialName("expires_at") val expiresAt: String?,
    @SerialName("never_expires") val neverExpires: Boolean,
    @SerialName("current") val current: Boolean,
    @SerialName("token_prefix") val tokenPrefix: String?,
    @SerialName("hard_expires_at") val hardExpiresAt: String?,
    @SerialName("scope") val scope: String,
    @SerialName("ip_range") val ipRange: String?,
    @SerialName("rotated_at") val rotatedAt: String,
)

@Serializable
data class Deleted(
    @SerialName("success") val success: Boolean,
    @SerialName("deleted") val deleted: Int,
)

@Serializable
data class EmailPreview(
    @SerialName("success") val success: Boolean,
    @SerialName("username") val username: String,
)

@Serializable
data class EndOthersRequest(
    @SerialName("accesses") val accesses: Boolean = true,
    @SerialName("password") val password: String? = null,
    @SerialName("code") val code: String? = null,
    @SerialName("passkey") @EncodeDefault(EncodeDefault.Mode.NEVER) val passkey: JsonObject? = null,
)

@Serializable
data class ForgotPasswordRequest(
    @SerialName("email") val email: String,
)

@Serializable
data class ForgotPasswordResponse(
    @SerialName("success") val success: Boolean,
    @SerialName("message") val message: String?,
    @SerialName("error") val error: String? = null,
)

@Serializable
data class LoginRequest(
    @SerialName("username") val username: String,
    @SerialName("password") val password: String,
    @SerialName("code") @EncodeDefault(EncodeDefault.Mode.NEVER) val code: String? = null,
    @SerialName("without_token") @EncodeDefault(EncodeDefault.Mode.NEVER) val withoutToken: Boolean? = null,
    @SerialName("label") val label: String = "Android App",
    @SerialName("never_expires") val neverExpires: Boolean = false,
    @SerialName("scope") val scope: String = TOKEN_SCOPE_APP,
    @SerialName("passkey") @EncodeDefault(EncodeDefault.Mode.NEVER) val passkey: JsonObject? = null,
)

@Serializable
data class LoginResponse(
    @SerialName("success") val success: Boolean,
    @SerialName("token") val token: String? = null,
    @SerialName("user") val user: User? = null,
    @SerialName("error") val error: String? = null,
    @SerialName("second_factor") val secondFactor: Boolean = false,
    @SerialName("never_expires") val neverExpires: Boolean,
    @SerialName("token_info") val tokenInfo: TokenInfo? = null,
    @SerialName("cookie_missing") val cookieMissing: Boolean,
)

@Serializable
data class MeResponse(
    @SerialName("success") val success: Boolean,
    @SerialName("loggedIn") val loggedIn: Boolean,
    @SerialName("user") val user: User? = null,
    @SerialName("token_expires") val tokenExpires: String? = null,
    @SerialName("token_last_used") val tokenLastUsed: String? = null,
    @SerialName("token_info") val tokenInfo: TokenInfo? = null,
)

@Serializable
data class OthersEnded(
    @SerialName("success") val success: Boolean,
    @SerialName("deleted") val deleted: Int,
    @SerialName("accesses") val accesses: Int = 0,
)

@Serializable
data class Passkey(
    @SerialName("id") val id: Int,
    @SerialName("name") val name: String?,
    @SerialName("transports") val transports: String?,
    @SerialName("created_at") val createdAt: String,
    @SerialName("last_used") val lastUsed: String?,
)

@Serializable
data class PasskeyCreated(
    @SerialName("success") val success: Boolean,
    @SerialName("passkey") val passkey: PasskeyCreatedPasskey,
)

@Serializable
data class PasskeyCreatedPasskey(
    @SerialName("id") val id: Int,
    @SerialName("name") val name: String,
)

@Serializable
data class PasskeyList(
    @SerialName("success") val success: Boolean,
    @SerialName("available") val available: Boolean,
    @SerialName("passkeys") val passkeys: List<Passkey>,
)

@Serializable
data class PasskeyLoginRequest(
    @SerialName("response") @EncodeDefault(EncodeDefault.Mode.NEVER) val response: JsonObject? = null,
    @SerialName("with_token") val withToken: Boolean = true,
    @SerialName("label") val label: String = "Android App",
    @SerialName("never_expires") val neverExpires: Boolean = false,
    @SerialName("scope") val scope: String = TOKEN_SCOPE_APP,
)

@Serializable
data class PasskeyOptions(
    @SerialName("success") val success: Boolean,
    @SerialName("options") val options: JsonObject,
)

@Serializable
data class PasskeyOptionsRequest(
    @SerialName("purpose") val purpose: String,
)

@Serializable
data class PasswordChange(
    @SerialName("newPassword") val newPassword: String,
    @SerialName("passkeys_revoked") @EncodeDefault(EncodeDefault.Mode.NEVER) val passkeysRevoked: Boolean? = null,
    @SerialName("current") val current: String,
    @SerialName("code") val code: String? = null,
    @SerialName("passkey") @EncodeDefault(EncodeDefault.Mode.NEVER) val passkey: JsonObject? = null,
)

@Serializable
data class PasswordSet(
    @SerialName("success") val success: Boolean,
    @SerialName("effective_at") val effectiveAt: String = "",
)

@Serializable
data class Profile(
    @SerialName("id") val id: Int,
    @SerialName("username") val username: String,
    @SerialName("email") val email: String?,
    @SerialName("first_name") val firstName: String?,
    @SerialName("last_name") val lastName: String?,
    @SerialName("email_verified") val emailVerified: Boolean,
    @SerialName("new_email") val newEmail: String?,
)

@Serializable
data class ProfileRequest(
    @SerialName("username") val username: String,
    @SerialName("email") val email: String,
    @SerialName("first_name") val firstName: String? = null,
    @SerialName("last_name") val lastName: String? = null,
    @SerialName("password") @EncodeDefault(EncodeDefault.Mode.NEVER) val password: String? = null,
    @SerialName("password_current") val passwordCurrent: String? = null,
    @SerialName("code") val code: String? = null,
    @SerialName("passkey") @EncodeDefault(EncodeDefault.Mode.NEVER) val passkey: JsonObject? = null,
)

@Serializable
data class ProfileResponse(
    @SerialName("success") val success: Boolean,
    @SerialName("user") val user: Profile?,
    @SerialName("error") val error: String? = null,
)

@Serializable
data class ProfileSavedResponse(
    @SerialName("success") val success: Boolean,
    @SerialName("emailChanged") val emailChanged: Boolean? = null,
    @SerialName("emailSent") val emailSent: Boolean? = null,
)

@Serializable
data class QrCollectRequest(
    @SerialName("pickup") val pickup: String,
    @SerialName("preview") val preview: Boolean = false,
)

@Serializable
data class QrDiscard(
    @SerialName("pickup") val pickup: String,
)

@Serializable
data class QrLoginRequest(
    @SerialName("token") val token: String,
    @SerialName("label") val label: String = "Android App",
)

@Serializable
data class QrMessage(
    @SerialName("success") val success: Boolean,
    @SerialName("waiting") val waiting: Boolean,
    @SerialName("pickup") val pickup: String,
    @SerialName("code") val code: String,
    @SerialName("expires_in") val expiresIn: Int,
)

@Serializable
data class QrPairingState(
    @SerialName("success") val success: Boolean,
    @SerialName("state") val state: String,
    @SerialName("device") val device: String?,
    @SerialName("ip_range") val ipRange: String?,
)

@Serializable
data class QrPickup(
    @SerialName("success") val success: Boolean,
    @SerialName("token") val token: String? = null,
    @SerialName("user") val user: User? = null,
    @SerialName("error") val error: String? = null,
    @SerialName("second_factor") val secondFactor: Boolean = false,
    @SerialName("never_expires") val neverExpires: Boolean = false,
    @SerialName("token_info") val tokenInfo: TokenInfo? = null,
    @SerialName("waiting") val waiting: Boolean,
    @SerialName("username") val username: String? = null,
    @SerialName("isAdmin") val isAdmin: Boolean = false,
    @SerialName("userId") val userId: Int = 0,
    @SerialName("preview") val preview: Boolean = false,
    @SerialName("key_nonce") val keyNonce: String? = null,
)

@Serializable
data class QrToken(
    @SerialName("success") val success: Boolean,
    @SerialName("token") val token: String,
    @SerialName("pairing") val pairing: Int,
    @SerialName("expires_in") val expiresIn: Int,
    @SerialName("url") val url: String,
    @SerialName("token_days") val tokenDays: Int?,
    @SerialName("fp") val fp: String = "",
    @SerialName("cert_sha256") val certSha256: String = "",
)

@Serializable
data class RegisterRequest(
    @SerialName("username") val username: String,
    @SerialName("email") val email: String,
    @SerialName("first_name") val firstName: String? = null,
    @SerialName("last_name") val lastName: String? = null,
    @SerialName("password") val password: String,
    @SerialName("language") val language: String = "de",
)

@Serializable
data class RegisterResponse(
    @SerialName("success") val success: Boolean,
    @SerialName("message") val message: String,
    @SerialName("email_sent") val emailSent: Boolean,
    @SerialName("console_mode") val consoleMode: Boolean,
    @SerialName("error") val error: String? = null,
)

@Serializable
data class RegistrationStatusResponse(
    @SerialName("enabled") val enabled: Boolean,
    @SerialName("passkey") val passkey: Boolean = false,
    @SerialName("forgot_password") val forgotPassword: Boolean = false,
    @SerialName("mail_delivery") val mailDelivery: Boolean = false,
)

@Serializable
data class SecondFactorCodes(
    @SerialName("success") val success: Boolean,
    @SerialName("codes") val codes: List<String>,
    @SerialName("error") val error: String? = null,
)

@Serializable
data class SecondFactorSetupResponse(
    @SerialName("success") val success: Boolean,
    @SerialName("secret") val secret: String?,
    @SerialName("otpauth") val otpauth: String?,
    @SerialName("error") val error: String? = null,
)

@Serializable
data class SecondFactorStateResponse(
    @SerialName("success") val success: Boolean,
    @SerialName("active") val active: Boolean,
    @SerialName("codes_left") val codesLeft: Int,
    @SerialName("old_codes_until") val oldCodesUntil: String?,
    @SerialName("error") val error: String? = null,
)

@Serializable
data class TokenCreated(
    @SerialName("success") val success: Boolean,
    @SerialName("token") val token: String,
    @SerialName("label") val label: String?,
    @SerialName("never_expires") val neverExpires: Boolean,
    @SerialName("token_info") val tokenInfo: TokenInfo?,
)

@Serializable
data class TokenInfo(
    @SerialName("scope") val scope: String,
    @SerialName("expires_at") val expiresAt: String? = null,
    @SerialName("hard_expires_at") val hardExpiresAt: String?,
    @SerialName("never_expires") val neverExpires: Boolean,
    @SerialName("rotated_at") val rotatedAt: String? = null,
    @SerialName("rotation_due") val rotationDue: Boolean = false,
)

@Serializable
data class TokenRevocation(
    @SerialName("success") val success: Boolean,
    @SerialName("deleted") val deleted: Int,
)

@Serializable
data class TokenRotation(
    @SerialName("success") val success: Boolean,
    @SerialName("token") val token: String?,
    @SerialName("token_info") val tokenInfo: TokenInfo?,
    @SerialName("old_valid_until") val oldValidUntil: String?,
    @SerialName("overlap_seconds") val overlapSeconds: Int?,
)

@Serializable
data class TokensResponse(
    @SerialName("success") val success: Boolean,
    @SerialName("tokens") val tokens: List<AppToken>,
    @SerialName("error") val error: String? = null,
)

@Serializable
data class User(
    @SerialName("id") val id: Int,
    @SerialName("username") val username: String,
    @SerialName("is_admin") val isAdmin: Boolean = false,
    @SerialName("mustChangePassword") val mustChangePassword: Boolean = false,
    @SerialName("secondFactorRequired") val secondFactorRequired: Boolean = false,
)
