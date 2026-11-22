package ch.brickinventoryapp.session

import ch.brickinventoryapp.model.domain.CurrencyCode
import ch.brickinventoryapp.model.ui.theme.Design
import ch.brickinventoryapp.model.domain.Condition
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import javax.inject.Inject
import javax.inject.Singleton
import ch.brickinventoryapp.data.SecondFactorRequired
import ch.brickinventoryapp.data.repository.AccountRepository
import ch.brickinventoryapp.data.repository.Outcome
import ch.brickinventoryapp.model.domain.StartStateView
import ch.brickinventoryapp.model.domain.AccountOwner
import java.time.Instant

/**
 * The app's session: server, sign-in, account settings. It is only changed
 * via these named steps; a generic „change“ would let every screen set
 * arbitrary fields, and nobody would know anymore who overwrote the currency.
 */
interface Session {
    val state: StateFlow<AppUiState>

    /**
     * Counts the sign-outs. A state instead of an event: a collector that
     * wasn't running right then would miss an event; a counter it reads the next time around.
     */
    val logouts: StateFlow<Long>

    /** Sign-in succeeded; the admin right holds until the next response from /auth/me. */
    fun loggedIn(admin: Boolean)

    /** Address and token have changed (SessionService follows the store). */
    fun loginChanged(serverUrl: String, loggedIn: Boolean)

    /** /auth/me has named the admin right. */
    fun adminChanged(admin: Boolean)

    /** The server has stored the account's currency and condition. */
    fun settingsSaved(currency: CurrencyCode, priceCondition: Condition)

    /** The account's settings from the server; the condition is the resolved one (user → global → „N“). */
    fun settingsLoaded(currency: CurrencyCode, priceCondition: Condition, defaultPriceCondition: Condition, userDefaultCondition: Condition?)

    /** A server response names the account's currency (e.g. the valuation). */
    fun currencyAdopted(currency: CurrencyCode)

    fun languageChanged(language: String)

    /** The effective theme, e.g. after a choice in the account; it goes into the store, the state follows it. */
    fun setDesign(theme: Design)

    /** The server's startup state, as long as it isn't ready; null means through or not reachable. */
    fun serverStartChanged(state: StartStateView?)

    /**
     * The server stays set up — signed out doesn't mean „different server“.
     * The theme stays until the server's default arrives; otherwise „classic“ would flash up.
     */
    fun loggedOut()
}

/** For tests and previews without Hilt. */
fun Session(values: AccountValues = StorageAccountValues()): Session = SessionState(values)

/**
 * A singleton and not a field of a ViewModel, because every screen reads the
 * session, but every scope ViewModel only lives as long as its target. It derives
 * currency and theme from [AccountValues]; it holds no copy of its own.
 */
@Singleton
class SessionState @Inject constructor(private val values: AccountValues) : Session {

    private val _state = MutableStateFlow(AppUiState())
    override val state: StateFlow<AppUiState> = _state
        .derived(values.currency) { s, w -> s.copy(currency = w) }
        .derived(values.design) { s, d -> s.copy(appTheme = d) }

    private val _logouts = MutableStateFlow(0L)
    override val logouts: StateFlow<Long> = _logouts.asStateFlow()

    override fun loggedIn(admin: Boolean) = _state.update { it.copy(isLoggedIn = true, isAdmin = admin) }

    override fun loginChanged(serverUrl: String, loggedIn: Boolean) =
        _state.update { it.copy(serverUrl = serverUrl, isLoggedIn = loggedIn) }

    override fun adminChanged(admin: Boolean) = _state.update { it.copy(isAdmin = admin) }

    override fun settingsSaved(currency: CurrencyCode, priceCondition: Condition) {
        values.setCurrency(currency)
        _state.update { it.copy(priceCondition = priceCondition) }
    }

    override fun settingsLoaded(
        currency: CurrencyCode, priceCondition: Condition, defaultPriceCondition: Condition, userDefaultCondition: Condition?,
    ) {
        values.setCurrency(currency)
        _state.update {
            it.copy(priceCondition = priceCondition, defaultPriceCondition = defaultPriceCondition,
                userDefaultCondition = userDefaultCondition)
        }
    }

    override fun currencyAdopted(currency: CurrencyCode) = values.setCurrency(currency)

    override fun languageChanged(language: String) = _state.update { it.copy(language = language) }

    override fun setDesign(theme: Design) = values.setDesign(theme)

    override fun serverStartChanged(state: StartStateView?) = _state.update { it.copy(startupStatus = state) }

    /** The account's currency no longer applies; the theme stays until the server's default arrives. */
    override fun loggedOut() {
        values.setCurrency(AppUiState().currency)
        _state.update { AppUiState(serverUrl = it.serverUrl) }
        _logouts.update { it + 1 }
    }
}

/**
 * The account's settings from the server into the session. Not the theme:
 * /settings names the admin's default in app_theme, the account's own comes
 * from /settings/theme (SessionService).
 */
suspend fun Session.loadSettings(account: AccountRepository) {
    val r = account.getSettings()
    if (r is Outcome.Success) {
        val e = r.data
        settingsLoaded(e.currency, e.priceState, e.defaultState, e.effectiveState)
    }
}

/**
 * After a 403 `only_admins`: catch up on the admin right from /auth/me. Only
 * from the admin state — repeated 403s (a polling screen) thereby
 * trigger at most one fetch. @return true if the right was lost
 */
suspend fun Session.followUpRights(account: AccountRepository): Boolean {
    if (!state.value.isAdmin) return false
    val me = account.getMe()
    // Without a response, the 403 stands: the server has just denied the right.
    val admin = me is Outcome.Success && me.data?.admin == true
    adminChanged(admin)
    return !admin
}

/**
 * After signing in: admin right and the requirement for a second factor from /auth/me.
 * /me also answers without a configured factor; this way the setup screen
 * appears before the other requests fail with 403. Without a response, everything stays as it is.
 */
suspend fun Session.adoptAccount(
    account: AccountRepository,
    factorRequired: SecondFactorRequired,
): AccountOwner? {
    val me = account.getMe()
    if (me !is Outcome.Success) return null
    val user = me.data
    adminChanged(user?.admin == true)
    if (user?.secondFactorRequired == true) factorRequired.report()
    return user
}

/**
 * Does the server's hard end of the token lie within [warnMs]? The server may set a shorter
 * maximum than the app's own 90 days; without a value (older server) it says nothing.
 */
fun tokenEndsSoon(endsAt: Instant?, now: Long, warnMs: Long = LOGIN_WARNING_MS): Boolean =
    endsAt != null && endsAt.toEpochMilli() - now <= warnMs

/** A week: enough to sign in again at leisure before requests start failing. */
const val LOGIN_WARNING_MS = 7L * 24 * 60 * 60 * 1000

/**
 * A failed QR startup while the app is already signed in is not an
 * error: the scanner fired twice, the first run already consumed the one-time
 * token and signed in. Returns the message, or null.
 */
fun <T : Any> qrError(alreadyLoggedIn: Boolean, message: T): T? =
    if (alreadyLoggedIn) null else message
