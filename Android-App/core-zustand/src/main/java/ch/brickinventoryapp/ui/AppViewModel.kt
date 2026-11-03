package ch.brickinventoryapp.ui

import android.content.Context
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import ch.brickinventoryapp.ressourcen.R
import ch.brickinventoryapp.ui.model.alsAnsicht
import ch.brickinventoryapp.data.CsvImportSseClient
import ch.brickinventoryapp.data.MeldungsKanal
import ch.brickinventoryapp.data.PreferencesManager
import ch.brickinventoryapp.data.SessionExpiredSignal
import ch.brickinventoryapp.data.cache.VorschauSpeicher
import ch.brickinventoryapp.data.cache.VorschauVorwaermer
import ch.brickinventoryapp.ui.model.CsvImportStandAnsicht
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
 * Was der ganzen App gehört: Sitzung beginnen und beenden, Design und Sprache,
 * Snackbar, CSV-Import-Balken, Vorwärmen und das Ziel einer angetippten Meldung.
 * Die Bereiche teilen über Sitzung, Blickfeld, Bestandssignal und Meldungskanal.
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
    private val rechte: ch.brickinventoryapp.data.RechteSignal,
    meldungen: MeldungsKanal,
    private val texte: Texte,
    // Der PdfViewer leitet seinen Download-Client hiervon ab, damit Token,
    // Klartext-Verbot und 401-Meldung auch dort gelten.
    @param:Named("api") val apiHttpClient: okhttp3.OkHttpClient,
    // Nur für seinen Zwischenspeicher: Beim Abmelden geleert wie Coils eigene Caches.
    @param:Named("image") private val bildHttpClient: okhttp3.OkHttpClient,
    // Beim Abmelden mit geleert: Die Vorschaubilder gehören zum Konto.
    private val imageLoader: coil3.ImageLoader,
    private val sitzung: Sitzung,
    private val blickfeldDienst: Blickfeld,
    private val bestand: Bestandssignal,
    val scrollMemory: ScrollMemory,
    /** Ein unbekanntes Zertifikat wartet auf Ja oder Nein (ZertifikatDialog). */
    val zertifikatsFrage: ch.brickinventoryapp.util.ZertifikatsFrage,
    ausgangsmelder: Ausgangsmelder,
    private val abmeldehaken: Abmeldehaken,
    /** Mit Startpasswort zeigt MainActivity statt der App die Maske zum Ersetzen. */
    val passwortPflicht: ch.brickinventoryapp.data.PasswortPflicht,
    private val abmeldung: ch.brickinventoryapp.data.Abmeldung,
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

    /** Offline gespeicherte Änderungen, die noch zum Server müssen — für die Leiste im Gerüst. */
    val offeneAenderungen: StateFlow<Int> = ausgangsmelder.starte(viewModelScope)
    fun clearSnackbar() { _snackbar.value = null }
    fun showSnackbar(msg: String) { _snackbar.value = msg }

    val blickfeld = blickfeldDienst.konten
    val lagerState = blickfeldDienst.lager

    /** Nur das Design, damit MainActivity nicht bei jeder Zustandsänderung neu komponiert. */
    val appTheme = sitzung.state
        .map { it.appTheme }
        .distinctUntilChanged()
        .stateIn(viewModelScope, SharingStarted.Eagerly, sitzung.state.value.appTheme)

    /** Je Gerät: System, Hell oder Dunkel (ui/theme/Darstellung.kt). */
    private val _helligkeit = MutableStateFlow(prefs.helligkeit())
    val helligkeit: StateFlow<String> = _helligkeit.asStateFlow()
    fun setHelligkeit(wahl: String) {
        prefs.setzeHelligkeit(wahl)
        _helligkeit.value = wahl
    }

    /** Je Gerät: auch nutzerinstallierte CAs für den eigenen Server; an nur nach Bestätigung. */
    val nutzerCa = NutzerCaSchalter(
        lies = prefs::nutzerCaErlaubt,
        schreibe = prefs::setzeNutzerCa,
        nachAenderung = { apiHttpClient.connectionPool.evictAll() },
    )

    /** Je Gerät: Material You statt der Farben des Designs (ui/theme/Darstellung.kt). */
    private val _systemfarben = MutableStateFlow(prefs.systemfarben())
    val systemfarben: StateFlow<Boolean> = _systemfarben.asStateFlow()
    fun setSystemfarben(an: Boolean) {
        prefs.setzeSystemfarben(an)
        _systemfarben.value = an
    }

    /** Je Gerät: FLAG_SECURE für die ganze App (MainActivity), über den Zähler von Sichtschutz. */
    private val _vorschauVerbergen = MutableStateFlow(prefs.vorschauVerbergen())
    val vorschauVerbergen: StateFlow<Boolean> = _vorschauVerbergen.asStateFlow()
    fun setVorschauVerbergen(an: Boolean) {
        prefs.setzeVorschauVerbergen(an)
        _vorschauVerbergen.value = an
    }

    /** Ja zum gezeigten Zertifikat: gepinnt, offene Verbindungen verworfen. Ohne bekannte CA oder geändert nur mit [eingabe]. */
    fun zertifikatVertrauen(eingabe: String? = null): Boolean {
        if (!zertifikatsFrage.bestaetige(prefs, eingabe)) return false
        apiHttpClient.connectionPool.evictAll()
        return true
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
            val gespeichert = prefs.appTheme.first()
            sitzung.aendere { it.copy(appTheme = gespeichert) }
            loadAppTheme()
            verfolgeServerstart()
        }
        // Nur eine echte Änderung von Adresse oder Token lädt neu.
        viewModelScope.launch {
            combine(prefs.serverUrl, prefs.authToken) { url, token -> url to token }
                .distinctUntilChanged()
                .collect { (url, token) ->
                    sitzung.aendere { it.copy(serverUrl = url, isLoggedIn = token.isNotBlank(), authToken = token) }
                    if (token.isNotBlank() && prefs.anmeldungAbgelaufen()) {
                        _snackbar.value = texte.text(R.string.vm_anmeldung_zu_alt)
                        logout()
                        return@collect
                    }
                    // Eine alte http-Adresse führt in die Einrichtung (startZiel); Abrufe
                    // dorthin scheiterten nur und füllten die Leiste mit Netzfehlern.
                    if (token.isNotBlank() && url.isNotBlank() &&
                        !ch.brickinventoryapp.util.NetworkPolicy.klartextAltbestand(url, ch.brickinventoryapp.util.NetworkPolicy.entwicklung)) {
                        launch {
                            val me = repo.konto.getMe()
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
        // Jede Änderung des Designs landet im Spiegel des Geräts — ob sie aus
        // /settings/theme oder der Wahl im Konto kommt. Beim Kontowechsel ist es damit
        // das Design des neuen Kontos, nach dem Abmelden die Vorgabe.
        viewModelScope.launch {
            sitzung.state.map { it.appTheme }.distinctUntilChanged().collect { prefs.saveAppTheme(it) }
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
        // Ein 401 auf einen Token, der an einen ausgewiesenen Server ging
        // (ServerWaechter); ein Fehlversuch beim Anmelden meldet nicht ab.
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

    // Ein 403 `nur_admins` (ServerWaechter): Recht nachziehen, Verwaltung
    // ausblenden; die Meldung nur beim Übergang, nicht je abgewiesener Anfrage.
    init {
        viewModelScope.launch {
            rechte.entzogen.collect {
                if (sitzung.rechteNachziehen(repo.konto)) _snackbar.value = texte.text(R.string.vm_rechte_entzogen)
            }
        }
    }

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
     * Die Bereichs-ViewModels leeren sich auf [Sitzung.abgemeldet]. Der Job lässt
     * einen Serverwechsel warten, bis alles weg ist. Zuerst entwertet der Server
     * den Token (kurz begrenzt, sonst später aus der Warteschlange) — beim Wechsel
     * ist das noch der alte Server.
     */
    @OptIn(coil3.annotation.ExperimentalCoilApi::class)
    fun logout(): Job {
        csvWatchJob?.cancel(); csvWatchJob = null
        return viewModelScope.launch {
            if (sitzung.state.value.isLoggedIn &&
                abmeldung.amServer() == ch.brickinventoryapp.data.Abmeldeweg.NACHGEHOLT) {
                _snackbar.value = texte.text(R.string.vm_abmelden_nachgeholt)
            }
            prefs.clearSession()
            passwortPflicht.erledigt()
            repo.clearCache()
            kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.IO) {
                runCatching { ch.brickinventoryapp.util.raeumeVertraulichePdfsAuf(ctx.cacheDir) }
                runCatching { ch.brickinventoryapp.util.raeumeKontoDateienAuf(ctx.filesDir, ctx.getExternalFilesDir(null)) }
                // Bilder des Kontos liegen auch hier: HTTP-Zwischenspeicher und Vorschau-Ablage.
                runCatching { bildHttpClient.cache?.evictAll() }
                runCatching { vorschau.leeren() }
            }
            // Speicher zuerst, sonst schreibt Coil beim nächsten Treffer wieder auf die Platte.
            try {
                imageLoader.memoryCache?.clear()
                imageLoader.diskCache?.clear()
            } catch (_: Exception) { /* darf das Abmelden nie verhindern */ }
            // Das Widget zeigt sonst die Zahlen des abgemeldeten Kontos weiter.
            runCatching {
                abmeldehaken.abgemeldet()
            }
            sitzung.abgemeldet()
            blickfeldDienst.zuruecksetzen()
            _csvImportState.value = CsvImportUiState()
            // Das Design des Kontos gilt nicht mehr; ohne Token liefert der Server die Vorgabe.
            loadAppTheme()
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

    /** Einstellungen und Design des Kontos; das Design kommt von /settings/theme. */
    fun loadSettings() {
        viewModelScope.launch { sitzung.ladeEinstellungen(repo.konto) }
        loadAppTheme()
    }

    /**
     * Das Design über /settings/theme: angemeldet das des Kontos, sonst die
     * Vorgabe. Ohne Meldung im Fehlerfall: Dann bleibt das gemerkte.
     */
    private fun loadAppTheme() {
        viewModelScope.launch {
            if (prefs.serverUrlJetzt().isBlank()) return@launch
            val r = repo.konto.getAppTheme()
            if (r is Result.Success && r.data.success) sitzung.aendere { it.copy(appTheme = r.data.theme) }
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
                val r = repo.verwaltung.getStartupStatus()
                if (r !is Result.Success || r.data.ready) {
                    sitzung.aendere { it.copy(startupStatus = null) }
                    return@launch
                }
                sitzung.aendere { it.copy(startupStatus = r.data.alsAnsicht()) }
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
        // Auch hier geprüft: Die Nummer wird Teil einer Navigationsroute.
        val sn = setnummerAusMeldung(setNummer) ?: return
        _meldungsZiel.value = MeldungsZielUiState(sn)
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
                                handleCsvStatus(event.status.alsAnsicht())
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

    private suspend fun handleCsvStatus(s: CsvImportStandAnsicht) {
        // Vor dem Überschreiben entscheiden — danach wäre „vorher" schon der
        // neue Zustand. Die Regel steht prüfbar in CsvUebergang.kt.
        val folge = csvFolge(warVorherAktiv = _csvImportState.value.running, status = s.status)
        if (folge == CsvFolge.DIENST_STARTEN) CsvImportService.start(ctx)
        _csvImportState.value = CsvImportUiState(
            running = importLaeuft(s.status),
            done    = s.done,
            total   = s.total,
            current = s.current,
            ok      = s.ok,
            warn    = s.warn,
            err     = s.err
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
            if (resp is Result.Success) handleCsvStatus(resp.data.alsAnsicht())
        } catch (_: Exception) {}
    }
}
