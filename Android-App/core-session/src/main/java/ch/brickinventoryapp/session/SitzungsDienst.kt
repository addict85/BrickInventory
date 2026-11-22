package ch.brickinventoryapp.session

import ch.brickinventoryapp.data.Abmeldeweg
import ch.brickinventoryapp.data.MeldungsKanal
import ch.brickinventoryapp.data.RightsSignal
import ch.brickinventoryapp.data.SessionExpiredSignal
import ch.brickinventoryapp.data.Sitzungsablage
import ch.brickinventoryapp.data.SecondFactorRequired
import ch.brickinventoryapp.data.repository.Bestandsabgleich
import ch.brickinventoryapp.data.repository.AccountRepository
import ch.brickinventoryapp.data.repository.Ergebnis
import ch.brickinventoryapp.data.repository.ManagementRepository
import ch.brickinventoryapp.model.coroutines.ApplicationScope
import ch.brickinventoryapp.resources.R
import ch.brickinventoryapp.model.ui.Meldung
import ch.brickinventoryapp.network.util.NetworkPolicy
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
 * [Sitzung]; only these steps are allowed to trigger it.
 */
interface SitzungsRepository {
    /** Starts following the store and the server's signals; a second call does nothing. */
    fun starte()

    /** The job lets a server change wait until everything is gone. */
    fun abmelden(): Job

    /** The second factor is confirmed: load now whatever was rejected with 403 until then. */
    fun secondFactorConfigured()

    /** Account settings and theme; the theme comes from /settings/theme. */
    fun ladeEinstellungen()

    /** The household accounts decide whether and with which entries the account filter appears. */
    fun loadMembers()

    /** One query for gallery and parts, so both show the same state. */
    fun ladeLagerorte()
}

/**
 * A singleton in the app's scope instead of an activity ViewModel: the session
 * lives as long as the process, and a 401 during a rotation or without a
 * visible activity must not go unheard.
 */
@Singleton
class SitzungsDienst @Inject constructor(
    private val konto: AccountRepository,
    private val verwaltung: ManagementRepository,
    private val prefs: Sitzungsablage,
    private val sessionExpired: SessionExpiredSignal,
    private val rights: RightsSignal,
    private val meldungen: MeldungsKanal,
    private val sitzung: Sitzung,
    private val blickfeld: Filterquelle,
    private val sync: Bestandsabgleich,
    private val zweiterFaktorPflicht: SecondFactorRequired,
    private val abmeldevorgang: Abmeldevorgang,
    private val vorwaermen: WarmUp,
    @param:ApplicationScope private val bereich: CoroutineScope,
) : SitzungsRepository {

    private val gestartet = AtomicBoolean(false)

    override fun starte() {
        if (!gestartet.compareAndSet(false, true)) return
        reportFailedRedemption()
        // The session reads currency and theme from the store (Kontowerte); here
        // only the server is asked whether the theme has changed.
        bereich.launch {
            launch { loadDesign() }
            trackServerStart()
        }
        bereich.launch { sequenceLogin() }
        bereich.launch { prefs.language.collect { sitzung.spracheGeaendert(it) } }
        // A 401 on a token that went to an identified server; a
        // failed sign-in attempt doesn't trigger a sign-out. The store instead of the session:
        // on a cold start the 401 can arrive before the session's first sync.
        bereich.launch {
            sessionExpired.abgelaufen.filter { it }.collect {
                sessionExpired.acknowledge()
                if (prefs.tokenJetzt().isNotBlank()) {
                    meldungen.zeige(Meldung.Resource(R.string.vm_session_expired))
                    abmelden()
                }
            }
        }
        // A 403 `nur_admins`: catch up on the right; the notification only on the transition.
        bereich.launch {
            rights.entzogen.filter { it }.collect {
                rights.acknowledge()
                if (sitzung.followUpRights(konto)) meldungen.zeige(Meldung.Resource(R.string.vm_rechte_entzogen))
            }
        }
    }

    // A deferred sign-out that finally failed (EntwertungsWorker): the
    // notification can be missing, so once more here, just once.
    private fun reportFailedRedemption() {
        prefs.failedRedemptions().firstOrNull()?.let { server ->
            meldungen.zeige(Meldung.Resource(R.string.abmeldung_gescheitert_text,
                listOf(NetworkPolicy.ansicht(server)?.adresse ?: server)))
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
            .collectLatest { (url, token) -> coroutineScope { anmeldung(this, url, token) } }
    }

    private suspend fun anmeldung(anmeldung: CoroutineScope, url: String, token: String) {
        sitzung.anmeldungGeaendert(url, token.isNotBlank())
        if (token.isNotBlank() && prefs.loginExpired()) {
            meldungen.zeige(Meldung.Resource(R.string.vm_anmeldung_zu_alt))
            abmelden()
            return
        }
        // An old http address leads into setup (startTarget); requests
        // there would only fail and fill the bar with network errors.
        if (token.isNotBlank() && url.isNotBlank() &&
            !NetworkPolicy.plaintextLegacyStock(url, NetworkPolicy.entwicklung)) {
            anmeldung.launch { sitzung.adoptAccount(konto, zweiterFaktorPflicht) }
            afterLogin(anmeldung)
            ladeEinstellungen(anmeldung)
            vorwaermen.kick()
        }
    }

    override fun secondFactorConfigured() {
        zweiterFaktorPflicht.erledigt()
        afterLogin(bereich)
        ladeEinstellungen()
    }

    /** After signing in: filter, accounts, locations and the gallery into the store; the scopes display them. */
    private fun afterLogin(anmeldung: CoroutineScope) {
        anmeldung.launch { blickfeld.loadFilter() }
        anmeldung.launch { blickfeld.loadMembers() }
        anmeldung.launch { blickfeld.ladeLagerorte() }
        anmeldung.launch { blickfeld.loadOwnLocations() }
        anmeldung.launch { sync.sets() }
    }

    /** The scope ViewModels clear themselves on [Sitzung.signOuts]. */
    override fun abmelden(): Job = bereich.launch {
        if (abmeldevorgang.ausfuehren() == Abmeldeweg.CAUGHT_UP) {
            meldungen.zeige(Meldung.Resource(R.string.vm_abmelden_nachgeholt))
        }
        // The account's theme no longer applies; without a token the server returns the default.
        bereich.launch { loadDesign() }
    }

    override fun loadMembers() {
        bereich.launch { blickfeld.loadMembers() }
    }

    override fun ladeLagerorte() {
        bereich.launch { blickfeld.ladeLagerorte() }
    }

    override fun ladeEinstellungen() = ladeEinstellungen(bereich)

    private fun ladeEinstellungen(anmeldung: CoroutineScope) {
        anmeldung.launch { sitzung.ladeEinstellungen(konto) }
        anmeldung.launch { loadDesign() }
    }

    /** Signed in, the account's theme, otherwise the default; on error the remembered one stays. */
    private suspend fun loadDesign() {
        if (prefs.serverUrlJetzt().isBlank()) return
        val r = konto.getAppTheme()
        if (r is Ergebnis.Erfolg) r.data.wirksam?.let(sitzung::setzeDesign)
    }

    /** No time limit: the server's first start can take many minutes. */
    private suspend fun trackServerStart() {
        if (prefs.serverUrlJetzt().isBlank()) return
        while (true) {
            val r = verwaltung.getStartupStatus()
            if (r !is Ergebnis.Erfolg || r.data.bereit) {
                sitzung.serverstartGeaendert(null)
                return
            }
            sitzung.serverstartGeaendert(r.data)
            delay(SERVER_START_TICK_MS)
        }
    }

    private companion object {
        const val SERVER_START_TICK_MS = 2000L
    }
}
