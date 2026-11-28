package ch.brickinventoryapp.dataapi.account

import ch.brickinventoryapp.model.domain.Login

/** How signing out at the server went: done, try again later, or pointless to repeat. */
enum class RedemptionOutcome { REDEEMED, LATER, GIVE_UP }

/**
 * The new token and the origin of the request that brought it (after rewriting and redirect).
 * Only these two values: the swap needs no more, and the wire format stays in core-data.
 */
data class SwappedToken(val token: String?, val origin: String?)

/** The response to [AccountRepository.login]; [passkeyInsteadOfCode] if the server also
 * takes a passkey for the second factor. */
data class LoginReply(val response: Login, val passkeyInsteadOfCode: Boolean = false)
