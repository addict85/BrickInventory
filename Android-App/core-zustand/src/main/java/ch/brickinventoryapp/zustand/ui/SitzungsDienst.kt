package ch.brickinventoryapp.zustand.ui

import ch.brickinventoryapp.data.Abmeldeweg
import ch.brickinventoryapp.data.MeldungsKanal
import ch.brickinventoryapp.data.RechteSignal
import ch.brickinventoryapp.data.SessionExpiredSignal
import ch.brickinventoryapp.data.Sitzungsablage
import ch.brickinventoryapp.data.ZweiterFaktorPflicht
import ch.brickinventoryapp.data.repository.Bestandsabgleich
import ch.brickinventoryapp.data.repository.KontoRepository
import ch.brickinventoryapp.data.repository.Ergebnis
import ch.brickinventoryapp.data.repository.VerwaltungRepository
import ch.brickinventoryapp.model.koroutinen.ApplicationScope
import ch.brickinventoryapp.ressourcen.R
import ch.brickinventoryapp.model.ui.model.alsAnsicht
import ch.brickinventoryapp.zustand.ui.viewmodel.Texte
import ch.brickinventoryapp.netz.util.NetworkPolicy
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
    fun zweiterFaktorEingerichtet()

    /** Einstellungen und Design des Kontos; das Design kommt von /settings/theme. */
    fun ladeEinstellungen()

    /** Die Haushaltskonten entscheiden, ob und mit welchen Einträgen der Kontofilter erscheint. */
    fun ladeMitglieder()

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
    private val konto: KontoRepository,
    private val verwaltung: VerwaltungRepository,
    private val prefs: Sitzungsablage,
    private val sessionExpired: SessionExpiredSignal,
    private val rechte: RechteSignal,
    private val meldungen: MeldungsKanal,
    private val texte: Texte,
    private val sitzung: Sitzung,
    private val blickfeld: Blickfeld,
    private val abgleich: Bestandsabgleich,
    private val zweiterFaktorPflicht: ZweiterFaktorPflicht,
    private val abmeldevorgang: Abmeldevorgang,
    private val vorwaermen: Vorwaermung,
    @param:ApplicationScope private val bereich: CoroutineScope,
) : SitzungsRepository {

    private val gestartet = AtomicBoolean(false)

    override fun starte() {
        if (!gestartet.compareAndSet(false, true)) return
        meldeGescheiterteEntwertung()
        // Währung und Design liest die Sitzung aus der Ablage (Kontowerte); hier
        // fragt nur der Server, ob sich das Design geändert hat.
        bereich.launch {
            launch { ladeDesign() }
            verfolgeServerstart()
        }
        bereich.launch { folgeAnmeldung() }
        bereich.launch { prefs.language.collect { sitzung.spracheGeaendert(it) } }
        // Ein 401 auf einen Token, der an einen ausgewiesenen Server ging; ein
        // Fehlversuch beim Anmelden meldet nicht ab. Die Ablage statt der Sitzung:
        // Beim Kaltstart kann der 401 vor dem ersten Abgleich der Sitzung kommen.
        bereich.launch {
            sessionExpired.abgelaufen.filter { it }.collect {
                sessionExpired.quittiere()
                if (prefs.tokenJetzt().isNotBlank()) {
                    meldungen.zeige(texte.text(R.string.vm_session_expired))
                    abmelden()
                }
            }
        }
        // Ein 403 `nur_admins`: Recht nachziehen; die Meldung nur beim Übergang.
        bereich.launch {
            rechte.entzogen.filter { it }.collect {
                rechte.quittiere()
                if (sitzung.rechteNachziehen(konto)) meldungen.zeige(texte.text(R.string.vm_rechte_entzogen))
            }
        }
    }

    // Eine nachgeholte Abmeldung, die endgültig scheiterte (EntwertungsWorker): Die
    // Benachrichtigung kann fehlen, also hier noch einmal, einmalig.
    private fun meldeGescheiterteEntwertung() {
        prefs.gescheiterteEntwertungen().firstOrNull()?.let { server ->
            meldungen.zeige(texte.text(R.string.abmeldung_gescheitert_text,
                NetworkPolicy.ansicht(server)?.adresse ?: server))
            prefs.quittiereGescheiterteEntwertungen()
        }
    }

    /**
     * Nur eine echte Änderung von Adresse oder Token lädt neu. Je Anmeldung ein
     * eigener Bereich, den der nächste Wechsel abbricht: Eine späte Antwort des
     * alten Kontos schriebe sonst in die neue Sitzung.
     */
    private suspend fun folgeAnmeldung() {
        combine(prefs.serverUrl, prefs.authToken) { url, token -> url to token }
            .distinctUntilChanged()
            .collectLatest { (url, token) -> coroutineScope { anmeldung(this, url, token) } }
    }

    private suspend fun anmeldung(anmeldung: CoroutineScope, url: String, token: String) {
        sitzung.anmeldungGeaendert(url, token.isNotBlank())
        if (token.isNotBlank() && prefs.anmeldungAbgelaufen()) {
            meldungen.zeige(texte.text(R.string.vm_anmeldung_zu_alt))
            abmelden()
            return
        }
        // Eine alte http-Adresse führt in die Einrichtung (startZiel); Abrufe
        // dorthin scheiterten nur und füllten die Leiste mit Netzfehlern.
        if (token.isNotBlank() && url.isNotBlank() &&
            !NetworkPolicy.klartextAltbestand(url, NetworkPolicy.entwicklung)) {
            anmeldung.launch { sitzung.kontoUebernehmen(konto, zweiterFaktorPflicht) }
            nachAnmeldung(anmeldung)
            ladeEinstellungen(anmeldung)
            vorwaermen.anstossen()
        }
    }

    override fun zweiterFaktorEingerichtet() {
        zweiterFaktorPflicht.erledigt()
        nachAnmeldung(bereich)
        ladeEinstellungen()
    }

    /** Nach dem Anmelden: Filter, Konten, Orte und die Galerie in die Ablage; die Bereiche zeigen sie. */
    private fun nachAnmeldung(anmeldung: CoroutineScope) {
        anmeldung.launch { blickfeld.ladeFilter() }
        anmeldung.launch { blickfeld.ladeMitglieder() }
        anmeldung.launch { blickfeld.ladeLagerorte() }
        anmeldung.launch { blickfeld.ladeEigeneLagerorte() }
        anmeldung.launch { abgleich.sets() }
    }

    /** Die Bereichs-ViewModels leeren sich auf [Sitzung.abmeldungen]. */
    override fun abmelden(): Job = bereich.launch {
        if (abmeldevorgang.ausfuehren() == Abmeldeweg.NACHGEHOLT) {
            meldungen.zeige(texte.text(R.string.vm_abmelden_nachgeholt))
        }
        // Das Design des Kontos gilt nicht mehr; ohne Token liefert der Server die Vorgabe.
        bereich.launch { ladeDesign() }
    }

    override fun ladeMitglieder() {
        bereich.launch { blickfeld.ladeMitglieder() }
    }

    override fun ladeLagerorte() {
        bereich.launch { blickfeld.ladeLagerorte() }
    }

    override fun ladeEinstellungen() = ladeEinstellungen(bereich)

    private fun ladeEinstellungen(anmeldung: CoroutineScope) {
        anmeldung.launch { sitzung.ladeEinstellungen(konto) }
        anmeldung.launch { ladeDesign() }
    }

    /** Angemeldet das Design des Kontos, sonst die Vorgabe; im Fehlerfall bleibt das gemerkte. */
    private suspend fun ladeDesign() {
        if (prefs.serverUrlJetzt().isBlank()) return
        val r = konto.getAppTheme()
        if (r is Ergebnis.Success && r.data.success) r.data.theme?.let(sitzung::setzeDesign)
    }

    /** Ohne Zeitlimit: Der erste Start des Servers kann viele Minuten dauern. */
    private suspend fun verfolgeServerstart() {
        if (prefs.serverUrlJetzt().isBlank()) return
        while (true) {
            val r = verwaltung.getStartupStatus()
            if (r !is Ergebnis.Success || r.data.ready) {
                sitzung.serverstartGeaendert(null)
                return
            }
            sitzung.serverstartGeaendert(r.data.alsAnsicht())
            delay(SERVERSTART_TAKT_MS)
        }
    }

    private companion object {
        const val SERVERSTART_TAKT_MS = 2000L
    }
}
