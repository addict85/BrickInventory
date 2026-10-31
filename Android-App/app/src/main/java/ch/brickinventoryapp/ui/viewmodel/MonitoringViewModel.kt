package ch.brickinventoryapp.ui.viewmodel

import androidx.lifecycle.ViewModel
import ch.brickinventoryapp.data.model.ApiLimits
import ch.brickinventoryapp.data.model.BricksetQueueEntry
import ch.brickinventoryapp.data.model.CacheStatsResponse
import ch.brickinventoryapp.data.model.JobStatus
import ch.brickinventoryapp.data.repository.BrickRepository
import ch.brickinventoryapp.data.repository.Result
import ch.brickinventoryapp.ui.VerwaltungUiState
import ch.brickinventoryapp.ui.model.alsAnsicht
import ch.brickinventoryapp.R
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import javax.inject.Inject

/**
 * Was der Monitoring-Bildschirm vom Server weiss — nur Serverdaten. Was gerade
 * bearbeitet wird (aufgeklappt, halb getippte Zahl), bleibt im Composable in
 * `rememberSaveable`.
 */
data class MonitoringUiState(
    val jobs: Map<String, JobStatus> = emptyMap(),
    /**
     * Zeitplan je Job, mit derselben Antwort wie `jobs` (`schedules`): damit die App
     * zeigt, wann ein Job das nächste Mal läuft, und es ändern kann.
     */
    val jobSchedules: Map<String, ch.brickinventoryapp.data.model.JobSchedule> = emptyMap(),
    val queue: List<BricksetQueueEntry> = emptyList(),
    val queueLoading: Boolean = false,
    val aktualisiert: Boolean = false,
    val cacheStats: CacheStatsResponse? = null,
    val apiLimits: ApiLimits? = null,
    val cacheTtl: String = "24",
    val vorgabeZustand: String = "N",
    /** Das Design, das der Verwalter allen vorgibt — nicht das eigene des Kontos. */
    val vorgabeDesign: String? = null,
)

/**
 * Der Monitoring-Bildschirm holt seine Daten über dieses ViewModel statt aus den
 * Composables, damit die Ladelogik ohne Compose-Laufzeit prüfbar ist. Ein eigenes
 * ViewModel am NavHost-Ziel (hiltViewModel()), weil der selten geöffnete
 * Bildschirm mit seiner Abfrageschleife nicht die Lebensdauer der Activity
 * braucht.
 *
 *   hierher      was vom Server kommt — wird ohnehin neu geladen
 *   Bildschirm   was der Mensch angefasst hat (rememberSaveable)
 *   Bildschirm   Knopftexte eines laufenden Vorgangs — dürfen eine Drehung nicht überleben
 *
 * Keine Texte hier: Die Funktionen sagen, was passiert ist; den Satz wählt die
 * Anzeige, wie in FehlerTexte.kt.
 */
/** Die Hintergrundarbeiten (Auftragstabelle); [fehler] ist der Satz des Servers, etwa bei 403 oder 409. */
data class HintergrundUiState(
    val laedt: Boolean = false,
    val ansicht: ch.brickinventoryapp.ui.model.HintergrundAnsicht? = null,
    val fehler: String? = null,
)

@HiltViewModel
class MonitoringViewModel @Inject constructor(
    private val repo: BrickRepository,
    private val texte: Texte,
) : ViewModel() {

    private val _state = MutableStateFlow(MonitoringUiState())
    val state = _state.asStateFlow()

    /** Das Server-Protokoll — eigener Fluss, es lädt nur auf Wunsch. */
    private val _verwaltungState = MutableStateFlow(VerwaltungUiState())
    val verwaltungState = _verwaltungState.asStateFlow()

    suspend fun ladeProtokoll(minuten: Int = _verwaltungState.value.protokollMinuten) {
        _verwaltungState.update { it.copy(protokollLaden = true, protokollMinuten = minuten, fehler = null) }
        when (val r = repo.verwaltung.getProtokoll(minuten)) {
            is Result.Success -> _verwaltungState.update {
                it.copy(protokollLaden = false, protokoll = r.data.logs,
                        fehler = if (r.data.success) null else r.data.error)
            }
            is Result.Error -> _verwaltungState.update { it.copy(protokollLaden = false, fehler = texte.meldung(r)) }
        }
    }

    private val _hintergrund = MutableStateFlow(HintergrundUiState())
    val hintergrund = _hintergrund.asStateFlow()

    suspend fun ladeHintergrund() {
        _hintergrund.update { it.copy(laedt = true) }
        when (val r = repo.verwaltung.getAuftraege()) {
            is Result.Success -> _hintergrund.update { HintergrundUiState(ansicht = r.data.alsAnsicht()) }
            is Result.Error -> _hintergrund.update { it.copy(laedt = false, fehler = texte.meldung(r)) }
        }
    }

    /**
     * Abbrechen, wiederholen, starten, leeren: Das Ergebnis ist der Satz für die
     * Meldung — bei 409 der des Servers, denn nur er weiss, warum der Auftrag
     * inzwischen nicht mehr passt. Danach wird die Liste neu geholt, so oder so.
     */
    suspend fun brichAuftragAb(id: String): String =
        nachAuftrag(repo.verwaltung.brichAuftragAb(id)) { texte.text(R.string.hintergrund_abgebrochen_ok) }

    suspend fun wiederholeAuftrag(id: String): String =
        nachAuftrag(repo.verwaltung.wiederholeAuftrag(id)) { texte.text(R.string.hintergrund_wiederholt_ok) }

    suspend fun starteAuftragsArt(art: String, name: String): String =
        nachAuftrag(repo.verwaltung.starteAuftragsArt(art)) {
            texte.text(if (it.gestartet) R.string.hintergrund_gestartet else R.string.hintergrund_nichts_gestartet, name)
        }

    suspend fun leereAuftragsArt(art: String): String =
        nachAuftrag(repo.verwaltung.leereAuftragsArt(art)) { texte.menge(R.plurals.hintergrund_geleert, it.entfernt, it.entfernt) }

    private suspend fun <T> nachAuftrag(r: Result<T>, erfolg: (T) -> String): String {
        val satz = when (r) {
            is Result.Success -> erfolg(r.data)
            is Result.Error -> texte.meldung(r)
        }
        ladeHintergrund()
        return satz
    }

    suspend fun ladeJobs() {
        _state.update { it.copy(aktualisiert = true) }
        val r = repo.verwaltung.getJobs()
        _state.update {
            if (r is Result.Success)
                it.copy(jobs = r.data.jobs, jobSchedules = r.data.schedules, aktualisiert = false)
            else it.copy(aktualisiert = false)
        }
    }

    suspend fun ladeWarteschlange() {
        _state.update { it.copy(queueLoading = true) }
        val r = repo.verwaltung.getBricksetQueue()
        _state.update {
            if (r is Result.Success) it.copy(queue = r.data.entries, queueLoading = false)
            else it.copy(queueLoading = false)
        }
    }

    /** Wiederholt einen hängengebliebenen Eintrag; lädt die Liste danach neu. */
    suspend fun wiederholeEintrag(setNummer: String): Boolean {
        val ok = repo.verwaltung.retryBricksetEntry(setNummer) is Result.Success
        if (ok) ladeWarteschlange()
        return ok
    }

    /**
     * Entfernt einen Eintrag, in der Anzeige vorweggenommen. Scheitert der Server,
     * wird neu geladen statt die alte Kopie zurückgeschrieben — dazwischen kann sich
     * am Server anderes geändert haben.
     */
    suspend fun entferneEintrag(setNummer: String): Boolean {
        _state.update { it.copy(queue = it.queue.filter { e -> e.setNumber != setNummer }) }
        val ok = repo.verwaltung.deleteBricksetEntry(setNummer) is Result.Success
        if (!ok) ladeWarteschlange()
        return ok
    }

    /** Anleitungen neu einlesen; zurück kommt die Zahl der eingereihten Sets, sonst null. */
    suspend fun leseAnleitungenNeuEin(): Int? =
        (repo.verwaltung.reimportInstructions() as? Result.Success)?.data?.enqueued

    suspend fun starteCsvAbgleich(): Boolean = repo.verwaltung.triggerCsvSync() is Result.Success

    suspend fun startePreislauf(): Boolean = repo.verwaltung.triggerPriceJob() is Result.Success

    suspend fun ladeFehlendeBilderNach(): Boolean =
        repo.verwaltung.redownloadMissingImages() is Result.Success

    /**
     * Cache-Zahlen, API-Grenzwerte, Cache-Dauer und Vorgabe-Zustand in einem Zug —
     * nacheinander, weil es parallel nicht sichtbar schneller wäre, die Reihenfolge
     * der Zustandsänderungen aber unbestimmt.
     */
    suspend fun ladeCacheUndGrenzen() {
        (repo.verwaltung.getCacheStats() as? Result.Success)?.let { r ->
            _state.update { it.copy(cacheStats = r.data) }
        }
        (repo.verwaltung.getApiLimits() as? Result.Success)?.let { r ->
            _state.update { it.copy(apiLimits = r.data.limits) }
        }
        (repo.verwaltung.getCacheTtl() as? Result.Success)?.let { r ->
            _state.update { it.copy(cacheTtl = r.data.ttl) }
        }
        (repo.konto.getDefaultCondition() as? Result.Success)?.let { r ->
            _state.update { it.copy(vorgabeZustand = r.data.condition) }
        }
    }

    suspend fun setzeCacheDauer(stunden: Int): Boolean {
        val ok = repo.verwaltung.setCacheTtl(stunden) is Result.Success
        if (ok) _state.update { it.copy(cacheTtl = stunden.toString()) }
        return ok
    }

    /**
     * Cache leeren und die Zahlen sofort neu holen — sonst stünden die alten da, und
     * nichts zeigte, dass etwas passiert ist.
     */
    suspend fun leereCache(alles: Boolean): Boolean {
        val ok = repo.verwaltung.clearCache(alles) is Result.Success
        if (ok) ladeCacheUndGrenzen()
        return ok
    }

    /**
     * Zeitplan eines Jobs setzen und neu holen, weil der Server normalisiert („7:5“ →
     * „07:05“, mindestens fünf Minuten): Es soll dastehen, was gilt.
     */
    suspend fun setzeJobZeitplan(name: String, zeit: String? = null, minuten: Int? = null): Boolean {
        val ok = repo.verwaltung.setJobSchedule(name, zeit, minuten) is Result.Success
        if (ok) ladeJobs()
        return ok
    }

    /** Fehlende KATALOGbilder einreihen — nicht die des Bestands daneben. */
    suspend fun reiheKatalogbilderEin(): Boolean =
        repo.verwaltung.queueCatalogImages() is Result.Success

    /**
     * Das globale Design umstellen. `loadSettings()` beim Aufrufer zieht den neuen
     * Wert in den Zustand und merkt ihn, damit die Anzeige sofort wechselt und den
     * Kaltstart überlebt.
     */
    /**
     * Die Vorgabe aus /settings/theme. Ein älterer Server kennt `vorgabe` noch
     * nicht; dort war das wirksame Design zugleich die Vorgabe.
     */
    suspend fun ladeDesignVorgabe() {
        (repo.konto.getAppTheme() as? Result.Success)?.let { r ->
            if (r.data.success) _state.update { it.copy(vorgabeDesign = r.data.vorgabe ?: r.data.theme) }
        }
    }

    suspend fun setzeDesign(theme: String): Boolean {
        val ok = repo.verwaltung.setAppTheme(theme) is Result.Success
        if (ok) _state.update { it.copy(vorgabeDesign = theme) }
        return ok
    }

    suspend fun setzeGrenzwerte(rebrickable: Int, bricklink: Int, brickset: Int): Boolean {
        val ok = repo.verwaltung.setApiLimits(rebrickable, bricklink, brickset) is Result.Success
        if (ok) {
            (repo.verwaltung.getApiLimits() as? Result.Success)?.let { r ->
                _state.update { it.copy(apiLimits = r.data.limits) }
            }
        }
        return ok
    }

    /**
     * Vorgabe-Zustand (neu/gebraucht) setzen, in der Anzeige vorweggenommen; scheitert
     * der Aufruf, wird zurückgestellt, sonst behauptete die Oberfläche etwas, das nie
     * gespeichert wurde.
     */
    suspend fun setzeVorgabeZustand(zustand: String): Boolean {
        val vorher = _state.value.vorgabeZustand
        _state.update { it.copy(vorgabeZustand = zustand) }
        val ok = repo.verwaltung.setDefaultCondition(zustand) is Result.Success
        if (!ok) _state.update { it.copy(vorgabeZustand = vorher) }
        return ok
    }
}
