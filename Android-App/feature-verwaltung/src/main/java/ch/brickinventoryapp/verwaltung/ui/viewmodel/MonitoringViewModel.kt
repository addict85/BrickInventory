package ch.brickinventoryapp.verwaltung.ui.viewmodel

import ch.brickinventoryapp.model.ui.theme.Design
import ch.brickinventoryapp.model.fach.Zustand
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import ch.brickinventoryapp.data.MeldungsKanal
import ch.brickinventoryapp.data.repository.KontoRepository
import ch.brickinventoryapp.data.repository.VerwaltungRepository
import ch.brickinventoryapp.data.repository.Ergebnis
import ch.brickinventoryapp.verwaltung.ui.VerwaltungUiState
import ch.brickinventoryapp.model.ui.model.ApiGrenzenAnsicht
import ch.brickinventoryapp.model.ui.model.BricksetEintragAnsicht
import ch.brickinventoryapp.model.ui.model.CacheKennzahlenAnsicht
import ch.brickinventoryapp.model.ui.model.JobZustandAnsicht
import ch.brickinventoryapp.model.ui.model.ZeitplanAnsicht
import ch.brickinventoryapp.ressourcen.R
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject
import ch.brickinventoryapp.model.fach.Fehlercode
import ch.brickinventoryapp.model.ui.model.HintergrundAnsicht
import ch.brickinventoryapp.model.ui.Laden
import ch.brickinventoryapp.model.ui.Meldung
import ch.brickinventoryapp.model.ui.datenOderNull
import ch.brickinventoryapp.zustand.ui.alsLaden
import ch.brickinventoryapp.zustand.ui.ladefehler
import ch.brickinventoryapp.zustand.ui.fehlerMeldung
import ch.brickinventoryapp.zustand.ui.viewmodel.ladeBeimBeobachten

/**
 * Was der Monitoring-Bildschirm vom Server weiss — nur Serverdaten. Was gerade
 * bearbeitet wird (aufgeklappt, halb getippte Zahl), bleibt im Composable in
 * `rememberSaveable`.
 */
data class MonitoringUiState(
    val jobs: Map<String, JobZustandAnsicht> = emptyMap(),
    /**
     * Zeitplan je Job, mit derselben Antwort wie `jobs` (`schedules`): damit die App
     * zeigt, wann ein Job das nächste Mal läuft, und es ändern kann.
     */
    val jobSchedules: Map<String, ZeitplanAnsicht> = emptyMap(),
    val queue: Laden<List<BricksetEintragAnsicht>> = Laden.Daten(emptyList()),
    /** Was ein laufender oder eben gestarteter Knopf statt seiner Beschriftung zeigt. */
    val knoepfe: Map<Jobstart, Meldung> = emptyMap(),
    val aktualisiert: Boolean = false,
    val cacheStats: CacheKennzahlenAnsicht? = null,
    val apiLimits: ApiGrenzenAnsicht? = null,
    val cacheTtl: String = "24",
    val vorgabeZustand: Zustand = Zustand.NEU,
    /** Das Design, das der Verwalter allen vorgibt — nicht das eigene des Kontos. */
    val vorgabeDesign: Design? = null,
    /** Der Server sagte `nur_admins`: Die Abfrageschleife hört auf, statt alle 5 s erneut abgewiesen zu werden. */
    val zugriffEntzogen: Boolean = false,
)

private fun entzogen(r: Ergebnis<*>) = r is Ergebnis.Error && r.code == Fehlercode.NUR_ADMINS

/** Die Hintergrundarbeiten (Auftragstabelle); die Ansicht bleibt stehen, während neu geholt wird. */
data class HintergrundUiState(
    val ansicht: HintergrundAnsicht? = null,
    val abruf: Laden<Unit> = Laden.Daten(Unit),
)

/**
 * Der Monitoring-Bildschirm holt seine Daten über dieses ViewModel statt aus den Composables,
 * damit die Ladelogik ohne Compose-Laufzeit prüfbar ist.
 */
@HiltViewModel
class MonitoringViewModel @Inject constructor(
    private val verwaltung: VerwaltungRepository,
    private val konto: KontoRepository,
    private val meldungen: MeldungsKanal,
) : ViewModel(), MonitoringAktionen {

    private val _state = MutableStateFlow(MonitoringUiState())
    val state = _state.asStateFlow()

    init {
        ladeBeimBeobachten(_state) { viewModelScope.launch { ladeCacheUndGrenzen(); ladeDesignVorgabe() } }
    }

    /** Das Server-Protokoll — eigener Fluss, es lädt nur auf Wunsch. */
    private val _verwaltungState = MutableStateFlow(VerwaltungUiState())
    val verwaltungState = _verwaltungState.asStateFlow()

    internal suspend fun ladeProtokoll(minuten: Int) {
        _verwaltungState.update { it.copy(abruf = Laden.Laedt, protokollMinuten = minuten) }
        when (val r = verwaltung.getProtokoll(minuten)) {
            is Ergebnis.Success -> _verwaltungState.update { it.copy(protokoll = r.data, abruf = Laden.Daten(Unit)) }
            is Ergebnis.Error -> _verwaltungState.update { it.copy(abruf = ladefehler(r)) }
        }
    }

    override fun waehleProtokoll(minuten: Int) {
        viewModelScope.launch { ladeProtokoll(minuten) }
    }

    private val _hintergrund = MutableStateFlow(HintergrundUiState())
    val hintergrund = _hintergrund.asStateFlow()

    /**
     * Hält Aufträge und Hintergrundarbeiten aktuell, bis der Aufrufer endet (die Seite
     * ist nicht mehr zu sehen) oder der Server das Verwalterrecht verneint; dann
     * fragte jeder weitere Takt nur noch ein 403 ab.
     */
    suspend fun haltAktuell() {
        while (!_state.value.zugriffEntzogen) {
            ladeJobs()
            ladeHintergrund()
            delay(TAKT_MS)
        }
    }

    suspend fun ladeHintergrund() {
        _hintergrund.update { it.copy(abruf = Laden.Laedt) }
        when (val r = verwaltung.getAuftraege()) {
            is Ergebnis.Success -> _hintergrund.update { HintergrundUiState(ansicht = r.data) }
            is Ergebnis.Error -> {
                _hintergrund.update { it.copy(abruf = ladefehler(r)) }
                if (entzogen(r)) _state.update { it.copy(zugriffEntzogen = true) }
            }
        }
    }

    /**
     * Abbrechen, wiederholen, starten, leeren: Das Ergebnis ist die Meldung — bei 409
     * der Satz des Servers, denn nur er weiss, warum der Auftrag
     * inzwischen nicht mehr passt. Danach wird die Liste neu geholt, so oder so.
     */
    internal suspend fun brichAuftragAb(id: String): Meldung =
        nachAuftrag(verwaltung.brichAuftragAb(id)) { Meldung.Ressource(R.string.hintergrund_abgebrochen_ok) }

    internal suspend fun wiederholeAuftrag(id: String): Meldung =
        nachAuftrag(verwaltung.wiederholeAuftrag(id)) { Meldung.Ressource(R.string.hintergrund_wiederholt_ok) }

    internal suspend fun starteAuftragsArt(art: String, name: String): Meldung =
        nachAuftrag(verwaltung.starteAuftragsArt(art)) {
            Meldung.Ressource(if (it) R.string.hintergrund_gestartet else R.string.hintergrund_nichts_gestartet, listOf(name))
        }

    internal suspend fun leereAuftragsArt(art: String): Meldung =
        nachAuftrag(verwaltung.leereAuftragsArt(art)) { Meldung.Menge(R.plurals.hintergrund_geleert, it) }

    // Im viewModelScope, nicht im Scope des Bildschirms: Wer die Seite verlässt,
    // bricht die Aktion nicht ab, und der Satz geht nicht am Zustand vorbei.
    override fun auftragAbbrechen(id: String) = melde { brichAuftragAb(id) }
    override fun auftragWiederholen(id: String) = melde { wiederholeAuftrag(id) }
    override fun auftragsArtStarten(art: String, name: String) = melde { starteAuftragsArt(art, name) }
    override fun auftragsArtLeeren(art: String) = melde { leereAuftragsArt(art) }

    private val _einstellungenNeu = MutableStateFlow(false)

    /** Design oder Vorgabe-Zustand geändert: Die App lädt ihre Einstellungen nach und quittiert. */
    val einstellungenNeu = _einstellungenNeu.asStateFlow()

    fun einstellungenGeladen() {
        _einstellungenNeu.value = false
    }

    fun vorgabeZustandWaehlen(zustand: Zustand) = gespeichert(einstellungen = true) { setzeVorgabeZustand(zustand) }
    fun designWaehlen(theme: Design) = gespeichert(einstellungen = true) { setzeDesign(theme) }
    fun cacheDauerSpeichern(stunden: Int) = gespeichert { setzeCacheDauer(stunden) }
    fun cacheLeeren(alles: Boolean) = gespeichert(R.string.monitoring_cache_cleared) { leereCache(alles) }
    fun grenzwerteSpeichern(rebrickable: Int, bricklink: Int, brickset: Int) =
        gespeichert(R.string.monitoring_limits_saved) { setzeGrenzwerte(rebrickable, bricklink, brickset) }

    // Nur ein Erfolg meldet sich; ein Fehlschlag lässt den angezeigten Stand stehen.
    private fun gespeichert(satz: Int = R.string.monitoring_cache_saved, einstellungen: Boolean = false, aktion: suspend () -> Boolean) {
        viewModelScope.launch {
            if (!aktion()) return@launch
            if (einstellungen) _einstellungenNeu.value = true
            meldungen.zeige(Meldung.Ressource(satz))
        }
    }

    private fun melde(aktion: suspend () -> Meldung) {
        viewModelScope.launch { meldungen.zeige(aktion()) }
    }

    private suspend fun <T> nachAuftrag(r: Ergebnis<T>, erfolg: (T) -> Meldung): Meldung {
        val satz = when (r) {
            is Ergebnis.Success -> erfolg(r.data)
            is Ergebnis.Error -> fehlerMeldung(r)
        }
        ladeHintergrund()
        return satz
    }

    override fun aktualisiere() {
        viewModelScope.launch { ladeJobs() }
    }

    internal suspend fun ladeJobs() {
        _state.update { it.copy(aktualisiert = true) }
        val r = verwaltung.getJobs()
        _state.update {
            if (r is Ergebnis.Success)
                it.copy(jobs = r.data.jobs, jobSchedules = r.data.zeitplaene, aktualisiert = false)
            else it.copy(aktualisiert = false, zugriffEntzogen = it.zugriffEntzogen || entzogen(r))
        }
    }

    override fun zeigeWarteschlange() {
        viewModelScope.launch { ladeWarteschlange() }
    }

    internal suspend fun ladeWarteschlange() {
        _state.update { it.copy(queue = Laden.Laedt) }
        val r = verwaltung.getBricksetQueue()
        _state.update { it.copy(queue = r.alsLaden()) }
    }

    override fun wiederhole(setNummer: String) = meldeNach(
        { wiederholeEintrag(setNummer) },
        Meldung.Ressource(R.string.monitoring_retry_queued, listOf(setNummer)),
        Meldung.Ressource(R.string.monitoring_retry_error),
    )

    override fun entferne(setNummer: String) = meldeNach(
        { entferneEintrag(setNummer) },
        Meldung.Ressource(R.string.monitoring_entry_removed, listOf(setNummer)),
        Meldung.Ressource(R.string.monitoring_delete_error),
    )

    private fun meldeNach(aktion: suspend () -> Boolean, erfolg: Meldung, fehlschlag: Meldung) {
        viewModelScope.launch { meldungen.zeige(if (aktion()) erfolg else fehlschlag) }
    }

    /** Wiederholt einen hängengebliebenen Eintrag; lädt die Liste danach neu. */
    internal suspend fun wiederholeEintrag(setNummer: String): Boolean {
        val ok = verwaltung.retryBricksetEntry(setNummer) is Ergebnis.Success
        if (ok) ladeWarteschlange()
        return ok
    }

    /**
     * Entfernt einen Eintrag, in der Anzeige vorweggenommen. Scheitert der Server,
     * wird neu geladen statt die alte Kopie zurückgeschrieben — dazwischen kann sich
     * am Server anderes geändert haben.
     */
    internal suspend fun entferneEintrag(setNummer: String): Boolean {
        _state.update { s ->
            val ohne = s.queue.datenOderNull()?.filter { it.setNumber != setNummer }
            if (ohne == null) s else s.copy(queue = Laden.Daten(ohne))
        }
        val ok = verwaltung.deleteBricksetEntry(setNummer) is Ergebnis.Success
        if (!ok) ladeWarteschlange()
        return ok
    }

    /**
     * Ein Startknopf zeigt „startet…“, nach Erfolg vier Sekunden lang, was geschah, dann
     * wieder seine Beschriftung; ein Fehlschlag geht als Meldung in die Snackbar. Gesperrt
     * wird vor dem launch, sonst startete ein Doppeltipp zweimal.
     */
    override fun starte(job: Jobstart) {
        if (job in _state.value.knoepfe) return
        setzeKnopf(job, Meldung.Ressource(if (job == Jobstart.ANLEITUNGEN) R.string.common_loading else R.string.monitoring_starting))
        viewModelScope.launch {
            val gestartet = starteJob(job)
            if (gestartet == null) {
                setzeKnopf(job, null)
                val satz = if (job == Jobstart.ANLEITUNGEN) R.string.monitoring_reimport_error else R.string.monitoring_start_error
                meldungen.zeige(Meldung.Ressource(satz))
                return@launch
            }
            setzeKnopf(job, gestartet)
            delay(GESTARTET_MS)
            setzeKnopf(job, null)
        }
    }

    private fun setzeKnopf(job: Jobstart, stand: Meldung?) =
        _state.update { it.copy(knoepfe = if (stand == null) it.knoepfe - job else it.knoepfe + (job to stand)) }

    /** Startet den Job; zurück kommt, was der Knopf danach zeigt, oder null bei einem Fehlschlag. */
    internal suspend fun starteJob(job: Jobstart): Meldung? {
        val gestartet = Meldung.Ressource(R.string.monitoring_started)
        return when (job) {
            Jobstart.CSV_ABGLEICH -> Meldung.Ressource(R.string.monitoring_sync_started_short)
                .takeIf { verwaltung.triggerCsvSync() is Ergebnis.Success }
            Jobstart.PREISLAUF -> gestartet.takeIf { verwaltung.triggerPriceJob() is Ergebnis.Success }
            Jobstart.BESTANDSBILDER -> gestartet.takeIf { verwaltung.redownloadMissingImages() is Ergebnis.Success }
            // Die Bilder des Katalogs, nicht die des Bestands daneben.
            Jobstart.KATALOGBILDER -> gestartet.takeIf { verwaltung.queueCatalogImages() is Ergebnis.Success }
            Jobstart.ANLEITUNGEN -> (verwaltung.reimportInstructions() as? Ergebnis.Success)?.data
                ?.let { Meldung.Menge(R.plurals.monitoring_reimport_enqueued, it) }
        }
    }

    /**
     * Cache-Zahlen, API-Grenzwerte, Cache-Dauer und Vorgabe-Zustand in einem Zug —
     * nacheinander, weil es parallel nicht sichtbar schneller wäre, die Reihenfolge
     * der Zustandsänderungen aber unbestimmt.
     */
    internal suspend fun ladeCacheUndGrenzen() {
        (verwaltung.getCacheStats() as? Ergebnis.Success)?.let { r ->
            _state.update { it.copy(cacheStats = r.data) }
        }
        (verwaltung.getApiLimits() as? Ergebnis.Success)?.let { r ->
            _state.update { it.copy(apiLimits = r.data) }
        }
        (verwaltung.getCacheTtl() as? Ergebnis.Success)?.let { r ->
            _state.update { it.copy(cacheTtl = r.data) }
        }
        (konto.getDefaultCondition() as? Ergebnis.Success)?.let { r ->
            _state.update { it.copy(vorgabeZustand = r.data) }
        }
    }

    internal suspend fun setzeCacheDauer(stunden: Int): Boolean {
        val ok = verwaltung.setCacheTtl(stunden) is Ergebnis.Success
        if (ok) _state.update { it.copy(cacheTtl = stunden.toString()) }
        return ok
    }

    /**
     * Cache leeren und die Zahlen sofort neu holen — sonst stünden die alten da, und
     * nichts zeigte, dass etwas passiert ist.
     */
    internal suspend fun leereCache(alles: Boolean): Boolean {
        val ok = verwaltung.clearCache(alles) is Ergebnis.Success
        if (ok) ladeCacheUndGrenzen()
        return ok
    }

    /**
     * Zeitplan eines Jobs setzen und neu holen, weil der Server normalisiert („7:5“ →
     * „07:05“, mindestens fünf Minuten): Es soll dastehen, was gilt.
     */
    override fun setzeZeitplan(name: String, zeit: String?, minuten: Int?) {
        viewModelScope.launch {
            if (setzeJobZeitplan(name, zeit, minuten)) meldungen.zeige(Meldung.Ressource(R.string.monitoring_cache_saved))
        }
    }

    internal suspend fun setzeJobZeitplan(name: String, zeit: String? = null, minuten: Int? = null): Boolean {
        val ok = verwaltung.setJobSchedule(name, zeit, minuten) is Ergebnis.Success
        if (ok) ladeJobs()
        return ok
    }

    /**
     * Die Vorgabe aus /settings/theme. Ein älterer Server kennt `vorgabe` noch
     * nicht; dort war das wirksame Design zugleich die Vorgabe.
     */
    internal suspend fun ladeDesignVorgabe() {
        (konto.getAppTheme() as? Ergebnis.Success)?.let { r ->
            _state.update { it.copy(vorgabeDesign = r.data.vorgabe ?: r.data.wirksam) }
        }
    }

    /**
     * Das globale Design umstellen. `loadSettings()` beim Aufrufer zieht den neuen
     * Wert in den Zustand und merkt ihn, damit die Anzeige sofort wechselt und den
     * Kaltstart überlebt.
     */
    internal suspend fun setzeDesign(theme: Design): Boolean {
        val ok = verwaltung.setAppTheme(theme) is Ergebnis.Success
        if (ok) _state.update { it.copy(vorgabeDesign = theme) }
        return ok
    }

    internal suspend fun setzeGrenzwerte(rebrickable: Int, bricklink: Int, brickset: Int): Boolean {
        val ok = verwaltung.setApiLimits(rebrickable, bricklink, brickset) is Ergebnis.Success
        if (ok) {
            (verwaltung.getApiLimits() as? Ergebnis.Success)?.let { r ->
                _state.update { it.copy(apiLimits = r.data) }
            }
        }
        return ok
    }

    /**
     * Vorgabe-Zustand (neu/gebraucht) setzen, in der Anzeige vorweggenommen; scheitert
     * der Aufruf, wird zurückgestellt, sonst behauptete die Oberfläche etwas, das nie
     * gespeichert wurde.
     */
    internal suspend fun setzeVorgabeZustand(zustand: Zustand): Boolean {
        val vorher = _state.value.vorgabeZustand
        _state.update { it.copy(vorgabeZustand = zustand) }
        val ok = verwaltung.setDefaultCondition(zustand) is Ergebnis.Success
        if (!ok) _state.update { it.copy(vorgabeZustand = vorher) }
        return ok
    }
}

/** Abstand der Abfragen, solange das Monitoring zu sehen ist. */
private const val TAKT_MS = 5_000L

/** So lange zeigt ein Startknopf, dass er gestartet hat. */
private const val GESTARTET_MS = 4_000L
