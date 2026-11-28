package ch.brickinventoryapp.session

import ch.brickinventoryapp.data.LogoutPath
import ch.brickinventoryapp.data.MessageChannel
import ch.brickinventoryapp.data.RightsSignal
import ch.brickinventoryapp.data.SecondFactorRequired
import ch.brickinventoryapp.data.SessionExpiredSignal
import ch.brickinventoryapp.data.SessionStore
import ch.brickinventoryapp.data.account.AccountRepository
import ch.brickinventoryapp.data.account.ManagementRepository
import ch.brickinventoryapp.data.local.StockReconciliation
import ch.brickinventoryapp.data.repository.Outcome
import ch.brickinventoryapp.model.coroutines.ApplicationScope
import ch.brickinventoryapp.model.ui.Message
import ch.brickinventoryapp.network.util.NetworkPolicy
import ch.brickinventoryapp.resources.R
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.filter
import kotlinx.coroutines.launch
import java.util.concurrent.atomic.AtomicBoolean
import javax.inject.Inject
import javax.inject.Singleton

/**
 * What the session does across screens: catch up on sign-in and sign-out,
 * load account settings and theme. Scopes read the
 * [Session]; only these steps are allowed to trigger it.
 */
interface SessionRepository {
    /** Starts following the store and the server's signals; a second call does nothing. */
    fun launch()

    /** The job lets a server change wait until everything is gone. */
    fun logout(): Job

    /** The second factor is confirmed: load now whatever was rejected with 403 until then. */
    fun secondFactorConfigured()

    /** Account settings and theme; the theme comes from /settings/theme. */
    fun loadSettings()

    /** The household accounts decide whether and with which entries the account filter appears. */
    fun loadMembers()

    /** One query for gallery and parts, so both show the same state. */
    fun fetchStorageLocations()
}

/**
 * A singleton in the app's scope instead of an activity ViewModel: the session
 * lives as long as the process, and a 401 during a rotation or without a
 * visible activity must not go unheard.
 */
@Singleton
class SessionService @Inject constructor(
    private val account: AccountRepository,
    private val admin: ManagementRepository,
    private val prefs: SessionStore,
    private val sessionExpired: SessionExpiredSignal,
    private val rights: RightsSignal,
    private val messages: MessageChannel,
    private val session: Session,
    private val viewport: FilterSource,
    private val sync: StockReconciliation,
    private val secondFactorRequired: SecondFactorRequired,
    private val logoutProcess: LogoutProcess,
    private val prewarm: WarmUp,
    @param:ApplicationScope private val area: CoroutineScope,
) : SessionRepository {

    private val started = AtomicBoolean(false)

    override fun launch() {
        if (!started.compareAndSet(false, true)) return
        reportFailedRedemption()
        // The session reads currency and theme from the store (AccountValues); here
        // only the server is asked whether the theme has changed.
        area.launch {
            launch { loadDesign() }
            trackServerStart()
        }
        area.launch { sequenceLogin() }
        area.launch { prefs.language.collect { session.languageChanged(it) } }
        // A 401 on a token that went to an identified server; a
        // failed sign-in attempt doesn't trigger a sign-out. The store instead of the session:
        // on a cold start the 401 can arrive before the session's first sync.
        area.launch {
            sessionExpired.expired.filter { it }.collect {
                sessionExpired.acknowledge()
                if (prefs.tokenNow().isNotBlank()) {
                    messages.show(Message.Resource(R.string.vm_session_expired))
                    logout()
                }
            }
        }
        // A 403 `only_admins`: catch up on the right; the notification only on the transition.
        area.launch {
            rights.revoked.filter { it }.collect {
                rights.acknowledge()
                if (session.followUpRights(account)) messages.show(Message.Resource(R.string.vm_rights_revoked))
            }
        }
    }

    // A deferred sign-out that finally failed (RedemptionWorker): the
    // notification can be missing, so once more here, just once.
    private fun reportFailedRedemption() {
        prefs.failedRedemptions().firstOrNull()?.let { server ->
            messages.show(Message.Resource(R.string.logout_failed_text,
                listOf(NetworkPolicy.view(server)?.address ?: server)))
            prefs.acknowledgeFailedRedemptions()
        }
    }

    /**
     * Only a real change of address or token triggers a reload. A dedicated scope
     * per sign-in, which the next change cancels: a late response from the
     * old account would otherwise write into the new session.
     */
    private suspend fun sequenceLogin() {
        combine(prefs.serverUrl, prefs.authToken) { url, token -> url to token }
            .distinctUntilChanged()
            .collectLatest { (url, token) -> coroutineScope { login(this, url, token) } }
    }

    private suspend fun login(login: CoroutineScope, url: String, token: String) {
        session.loginChanged(url, token.isNotBlank())
        if (token.isNotBlank() && prefs.loginExpired()) {
            messages.show(Message.Resource(R.string.vm_login_too_old))
            logout()
            return
        }
        // An old http address leads into setup (startTarget); requests
        // there would only fail and fill the bar with network errors.
        if (token.isNotBlank() && url.isNotBlank() &&
            !NetworkPolicy.plaintextLegacyStock(url, NetworkPolicy.development)) {
            login.launch {
                val user = session.adoptAccount(account, secondFactorRequired)
                // The swap cannot extend the hard end (the app's 90 days or the server's); only a new sign-in can.
                if (prefs.loginExpiresSoon() || tokenEndsSoon(user?.tokenEndsAt, System.currentTimeMillis())) {
                    messages.show(Message.Resource(R.string.vm_login_running_ab))
                }
            }
            afterLogin(login)
            loadSettings(login)
            prewarm.kick()
        }
    }

    override fun secondFactorConfigured() {
        secondFactorRequired.done()
        afterLogin(area)
        loadSettings()
    }

    /** After signing in: filter, accounts, locations and the gallery into the store; the scopes display them. */
    private fun afterLogin(login: CoroutineScope) {
        login.launch { viewport.loadFilter() }
        login.launch { viewport.loadMembers() }
        login.launch { viewport.fetchStorageLocations() }
        login.launch { viewport.loadOwnLocations() }
        login.launch { sync.sets() }
    }

    /** The scope ViewModels clear themselves on [Session.logouts]. */
    override fun logout(): Job = area.launch {
        if (logoutProcess.execute() == LogoutPath.CAUGHT_UP) {
            messages.show(Message.Resource(R.string.vm_logout_caught_up))
        }
        // The account's theme no longer applies; without a token the server returns the default.
        area.launch { loadDesign() }
    }

    override fun loadMembers() {
        area.launch { viewport.loadMembers() }
    }

    override fun fetchStorageLocations() {
        area.launch { viewport.fetchStorageLocations() }
    }

    override fun loadSettings() = loadSettings(area)

    private fun loadSettings(login: CoroutineScope) {
        login.launch { session.loadSettings(account) }
        login.launch { loadDesign() }
    }

    /** Signed in, the account's theme, otherwise the default; on error the remembered one stays. */
    private suspend fun loadDesign() {
        if (prefs.serverUrlNow().isBlank()) return
        val r = account.getAppTheme()
        if (r is Outcome.Success) r.data.effective?.let(session::setDesign)
    }

    /** No time limit: the server's first start can take many minutes. */
    private suspend fun trackServerStart() {
        if (prefs.serverUrlNow().isBlank()) return
        while (true) {
            val r = admin.getStartupStatus()
            if (r !is Outcome.Success || r.data.ready) {
                session.serverStartChanged(null)
                return
            }
            session.serverStartChanged(r.data)
            delay(SERVER_START_TICK_MS)
        }
    }

    private companion object {
        const val SERVER_START_TICK_MS = 2000L
    }
}
