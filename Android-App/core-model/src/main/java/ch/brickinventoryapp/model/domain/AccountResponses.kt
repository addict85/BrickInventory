package ch.brickinventoryapp.model.domain

import ch.brickinventoryapp.model.ui.theme.Design
import java.time.Instant

// What the account repository delivers, in domain values: the areas read no field of the
// wire format, and a rename on the server breaks only the mapping in core-data.

/**
 * The response to a sign-in. [admin] applies only with a full token; [error] is the
 * server's sentence, e.g. on a wrong code.
 */
data class Login(
    val success: Boolean,
    val token: String? = null,
    val user: String? = null,
    val admin: Boolean = false,
    val secondFactor: Boolean = false,
    val error: String? = null,
)

/**
 * Who is signed in, as the server sees it. [tokenEndsAt]: the token's hard end from /auth/me
 * (token_info.hard_expires_at, ISO instant); the swap does not move it.
 */
data class AccountOwner(
    val id: Int,
    val user: String,
    val admin: Boolean,
    val secondFactorRequired: Boolean,
    val tokenEndsAt: Instant? = null,
)

/** A started QR pairing: [code] is shown by the app for comparison with the browser. */
data class QrPairing(val pickup: String, val code: String, val validSeconds: Int)

/** A look at the pickup of a QR pairing: waiting, as a preview of the account or with token. */
data class QrPickupState(
    val token: String? = null,
    val user: String? = null,
    val waiting: Boolean = false,
    val preview: Boolean = false,
    val error: String? = null,
)

/** What the server offers without sign-in. */
data class RegistrationState(val open: Boolean, val passkey: Boolean, val passwordForget: Boolean, val mailSending: Boolean)

/** A new account; [withoutMailSending]: the link stands in the server log instead of in an email. */
data class Registration(val message: String?, val withoutMailSending: Boolean)

/** The details of a new account; empty names mean „not given“. */
data class AccountCreation(
    val user: String,
    val email: String,
    val firstName: String?,
    val lastName: String?,
    val password: String,
    val language: String,
)

/** A profile change; the signed-in token is enough, the server asks for no password. */
data class ProfileChange(
    val user: String,
    val email: String,
    val firstName: String?,
    val lastName: String?,
)

/** A new address applies only after the link; [mailSent] says whether it is on its way. */
data class ProfileSaved(val newAddress: Boolean, val mailSent: Boolean)

/** Effective design, the admin's default and own choice; without [default] the server knows no design per account. */
data class DesignState(val effective: Design?, val default: Design?, val own: Design?)

data class SecondFactorStatus(val active: Boolean, val codesRemaining: Int)

data class SecondFactorSetup(val secret: String?, val otpauth: String?)

/** The account's settings; [effectiveState] is the own default or that of the server. */
data class AccountSettings(
    val currency: CurrencyCode,
    val priceState: Condition,
    val defaultState: Condition,
    val effectiveState: Condition,
)
