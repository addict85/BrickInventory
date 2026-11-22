package ch.brickinventoryapp.session

import ch.brickinventoryapp.model.domain.CurrencyCode
import ch.brickinventoryapp.model.domain.Condition
import ch.brickinventoryapp.model.domain.StartStateView
import ch.brickinventoryapp.model.ui.theme.Design

/**
 * What the whole app knows about the session — held by [Session], read by
 * every screen. Sign-in form, account filter and household accounts belong with
 * whoever is responsible for them (LoginUiState, ScopeUiState).
 */
data class AppUiState(
    val serverUrl: String = "",
    val isLoggedIn: Boolean = false,
    val isAdmin: Boolean = false,
    // No token here: only the interceptor (TokenStore) reads it; in
    // the state it would be exposed to every screen, as a second source of truth.
    val currency: CurrencyCode = CurrencyCode.EUR,
    val priceCondition: Condition = Condition.NEW,
    /** The server's default for newly captured data. */
    val defaultPriceCondition: Condition = Condition.NEW,
    /** null: the account takes over the server's default. */
    val userDefaultCondition: Condition? = null,
    val appTheme: Design = Design.DEFAULT, // Effective theme: the account's own, otherwise the default
    /**
     * The server's startup state, as long as it hasn't reported `ready`; otherwise null. The
     * first start after a fresh install takes minutes, and instead of a network error
     * the sign-in screen then shows a progress bar like the web app. null means through
     * or not reachable at all.
     */
    val startupStatus: StartStateView? = null,
    val language: String = "system",
)
