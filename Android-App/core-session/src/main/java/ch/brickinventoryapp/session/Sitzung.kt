package ch.brickinventoryapp.session

import ch.brickinventoryapp.model.domain.Waehrung
import ch.brickinventoryapp.model.ui.theme.Design
import ch.brickinventoryapp.model.domain.Zustand
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import javax.inject.Inject
import javax.inject.Singleton
import ch.brickinventoryapp.data.SecondFactorRequired
import ch.brickinventoryapp.data.repository.AccountRepository
import ch.brickinventoryapp.data.repository.Ergebnis
import ch.brickinventoryapp.model.domain.StartStateView
import ch.brickinventoryapp.model.domain.AccountOwner
import java.time.Instant

/**
 * The app's session: server, sign-in, account settings. It is only changed
 * via these named steps; a generic „change“ would let every screen set
 * arbitrary fields, and nobody would know anymore who overwrote the currency.
 */
interface Sitzung {
    val state: StateFlow<AppUiState>

    /**
     * Counts the sign-outs. A state instead of an event: a collector that
     * wasn't running right then would miss an event; a counter it reads the next time around.
     */
    val signOuts: StateFlow<Long>

    /** Sign-in succeeded; the admin right holds until the next response from /auth/me. */
    fun angemeldet(admin: Boolean)

    /** Address and token have changed (SitzungsDienst follows the store). */
    fun anmeldungGeaendert(serverUrl: String, angemeldet: Boolean)

    /** /auth/me has named the admin right. */
    fun verwalterGeaendert(admin: Boolean)

    /** The server has stored the account's currency and condition. */
    fun einstellungenGespeichert(currency: Waehrung, priceCondition: Zustand)

    /** The account's settings from the server; the condition is the resolved one (user → global → „N“). */
    fun einstellungenGeladen(currency: Waehrung, priceCondition: Zustand, defaultPriceCondition: Zustand, userDefaultCondition: Zustand?)

    /** A server response names the account's currency (e.g. the valuation). */
    fun waehrungUebernommen(currency: Waehrung)

    fun spracheGeaendert(language: String)

    /** The effective theme, e.g. after a choice in the account; it goes into the store, the state follows it. */
    fun setzeDesign(theme: Design)

    /** The server's startup state, as long as it isn't ready; null means through or not reachable. */
    fun serverstartGeaendert(stand: StartStateView?)

    /**
     * The server stays set up — signed out doesn't mean „different server“.
     * The theme stays until the server's default arrives; otherwise „classic“ would flash up.
     */
    fun abgemeldet()
}

/** For tests and previews without Hilt. */
fun Sitzung(werte: Kontowerte = StorageAccountValues()): Sitzung = SessionState(werte)

/**
 * A singleton and not a field of a ViewModel, because every screen reads the
 * session, but every scope ViewModel only lives as long as its target. It derives
 * currency and theme from [Kontowerte]; it holds no copy of its own.
 */
@Singleton
class SessionState @Inject constructor(private val werte: Kontowerte) : Sitzung {

    private val _state = MutableStateFlow(AppUiState())
    override val state: StateFlow<AppUiState> = _state
        .abgeleitet(werte.waehrung) { s, w -> s.copy(currency = w) }
        .abgeleitet(werte.design) { s, d -> s.copy(appTheme = d) }

    private val _signOuts = MutableStateFlow(0L)
    override val signOuts: StateFlow<Long> = _signOuts.asStateFlow()

    override fun angemeldet(admin: Boolean) = _state.update { it.copy(isLoggedIn = true, isAdmin = admin) }

    override fun anmeldungGeaendert(serverUrl: String, angemeldet: Boolean) =
        _state.update { it.copy(serverUrl = serverUrl, isLoggedIn = angemeldet) }

    override fun verwalterGeaendert(admin: Boolean) = _state.update { it.copy(isAdmin = admin) }

    override fun einstellungenGespeichert(currency: Waehrung, priceCondition: Zustand) {
        werte.setCurrency(currency)
        _state.update { it.copy(priceCondition = priceCondition) }
    }

    override fun einstellungenGeladen(
        currency: Waehrung, priceCondition: Zustand, defaultPriceCondition: Zustand, userDefaultCondition: Zustand?,
    ) {
        werte.setCurrency(currency)
        _state.update {
            it.copy(priceCondition = priceCondition, defaultPriceCondition = defaultPriceCondition,
                userDefaultCondition = userDefaultCondition)
        }
    }

    override fun waehrungUebernommen(currency: Waehrung) = werte.setCurrency(currency)

    override fun spracheGeaendert(language: String) = _state.update { it.copy(language = language) }

    override fun setzeDesign(theme: Design) = werte.setzeDesign(theme)

    override fun serverstartGeaendert(stand: StartStateView?) = _state.update { it.copy(startupStatus = stand) }

    /** The account's currency no longer applies; the theme stays until the server's default arrives. */
    override fun abgemeldet() {
        werte.setCurrency(AppUiState().currency)
        _state.update { AppUiState(serverUrl = it.serverUrl) }
        _signOuts.update { it + 1 }
    }
}

/**
 * The account's settings from the server into the session. Not the theme:
 * /settings names the admin's default in app_theme, the account's own comes
 * from /settings/theme (SitzungsDienst).
 */
suspend fun Sitzung.ladeEinstellungen(konto: AccountRepository) {
    val r = konto.getSettings()
    if (r is Ergebnis.Erfolg) {
        val e = r.data
        einstellungenGeladen(e.waehrung, e.priceState, e.defaultState, e.effectiveState)
    }
}

/**
 * After a 403 `nur_admins`: catch up on the admin right from /auth/me. Only
 * from the admin state — repeated 403s (a polling screen) thereby
 * trigger at most one fetch. @return true if the right was lost
 */
suspend fun Sitzung.followUpRights(konto: AccountRepository): Boolean {
    if (!state.value.isAdmin) return false
    val me = konto.getMe()
    // Without a response, the 403 stands: the server has just denied the right.
    val verwalter = me is Ergebnis.Erfolg && me.data?.verwalter == true
    verwalterGeaendert(verwalter)
    return !verwalter
}

/**
 * After signing in: admin right and the requirement for a second factor from /auth/me.
 * /me also answers without a configured factor; this way the setup screen
 * appears before the other requests fail with 403. Without a response, everything stays as it is.
 */
suspend fun Sitzung.adoptAccount(
    konto: AccountRepository,
    factorRequired: SecondFactorRequired,
): AccountOwner? {
    val me = konto.getMe()
    if (me !is Ergebnis.Erfolg) return null
    val nutzer = me.data
    verwalterGeaendert(nutzer?.verwalter == true)
    if (nutzer?.zweiterFaktorPflicht == true) factorRequired.melde()
    return nutzer
}

/**
 * Does the server's hard end of the token lie within [warnMs]? The server may set a shorter
 * maximum than the app's own 90 days; without a value (older server) it says nothing.
 */
fun tokenEndsSoon(endsAt: Instant?, jetzt: Long, warnMs: Long = LOGIN_WARNING_MS): Boolean =
    endsAt != null && endsAt.toEpochMilli() - jetzt <= warnMs

/** A week: enough to sign in again at leisure before requests start failing. */
const val LOGIN_WARNING_MS = 7L * 24 * 60 * 60 * 1000

/**
 * A failed QR startup while the app is already signed in is not an
 * error: the scanner fired twice, the first run already consumed the one-time
 * token and signed in. Returns the message, or null.
 */
fun <T : Any> qrError(alreadySignedIn: Boolean, meldung: T): T? =
    if (alreadySignedIn) null else meldung
