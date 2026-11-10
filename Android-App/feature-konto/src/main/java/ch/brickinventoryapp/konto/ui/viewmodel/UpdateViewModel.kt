package ch.brickinventoryapp.konto.ui.viewmodel

import ch.brickinventoryapp.model.util.fangeAusserAbbruch
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import ch.brickinventoryapp.ressourcen.R
import ch.brickinventoryapp.konto.ui.UpdateUiState
import ch.brickinventoryapp.update.util.gepruefteBeschreibung
import ch.brickinventoryapp.update.util.pruefsummePasst
import ch.brickinventoryapp.update.util.fassungPasst
import ch.brickinventoryapp.update.util.Installationsmeldung
import ch.brickinventoryapp.update.util.istErlaubteApkAdresse
import ch.brickinventoryapp.update.util.anzubietendeFassung
import ch.brickinventoryapp.update.util.pruefeFrische
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.drop
import kotlinx.coroutines.flow.filter
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import javax.inject.Inject
import ch.brickinventoryapp.update.util.UpdateBeschreibung
import java.io.File
import ch.brickinventoryapp.model.koroutinen.BrickDispatchers
import ch.brickinventoryapp.model.koroutinen.Dispatcher
import ch.brickinventoryapp.data.Anmeldestand
import ch.brickinventoryapp.update.data.UpdateRepository
import kotlinx.coroutines.Job
import ch.brickinventoryapp.update.util.UpdateGeraet
import ch.brickinventoryapp.update.util.UpdateStandAblage
import ch.brickinventoryapp.zustand.ui.viewmodel.Texte

/**
 * Selbstaktualisierung: nachsehen, laden, installieren lassen. Beim Start still
 * prüfen, nie von allein laden, dazu ein Knopf in den Einstellungen. Die stille
 * Prüfung meldet keinen Fehler: Wer ohne Netz startet, hat nichts gefragt; wer den
 * Knopf drückt, schon.
 * Ausführlich: docs/begruendungen/feature-konto/konto/ui/viewmodel/UpdateViewModel.kt.md#constructor
 */
@HiltViewModel
class UpdateViewModel @Inject constructor(
    private val repo: UpdateRepository,
    private val texte: Texte,
    private val anmeldestand: Anmeldestand,
    private val updateStand: UpdateStandAblage,
    private val geraet: UpdateGeraet,
    @param:Dispatcher(BrickDispatchers.IO) private val io: CoroutineDispatcher,
) : ViewModel(), UpdateAktionen {

    private val _state = MutableStateFlow(UpdateUiState(startpruefung = updateStand.startpruefungAn()))
    val updateState = _state.asStateFlow()

    /** Der laufende Download; [ladeAbbrechen] beendet ihn samt Teildatei. */
    private var ladeJob: Job? = null

    init {
        // Beim Abmelden zuruecksetzen: Ein Fortschritt oder „bereit zur
        // Installation" erschiene dem naechsten Nutzer sonst als sein Vorgang.
        viewModelScope.launch {
            anmeldestand.authTokenState.map { it.isNullOrBlank() }.distinctUntilChanged().drop(1)
                .filter { abgemeldet -> abgemeldet }
                .collect { _state.value = UpdateUiState(startpruefung = updateStand.startpruefungAn()) }
        }
        // Die Installer-Sitzung antwortet an einen Empfänger, nicht hierher (util/AppUpdate.kt).
        viewModelScope.launch {
            Installationsmeldung.fehler.filter { it != null }.collect { grund ->
                Installationsmeldung.fehler.value = null
                _state.update { it.copy(fehler = texte.text(R.string.update_installation_fehlgeschlagen, grund)) }
            }
        }
    }

    /**
     * Gibt es eine neuere Fassung?
     *
     * @param still Beim Start `true`: kein Ladebalken, keine Fehlermeldung. Auf
     *        Knopfdruck `false` — dann sieht der Nutzer beides.
     */
    override fun pruefeBeimStart() {
        if (updateStand.startpruefungAn()) pruefeAufUpdate(still = true)
    }

    override fun setzeStartpruefung(an: Boolean) {
        updateStand.setzeStartpruefung(an)
        _state.update { it.copy(startpruefung = an) }
    }

    override fun pruefeAufUpdate(still: Boolean) {
        viewModelScope.launch {
            _state.update { it.copy(laedtPruefung = !still, fehler = null) }
            fangeAusserAbbruch {
                val roh = repo.holeBeschreibung()
                // Nur eine signierte Beschreibung zählt: Schreibrecht am Repository allein
                // reicht dann nicht, um ein Update zu unterdrücken oder umzuleiten. Danach
                // wird die Adresse trotzdem geprüft, nicht geglaubt.
                val beschreibung = withContext(io) {
                    gepruefteBeschreibung(roh, geraet.eigeneZertifikate(), geraet.beschreibungsSchluessel())
                }
                if (beschreibung == null || !istErlaubteApkAdresse(beschreibung.apkUrl)) {
                    _state.update {
                        it.copy(laedtPruefung = false, geprueft = true, neuereFassung = null,
                            fehler = if (still) null else texte.text(
                                if (beschreibung == null) R.string.update_beschreibung_unsigniert else R.string.update_fremde_adresse))
                    }
                    return@launch
                }
                // Aus einer zurückgesetzten oder abgelaufenen Beschreibung kein Angebot;
                // die Einstellungen sagen dann, warum (anzubietendeFassung).
                val frische = pruefeFrische(updateStand, beschreibung, repo.laufendeFassung.code, System.currentTimeMillis() / 1000)
                _state.update {
                    it.copy(laedtPruefung = false, geprueft = true,
                        neuereFassung = anzubietendeFassung(beschreibung, frische, repo.laufendeFassung.code), fehler = null, frische = frische)
                }
            }.onFailure { _ ->
                _state.update {
                    it.copy(laedtPruefung = false, geprueft = true,
                        fehler = if (still) null else texte.text(R.string.update_pruefung_fehlgeschlagen))
                }
            }
        }
    }

    /**
     * „Später“ im Start-Hinweis: für diesen App-Lauf nicht mehr fragen. Der Zustand
     * bleibt — es gibt weiterhin eine neuere Fassung, und der Punkt am Konto-Symbol
     * sagt das weiter. Weggeklickt ist nur die Frage, nicht der Befund.
     */
    override fun updateHinweisSchliessen() {
        _state.update { it.copy(dialogAbgelehnt = true) }
    }

    /**
     * Lädt das APK und bietet es zur Installation an. Drei Bedingungen, bevor etwas
     * installiert wird: 1. Die Adresse zeigt in unsere Release-Ablage (schon in der Prüfung,
     * hier nochmal — zwischen Prüfung und Klick kann ein neuer Zustand stehen). 2. Die
     * Signatur stimmt mit der installierten App überein.
     * Ausführlich: docs/begruendungen/feature-konto/konto/ui/viewmodel/UpdateViewModel.kt.md#ladeupdate
     */
    override fun ladeUpdate() {
        val fassung = _state.value.neuereFassung ?: return
        if (ladeJob?.isActive == true) return
        ladeJob = viewModelScope.launch {
            if (!istErlaubteApkAdresse(fassung.apkUrl)) {
                _state.update { it.copy(fehler = texte.text(R.string.update_fremde_adresse)) }
                return@launch
            }
            _state.update { it.copy(fortschritt = 0, fehler = null, bereitZurInstallation = false) }
            val ziel = geraet.updateDatei()
            fangeAusserAbbruch {
                repo.ladeApk(fassung, ziel).collect { p -> _state.update { it.copy(fortschritt = p) } }
                val falsch = withContext(io) { ungueltigesApk(fassung, ziel) }
                if (falsch != null) {
                    ziel.delete()
                    _state.update { it.copy(fortschritt = null, fehler = texte.text(falsch)) }
                    return@launch
                }
                val erlaubt = geraet.darfInstallieren()
                _state.update { it.copy(fortschritt = null, bereitZurInstallation = true, erlaubnisFehlt = !erlaubt) }
                if (erlaubt) starteInstallation()
            }.onFailure { _ ->
                ziel.delete()
                _state.update {
                    it.copy(fortschritt = null, fehler = texte.text(R.string.update_laden_fehlgeschlagen))
                }
            }
        }
    }

    /** Der Download bricht ab, die Teildatei löscht die Datenschicht; ein neuer Versuch beginnt von vorn. */
    override fun ladeAbbrechen() {
        ladeJob?.cancel()
        ladeJob = null
        _state.update { it.copy(fortschritt = null) }
    }

    /**
     * Der Text zur ersten Prüfung, die das geladene APK nicht besteht, sonst null. Erst
     * die signierte Prüfsumme (genau dieses APK), dann die Signatur, dann die Fassung —
     * alles, bevor der Nutzer gefragt wird (util/AppUpdate.kt).
     */
    private fun ungueltigesApk(beschreibung: UpdateBeschreibung, ziel: File): Int? = when {
        !pruefsummePasst(ziel, beschreibung.apkSha256) -> R.string.update_pruefsumme_falsch
        !geraet.signaturPasst(ziel) -> R.string.update_signatur_falsch
        !fassungPasst(geraet.apkFassung(ziel), beschreibung.versionCode, repo.laufendeFassung.code) -> R.string.update_fassung_falsch
        else -> null
    }

    /**
     * Öffnet den System-Installer für das geladene APK. Zwei Aufrufer: das Ende von
     * [ladeUpdate] und der Knopf „Installieren“ nach nachträglich erteilter Erlaubnis.
     * Die Signatur wird erneut geprüft, weil die Datei während des Ausflugs in die
     * Systemeinstellungen auf der Platte liegt.
     */
    override fun starteInstallation() {
        val gemeldet = _state.value.neuereFassung?.versionCode ?: 0
        val pruefsumme = _state.value.neuereFassung?.apkSha256.orEmpty()
        viewModelScope.launch {
            // Rund 46 MB hashen und zwei APK-Analysen: auf dem Hauptfaden droht ein ANR.
            // Die Reihenfolge bleibt; `&&` bricht beim ersten Fehlschlag ab.
            val geprueft = withContext(io) {
                val datei = geraet.updateDatei()
                val echt = datei.isFile && pruefsummePasst(datei, pruefsumme) && geraet.signaturPasst(datei) &&
                    fassungPasst(geraet.apkFassung(datei), gemeldet, repo.laufendeFassung.code)
                if (!echt) datei.delete()
                datei.takeIf { echt }
            }
            if (geprueft == null) {
                _state.update {
                    it.copy(bereitZurInstallation = false, fehler = texte.text(R.string.update_signatur_falsch))
                }
                return@launch
            }
            if (!geraet.darfInstallieren()) {
                _state.update { it.copy(erlaubnisFehlt = true) }
                return@launch
            }
            withContext(io) { runCatching { geraet.installiere(geprueft) } }
                .onFailure {
                    _state.update { s -> s.copy(fehler = texte.text(R.string.update_installer_fehlt)) }
                }
        }
    }
}
