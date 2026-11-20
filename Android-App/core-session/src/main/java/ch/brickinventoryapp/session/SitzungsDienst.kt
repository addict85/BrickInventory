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
 * Was die Sitzung über die Bildschirme hinweg tut: anmelden und abmelden
 * nachziehen, Einstellungen und Design des Kontos laden. Die Bereiche lesen die
 * [Sitzung]; auslösen dürfen sie nur diese Schritte.
 */
interface SitzungsRepository {
    /** Beginnt, der Ablage und den Signalen des Servers zu folgen; ein zweiter Aufruf tut nichts. */
    fun starte()

    /** Der Job lässt einen Serverwechsel warten, bis alles weg ist. */
    fun abmelden(): Job

    /** Der zweite Faktor ist bestätigt: Was bis dahin mit 403 abgewiesen wurde, jetzt laden. */
    fun secondFactorConfigured()

    /** Einstellungen und Design des Kontos; das Design kommt von /settings/theme. */
    fun ladeEinstellungen()

    /** Die Haushaltskonten entscheiden, ob und mit welchen Einträgen der Kontofilter erscheint. */
    fun loadMembers()

    /** Eine Abfrage für Galerie und Teile, damit beide denselben Stand zeigen. */
    fun ladeLagerorte()
}

/**
 * Ein Singleton im Bereich der App statt eines Activity-ViewModels: Die Sitzung
 * lebt so lange wie der Prozess, und ein 401 während einer Drehung oder ohne
 * sichtbare Activity darf nicht ungehört bleiben.
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
        // Währung und Design liest die Sitzung aus der Ablage (Kontowerte); hier
        // fragt nur der Server, ob sich das Design geändert hat.
        bereich.launch {
            launch { loadDesign() }
            trackServerStart()
        }
        bereich.launch { sequenceLogin() }
        bereich.launch { prefs.language.collect { sitzung.spracheGeaendert(it) } }
        // Ein 401 auf einen Token, der an einen ausgewiesenen Server ging; ein
        // Fehlversuch beim Anmelden meldet nicht ab. Die Ablage statt der Sitzung:
        // Beim Kaltstart kann der 401 vor dem ersten Abgleich der Sitzung kommen.
        bereich.launch {
            sessionExpired.abgelaufen.filter { it }.collect {
                sessionExpired.acknowledge()
                if (prefs.tokenJetzt().isNotBlank()) {
                    meldungen.zeige(Meldung.Resource(R.string.vm_session_expired))
                    abmelden()
                }
            }
        }
        // Ein 403 `nur_admins`: Recht nachziehen; die Meldung nur beim Übergang.
        bereich.launch {
            rights.entzogen.filter { it }.collect {
                rights.acknowledge()
                if (sitzung.followUpRights(konto)) meldungen.zeige(Meldung.Resource(R.string.vm_rechte_entzogen))
            }
        }
    }

    // Eine nachgeholte Abmeldung, die endgültig scheiterte (EntwertungsWorker): Die
    // Benachrichtigung kann fehlen, also hier noch einmal, einmalig.
    private fun reportFailedRedemption() {
        prefs.failedRedemptions().firstOrNull()?.let { server ->
            meldungen.zeige(Meldung.Resource(R.string.abmeldung_gescheitert_text,
                listOf(NetworkPolicy.ansicht(server)?.adresse ?: server)))
            prefs.acknowledgeFailedRedemptions()
        }
    }

    /**
     * Nur eine echte Änderung von Adresse oder Token lädt neu. Je Anmeldung ein
     * eigener Bereich, den der nächste Wechsel abbricht: Eine späte Antwort des
     * alten Kontos schriebe sonst in die neue Sitzung.
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
        // Eine alte http-Adresse führt in die Einrichtung (startTarget); Abrufe
        // dorthin scheiterten nur und füllten die Leiste mit Netzfehlern.
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

    /** Nach dem Anmelden: Filter, Konten, Orte und die Galerie in die Ablage; die Bereiche zeigen sie. */
    private fun afterLogin(anmeldung: CoroutineScope) {
        anmeldung.launch { blickfeld.loadFilter() }
        anmeldung.launch { blickfeld.loadMembers() }
        anmeldung.launch { blickfeld.ladeLagerorte() }
        anmeldung.launch { blickfeld.loadOwnLocations() }
        anmeldung.launch { sync.sets() }
    }

    /** Die Bereichs-ViewModels leeren sich auf [Sitzung.signOuts]. */
    override fun abmelden(): Job = bereich.launch {
        if (abmeldevorgang.ausfuehren() == Abmeldeweg.CAUGHT_UP) {
            meldungen.zeige(Meldung.Resource(R.string.vm_abmelden_nachgeholt))
        }
        // Das Design des Kontos gilt nicht mehr; ohne Token liefert der Server die Vorgabe.
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

    /** Angemeldet das Design des Kontos, sonst die Vorgabe; im Fehlerfall bleibt das gemerkte. */
    private suspend fun loadDesign() {
        if (prefs.serverUrlJetzt().isBlank()) return
        val r = konto.getAppTheme()
        if (r is Ergebnis.Erfolg) r.data.wirksam?.let(sitzung::setzeDesign)
    }

    /** Ohne Zeitlimit: Der erste Start des Servers kann viele Minuten dauern. */
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
