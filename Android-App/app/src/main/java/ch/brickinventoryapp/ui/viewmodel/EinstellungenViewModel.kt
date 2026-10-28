package ch.brickinventoryapp.ui.viewmodel

import android.net.Uri
import androidx.lifecycle.viewModelScope
import ch.brickinventoryapp.R
import ch.brickinventoryapp.data.model.CsvArt
import ch.brickinventoryapp.data.repository.AdminRepository
import ch.brickinventoryapp.data.repository.Result
import ch.brickinventoryapp.data.repository.SetsRepository
import ch.brickinventoryapp.data.repository.TeileRepository
import ch.brickinventoryapp.ui.Aenderung
import ch.brickinventoryapp.ui.AlarmUebersichtUiState
import ch.brickinventoryapp.ui.CsvHochladenUiState
import ch.brickinventoryapp.ui.ladeEinstellungen
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import javax.inject.Inject

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
    dienste: AppDienste,
    private val admin: AdminRepository,
    private val sets: SetsRepository,
    private val teile: TeileRepository,
    private val leser: DateiLeser,
) : BereichsViewModel(dienste) {

    private val _csvHochladenState = MutableStateFlow(CsvHochladenUiState())
    val csvHochladenState: StateFlow<CsvHochladenUiState> = _csvHochladenState.asStateFlow()

    private val _alarmUebersicht = MutableStateFlow(AlarmUebersichtUiState())
    val alarmUebersicht: StateFlow<AlarmUebersichtUiState> = _alarmUebersicht.asStateFlow()

    // ── Währung und Zustand ──────────────────────────────────────────────────

    /** Eine andere Währung oder ein anderer Zustand ändert jeden Preis: alle Bestandsansichten neu. */
    fun saveSettings(currency: String, condition: String) {
        viewModelScope.launch {
            when (val r = admin.updateSettings(currency, condition)) {
                is Result.Success -> {
                    _snackbar.value = text(R.string.vm_settings_saved)
                    dienste.sitzung.aendere { it.copy(currency = currency, priceCondition = condition) }
                    dienste.bestand.melde(Aenderung.Sets, Aenderung.Teile, Aenderung.Figuren)
                }
                is Result.Error -> _snackbar.value = meldungFuerSnackbar(r)
            }
        }
    }

    /** Danach die Einstellungen neu: Der Server löst die wirksame Bedingung auf. */
    fun saveUserDefaultCondition(condition: String) {
        viewModelScope.launch {
            when (val r = teile.setUserDefaultCondition(condition)) {
                is Result.Success -> dienste.sitzung.ladeEinstellungen(admin)
                is Result.Error -> _snackbar.value = meldungFuerSnackbar(r)?.let { text(R.string.vm_error, it) }
            }
        }
    }

    // ── CSV-Import ───────────────────────────────────────────────────────────

    fun ladeCsvHoch(art: CsvArt, uri: Uri) {
        viewModelScope.launch {
            _csvHochladenState.value = CsvHochladenUiState(laeuft = true, art = art)
            val bytes = leser.lies(uri)?.second
            if (bytes == null) {
                _csvHochladenState.value = CsvHochladenUiState(fehler = text(R.string.csv_upload_unreadable))
                return@launch
            }
            if (bytes.size > CSV_MAX_BYTES) {
                _csvHochladenState.value = CsvHochladenUiState(
                    fehler = text(R.string.csv_upload_too_big, CSV_MAX_BYTES / 1024 / 1024))
                return@launch
            }
            val name = leser.name(uri) ?: "import.csv"
            when (val r = admin.importiereCsv(art, name, bytes)) {
                is Result.Success ->
                    if (r.data.success) {
                        _csvHochladenState.value = CsvHochladenUiState(ergebnis = r.data)
                        dienste.bestand.melde(when (art) {
                            CsvArt.MERKLISTE -> Aenderung.Merkliste
                            CsvArt.PREISALARME -> Aenderung.Alarme
                            CsvArt.TEILE -> Aenderung.Teile
                            CsvArt.MINIFIGUREN -> Aenderung.Figuren
                            CsvArt.SETS -> Aenderung.Sets
                        })
                    } else _csvHochladenState.value = CsvHochladenUiState(fehler = r.data.error ?: text(R.string.err_generic))
                is Result.Error -> _csvHochladenState.value = CsvHochladenUiState(fehler = meldung(r))
            }
        }
    }

    fun csvHochladenWeg() {
        _csvHochladenState.value = CsvHochladenUiState()
    }

    // ── Preisalarme ──────────────────────────────────────────────────────────

    fun ladeAlarmUebersicht() {
        viewModelScope.launch {
            when (val r = sets.getAlleAlarme()) {
                is Result.Success ->
                    if (r.data.success) _alarmUebersicht.value = AlarmUebersichtUiState(alarme = r.data.alerts, geladen = true)
                    else _snackbar.value = r.data.error
                is Result.Error -> _snackbar.value = meldungFuerSnackbar(r)
            }
        }
    }

    fun aendereAlarmSchwelle(setNumber: String, condition: String, richtung: String, schwelle: Double) {
        if (schwelle <= 0.0) { _snackbar.value = text(R.string.alerts_bad_value); return }
        alarmSchleuse { sets.setPreisalarm(setNumber, richtung, schwelle, condition) }
    }

    fun loescheAlarm(setNumber: String, condition: String) =
        alarmSchleuse { sets.deletePreisalarm(setNumber, condition) }

    /** Ändern und Löschen: rufen, melden, die Übersicht lädt auf das Signal nach. */
    private fun alarmSchleuse(tun: suspend () -> Result<ch.brickinventoryapp.data.model.PreisalarmResponse>) {
        viewModelScope.launch {
            when (val r = tun()) {
                is Result.Success -> if (!r.data.success) _snackbar.value = r.data.error
                is Result.Error -> _snackbar.value = meldungFuerSnackbar(r)
            }
            dienste.bestand.melde(Aenderung.Alarme)
        }
    }

    // ── Lagerorte ────────────────────────────────────────────────────────────

    fun legeLagerortAn(name: String) = lagerortSchleuse(false) { teile.legeLagerortAn(name).auswerten() }

    /** Umbenennen ändert, was in der Galerie an den Sets steht — die lädt deshalb nach. */
    fun benenneLagerortUm(id: Int, name: String) = lagerortSchleuse(true) { teile.benenneLagerortUm(id, name).auswerten() }

    /** Der Stern: Ist der Ort schon Vorgabe, nimmt der zweite Tipp sie wieder weg. */
    fun schalteLagerortVorgabe(id: Int, istVorgabe: Boolean) =
        lagerortSchleuse(false) { teile.setzeLagerortVorgabe(if (istVorgabe) null else id).auswerten() }

    fun loescheLagerort(id: Int) = lagerortSchleuse(false) { teile.loescheLagerort(id).auswerten() }

    private fun lagerortSchleuse(galerieNeu: Boolean, tun: suspend () -> Pair<Boolean, String?>) {
        viewModelScope.launch {
            val (gelungen, fehler) = tun()
            if (!gelungen) { _snackbar.value = fehler; return@launch }
            dienste.blickfeld.ladeEigeneLagerorte()
            if (galerieNeu) dienste.bestand.melde(Aenderung.Sets)
        }
    }

    /** Erfolg und Satz einer Lagerort-Antwort; ein Fehler ohne Satz bleibt still. */
    private fun <T> Result<T>.auswerten(): Pair<Boolean, String?> = when (this) {
        is Result.Success -> when (val d = data) {
            is ch.brickinventoryapp.data.model.LagerortEintragResponse -> d.success to d.error
            is ch.brickinventoryapp.data.model.LagerortVorgabeResponse -> d.success to d.error
            is ch.brickinventoryapp.data.model.LagerortResponse -> d.success to d.error
            else -> true to null
        }
        is Result.Error -> false to meldungFuerSnackbar(this)
    }

    override fun beiAenderung(aenderung: Aenderung) {
        if (aenderung == Aenderung.Alarme && _alarmUebersicht.value.geladen) ladeAlarmUebersicht()
    }

    override fun zuruecksetzen() {
        _csvHochladenState.value = CsvHochladenUiState()
        _alarmUebersicht.value = AlarmUebersichtUiState()
    }
}
