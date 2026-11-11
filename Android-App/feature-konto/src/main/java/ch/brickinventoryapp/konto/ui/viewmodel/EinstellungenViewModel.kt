package ch.brickinventoryapp.konto.ui.viewmodel

import kotlinx.coroutines.flow.first
import ch.brickinventoryapp.data.repository.AlarmRepository
import ch.brickinventoryapp.model.fach.Alarmrichtung
import ch.brickinventoryapp.model.fach.Waehrung
import ch.brickinventoryapp.model.fach.Zustand
import androidx.lifecycle.viewModelScope
import ch.brickinventoryapp.ressourcen.R
import ch.brickinventoryapp.model.ui.model.CsvImportArt
import ch.brickinventoryapp.model.ui.model.alsAnsicht
import ch.brickinventoryapp.model.ui.model.alsDaten
import ch.brickinventoryapp.data.repository.KontoRepository
import ch.brickinventoryapp.data.repository.VerwaltungRepository
import ch.brickinventoryapp.data.repository.Ergebnis
import ch.brickinventoryapp.data.repository.TeileRepository
import ch.brickinventoryapp.data.repository.Bestandsabgleich
import ch.brickinventoryapp.konto.ui.AlarmUebersichtUiState
import ch.brickinventoryapp.konto.ui.CsvHochladenUiState
import ch.brickinventoryapp.zustand.ui.ladeEinstellungen
import dagger.hilt.android.lifecycle.HiltViewModel
import ch.brickinventoryapp.data.alarm.Alarmeingabe
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import javax.inject.Inject
import ch.brickinventoryapp.model.data.model.LagerortEintragResponse
import ch.brickinventoryapp.model.data.model.LagerortResponse
import ch.brickinventoryapp.model.data.model.LagerortVorgabeResponse
import ch.brickinventoryapp.model.data.model.PreisalarmResponse
import androidx.lifecycle.ViewModel
import ch.brickinventoryapp.zustand.ui.AppUiState
import ch.brickinventoryapp.zustand.ui.Sitzung
import ch.brickinventoryapp.zustand.ui.viewmodel.DateiLeser
import ch.brickinventoryapp.zustand.ui.viewmodel.Gelesen
import ch.brickinventoryapp.zustand.ui.viewmodel.DateiRef
import ch.brickinventoryapp.zustand.ui.viewmodel.Filterwahl
import ch.brickinventoryapp.zustand.ui.viewmodel.Meldungen
import ch.brickinventoryapp.zustand.ui.viewmodel.folgeAbmeldung

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
    private val abgleich: Bestandsabgleich,
    private val konto: KontoRepository,
    private val verwaltung: VerwaltungRepository,
    private val alarme: AlarmRepository,
    private val teile: TeileRepository,
    private val leser: DateiLeser,
) : ViewModel(), Filterwahl by filter, EinstellungenAktionen {

    val state: StateFlow<AppUiState> = sitzung.state

    init {
        folgeAbmeldung(sitzung) { zuruecksetzen() }
    }

    private val _csvHochladenState = MutableStateFlow(CsvHochladenUiState())
    val csvHochladenState: StateFlow<CsvHochladenUiState> = _csvHochladenState.asStateFlow()

    private val _alarmUebersicht = MutableStateFlow(AlarmUebersichtUiState())
    val alarmUebersicht: StateFlow<AlarmUebersichtUiState> = _alarmUebersicht.asStateFlow()

    // ── Währung und Zustand ──────────────────────────────────────────────────

    /** Eine andere Währung oder ein anderer Zustand ändert jeden Preis: Die Ablage holt sie neu. */
    override fun saveSettings(currency: Waehrung, condition: Zustand) {
        viewModelScope.launch {
            when (val r = konto.updateSettings(currency, condition)) {
                is Ergebnis.Success -> {
                    meldungen.zeige(meldungen.text(R.string.vm_settings_saved))
                    sitzung.einstellungenGespeichert(currency, condition)
                    abgleich.bestand()
                }
                is Ergebnis.Error -> meldungen.zeige(meldungen.meldungFuerSnackbar(r))
            }
        }
    }

    /** Danach die Einstellungen neu: Der Server löst die wirksame Bedingung auf. */
    override fun saveUserDefaultCondition(condition: Zustand?) {
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
            val bytes = when (val g = leser.liesHoechstens(datei, CSV_MAX_BYTES)) {
                null -> {
                    _csvHochladenState.value = CsvHochladenUiState(fehler = meldungen.text(R.string.csv_upload_unreadable))
                    return@launch
                }
                Gelesen.ZuGross -> {
                    _csvHochladenState.value = CsvHochladenUiState(
                        fehler = meldungen.text(R.string.csv_upload_too_big, CSV_MAX_BYTES / 1024 / 1024))
                    return@launch
                }
                is Gelesen.Inhalt -> g.bytes
            }
            val name = leser.name(datei) ?: "import.csv"
            when (val r = verwaltung.importiereCsv(art.alsDaten(), name, bytes)) {
                is Ergebnis.Success ->
                    if (r.data.success) {
                        _csvHochladenState.value = CsvHochladenUiState(ergebnis = r.data.alsAnsicht())
                        when (art) {
                            CsvImportArt.MERKLISTE -> abgleich.merkliste()
                            CsvImportArt.PREISALARME -> alarmeNeu()
                            CsvImportArt.TEILE -> abgleich.teile()
                            CsvImportArt.MINIFIGUREN -> abgleich.figuren()
                            CsvImportArt.SETS -> abgleich.sets()
                        }
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
            // Gezeigt wird die Ablage; ohne Netz die zuletzt geholte Liste samt Meldung.
            val r = alarme.aktualisiereAlarme()
            if (r is Ergebnis.Error) meldungen.zeige(meldungen.meldungFuerSnackbar(r))
            val lokal = alarme.beobachteAlarme().first()
            if (r is Ergebnis.Success || lokal.stand != null)
                _alarmUebersicht.value = AlarmUebersichtUiState(alarme = lokal.liste.map { it.alsAnsicht() }, geladen = true)
        }
    }

    override fun aendereAlarmSchwelle(setNumber: String, condition: Zustand, richtung: Alarmrichtung, schwelle: Double) {
        wartendeSchwellen.remove(setNumber to condition)?.cancel()
        if (schwelle <= 0.0) { meldungen.zeige(meldungen.text(R.string.alerts_bad_value)); return }
        alarmSchleuse { alarme.setPreisalarm(setNumber, richtung, schwelle, condition) }
    }

    /** Getippte Schwellen, die auf ihre Ruhezeit warten — je (Set, Zustand) eine. */
    private val wartendeSchwellen = mutableMapOf<Pair<String, Zustand>, Job>()

    /**
     * Speichert beim Tippen, entprellt wie im Set-Detail (Alarmeingabe.RUHE_MS): Die
     * Übersicht hatte als einzige Stelle einen Speichern-Knopf, der nur bei Änderung
     * erschien. Im ViewModel, damit die Eingabe das Verlassen der Seite übersteht.
     * Ein leeres Feld löscht hier nicht — dafür steht der Papierkorb daneben.
     */
    override fun setzeAlarmSchwelle(setNumber: String, condition: Zustand, richtung: Alarmrichtung, roh: String) {
        val schluessel = setNumber to condition
        wartendeSchwellen.remove(schluessel)?.cancel()
        val schwelle = Alarmeingabe.zahl(roh) ?: return
        wartendeSchwellen[schluessel] = viewModelScope.launch {
            delay(Alarmeingabe.RUHE_MS)
            wartendeSchwellen.remove(schluessel)
            aendereAlarmSchwelle(setNumber, condition, richtung, schwelle)
        }
    }

    override fun loescheAlarm(setNumber: String, condition: Zustand) =
        alarmSchleuse { alarme.deletePreisalarm(setNumber, condition) }

    /** Ohne Bindestrich gilt die erste Fassung („10294“ → „10294-1“), wie beim Erfassen. */
    override fun legeAlarmAn(setNumber: String, condition: Zustand, richtung: Alarmrichtung, roh: String) {
        val nummer = setNumber.trim().let { if (it.isBlank() || it.contains('-')) it else "$it-1" }
        val schwelle = Alarmeingabe.zahl(roh)
        if (nummer.isBlank() || schwelle == null || schwelle <= 0.0) { meldungen.zeige(meldungen.text(R.string.alerts_bad_value)); return }
        alarmSchleuse { alarme.setPreisalarm(nummer, richtung, schwelle, condition) }
    }

    /** Ändern und Löschen: rufen, melden, die Übersicht neu, wenn sie schon dasteht. */
    private fun alarmSchleuse(tun: suspend () -> Ergebnis<PreisalarmResponse>) {
        viewModelScope.launch {
            when (val r = tun()) {
                is Ergebnis.Success -> if (!r.data.success) meldungen.zeige(r.data.error)
                is Ergebnis.Error -> meldungen.zeige(meldungen.meldungFuerSnackbar(r))
            }
            alarmeNeu()
        }
    }

    /** Neu vom Server, auch nach eigenem Schreiben: Den Auslöser setzt der Preislauf, nicht die App. */
    private fun alarmeNeu(): Unit = if (_alarmUebersicht.value.geladen) ladeAlarmUebersicht() else Unit

    // ── Lagerorte ────────────────────────────────────────────────────────────

    override fun legeLagerortAn(name: String) = lagerortSchleuse { teile.legeLagerortAn(name).auswerten() }

    /** Umbenennen ändert, was an Sets, Teilen und Figuren steht; das Repository zieht die Ablage nach. */
    override fun benenneLagerortUm(id: Int, name: String) {
        val alt = filter.lagerState.value.eigene.firstOrNull { it.id == id }?.name.orEmpty()
        lagerortSchleuse { teile.benenneLagerortUm(id, alt, name).auswerten() }
    }

    /** Der Stern: Ist der Ort schon Vorgabe, nimmt der zweite Tipp sie wieder weg. */
    override fun schalteLagerortVorgabe(id: Int, istVorgabe: Boolean) =
        lagerortSchleuse { teile.setzeLagerortVorgabe(if (istVorgabe) null else id).auswerten() }

    override fun loescheLagerort(id: Int) = lagerortSchleuse { teile.loescheLagerort(id).auswerten() }

    private fun lagerortSchleuse(tun: suspend () -> Pair<Boolean, String?>) {
        viewModelScope.launch {
            val (gelungen, fehler) = tun()
            if (!gelungen) { meldungen.zeige(fehler); return@launch }
            filter.eigeneLagerorteNeu()
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

    private fun zuruecksetzen() {
        _csvHochladenState.value = CsvHochladenUiState()
        _alarmUebersicht.value = AlarmUebersichtUiState()
    }
}
