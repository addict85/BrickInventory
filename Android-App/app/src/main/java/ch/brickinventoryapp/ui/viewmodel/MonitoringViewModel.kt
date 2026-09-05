package ch.brickinventoryapp.ui.viewmodel

import androidx.lifecycle.ViewModel
import ch.brickinventoryapp.data.model.ApiLimits
import ch.brickinventoryapp.data.model.BricksetQueueEntry
import ch.brickinventoryapp.data.model.CacheStatsResponse
import ch.brickinventoryapp.data.model.JobStatus
import ch.brickinventoryapp.data.repository.BrickRepository
import ch.brickinventoryapp.data.repository.Result
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import javax.inject.Inject

/**
 * Was der Monitoring-Bildschirm vom Server weiss.
 *
 * Nur SERVERDATEN. Was gerade im Bildschirm bearbeitet wird — ob die
 * Warteschlange aufgeklappt ist, welche Zahl halb in ein Eingabefeld getippt
 * wurde — bleibt bewusst im Composable als `rememberSaveable`. Begründung
 * unten in der Klasse.
 */
data class MonitoringUiState(
    val jobs: Map<String, JobStatus> = emptyMap(),
    /**
     * Zeitplan je Job — kommt mit derselben Antwort wie `jobs`.
     *
     * Der Server schickt ihn seit jeher mit (routes/api_v1/admin.ts,
     * `schedules`); die App hat ihn nie eingelesen. Sie zeigte damit, DASS ein
     * Job laeuft, aber nicht, wann er das naechste Mal laeuft — und aendern
     * konnte sie es schon gar nicht (Nachtrag 137).
     */
    val jobSchedules: Map<String, ch.brickinventoryapp.data.model.JobSchedule> = emptyMap(),
    val queue: List<BricksetQueueEntry> = emptyList(),
    val queueLoading: Boolean = false,
    val aktualisiert: Boolean = false,
    val cacheStats: CacheStatsResponse? = null,
    val apiLimits: ApiLimits? = null,
    val cacheTtl: String = "24",
    val vorgabeZustand: String = "N",
)

/**
 * Der Monitoring-Bildschirm holt seine Daten nicht mehr selbst.
 *
 * ── Der Befund ─────────────────────────────────────────────────────────────
 * MonitoringScreen.kt und MonitoringSections.kt waren die einzigen zwei
 * Dateien im Baum, die über `vm.repo` direkt an die Datenschicht griffen —
 * sechzehn Aufrufe mitten aus Composables heraus. Alle anderen Bildschirme
 * gehen über MainViewModel.
 *
 * Das ist die schlechtere Hälfte des Befunds „ViewModels je Bildschirm": Nicht
 * dass ein ViewModel zu viel kann, sondern dass ein Bildschirm die Rolle
 * gleich selbst übernimmt. Praktisch heisst das: Die Ladelogik lässt sich
 * nicht ohne Compose-Laufzeit ausführen, also auch nicht prüfen. Ob ein
 * fehlgeschlagenes Löschen die Liste wieder herstellt, konnte niemand
 * nachfahren — es stand in einem Lambda in einem `items {}`-Block.
 *
 * ── Warum ein EIGENES ViewModel und nicht MainViewModel ────────────────────
 * MainViewModel lebt so lange wie die Activity und hält den Zustand aller
 * Reiter. Monitoring ist ein Verwaltungsbildschirm, den man selten öffnet,
 * mit einer Abfrageschleife alle fünf Sekunden. Hier eingehängt (die Route
 * ist ein NavHost-Ziel, `hiltViewModel()` bindet also an den Backstack-
 * Eintrag) entsteht der Zustand beim Betreten und verschwindet beim
 * Verlassen — statt für die Dauer der App mitgetragen zu werden.
 *
 * ── Die Grenze zum Bildschirm, und warum sie dort liegt ────────────────────
 * Ein ViewModel überlebt die Drehung, aber NICHT den Prozesstod;
 * `rememberSaveable` überlebt beides. Wer Bedienzustand in ein ViewModel
 * schiebt, nimmt also zurück, was der vorige Schritt gerade eingebaut hat.
 * Deshalb der Schnitt:
 *
 *   hierher      was vom Server kommt — es wird ohnehin neu geladen, ein
 *                Bundle wäre nur eine zweite, alternde Kopie
 *   Bildschirm   was der Mensch angefasst hat — aufgeklappt/zugeklappt,
 *                Eingabefelder, „ich bearbeite gerade" (rememberSaveable)
 *   Bildschirm   Knopftexte eines laufenden Vorgangs („starte…") — sie
 *                dürfen eine Drehung ausdrücklich NICHT überleben
 *
 * ── Keine Texte hier ───────────────────────────────────────────────────────
 * Die Funktionen geben zurück, WAS passiert ist, nicht welcher Satz dazu
 * anzuzeigen ist. Dieselbe Trennung wie in FehlerTexte.kt: Die Zuordnung
 * Ursache → Textressource braucht keinen Context und ist damit ohne
 * Android-Laufzeit prüfbar.
 */
@HiltViewModel
class MonitoringViewModel @Inject constructor(
    private val repo: BrickRepository,
) : ViewModel() {

    private val _state = MutableStateFlow(MonitoringUiState())
    val state = _state.asStateFlow()

    suspend fun ladeJobs() {
        _state.update { it.copy(aktualisiert = true) }
        val r = repo.admin.getJobs()
        _state.update {
            if (r is Result.Success)
                it.copy(jobs = r.data.jobs, jobSchedules = r.data.schedules, aktualisiert = false)
            else it.copy(aktualisiert = false)
        }
    }

    suspend fun ladeWarteschlange() {
        _state.update { it.copy(queueLoading = true) }
        val r = repo.admin.getBricksetQueue()
        _state.update {
            if (r is Result.Success) it.copy(queue = r.data.entries, queueLoading = false)
            else it.copy(queueLoading = false)
        }
    }

    /** Wiederholt einen hängengebliebenen Eintrag; lädt die Liste danach neu. */
    suspend fun wiederholeEintrag(setNummer: String): Boolean {
        val ok = repo.admin.retryBricksetEntry(setNummer) is Result.Success
        if (ok) ladeWarteschlange()
        return ok
    }

    /**
     * Entfernt einen Eintrag — vorweggenommen in der Anzeige.
     *
     * Der Eintrag verschwindet sofort, damit der Griff sich nicht zäh anfühlt.
     * Scheitert der Server, wird die Liste NEU GELADEN statt die alte Kopie
     * zurückzuschreiben: Zwischen Klick und Fehlschlag kann sich am Server
     * etwas anderes geändert haben, und dann wäre die zurückgeschriebene Liste
     * falsch.
     */
    suspend fun entferneEintrag(setNummer: String): Boolean {
        _state.update { it.copy(queue = it.queue.filter { e -> e.setNumber != setNummer }) }
        val ok = repo.admin.deleteBricksetEntry(setNummer) is Result.Success
        if (!ok) ladeWarteschlange()
        return ok
    }

    /** Anleitungen neu einlesen; zurück kommt die Zahl der eingereihten Sets, sonst null. */
    suspend fun leseAnleitungenNeuEin(): Int? =
        (repo.sets.reimportInstructions() as? Result.Success)?.data?.enqueued

    suspend fun starteCsvAbgleich(): Boolean = repo.sets.triggerCsvSync() is Result.Success

    suspend fun startePreislauf(): Boolean = repo.finanzen.triggerPriceJob() is Result.Success

    suspend fun ladeFehlendeBilderNach(): Boolean =
        repo.admin.redownloadMissingImages() is Result.Success

    /**
     * Cache-Zahlen, API-Grenzwerte, Cache-Dauer und Vorgabe-Zustand in einem Zug.
     *
     * Nacheinander und nicht nebenläufig: Es sind vier Abfragen an denselben
     * Server, und sie stehen im selben Kartenstapel. Vier parallele Aufrufe
     * würden hier nichts sichtbar beschleunigen, aber die Reihenfolge der
     * Zustandsänderungen unbestimmt machen.
     */
    suspend fun ladeCacheUndGrenzen() {
        (repo.admin.getCacheStats() as? Result.Success)?.let { r ->
            _state.update { it.copy(cacheStats = r.data) }
        }
        (repo.admin.getApiLimits() as? Result.Success)?.let { r ->
            _state.update { it.copy(apiLimits = r.data.limits) }
        }
        (repo.admin.getCacheTtl() as? Result.Success)?.let { r ->
            _state.update { it.copy(cacheTtl = r.data.ttl) }
        }
        (repo.teile.getDefaultCondition() as? Result.Success)?.let { r ->
            _state.update { it.copy(vorgabeZustand = r.data.condition) }
        }
    }

    suspend fun setzeCacheDauer(stunden: Int): Boolean {
        val ok = repo.admin.setCacheTtl(stunden) is Result.Success
        if (ok) _state.update { it.copy(cacheTtl = stunden.toString()) }
        return ok
    }

    /**
     * Cache leeren und die Zahlen sofort neu holen.
     *
     * Das Nachladen gehoert dazu: Ohne es staenden die alten Zahlen weiter da,
     * und der Nutzer haette keinen Hinweis, dass etwas passiert ist — bei einer
     * Handlung, die man genau EINMAL ausloest, ist das der ganze Unterschied
     * zwischen „hat funktioniert" und „nichts passiert".
     */
    suspend fun leereCache(alles: Boolean): Boolean {
        val ok = repo.admin.clearCache(alles) is Result.Success
        if (ok) ladeCacheUndGrenzen()
        return ok
    }

    /**
     * Zeitplan eines Jobs setzen und die Liste neu holen.
     *
     * Neu holen, weil der Server den Wert normalisiert: „7:5" wird zu „07:05",
     * und ein Abstand unter fuenf Minuten wird auf fuenf angehoben. Ohne das
     * Nachladen stuende in der Oberflaeche, was der Nutzer getippt hat, und
     * nicht, was gilt.
     */
    suspend fun setzeJobZeitplan(name: String, zeit: String? = null, minuten: Int? = null): Boolean {
        val ok = repo.admin.setJobSchedule(name, zeit, minuten) is Result.Success
        if (ok) ladeJobs()
        return ok
    }

    /** Fehlende KATALOGbilder einreihen — nicht die des Bestands daneben. */
    suspend fun reiheKatalogbilderEin(): Boolean =
        repo.admin.queueCatalogImages() is Result.Success

    /**
     * Das globale Design umstellen.
     *
     * Die App liest es seit Nachtrag 135 in zwei Stufen; hier wird es gesetzt.
     * `loadSettings()` beim Aufrufer zieht den neuen Wert dann in den Zustand
     * und merkt ihn — die Anzeige wechselt also sofort und ueberlebt den
     * naechsten Kaltstart.
     */
    suspend fun setzeDesign(theme: String): Boolean =
        repo.admin.setAppTheme(theme) is Result.Success

    suspend fun setzeGrenzwerte(rebrickable: Int, bricklink: Int, brickset: Int): Boolean {
        val ok = repo.admin.setApiLimits(rebrickable, bricklink, brickset) is Result.Success
        if (ok) {
            (repo.admin.getApiLimits() as? Result.Success)?.let { r ->
                _state.update { it.copy(apiLimits = r.data.limits) }
            }
        }
        return ok
    }

    /**
     * Vorgabe-Zustand (neu/gebraucht) setzen — in der Anzeige vorweggenommen.
     *
     * Der Schalter springt sofort um, weil er sonst bis zur Serverantwort auf
     * dem alten Wert stünde. Scheitert der Aufruf, wird zurückgestellt; ohne
     * das behauptete die Oberfläche dauerhaft etwas, das nie gespeichert wurde.
     */
    suspend fun setzeVorgabeZustand(zustand: String): Boolean {
        val vorher = _state.value.vorgabeZustand
        _state.update { it.copy(vorgabeZustand = zustand) }
        val ok = repo.teile.setDefaultCondition(zustand) is Result.Success
        if (!ok) _state.update { it.copy(vorgabeZustand = vorher) }
        return ok
    }
}
