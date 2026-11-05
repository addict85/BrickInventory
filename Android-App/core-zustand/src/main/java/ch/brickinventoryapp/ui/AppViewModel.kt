package ch.brickinventoryapp.ui

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import ch.brickinventoryapp.data.Abmeldeweg
import ch.brickinventoryapp.data.MeldungsKanal
import ch.brickinventoryapp.data.PasswortPflicht
import ch.brickinventoryapp.data.RechteSignal
import ch.brickinventoryapp.data.SessionExpiredSignal
import ch.brickinventoryapp.data.Sitzungsablage
import ch.brickinventoryapp.data.ZweiterFaktorPflicht
import ch.brickinventoryapp.data.repository.KontoRepository
import ch.brickinventoryapp.data.repository.VerwaltungRepository
import ch.brickinventoryapp.data.repository.Result
import ch.brickinventoryapp.ressourcen.R
import ch.brickinventoryapp.ui.model.alsAnsicht
import ch.brickinventoryapp.ui.viewmodel.Texte
import ch.brickinventoryapp.util.NetworkPolicy
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.drop
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.launch
import javax.inject.Inject

/**
 * Die Sitzung der App: anmelden, abmelden, Einstellungen und Design des Kontos
 * nachziehen, Snackbar und das Ziel einer angetippten Meldung. Darstellung,
 * Vertrauen und CSV-Import haben eigene ViewModels; die Bereiche teilen über
 * Sitzung, Blickfeld, Bestandssignal und Meldungskanal.
 */
@HiltViewModel
class AppViewModel @Inject constructor(
    private val konto: KontoRepository,
    private val verwaltung: VerwaltungRepository,
    private val prefs: Sitzungsablage,
    private val sessionExpired: SessionExpiredSignal,
    private val rechte: RechteSignal,
    private val meldungen: MeldungsKanal,
    private val texte: Texte,
    private val sitzung: Sitzung,
    private val blickfeldDienst: Blickfeld,
    private val bestand: Bestandssignal,
    val scrollMemory: ScrollMemory,
    ausgangsmelder: Ausgangsmelder,
    private val passwortPflicht: PasswortPflicht,
    private val zweiterFaktorPflicht: ZweiterFaktorPflicht,
    private val abmelden: Abmeldevorgang,
    private val vorwaermen: Vorwaermung,
) : ViewModel() {

    val state: StateFlow<AppUiState> = sitzung.state

    val snackbar = meldungen.meldung

    /** Offline gespeicherte Änderungen, die noch zum Server müssen — für die Leiste im Gerüst. */
    val offeneAenderungen: StateFlow<Int> = ausgangsmelder.starte(viewModelScope)
    fun clearSnackbar() { meldungen.quittiere() }

    /** Mit Startpasswort zeigt MainActivity statt der App die Maske zum Ersetzen. */
    val startpasswortNoetig: StateFlow<Boolean> = passwortPflicht.noetig

    /** Verwalterrechte ohne zweiten Faktor: MainActivity zeigt dessen Einrichtung. */
    val zweiterFaktorNoetig: StateFlow<Boolean> = zweiterFaktorPflicht.noetig

    // Eine nachgeholte Abmeldung, die endgültig scheiterte (EntwertungsWorker): Die
    // Benachrichtigung kann fehlen, also hier noch einmal, einmalig.
    init {
        prefs.gescheiterteEntwertungen().firstOrNull()?.let { server ->
            meldungen.zeige(texte.text(R.string.abmeldung_gescheitert_text,
                NetworkPolicy.ansicht(server)?.adresse ?: server))
            prefs.quittiereGescheiterteEntwertungen()
        }
    }

    val blickfeld = blickfeldDienst.konten
    val lagerState = blickfeldDienst.lager

    private val _meldungsZiel = MutableStateFlow(MeldungsZielUiState())
    val meldungsZiel: StateFlow<MeldungsZielUiState> = _meldungsZiel.asStateFlow()

    init {
        viewModelScope.launch {
            // Bei Installationen vor dem synchronen Spiegel steht das Design
            // nur im DataStore; danach fragt der Server, ob es sich geändert hat.
            val gespeichert = prefs.appTheme.first()
            sitzung.aendere { it.copy(appTheme = gespeichert) }
            loadAppTheme()
            verfolgeServerstart()
        }
        viewModelScope.launch { folgeAnmeldung() }
        viewModelScope.launch {
            prefs.currency.collect { cur -> sitzung.aendere { it.copy(currency = cur) } }
        }
        // Jede Änderung des Designs landet im Spiegel des Geräts, ob vom Server oder
        // aus der Wahl im Konto; nach dem Abmelden ist es die Vorgabe.
        viewModelScope.launch {
            sitzung.state.map { it.appTheme }.distinctUntilChanged().collect { prefs.saveAppTheme(it) }
        }
        // drop(1) lässt den gemerkten Startwert aus: Nur eine Währung des Servers wird gemerkt.
        viewModelScope.launch {
            sitzung.state.map { it.currency }.distinctUntilChanged().drop(1)
                .collect { prefs.saveCurrency(it) }
        }
        viewModelScope.launch {
            prefs.language.collect { lang -> sitzung.aendere { it.copy(language = lang) } }
        }
        // Ein 401 auf einen Token, der an einen ausgewiesenen Server ging; ein
        // Fehlversuch beim Anmelden meldet nicht ab.
        viewModelScope.launch {
            sessionExpired.events.collect {
                if (sitzung.state.value.isLoggedIn) {
                    meldungen.zeige(texte.text(R.string.vm_session_expired))
                    logout()
                }
            }
        }
        // Ein 403 `nur_admins`: Recht nachziehen; die Meldung nur beim Übergang.
        viewModelScope.launch {
            rechte.entzogen.collect {
                if (sitzung.rechteNachziehen(konto)) meldungen.zeige(texte.text(R.string.vm_rechte_entzogen))
            }
        }
    }

    /** Nur eine echte Änderung von Adresse oder Token lädt neu. */
    private suspend fun folgeAnmeldung() {
        combine(prefs.serverUrl, prefs.authToken) { url, token -> url to token }
            .distinctUntilChanged()
            .collect { (url, token) ->
                sitzung.aendere { it.copy(serverUrl = url, isLoggedIn = token.isNotBlank()) }
                if (token.isNotBlank() && prefs.anmeldungAbgelaufen()) {
                    meldungen.zeige(texte.text(R.string.vm_anmeldung_zu_alt))
                    logout()
                    return@collect
                }
                // Eine alte http-Adresse führt in die Einrichtung (startZiel); Abrufe
                // dorthin scheiterten nur und füllten die Leiste mit Netzfehlern.
                if (token.isNotBlank() && url.isNotBlank() &&
                    !NetworkPolicy.klartextAltbestand(url, NetworkPolicy.entwicklung)) {
                    viewModelScope.launch { sitzung.kontoUebernehmen(konto, zweiterFaktorPflicht) }
                    nachAnmeldung()
                    loadSettings()
                    vorwaermen.anstossen()
                }
            }
    }

    // ── Sitzung ──────────────────────────────────────────────────────────────

    /** Der zweite Faktor ist bestätigt: Was bis dahin mit 403 abgewiesen wurde, jetzt laden. */
    fun zweiterFaktorEingerichtet() {
        zweiterFaktorPflicht.erledigt()
        nachAnmeldung()
        loadSettings()
    }

    /** Nach dem Anmelden: Filter, Konten und Orte; die Bereiche laden ihre Listen selbst. */
    private fun nachAnmeldung() {
        viewModelScope.launch { blickfeldDienst.ladeFilter() }
        loadHouseholdMembers()
        loadLagerorte()
        viewModelScope.launch { blickfeldDienst.ladeEigeneLagerorte() }
        bestand.melde(Aenderung.Sets)
    }

    /**
     * Abmelden ([Abmelden]); die Bereichs-ViewModels leeren sich auf
     * [Sitzung.abgemeldet]. Der Job lässt einen Serverwechsel warten, bis alles weg ist.
     */
    fun logout(): Job = viewModelScope.launch {
        if (abmelden.ausfuehren() == Abmeldeweg.NACHGEHOLT) {
            meldungen.zeige(texte.text(R.string.vm_abmelden_nachgeholt))
        }
        // Das Design des Kontos gilt nicht mehr; ohne Token liefert der Server die Vorgabe.
        loadAppTheme()
    }

    /** Die Haushaltskonten entscheiden, ob und mit welchen Einträgen der Kontofilter erscheint. */
    fun loadHouseholdMembers() {
        viewModelScope.launch { blickfeldDienst.ladeMitglieder() }
    }

    /** Eine Abfrage für Galerie und Teile, damit beide denselben Stand zeigen. */
    fun loadLagerorte() {
        viewModelScope.launch { blickfeldDienst.ladeLagerorte() }
    }

    // ── Design und Einstellungen des Kontos ──────────────────────────────────

    /** Einstellungen und Design des Kontos; das Design kommt von /settings/theme. */
    fun loadSettings() {
        viewModelScope.launch { sitzung.ladeEinstellungen(konto) }
        loadAppTheme()
    }

    /** Angemeldet das Design des Kontos, sonst die Vorgabe; im Fehlerfall bleibt das gemerkte. */
    private fun loadAppTheme() {
        viewModelScope.launch {
            if (prefs.serverUrlJetzt().isBlank()) return@launch
            val r = konto.getAppTheme()
            if (r is Result.Success && r.data.success) sitzung.aendere { it.copy(appTheme = r.data.theme) }
        }
    }

    /** Ohne Zeitlimit: Der erste Start des Servers kann viele Minuten dauern. */
    private fun verfolgeServerstart() {
        viewModelScope.launch {
            if (prefs.serverUrlJetzt().isBlank()) return@launch
            while (true) {
                val r = verwaltung.getStartupStatus()
                if (r !is Result.Success || r.data.ready) {
                    sitzung.aendere { it.copy(startupStatus = null) }
                    return@launch
                }
                sitzung.aendere { it.copy(startupStatus = r.data.alsAnsicht()) }
                delay(SERVERSTART_TAKT_MS)
            }
        }
    }

    // ── Meldung angetippt ────────────────────────────────────────────────────

    /** Der Intent kommt am Rand der App an, und dieser Rand ist die Activity. */
    fun setAusMeldungAnfordern(setNummer: String?) {
        // Auch hier geprüft: Die Nummer wird Teil einer Navigationsroute.
        val sn = setnummerAusMeldung(setNummer) ?: return
        _meldungsZiel.value = MeldungsZielUiState(sn)
    }

    /** Erledigt — sonst springt die App bei der nächsten Rekomposition erneut. */
    fun setAusMeldungQuittieren() {
        _meldungsZiel.value = MeldungsZielUiState(null)
    }

    private companion object {
        const val SERVERSTART_TAKT_MS = 2000L
    }
}
