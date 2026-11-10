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
import ch.brickinventoryapp.model.ui.model.alsAnsicht
import ch.brickinventoryapp.ressourcen.R
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject
import ch.brickinventoryapp.model.data.model.Fehlercode
import ch.brickinventoryapp.model.ui.model.HintergrundAnsicht
import ch.brickinventoryapp.zustand.ui.viewmodel.Texte

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
    val queue: List<BricksetEintragAnsicht> = emptyList(),
    val queueLoading: Boolean = false,
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

/** Die Hintergrundarbeiten (Auftragstabelle); [fehler] ist der Satz des Servers, etwa bei 403 oder 409. */
data class HintergrundUiState(
    val laedt: Boolean = false,
    val ansicht: HintergrundAnsicht? = null,
    val fehler: String? = null,
)

/**
 * Der Monitoring-Bildschirm holt seine Daten über dieses ViewModel statt aus den Composables,
 * damit die Ladelogik ohne Compose-Laufzeit prüfbar ist.
 */
@HiltViewModel
class MonitoringViewModel @Inject constructor(
    private val verwaltung: VerwaltungRepository,
    private val konto: KontoRepository,
    private val texte: Texte,
    private val meldungen: MeldungsKanal,
) : ViewModel(), MonitoringAktionen {

    private val _state = MutableStateFlow(MonitoringUiState())
    val state = _state.asStateFlow()

    /** Das Server-Protokoll — eigener Fluss, es lädt nur auf Wunsch. */
    private val _verwaltungState = MutableStateFlow(VerwaltungUiState())
    val verwaltungState = _verwaltungState.asStateFlow()

    /** Das Protokoll für den gewählten Zeitraum neu holen. */
    suspend fun ladeProtokoll() = ladeProtokoll(_verwaltungState.value.protokollMinuten)

    override suspend fun ladeProtokoll(minuten: Int) {
        _verwaltungState.update { it.copy(protokollLaden = true, protokollMinuten = minuten, fehler = null) }
        when (val r = verwaltung.getProtokoll(minuten)) {
            is Ergebnis.Success -> _verwaltungState.update {
                it.copy(protokollLaden = false, protokoll = r.data.logs.map { it.alsAnsicht() },
                        fehler = if (r.data.success) null else r.data.error)
            }
            is Ergebnis.Error -> _verwaltungState.update { it.copy(protokollLaden = false, fehler = texte.meldung(r)) }
        }
    }

    private val _hintergrund = MutableStateFlow(HintergrundUiState())
    val hintergrund = _hintergrund.asStateFlow()

    suspend fun ladeHintergrund() {
        _hintergrund.update { it.copy(laedt = true) }
        when (val r = verwaltung.getAuftraege()) {
            is Ergebnis.Success -> _hintergrund.update { HintergrundUiState(ansicht = r.data.alsAnsicht()) }
            is Ergebnis.Error -> {
                _hintergrund.update { it.copy(laedt = false, fehler = texte.meldung(r)) }
                if (entzogen(r)) _state.update { it.copy(zugriffEntzogen = true) }
            }
        }
    }

    /**
     * Abbrechen, wiederholen, starten, leeren: Das Ergebnis ist der Satz für die
     * Meldung — bei 409 der des Servers, denn nur er weiss, warum der Auftrag
     * inzwischen nicht mehr passt. Danach wird die Liste neu geholt, so oder so.
     */
    internal suspend fun brichAuftragAb(id: String): String =
        nachAuftrag(verwaltung.brichAuftragAb(id)) { texte.text(R.string.hintergrund_abgebrochen_ok) }

    internal suspend fun wiederholeAuftrag(id: String): String =
        nachAuftrag(verwaltung.wiederholeAuftrag(id)) { texte.text(R.string.hintergrund_wiederholt_ok) }

    internal suspend fun starteAuftragsArt(art: String, name: String): String =
        nachAuftrag(verwaltung.starteAuftragsArt(art)) {
            texte.text(if (it.gestartet) R.string.hintergrund_gestartet else R.string.hintergrund_nichts_gestartet, name)
        }

    internal suspend fun leereAuftragsArt(art: String): String =
        nachAuftrag(verwaltung.leereAuftragsArt(art)) { texte.menge(R.plurals.hintergrund_geleert, it.entfernt, it.entfernt) }

    // Im viewModelScope, nicht im Scope des Bildschirms: Wer die Seite verlässt,
    // bricht die Aktion nicht ab, und der Satz geht nicht am Zustand vorbei.
    override fun auftragAbbrechen(id: String) = melde { brichAuftragAb(id) }
    override fun auftragWiederholen(id: String) = melde { wiederholeAuftrag(id) }
    override fun auftragsArtStarten(art: String, name: String) = melde { starteAuftragsArt(art, name) }
    override fun auftragsArtLeeren(art: String) = melde { leereAuftragsArt(art) }

    private val _einstellungenNeu = MutableStateFlow(false)

    /** Design oder Vorgabe-Zustand geändert: Die App lädt ihre Einstellungen nach und quittiert. */
    val einstellungenNeu = _einstellungenNeu.asStateFlow()

    override fun melde(satz: String) {
        meldungen.zeige(satz)
    }

    fun einstellungenGeladen() {
        _einstellungenNeu.value = false
    }

    /** Cache-Zahlen, Grenzwerte und Design-Vorgabe für den Cache-Abschnitt. */
    fun ladeCacheAbschnitt() {
        viewModelScope.launch { ladeCacheUndGrenzen(); ladeDesignVorgabe() }
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
            meldungen.zeige(texte.text(satz))
        }
    }

    private fun melde(aktion: suspend () -> String) {
        viewModelScope.launch { meldungen.zeige(aktion()) }
    }

    private suspend fun <T> nachAuftrag(r: Ergebnis<T>, erfolg: (T) -> String): String {
        val satz = when (r) {
            is Ergebnis.Success -> erfolg(r.data)
            is Ergebnis.Error -> texte.meldung(r)
        }
        ladeHintergrund()
        return satz
    }

    override suspend fun ladeJobs() {
        _state.update { it.copy(aktualisiert = true) }
        val r = verwaltung.getJobs()
        _state.update {
            if (r is Ergebnis.Success)
                it.copy(jobs = r.data.jobs.mapValues { j -> j.value.alsAnsicht() },
                    jobSchedules = r.data.schedules.mapValues { z -> z.value.alsAnsicht() }, aktualisiert = false)
            else it.copy(aktualisiert = false, zugriffEntzogen = it.zugriffEntzogen || entzogen(r))
        }
    }

    override suspend fun ladeWarteschlange() {
        _state.update { it.copy(queueLoading = true) }
        val r = verwaltung.getBricksetQueue()
        _state.update {
            if (r is Ergebnis.Success) it.copy(queue = r.data.entries.map { e -> e.alsAnsicht() }, queueLoading = false)
            else it.copy(queueLoading = false)
        }
    }

    /** Wiederholt einen hängengebliebenen Eintrag; lädt die Liste danach neu. */
    override suspend fun wiederholeEintrag(setNummer: String): Boolean {
        val ok = verwaltung.retryBricksetEntry(setNummer) is Ergebnis.Success
        if (ok) ladeWarteschlange()
        return ok
    }

    /**
     * Entfernt einen Eintrag, in der Anzeige vorweggenommen. Scheitert der Server,
     * wird neu geladen statt die alte Kopie zurückgeschrieben — dazwischen kann sich
     * am Server anderes geändert haben.
     */
    override suspend fun entferneEintrag(setNummer: String): Boolean {
        _state.update { it.copy(queue = it.queue.filter { e -> e.setNumber != setNummer }) }
        val ok = verwaltung.deleteBricksetEntry(setNummer) is Ergebnis.Success
        if (!ok) ladeWarteschlange()
        return ok
    }

    /** Anleitungen neu einlesen; zurück kommt die Zahl der eingereihten Sets, sonst null. */
    override suspend fun leseAnleitungenNeuEin(): Int? =
        (verwaltung.reimportInstructions() as? Ergebnis.Success)?.data?.enqueued

    override suspend fun starteCsvAbgleich(): Boolean = verwaltung.triggerCsvSync() is Ergebnis.Success

    override suspend fun startePreislauf(): Boolean = verwaltung.triggerPriceJob() is Ergebnis.Success

    override suspend fun ladeFehlendeBilderNach(): Boolean =
        verwaltung.redownloadMissingImages() is Ergebnis.Success

    /**
     * Cache-Zahlen, API-Grenzwerte, Cache-Dauer und Vorgabe-Zustand in einem Zug —
     * nacheinander, weil es parallel nicht sichtbar schneller wäre, die Reihenfolge
     * der Zustandsänderungen aber unbestimmt.
     */
    internal suspend fun ladeCacheUndGrenzen() {
        (verwaltung.getCacheStats() as? Ergebnis.Success)?.let { r ->
            _state.update { it.copy(cacheStats = r.data.alsAnsicht()) }
        }
        (verwaltung.getApiLimits() as? Ergebnis.Success)?.let { r ->
            _state.update { it.copy(apiLimits = r.data.limits.alsAnsicht()) }
        }
        (verwaltung.getCacheTtl() as? Ergebnis.Success)?.let { r ->
            _state.update { it.copy(cacheTtl = r.data.ttl) }
        }
        (konto.getDefaultCondition() as? Ergebnis.Success)?.let { r ->
            _state.update { it.copy(vorgabeZustand = r.data.condition) }
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
    override suspend fun setzeJobZeitplan(name: String, zeit: String?, minuten: Int?): Boolean {
        val ok = verwaltung.setJobSchedule(name, zeit, minuten) is Ergebnis.Success
        if (ok) ladeJobs()
        return ok
    }

    /** Fehlende KATALOGbilder einreihen — nicht die des Bestands daneben. */
    override suspend fun reiheKatalogbilderEin(): Boolean =
        verwaltung.queueCatalogImages() is Ergebnis.Success

    /**
     * Die Vorgabe aus /settings/theme. Ein älterer Server kennt `vorgabe` noch
     * nicht; dort war das wirksame Design zugleich die Vorgabe.
     */
    internal suspend fun ladeDesignVorgabe() {
        (konto.getAppTheme() as? Ergebnis.Success)?.let { r ->
            if (r.data.success) _state.update { it.copy(vorgabeDesign = r.data.vorgabe ?: r.data.theme) }
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
                _state.update { it.copy(apiLimits = r.data.limits.alsAnsicht()) }
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
