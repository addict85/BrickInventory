package ch.brickinventoryapp.ui

import android.content.Context
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import ch.brickinventoryapp.R
import ch.brickinventoryapp.data.CsvImportSseClient
import ch.brickinventoryapp.data.PreferencesManager
import ch.brickinventoryapp.data.model.*
import ch.brickinventoryapp.data.repository.BrickRepository
import ch.brickinventoryapp.data.repository.Fehlerart
import ch.brickinventoryapp.data.repository.Result
import ch.brickinventoryapp.service.CsvImportService
import ch.brickinventoryapp.service.PdfExportManager
import ch.brickinventoryapp.service.PdfExportService
import ch.brickinventoryapp.service.PdfExportState
import dagger.hilt.android.lifecycle.HiltViewModel
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.flow.*
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import javax.inject.Inject

@HiltViewModel
class MainViewModel @Inject constructor(
    /**
     * Der Anwendungs-Context, eingespritzt statt geerbt.
     *
     * ── Warum das keine Kosmetik ist ────────────────────────────────────────
     * Diese Klasse war das EINZIGE AndroidViewModel im Baum. CatalogViewModel
     * und MonitoringViewModel sind gewoehnliche ViewModel und lassen sich den
     * Context einspritzen — genau wie ResponseCache, PreferencesManager und
     * PdfExportManager. Zwei Muster fuer dieselbe Sache, und das seltenere war
     * das teurere: AndroidViewModel verlangt eine echte Application im
     * Konstruktor. Damit laesst sich diese Klasse in einem JVM-Test nicht
     * bauen, und deshalb liest der grosse Teil der Android-Tests Quelltext,
     * statt Code auszufuehren.
     *
     * Der Context bleibt derselbe: getApplication<Application>()
     * .applicationContext und Hilts @ApplicationContext liefern dasselbe
     * Objekt. Was sich aendert, ist nur, dass er ueber die Tuer hereinkommt
     * statt aus der Oberklasse — und damit in einem Test ersetzbar ist.
     */
    @param:ApplicationContext internal val ctx: Context,
    internal val repo: BrickRepository,
    internal val prefs: PreferencesManager,
    internal val sseClient: CsvImportSseClient,
    internal val pdfExport: PdfExportManager,
    internal val sessionExpired: ch.brickinventoryapp.data.SessionExpiredSignal,
    // Der eine Weg zur Snackbar — geteilt mit den uebrigen ViewModels.
    meldungen: ch.brickinventoryapp.data.MeldungsKanal,
    // Für den PdfViewer: Er leitet seinen Download-Client per newBuilder()
    // von diesem ab, statt einen eigenen OkHttpClient zu bauen. Damit teilt
    // er Thread- und Connection-Pool, und Interceptor-Regeln (Bearer-Token,
    // Klartext-Verbot, 401-Meldung) gelten automatisch statt handgepflegt.
    @param:javax.inject.Named("api") val apiHttpClient: okhttp3.OkHttpClient,
    // Nur fürs Abmelden: Der Bild-Cache enthält Thumbnails des angemeldeten
    // Kontos und wird zusammen mit dem API-Cache geleert (SessionFeature.kt).
    internal val imageLoader: coil.ImageLoader
) : ViewModel() {

    /**
     * Gemerkte Rollpositionen der Reiter (siehe ScrollMemory.kt). Kein
     * StateFlow: Die Position ändert sich bei jeder Rollbewegung, gelesen wird
     * sie nur beim Betreten eines Reiters.
     */
    val scrollMemory = ScrollMemory()

    /**
     * Ein Text aus den Ressourcen — in der SPRACHE DER APP, nicht des Systems.
     *
     * ── Der Fehler, der hier steckte ────────────────────────────────────────
     * Hier stand dreissigmal ein getString() direkt auf dem
     * Application-Context. `AppCompatDelegate.setApplicationLocales()`
     * lokalisiert aber nur AppCompat-ACTIVITIES; der Application-Context
     * behaelt unterhalb von Android 13 die SYSTEM-Sprache
     * (siehe LanguageManager.localizedContext(), minSdk ist 26 — betroffen
     * sind also Android 8 bis 12).
     *
     * Folge: Wer sein Telefon auf Deutsch stehen hat und die App auf Englisch
     * stellt, bekam JEDE Snackbar und JEDE Fehlermeldung des ViewModels
     * trotzdem auf Deutsch. Das trifft ausgerechnet meldung() — die Funktion,
     * die es nur gibt, damit Fehlermeldungen nicht in einer Sprache
     * herauskommen, die der Nutzer nicht gewaehlt hat.
     *
     * Fuer die Foreground-Services und den PDF-Export ist genau dieser Fall
     * schon geloest (CsvImportService, PdfExportService, PdfExportManager holen
     * sich den lokalisierten Context). Die ViewModels waren die Luecke.
     *
     * ── Warum ohne Zwischenspeicher ─────────────────────────────────────────
     * localizedContext() baut den Context bei jedem Aufruf neu. Das ist
     * Absicht: Die Sprache kann waehrend der Laufzeit umgestellt werden, ein
     * gemerkter Context waere danach der alte. Die Kosten fallen nur an, wenn
     * tatsaechlich eine Meldung entsteht.
     *
     * ── Warum `Any?` und nicht `Any` ────────────────────────────────────────
     * Die erste Fassung stand auf `vararg args: Any` und liess drei
     * Aufrufstellen nicht mehr uebersetzen: Sie reichen `r.data.setNumber`,
     * `partNumber` und `figNumber` durch, und die sind `String?`. Vorher fiel
     * das nicht auf, weil Androids `getString(int, Object...)` in Kotlin als
     * Plattformtyp `Any!` ankommt — dort wird Nullbarkeit nicht geprueft.
     *
     * Der Helfer darf nicht strenger sein als die Stelle, die er ersetzt:
     * Sonst verlagert eine Aenderung an der SPRACHE eine Aufraeumarbeit an
     * dreissig Aufrufstellen, die damit nichts zu tun hat. Ob eine Setnummer
     * `null` sein kann, ist eine eigene Frage — und keine, die hier
     * mitentschieden werden soll.
     */
    internal fun text(id: Int, vararg args: Any?): String {
        val c = ch.brickinventoryapp.util.LanguageManager.localizedContext(ctx)
        // Ohne Argumente die einfache Ueberladung: getString(id, *leer) laeuft
        // durch String.format, und ein Text mit einem einzelnen Prozentzeichen
        // wuerde dort eine Ausnahme werfen statt angezeigt zu werden.
        return if (args.isEmpty()) c.getString(id) else c.getString(id, *args)
    }

    internal val _state = MutableStateFlow(AppUiState())
    val state = _state.asStateFlow()

    // Live-Status des laufenden PDF-Exports (z. B. Countdown-Text „…noch ~Xs"),
    // null wenn kein Export läuft. Wird im PartsListScreen angezeigt.
    val pdfExportStatus: StateFlow<String?> =
        pdfExport.state
            .map { (it as? PdfExportState.Running)?.statusText }
            .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), null)

    // Snackbar getrennt vom Haupt-State: Meldungen sind der häufigste
    // querschneidende Update — als Feld in AppUiState hat jede Snackbar
    // den gesamten UI-Tree rekomponiert.
    //
    // Der Fluss gehoert seit dem Meldungskanal nicht mehr diesem ViewModel:
    // CatalogViewModel und jedes kuenftig herausgeloeste ViewModel schreiben in
    // DENSELBEN. Der Name bleibt `_snackbar`, damit die Schreibstellen in den
    // Feature-Dateien unveraendert lesen. Warum das so ist: MeldungsKanal.kt.
    internal val _snackbar = meldungen.fluss
    val snackbar = meldungen.meldung

    internal val _setDetailState = MutableStateFlow(SetDetailUiState())
    val setDetailState = _setDetailState.asStateFlow()

    internal val _csvImportState = MutableStateFlow(CsvImportUiState())
    val csvImportState = _csvImportState.asStateFlow()

    internal val _manDetailState = MutableStateFlow(ManualItemDetailUiState())
    val manDetailState = _manDetailState.asStateFlow()

    // Eigener Fluss statt zwölf Felder in AppUiState (Nachtrag 117): Ein Scan
    // erzeugt viele Zwischenstände, und die gingen vorher jeden Reiter an.
    internal val _barcodeState = MutableStateFlow(BarcodeUiState())
    val barcodeState = _barcodeState.asStateFlow()

    /**
     * Läuft gerade eine Prüfung vor dem Erfassen? Siehe ErfassungUiState.
     *
     * Eigener Fluss, weil ihn alle vier Erfassungswege speisen (Barcode,
     * Texterkennung, Galerie, Katalog) und nur der Anzeige-Dialog ihn liest.
     */
    /**
     * Galerie — eigener Fluss (Nachtrag: AppUiState-Aufteilung).
     *
     * Sechzehn Dateien sammeln `state`; die Galerie-Felder lesen davon drei.
     * Als Teil von AppUiState loeste jedes Blaettern und jede Suche eine
     * Rekomposition in allen sechzehn aus. Siehe GalleryUiState.
     */
    internal val _galleryState = MutableStateFlow(GalleryUiState())
    val galleryState = _galleryState.asStateFlow()

    internal val _erfassungState = MutableStateFlow(ErfassungUiState())
    val erfassungState = _erfassungState.asStateFlow()

    /**
     * Die laufende Prüfung, damit sie abgebrochen werden kann.
     *
     * Ohne den Merker wäre der Dialog eine Sackgasse: Hängt die Gegenstelle,
     * bliebe er stehen, bis das Zeitlimit der Verbindung greift — und genau in
     * dieser Zeit will man weiterscannen können. Neben partsJob und den
     * Galerie-Jobs, gleiches Muster.
     */
    internal var erfassungsJob: kotlinx.coroutines.Job? = null

    // Der Katalogzustand ist nach CatalogViewModel gewandert. Er wurde von
    // niemandem ausser den Katalogfunktionen gelesen — und die stehen jetzt
    // dort, wo sie auch ihre Abbruch-Jobs halten koennen.

    // Teile/Minifiguren und Finanzen — aus AppUiState herausgelöst, gleiches
    // Muster wie oben. Nur die Screens, die diese Daten tatsächlich anzeigen,
    // sammeln sie; ein Ladevorgang in der Teileliste rekomponiert damit nicht
    // mehr Galerie und Navigationsleiste mit.
    internal val _partsState = MutableStateFlow(PartsUiState())
    val partsState = _partsState.asStateFlow()

    internal val _financeState = MutableStateFlow(FinanceUiState())
    val financeState = _financeState.asStateFlow()

    /** Haushalt: Verknüpfung, Einladungscode, Servermeldung. */
    internal val _householdState = MutableStateFlow(HouseholdUiState())
    val householdState = _householdState.asStateFlow()

    /**
     * Nur das App-Design, entkoppelt vom übrigen Zustand.
     *
     * MainActivity sammelte bisher den kompletten AppUiState, um genau dieses
     * eine Feld zu lesen — jede Zustandsänderung invalidierte damit die Wurzel
     * der Composition und darüber die ganze App. distinctUntilChanged() sorgt
     * dafür, dass nur eine echte Designänderung durchkommt.
     */
    val appTheme = _state
        .map { it.appTheme }
        .distinctUntilChanged()
        .stateIn(viewModelScope, SharingStarted.Eagerly, _state.value.appTheme)

    init {
        // Session (URL + Token): nur bei *tatsächlicher* Änderung neu laden.
        // Früher hing hier auch currency dran — dadurch löste z. B.
        // loadValuation() (das die Währung speichert) einen kompletten
        // Dashboard-Reload aus.
        viewModelScope.launch {
            combine(prefs.serverUrl, prefs.authToken) { url, token -> url to token }
                .distinctUntilChanged()
                .collect { (url, token) ->
                    _state.update {
                        it.copy(
                            serverUrl  = url,
                            isLoggedIn = token.isNotBlank(),
                            authToken  = token
                        )
                    }
                    if (token.isNotBlank() && url.isNotBlank()) {
                        launch {
                            try {
                                val me = repo.admin.getMe()
                                if (me is Result.Success) {
                                    _state.update { it.copy(isAdmin = me.data.user?.isAdmin == true) }
                                }
                            } catch (_: Exception) {}
                        }
                        loadDashboard()
                        loadSettings()
                    }
                }
        }
        // Anzeige-Präferenzen separat — lösen keine Reloads aus
        // Der frueher hier gesammelte Benutzername ist entfallen (siehe
        // AppUiState). PreferencesManager.username und saveUsername() gibt es
        // noch — sie haben damit allerdings auch keinen Leser mehr.
        viewModelScope.launch {
            prefs.currency.collect { cur -> _state.update { it.copy(currency = cur) } }
        }
        viewModelScope.launch {
            prefs.language.collect { lang -> _state.update { it.copy(language = lang) } }
        }
        // Der OkHttp-Interceptor (AppModule) meldet hier jeden 401 von unserem
        // eigenen Server, bei dem ein Token mitgeschickt wurde. Reagiert wird
        // nur, wenn zu diesem Zeitpunkt tatsächlich noch eine Sitzung besteht —
        // ein 401 während des Login-Versuchs selbst läuft über die normale
        // Fehlermeldung in login(), nicht über dieses Signal (dort ist noch
        // kein Token gesetzt, siehe Guard im Interceptor).
        viewModelScope.launch {
            sessionExpired.events.collect {
                if (_state.value.isLoggedIn) {
                    _snackbar.value = text(R.string.vm_session_expired)
                    logout()
                }
            }
        }
    }

    // retryOnNetwork() steht jetzt paketweit in Netzwiederholung.kt — sie
    // brauchte nichts aus dieser Klasse, und die Bildschirm-ViewModels
    // ausserhalb von ui/ sollen sie ebenfalls benutzen koennen.

    // ── Parts ────────────────────────────────────────────────────────────────
    // Suche wird debounced (350 ms) und der vorherige Request abgebrochen:
    // Ohne das feuert jeder Tastendruck einen vollen Netzwerk-Request (500er-Page),
    // und eine langsame alte Antwort kann eine neuere überschreiben (Race).
    internal var partsJob: kotlinx.coroutines.Job? = null

    // ── Galerie ──────────────────────────────────────────────────────────────
    // Dieselbe Mechanik, und sie gehoert aus demselben Grund hierher: Als
    // `private var` auf Dateiebene in GalleryFeature.kt war sie prozessweit
    // statt je Instanz. Die Filter-Generation verwirft Antworten eines alten
    // Filters — eine geteilte Generation liesse zwei Instanzen einander die
    // Ergebnisse wegwerfen.
    internal var gallerySearchJob: kotlinx.coroutines.Job? = null
    internal var galleryListJob: kotlinx.coroutines.Job? = null
    internal var galleryGeneration = 0

    /**
     * Die EINE Stelle, an der ein Fehler einen Satz bekommt (Nachtrag 116).
     *
     * ── Warum das hier liegt und nicht im Repository ─────────────────────────
     * Das Repository hat keinen Context und kann nicht übersetzen. Solange es
     * seine Meldungen selbst formulierte, war jede Fehlermeldung der App
     * deutsch — auch für einen englischsprachigen Nutzer, dessen Bildschirme
     * sonst sauber lokalisiert waren. Es meldet jetzt nur noch, WAS passiert
     * ist ([Fehlerart]); wie es heisst, entscheidet diese Funktion.
     *
     * Vorrang hat immer die Meldung des SERVERS: Er kennt seine Fälle genauer
     * als jede Aufzählung hier (Kaufdatum-Konflikt, Währung passt nicht, Code
     * schon eingelöst) und antwortet in der Sprache des Kontos. Nur wenn er
     * keine schickt, formuliert die App selbst.
     */
    internal fun meldung(fehler: Result.Error): String {
        if (fehler.message.isNotBlank()) return fehler.message
        // Welcher Text zu welcher Ursache gehört, steht in FehlerTexte.kt —
        // als reine Funktion ohne Context, damit sie prüfbar ist (Nachtrag 117).
        val id = fehlerTextId(fehler.art)
        return if (fehlerTextBrauchtCode(fehler.art)) text(id, fehler.httpCode ?: 0)
        else text(id)
    }


    fun clearSnackbar(){ _snackbar.value = null }
    fun showSnackbar(msg: String) { _snackbar.value = msg }

    // ── CSV-Import-Überwachung ───────────────────────────────────────────────
    //
    // Einzige Ebene: persistente SSE-Verbindung, die dauerhaft offen bleibt.
    // Der Server schickt bei jeder Statusänderung sofort ein Event — also auch
    // wenn ein Import *startet* (egal ob von Webapp, App oder anderem Gerät).
    // Kein 30s-Poll mehr nötig. Bei Verbindungsfehler: exponentieller Backoff,
    // dann automatischer Reconnect. Schlägt SSE komplett fehl: Polling-Fallback.
    //
    // Lebenszyklus:  startCsvImportWatcher() → einmal beim Login aufgerufen →
    // läuft im viewModelScope bis zum Logout oder App-Ende.

    internal var csvWatchJob: kotlinx.coroutines.Job? = null

    /** Verarbeitet ein Status-Event: aktualisiert Banner und startet bei Bedarf den FG-Service. */
    internal suspend fun handleCsvStatus(s: ch.brickinventoryapp.data.model.CsvImportStatus) {
        val running = s.status == "running" || s.status == "pending"
        // Zustand VOR dieser Meldung — unten wird _csvImportState überschrieben.
        val warVorherAktiv = _csvImportState.value.running

        // FG-Service starten/stoppen je nach Import-Zustand
        if (running && !_csvImportState.value.running) {
            CsvImportService.start(ctx)
        }

        _csvImportState.value = CsvImportUiState(
            running = running,
            done    = s.done ?: 0,
            total   = s.total ?: 0,
            current = s.current,
            ok      = s.ok ?: 0,
            warn    = s.warn ?: 0,
            err     = s.err ?: 0
        )

        // ── Nur beim ÜBERGANG „lief" → „fertig" (Nachtrag 110) ────────────────
        //
        // Marcos Befund: „In der Galerie springt die Liste beim Scrollen zurück."
        // Sein Protokoll zeigte es unmissverständlich:
        //
        //     Seite 2: 60 empfangen, Liste  60 -> 120
        //     Seite 3: 60 empfangen, Liste 120 -> 180
        //     Seite 4: 60 empfangen, Liste 180 -> 240
        //     Seite 2: 60 empfangen, Liste  60 -> 120     ← zurück auf Anfang
        //
        // Alle fünf bis zehn Sekunden fiel die Liste auf 60 Einträge zurück, und
        // das Raster landete auf der letzten noch vorhandenen Zeile — immer
        // derselben. Genau der beobachtete Sprung.
        //
        // Ursache: Der SSE-Strom meldet den Importstatus fortlaufend, auch wenn
        // der Import längst abgeschlossen ist. Die Bedingung fragte nur „läuft
        // gerade nicht und ist kein Fehler" — das trifft auf JEDE Meldung eines
        // fertigen Imports zu. Also lief `finishCsvImport()` alle paar Sekunden
        // neu und ersetzte mit `loadSets()` die ganze Liste durch Seite 1.
        //
        // Der Wächter `csvFinishing` half nicht: Er wird nach fünf Sekunden
        // wieder freigegeben — genau im Takt der Meldungen.
        //
        // Ein Abschluss ist ein ÜBERGANG, kein Zustand. Nachgeladen wird jetzt
        // nur, wenn vorher tatsächlich ein Import lief.
        if (!running && warVorherAktiv && s.status != null && s.status != "error") {
            // Import abgeschlossen → Daten neu laden, Banner nach kurzer Pause ausblenden
            finishCsvImport()
        } else if (s.status == "error") {
            kotlinx.coroutines.delay(5000)
            _csvImportState.value = CsvImportUiState()
            CsvImportService.stop(ctx)
        }

        // Sets nachlagen falls Erstladung beim App-Start scheiterte
        if (_galleryState.value.sets.isEmpty() && !_galleryState.value.galleryLoading) loadDashboard()
    }

    /** Import abgeschlossen: Daten neu laden, Banner kurz sichtbar lassen, dann ausblenden. */
    @Volatile private var csvFinishing = false
    private suspend fun finishCsvImport() {
        if (csvFinishing) return
        csvFinishing = true
        try {
            loadSets(); loadStats()
            kotlinx.coroutines.delay(5000)
            _csvImportState.value = CsvImportUiState()
            CsvImportService.stop(ctx)
        } finally {
            csvFinishing = false
        }
    }

    /** Einmaliger Polling-Abruf als SSE-Fallback (kein Loop). */
    internal suspend fun runCatchingPollingFallback() {
        try {
            val url   = prefs.serverUrl.first()
            val token = prefs.authToken.first()
            if (token.isBlank() || url.isBlank()) return
            val resp = repo.sets.getCsvImportStatus(url, token)
            if (resp is Result.Success) handleCsvStatus(resp.data)
        } catch (_: Exception) {}
    }

}
