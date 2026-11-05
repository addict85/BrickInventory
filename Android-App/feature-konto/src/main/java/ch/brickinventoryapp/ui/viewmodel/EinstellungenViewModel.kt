package ch.brickinventoryapp.ui.viewmodel

import androidx.lifecycle.viewModelScope
import ch.brickinventoryapp.ressourcen.R
import ch.brickinventoryapp.ui.model.CsvImportArt
import ch.brickinventoryapp.ui.model.alsAnsicht
import ch.brickinventoryapp.ui.model.alsDaten
import ch.brickinventoryapp.data.repository.KontoRepository
import ch.brickinventoryapp.data.repository.VerwaltungRepository
import ch.brickinventoryapp.data.repository.Ergebnis
import ch.brickinventoryapp.data.repository.SetsRepository
import ch.brickinventoryapp.data.repository.TeileRepository
import ch.brickinventoryapp.ui.Aenderung
import ch.brickinventoryapp.ui.AlarmUebersichtUiState
import ch.brickinventoryapp.ui.CsvHochladenUiState
import ch.brickinventoryapp.ui.ladeEinstellungen
import dagger.hilt.android.lifecycle.HiltViewModel
import ch.brickinventoryapp.alarm.Alarmeingabe
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import javax.inject.Inject
import ch.brickinventoryapp.data.model.LagerortEintragResponse
import ch.brickinventoryapp.data.model.LagerortResponse
import ch.brickinventoryapp.data.model.LagerortVorgabeResponse
import ch.brickinventoryapp.data.model.PreisalarmResponse
import androidx.lifecycle.ViewModel
import ch.brickinventoryapp.ui.AppUiState
import ch.brickinventoryapp.ui.Sitzung
import ch.brickinventoryapp.ui.Bestandssignal

/**
 * Wie gross eine CSV-Datei sein darf — derselbe Wert wie CSV_MAX_BYTES in
 * utils/dateiEmpfang.ts. Die App muss die Grenze kennen, bevor sie 20 MB durch
 * ein Mobilfunknetz schickt, um dann eine Absage zu bekommen.
 */
internal const val CSV_MAX_BYTES = 15L * 1024 * 1024

/**
 * Einstellungen und Verwaltung: Währung und Zustand, CSV-Import, Übersicht
 * der Preisalarme, eigene Lagerorte.
 *
 * Was am Gerät hängt (Sprache, Design bei Dunkelheit, Meldungen, Vorwärmen),
 * steht im AppViewModel; dieses ViewModel spricht nur mit dem Server.
 */
@HiltViewModel
class EinstellungenViewModel @Inject constructor(
    private val sitzung: Sitzung,
    private val filter: Filterwahl,
    private val meldungen: Meldungen,
    private val bestand: Bestandssignal,
    private val konto: KontoRepository,
    private val verwaltung: VerwaltungRepository,
    private val sets: SetsRepository,
    private val teile: TeileRepository,
    private val leser: DateiLeser,
) : ViewModel(), Filterwahl by filter, EinstellungenAktionen {

    val state: StateFlow<AppUiState> = sitzung.state

    init {
        folgeAbmeldung(sitzung) { zuruecksetzen() }
        folgeBestand(bestand) { beiAenderung(it) }
    }

    private val _csvHochladenState = MutableStateFlow(CsvHochladenUiState())
    val csvHochladenState: StateFlow<CsvHochladenUiState> = _csvHochladenState.asStateFlow()

    private val _alarmUebersicht = MutableStateFlow(AlarmUebersichtUiState())
    val alarmUebersicht: StateFlow<AlarmUebersichtUiState> = _alarmUebersicht.asStateFlow()

    // ── Währung und Zustand ──────────────────────────────────────────────────

    /** Eine andere Währung oder ein anderer Zustand ändert jeden Preis: alle Bestandsansichten neu. */
    override fun saveSettings(currency: String, condition: String) {
        viewModelScope.launch {
            when (val r = konto.updateSettings(currency, condition)) {
                is Ergebnis.Success -> {
                    meldungen.zeige(meldungen.text(R.string.vm_settings_saved))
                    sitzung.einstellungenGespeichert(currency, condition)
                    bestand.melde(Aenderung.Sets, Aenderung.Teile, Aenderung.Figuren)
                }
                is Ergebnis.Error -> meldungen.zeige(meldungen.meldungFuerSnackbar(r))
            }
        }
    }

    /** Danach die Einstellungen neu: Der Server löst die wirksame Bedingung auf. */
    override fun saveUserDefaultCondition(condition: String) {
        viewModelScope.launch {
            when (val r = konto.setUserDefaultCondition(condition)) {
                is Ergebnis.Success -> {
                    // Die Wahl gilt ohne Speichern-Knopf; ohne diese Meldung bliebe offen, ob sie ankam.
                    meldungen.zeige(meldungen.text(R.string.vm_settings_saved))
                    sitzung.ladeEinstellungen(konto)
                }
                is Ergebnis.Error -> meldungen.zeige(meldungen.meldungFuerSnackbar(r)?.let { meldungen.text(R.string.vm_error, it) })
            }
        }
    }

    // ── CSV-Import ───────────────────────────────────────────────────────────

    fun ladeCsvHoch(art: CsvImportArt, datei: DateiRef) {
        viewModelScope.launch {
            _csvHochladenState.value = CsvHochladenUiState(laeuft = true, art = art)
            val bytes = leser.lies(datei)?.second
            if (bytes == null) {
                _csvHochladenState.value = CsvHochladenUiState(fehler = meldungen.text(R.string.csv_upload_unreadable))
                return@launch
            }
            if (bytes.size > CSV_MAX_BYTES) {
                _csvHochladenState.value = CsvHochladenUiState(
                    fehler = meldungen.text(R.string.csv_upload_too_big, CSV_MAX_BYTES / 1024 / 1024))
                return@launch
            }
            val name = leser.name(datei) ?: "import.csv"
            when (val r = verwaltung.importiereCsv(art.alsDaten(), name, bytes)) {
                is Ergebnis.Success ->
                    if (r.data.success) {
                        _csvHochladenState.value = CsvHochladenUiState(ergebnis = r.data.alsAnsicht())
                        bestand.melde(when (art) {
                            CsvImportArt.MERKLISTE -> Aenderung.Merkliste
                            CsvImportArt.PREISALARME -> Aenderung.Alarme
                            CsvImportArt.TEILE -> Aenderung.Teile
                            CsvImportArt.MINIFIGUREN -> Aenderung.Figuren
                            CsvImportArt.SETS -> Aenderung.Sets
                        })
                    } else _csvHochladenState.value = CsvHochladenUiState(fehler = r.data.error ?: meldungen.text(R.string.err_generic))
                is Ergebnis.Error -> _csvHochladenState.value = CsvHochladenUiState(fehler = meldungen.meldung(r))
            }
        }
    }

    fun csvHochladenWeg() {
        _csvHochladenState.value = CsvHochladenUiState()
    }

    // ── Preisalarme ──────────────────────────────────────────────────────────

    override fun ladeAlarmUebersicht() {
        viewModelScope.launch {
            when (val r = sets.getAlleAlarme()) {
                is Ergebnis.Success ->
                    if (r.data.success) _alarmUebersicht.value = AlarmUebersichtUiState(alarme = r.data.alerts.map { it.alsAnsicht() }, geladen = true)
                    else meldungen.zeige(r.data.error)
                is Ergebnis.Error -> meldungen.zeige(meldungen.meldungFuerSnackbar(r))
            }
        }
    }

    override fun aendereAlarmSchwelle(setNumber: String, condition: String, richtung: String, schwelle: Double) {
        wartendeSchwellen.remove(setNumber to condition)?.cancel()
        if (schwelle <= 0.0) { meldungen.zeige(meldungen.text(R.string.alerts_bad_value)); return }
        alarmSchleuse { sets.setPreisalarm(setNumber, richtung, schwelle, condition) }
    }

    /** Getippte Schwellen, die auf ihre Ruhezeit warten — je (Set, Zustand) eine. */
    private val wartendeSchwellen = mutableMapOf<Pair<String, String>, Job>()

    /**
     * Speichert beim Tippen, entprellt wie im Set-Detail (Alarmeingabe.RUHE_MS): Die
     * Übersicht hatte als einzige Stelle einen Speichern-Knopf, der nur bei Änderung
     * erschien. Im ViewModel, damit die Eingabe das Verlassen der Seite übersteht.
     * Ein leeres Feld löscht hier nicht — dafür steht der Papierkorb daneben.
     */
    override fun setzeAlarmSchwelle(setNumber: String, condition: String, richtung: String, roh: String) {
        val schluessel = setNumber to condition
        wartendeSchwellen.remove(schluessel)?.cancel()
        val schwelle = Alarmeingabe.zahl(roh) ?: return
        wartendeSchwellen[schluessel] = viewModelScope.launch {
            delay(Alarmeingabe.RUHE_MS)
            wartendeSchwellen.remove(schluessel)
            aendereAlarmSchwelle(setNumber, condition, richtung, schwelle)
        }
    }

    override fun loescheAlarm(setNumber: String, condition: String) =
        alarmSchleuse { sets.deletePreisalarm(setNumber, condition) }

    /** Ändern und Löschen: rufen, melden, die Übersicht lädt auf das Signal nach. */
    private fun alarmSchleuse(tun: suspend () -> Ergebnis<PreisalarmResponse>) {
        viewModelScope.launch {
            when (val r = tun()) {
                is Ergebnis.Success -> if (!r.data.success) meldungen.zeige(r.data.error)
                is Ergebnis.Error -> meldungen.zeige(meldungen.meldungFuerSnackbar(r))
            }
            bestand.melde(Aenderung.Alarme)
        }
    }

    // ── Lagerorte ────────────────────────────────────────────────────────────

    override fun legeLagerortAn(name: String) = lagerortSchleuse(false) { teile.legeLagerortAn(name).auswerten() }

    /** Umbenennen ändert, was in der Galerie an den Sets steht — die lädt deshalb nach. */
    override fun benenneLagerortUm(id: Int, name: String) = lagerortSchleuse(true) { teile.benenneLagerortUm(id, name).auswerten() }

    /** Der Stern: Ist der Ort schon Vorgabe, nimmt der zweite Tipp sie wieder weg. */
    override fun schalteLagerortVorgabe(id: Int, istVorgabe: Boolean) =
        lagerortSchleuse(false) { teile.setzeLagerortVorgabe(if (istVorgabe) null else id).auswerten() }

    override fun loescheLagerort(id: Int) = lagerortSchleuse(false) { teile.loescheLagerort(id).auswerten() }

    private fun lagerortSchleuse(galerieNeu: Boolean, tun: suspend () -> Pair<Boolean, String?>) {
        viewModelScope.launch {
            val (gelungen, fehler) = tun()
            if (!gelungen) { meldungen.zeige(fehler); return@launch }
            filter.eigeneLagerorteNeu()
            if (galerieNeu) bestand.melde(Aenderung.Sets)
        }
    }

    /** Erfolg und Satz einer Lagerort-Antwort; ein Fehler ohne Satz bleibt still. */
    private fun <T> Ergebnis<T>.auswerten(): Pair<Boolean, String?> = when (this) {
        is Ergebnis.Success -> erfolgUndSatz(data)
        is Ergebnis.Error -> false to meldungen.meldungFuerSnackbar(this)
    }

    private fun erfolgUndSatz(antwort: Any?): Pair<Boolean, String?> = when (antwort) {
        is LagerortEintragResponse -> antwort.success to antwort.error
        is LagerortVorgabeResponse -> antwort.success to antwort.error
        is LagerortResponse -> antwort.success to antwort.error
        else -> true to null
    }

    private fun beiAenderung(aenderung: Aenderung) {
        if (aenderung == Aenderung.Alarme && _alarmUebersicht.value.geladen) ladeAlarmUebersicht()
    }

    private fun zuruecksetzen() {
        _csvHochladenState.value = CsvHochladenUiState()
        _alarmUebersicht.value = AlarmUebersichtUiState()
    }
}
