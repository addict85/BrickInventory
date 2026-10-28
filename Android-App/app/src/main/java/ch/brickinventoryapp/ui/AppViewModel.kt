package ch.brickinventoryapp.ui

import android.content.Context
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import ch.brickinventoryapp.R
import ch.brickinventoryapp.data.CsvImportSseClient
import ch.brickinventoryapp.data.MeldungsKanal
import ch.brickinventoryapp.data.PreferencesManager
import ch.brickinventoryapp.data.SessionExpiredSignal
import ch.brickinventoryapp.data.cache.VorschauSpeicher
import ch.brickinventoryapp.data.cache.VorschauVorwaermer
import ch.brickinventoryapp.data.model.CsvImportStatus
import ch.brickinventoryapp.data.repository.BrickRepository
import ch.brickinventoryapp.data.repository.Result
import ch.brickinventoryapp.service.CsvImportService
import ch.brickinventoryapp.ui.viewmodel.Texte
import dagger.hilt.android.lifecycle.HiltViewModel
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.drop
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import javax.inject.Inject
import javax.inject.Named

/**
 * Was der ganzen App gehört und an der Activity hängt: Sitzung beginnen und
 * beenden, Design und Sprache, die Snackbar, der CSV-Import-Balken, das
 * Vorwärmen der Bilder und das Ziel einer angetippten Meldung.
 *
 * Die Bereiche (Galerie, Teile, Finanzen, …) haben eigene ViewModels unter
 * ui/viewmodel; geteilt wird über Sitzung, Blickfeld, Bestandssignal und den
 * Meldungskanal, nicht über dieses ViewModel.
 */
@HiltViewModel
class AppViewModel @Inject constructor(
    @param:ApplicationContext private val ctx: Context,
    private val repo: BrickRepository,
    /** Geräte-Einstellungen (Netzerlaubnisse, Alarmmeldungen) lesen die Bildschirme direkt. */
    val prefs: PreferencesManager,
    private val vorschau: VorschauSpeicher,
    private val vorwaermer: VorschauVorwaermer,
    private val sseClient: CsvImportSseClient,
    private val sessionExpired: SessionExpiredSignal,
    meldungen: MeldungsKanal,
    private val texte: Texte,
    // Der PdfViewer leitet seinen Download-Client hiervon ab, damit Token,
    // Klartext-Verbot und 401-Meldung auch dort gelten.
    @param:Named("api") val apiHttpClient: okhttp3.OkHttpClient,
    // Beim Abmelden mit geleert: Die Vorschaubilder gehören zum Konto.
    private val imageLoader: coil3.ImageLoader,
    private val sitzung: Sitzung,
    private val blickfeldDienst: Blickfeld,
    private val bestand: Bestandssignal,
    val scrollMemory: ScrollMemory,
) : ViewModel() {

    // Der Zustand wird mit dem gemerkten Design geboren: appTheme unten nimmt
    // seinen Startwert beim Anlegen, ein späterer Wert käme nach der ersten
    // Komposition und das falsche Design blitzte auf.
    init {
        sitzung.aendere { it.copy(appTheme = prefs.gemerktesDesign()) }
    }
    val state: StateFlow<AppUiState> = sitzung.state

    private val _snackbar = meldungen.fluss
    val snackbar = meldungen.meldung
    fun clearSnackbar() { _snackbar.value = null }
    fun showSnackbar(msg: String) { _snackbar.value = msg }

    val blickfeld = blickfeldDienst.konten
    val lagerState = blickfeldDienst.lager

    /** Nur das Design, damit MainActivity nicht bei jeder Zustandsänderung neu komponiert. */
    val appTheme = sitzung.state
        .map { it.appTheme }
        .distinctUntilChanged()
        .stateIn(viewModelScope, SharingStarted.Eagerly, sitzung.state.value.appTheme)

    /** Je Gerät: Werkbank, solange das System dunkel ist (siehe wirksamesDesign). */
    private val _dunkelNachSystem = MutableStateFlow(prefs.dunkelNachSystem())
    val dunkelNachSystem: StateFlow<Boolean> = _dunkelNachSystem.asStateFlow()
    fun setDunkelNachSystem(an: Boolean) {
        prefs.setzeDunkelNachSystem(an)
        _dunkelNachSystem.value = an
    }

    private val _csvImportState = MutableStateFlow(CsvImportUiState())
    val csvImportState: StateFlow<CsvImportUiState> = _csvImportState.asStateFlow()
    private var csvWatchJob: Job? = null

    private val _meldungsZiel = MutableStateFlow(MeldungsZielUiState())
    val meldungsZiel: StateFlow<MeldungsZielUiState> = _meldungsZiel.asStateFlow()

    // Mehrfaches Anstossen (Serverwechsel, neues Token) soll keine zweite
    // Runde durch dieselben Bilder starten.
    private var vorwaermenLaeuft = false

    init {
        viewModelScope.launch {
            // Bei Installationen vor dem synchronen Spiegel steht das Design
            // nur im DataStore; danach fragt der Server, ob es sich geändert hat.
            sitzung.aendere { it.copy(appTheme = prefs.appTheme.first()) }
            loadAppTheme()
            verfolgeServerstart()
        }
        // Nur eine echte Änderung von Adresse oder Token lädt neu.
        viewModelScope.launch {
            combine(prefs.serverUrl, prefs.authToken) { url, token -> url to token }
                .distinctUntilChanged()
                .collect { (url, token) ->
                    sitzung.aendere { it.copy(serverUrl = url, isLoggedIn = token.isNotBlank(), authToken = token) }
                    if (token.isNotBlank() && url.isNotBlank()) {
                        launch {
                            val me = repo.admin.getMe()
                            if (me is Result.Success) sitzung.aendere { it.copy(isAdmin = me.data.user?.isAdmin == true) }
                        }
                        nachAnmeldung()
                        loadSettings()
                        vorwaermenAnstossen()
                    }
                }
        }
        viewModelScope.launch {
            prefs.currency.collect { cur -> sitzung.aendere { it.copy(currency = cur) } }
        }
        // Eine Währung, die der Server nennt, gilt beim nächsten Start schon vor
        // der ersten Antwort; drop(1) lässt den gemerkten Startwert aus.
        viewModelScope.launch {
            sitzung.state.map { it.currency }.distinctUntilChanged().drop(1)
                .collect { prefs.saveCurrency(it) }
        }
        viewModelScope.launch {
            prefs.language.collect { lang -> sitzung.aendere { it.copy(language = lang) } }
        }
        // Ein 401 mit Token meldet der Interceptor hier; abgemeldet wird nur,
        // wenn noch eine Sitzung besteht (ein Fehlversuch beim Anmelden nicht).
        viewModelScope.launch {
            sessionExpired.events.collect {
                if (sitzung.state.value.isLoggedIn) {
                    _snackbar.value = texte.text(R.string.vm_session_expired)
                    logout()
                }
            }
        }
    }

    // ── Sitzung ──────────────────────────────────────────────────────────────

    /** Nach dem Anmelden: Filter, Konten und Orte; die Bereiche laden ihre Listen selbst. */
    private fun nachAnmeldung() {
        _csvImportState.value = CsvImportUiState()
        viewModelScope.launch { blickfeldDienst.ladeFilter() }
        loadHouseholdMembers()
        loadLagerorte()
        viewModelScope.launch { blickfeldDienst.ladeEigeneLagerorte() }
        bestand.melde(Aenderung.Sets)
    }

    /**
     * Abmelden räumt alles weg, was zum Konto gehört — auch API- und
     * Bild-Cache, sonst sähe der nächste Nutzer auf dem Gerät fremde Daten.
     * Die Bereichs-ViewModels leeren sich auf [Sitzung.abgemeldet].
     */
    @OptIn(coil3.annotation.ExperimentalCoilApi::class)
    fun logout() {
        csvWatchJob?.cancel(); csvWatchJob = null
        viewModelScope.launch {
            prefs.clearSession()
            repo.clearCache()
            // Speicher zuerst, sonst schreibt Coil beim nächsten Treffer wieder auf die Platte.
            try {
                imageLoader.memoryCache?.clear()
                imageLoader.diskCache?.clear()
            } catch (_: Exception) { /* darf das Abmelden nie verhindern */ }
            sitzung.abgemeldet()
            blickfeldDienst.zuruecksetzen()
            _csvImportState.value = CsvImportUiState()
        }
    }

    /** Die Haushaltskonten entscheiden, ob und mit welchen Einträgen der Kontofilter erscheint. */
    fun loadHouseholdMembers() {
        viewModelScope.launch { blickfeldDienst.ladeMitglieder() }
    }

    /** Eine Abfrage für Galerie und Teile, damit beide denselben Stand zeigen. */
    fun loadLagerorte() {
        viewModelScope.launch { blickfeldDienst.ladeLagerorte() }
    }

    // ── Design, Sprache, Einstellungen ───────────────────────────────────────

    /** Das Design merken, damit der nächste Kaltstart schon darin anfängt. */
    fun loadSettings() {
        viewModelScope.launch {
            sitzung.ladeEinstellungen(repo.admin)?.let { prefs.saveAppTheme(it) }
        }
    }

    /**
     * Das Design vor der Anmeldung über die öffentliche Adresse holen. Ohne
     * Meldung im Fehlerfall: Dann bleibt das gemerkte, und das ist richtig.
     */
    private fun loadAppTheme() {
        viewModelScope.launch {
            if (prefs.serverUrlJetzt().isBlank()) return@launch
            val r = repo.admin.getAppTheme()
            if (r is Result.Success && r.data.success) {
                sitzung.aendere { it.copy(appTheme = r.data.theme) }
                prefs.saveAppTheme(r.data.theme)
            }
        }
    }

    /**
     * Den Start des Servers verfolgen, bis er bereit ist. Ohne Zeitlimit, weil
     * der erste Start viele Minuten dauern kann; antwortet er gar nicht, bleibt
     * es bei der gewöhnlichen Netzmeldung.
     */
    private fun verfolgeServerstart() {
        viewModelScope.launch {
            if (prefs.serverUrlJetzt().isBlank()) return@launch
            while (true) {
                val r = repo.admin.getStartupStatus()
                if (r !is Result.Success || r.data.ready) {
                    sitzung.aendere { it.copy(startupStatus = null) }
                    return@launch
                }
                sitzung.aendere { it.copy(startupStatus = r.data) }
                delay(2000)
            }
        }
    }

    fun setLanguage(languageCode: String) {
        viewModelScope.launch {
            prefs.saveLanguage(languageCode)
            ch.brickinventoryapp.util.LanguageManager.applyLanguage(languageCode)
        }
    }

    // ── Meldung angetippt ────────────────────────────────────────────────────

    /** Der Intent kommt am Rand der App an, und dieser Rand ist die Activity. */
    fun setAusMeldungAnfordern(setNummer: String?) {
        if (setNummer.isNullOrBlank()) return
        _meldungsZiel.value = MeldungsZielUiState(setNummer)
    }

    /** Erledigt — sonst springt die App bei der nächsten Rekomposition erneut. */
    fun setAusMeldungQuittieren() {
        _meldungsZiel.value = MeldungsZielUiState(null)
    }

    // ── Vorschaubilder ───────────────────────────────────────────────────────

    fun vorschauAblageBytes(): Long = vorschau.belegt()

    /** Füllt sich beim Blättern wieder; offline ist danach nichts mehr da. */
    fun vorschauAblageLeeren() = vorschau.leeren()

    /** Einmal je App-Start, auf IO: Der Bildabruf blockiert. */
    private fun vorwaermenAnstossen() {
        if (vorwaermenLaeuft) return
        vorwaermenLaeuft = true
        viewModelScope.launch(Dispatchers.IO) {
            delay(VorschauVorwaermer.ANLAUF_MS)
            // Erst Netzlage und Platz prüfen, sonst kostet jeder Start vier Listenabrufe umsonst.
            if (!vorwaermer.darfStarten()) return@launch
            val basis = runCatching { prefs.serverUrlJetzt() }.getOrNull().orEmpty()
            if (basis.isBlank()) return@launch
            vorwaermer.vorwaermen(bildAdressenDerSammlung(repo, blickfeldDienst, basis))
        }
    }

    // ── CSV-Import ───────────────────────────────────────────────────────────

    /**
     * Eine dauerhafte SSE-Verbindung meldet jeden Import, auch einen aus der
     * Webapp. Bei Fehlern einmal per Abfrage nachsehen (damit der Balken nicht
     * hängt) und mit wachsendem Abstand neu verbinden. Mehrfach gerufen: ohne Wirkung.
     */
    fun startCsvImportWatcher() {
        if (csvWatchJob?.isActive == true) return
        csvWatchJob = viewModelScope.launch {
            var backoffMs = 5_000L
            while (isActive) {
                var sseFailed = false
                try {
                    sseClient.stream().collect { event ->
                        when (event) {
                            is CsvImportSseClient.Event.Status -> {
                                backoffMs = 5_000L
                                handleCsvStatus(event.status)
                            }
                            is CsvImportSseClient.Event.Failed -> { sseFailed = true }
                        }
                    }
                } catch (_: Exception) {
                    sseFailed = true
                }
                if (!isActive) break
                if (sseFailed) {
                    abfrageStattStrom()
                    delay(backoffMs)
                    backoffMs = minOf(backoffMs * 2, 60_000L)
                }
                // Sauber geschlossen (Neustart des Servers): sofort neu verbinden.
            }
        }
    }

    /**
     * Abbrechen heisst „ab hier nicht weiter", nicht „rückgängig": Angelegte
     * Sets bleiben. Der Balken verschwindet erst mit dem nächsten Status vom
     * Server, nicht schon hier.
     */
    fun cancelCsvImport() {
        viewModelScope.launch {
            when (val r = repo.sets.cancelCsvImport()) {
                is Result.Success -> _snackbar.value = texte.text(R.string.csv_cancel_requested)
                is Result.Error -> _snackbar.value = texte.meldungFuerSnackbar(r)
            }
        }
    }

    private suspend fun handleCsvStatus(s: CsvImportStatus) {
        // Vor dem Überschreiben entscheiden — danach wäre „vorher" schon der
        // neue Zustand. Die Regel steht prüfbar in CsvUebergang.kt.
        val folge = csvFolge(warVorherAktiv = _csvImportState.value.running, status = s.status)
        if (folge == CsvFolge.DIENST_STARTEN) CsvImportService.start(ctx)
        _csvImportState.value = CsvImportUiState(
            running = importLaeuft(s.status),
            done    = s.done ?: 0,
            total   = s.total ?: 0,
            current = s.current,
            ok      = s.ok ?: 0,
            warn    = s.warn ?: 0,
            err     = s.err ?: 0
        )
        when (folge) {
            CsvFolge.NACHLADEN -> finishCsvImport()
            CsvFolge.FEHLER_AUFRAEUMEN -> {
                delay(5000)
                _csvImportState.value = CsvImportUiState()
                CsvImportService.stop(ctx)
            }
            CsvFolge.DIENST_STARTEN, CsvFolge.NICHTS -> {}
        }
    }

    @Volatile private var csvFinishing = false

    /** Fertig: die Galerie lädt nach, der Balken bleibt kurz stehen. */
    private suspend fun finishCsvImport() {
        if (csvFinishing) return
        csvFinishing = true
        try {
            bestand.melde(Aenderung.Sets)
            delay(5000)
            _csvImportState.value = CsvImportUiState()
            CsvImportService.stop(ctx)
        } finally {
            csvFinishing = false
        }
    }

    private suspend fun abfrageStattStrom() {
        try {
            val url = prefs.serverUrlJetzt()
            val token = prefs.tokenJetzt()
            if (token.isBlank() || url.isBlank()) return
            val resp = repo.sets.getCsvImportStatus(url, token)
            if (resp is Result.Success) handleCsvStatus(resp.data)
        } catch (_: Exception) {}
    }
}
