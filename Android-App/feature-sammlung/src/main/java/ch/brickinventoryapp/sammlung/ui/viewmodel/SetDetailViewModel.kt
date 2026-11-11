package ch.brickinventoryapp.sammlung.ui.viewmodel

import ch.brickinventoryapp.model.fach.Zustand
import ch.brickinventoryapp.model.ui.model.alsAnsicht
import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.viewModelScope
import ch.brickinventoryapp.ressourcen.R
import ch.brickinventoryapp.data.alarm.Alarmeingabe
import ch.brickinventoryapp.model.data.model.GenericResponse
import ch.brickinventoryapp.data.repository.FinanzenRepository
import ch.brickinventoryapp.data.repository.HaushaltRepository
import ch.brickinventoryapp.data.repository.Ergebnis
import ch.brickinventoryapp.data.repository.SetsRepository
import ch.brickinventoryapp.zustand.ui.Aenderung
import ch.brickinventoryapp.sammlung.ui.Preisalarmeingabe
import ch.brickinventoryapp.sammlung.ui.SetDetailUiState
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject
import ch.brickinventoryapp.zustand.ui.fehlerklasse
import androidx.lifecycle.ViewModel
import ch.brickinventoryapp.zustand.ui.AppUiState
import ch.brickinventoryapp.zustand.ui.Sitzung
import ch.brickinventoryapp.zustand.ui.Bestandssignal
import ch.brickinventoryapp.zustand.ui.viewmodel.DateiLeser
import ch.brickinventoryapp.zustand.ui.viewmodel.Gelesen
import ch.brickinventoryapp.zustand.ui.viewmodel.DateiRef
import ch.brickinventoryapp.zustand.ui.viewmodel.Filterwahl
import ch.brickinventoryapp.zustand.ui.viewmodel.Meldungen
import ch.brickinventoryapp.zustand.ui.viewmodel.folgeAbmeldung
import ch.brickinventoryapp.zustand.ui.viewmodel.folgeBestand

/**
 * Wie gross eine Anleitung sein darf — derselbe Wert wie `limits.fileSize` in
 * routes/sets.ts. Die App muss die Grenze kennen, bevor sie 80 MB durchs
 * Mobilfunknetz schickt.
 */
internal const val ANLEITUNG_MAX_BYTES = 50L * 1024 * 1024

/**
 * Die Typen, die der Server annimmt (INSTR_EXT_BY_MIME in routes/sets.ts). Er
 * leitet daraus die Dateiendung ab; die App filtert schon die Auswahl.
 */
internal val ANLEITUNG_TYPEN = arrayOf("application/pdf", "image/jpeg", "image/png")

/**
 * Die Detailansicht eines Sets: Stammdaten, Preis und Verlauf, Käufe,
 * Preisalarme, Anleitungen, Menge und Lagerort.
 *
 * Welches Set, steht im [SavedStateHandle] (Navigationsargument `setNumber`):
 * Nach einem Prozess-Tod öffnet die Ansicht wieder dasselbe Set.
 */
@HiltViewModel
class SetDetailViewModel @Inject constructor(
    private val sitzung: Sitzung,
    private val filter: Filterwahl,
    private val meldungen: Meldungen,
    private val bestand: Bestandssignal,
    private val sets: SetsRepository,
    private val finanzen: FinanzenRepository,
    private val haushalt: HaushaltRepository,
    private val leser: DateiLeser,
    gemerkt: SavedStateHandle,
) : ViewModel(), Filterwahl by filter, SetDetailAktionen {

    val state: StateFlow<AppUiState> = sitzung.state

    init {
        folgeAbmeldung(sitzung) { zuruecksetzen() }
        folgeBestand(bestand) { beiAenderung(it) }
    }

    /** Aus der Route set_detail/{setNumber}. */
    val setNumber: String = gemerkt[ARG_SET] ?: ""

    private val _setDetailState = MutableStateFlow(SetDetailUiState())
    val setDetailState: StateFlow<SetDetailUiState> = _setDetailState.asStateFlow()

    // Menge, Lagerort und Alarm warten die Ruhezeit ab; die Aufträge laufen im
    // Scope des ViewModels und überstehen so das Zurückgehen.
    private var lagerJob: Job? = null
    private val alarmEingabe = Preisalarmeingabe(
        scope = viewModelScope, sets = sets,
        melde = { meldungen.zeige(it) },
        beschreibe = { meldungen.meldungFuerSnackbar(it) },
        // Nachgeladen wird in beiAenderung(): Dort kommt dasselbe Signal auch
        // an, wenn ein Alarm anderswo (Übersicht, Merkliste) geändert wurde.
        gespeichert = { bestand.melde(Aenderung.Alarme) },
    )

    /** Alles, was die Ansicht zeigt — beim Betreten und nach der Rückkehr. */
    fun ladeAlles() {
        if (setNumber.isBlank()) return
        loadSetDetail(setNumber)
        loadSetPrice(setNumber)
        loadSetPriceHistory(setNumber)
        loadAcquisitions(setNumber)
        loadPreisalarme(setNumber)
    }

    override fun loadSetDetail(setNumber: String) {
        viewModelScope.launch {
            _setDetailState.update { it.copy(setDetailLoading = true, setDetailFehler = null) }
            when (val r = sets.getSetDetail(setNumber)) {
                is Ergebnis.Success -> _setDetailState.update { it.copy(setDetail = r.data.set?.alsAnsicht(), setDetailLoading = false) }
                is Ergebnis.Error -> _setDetailState.update { it.copy(setDetailLoading = false, setDetailFehler = meldungen.meldung(r),
                    setDetailFehlerKlasse = fehlerklasse(r)) }
            }
        }
    }

    override fun loadSetPrice(setNumber: String) {
        viewModelScope.launch {
            _setDetailState.update { it.copy(setPriceLoading = true) }
            when (val r = finanzen.getSetPrice(setNumber)) {
                is Ergebnis.Success -> _setDetailState.update { it.copy(setPrice = r.data.alsAnsicht(), setPriceLoading = false) }
                is Ergebnis.Error -> _setDetailState.update { it.copy(setPriceLoading = false) }
            }
        }
    }

    override fun loadSetPriceHistory(setNumber: String) {
        viewModelScope.launch {
            _setDetailState.update { it.copy(priceHistoryLoading = true) }
            when (val r = finanzen.getSetPriceHistory(setNumber)) {
                is Ergebnis.Success -> _setDetailState.update { it.copy(priceHistory = r.data.alsAnsicht(), priceHistoryLoading = false) }
                is Ergebnis.Error -> _setDetailState.update { it.copy(priceHistoryLoading = false) }
            }
        }
    }

    override fun loadAcquisitions(setNumber: String) {
        viewModelScope.launch {
            _setDetailState.update { it.copy(acquisitionsLoading = true) }
            when (val r = haushalt.getAcquisitions(setNumber)) {
                is Ergebnis.Success -> _setDetailState.update {
                    it.copy(acquisitions = r.data.acquisitions.map { a -> a.alsAnsicht() }, acquisitionTotals = r.data.totals.alsAnsicht(),
                            acquisitionsLoading = false)
                }
                is Ergebnis.Error -> _setDetailState.update { it.copy(acquisitionsLoading = false) }
            }
        }
    }

    override fun loadPreisalarme(setNumber: String) {
        viewModelScope.launch {
            val r = sets.getPreisalarme(setNumber)
            val alarme = (r as? Ergebnis.Success)?.data?.takeIf { it.success }?.alerts?.map { it.alsAnsicht() } ?: emptyList()
            _setDetailState.update { it.copy(preisalarme = alarme) }
        }
    }

    override fun setzePreisalarm(setNumber: String, richtung: String, roh: String, zustand: Zustand) =
        alarmEingabe.setze(setNumber, richtung, roh, zustand)

    /**
     * Die Menge ändern. Die neue Zahl steht sofort in der Ansicht, die übrigen
     * Bestandsansichten erfahren es über das Signal.
     */
    fun updateQuantity(setNumber: String, quantity: Int, purchasePrice: Double? = null, condition: Zustand? = null) =
        mengeAendern(setNumber) { sets.updateQuantity(setNumber, quantity, purchasePrice, condition) }

    /** Der Regler: ein Schritt, damit gleichzeitige Klicks auf zwei Geräten zusammenzählen. */
    override fun aendereMengeUm(setNumber: String, schritt: Int) =
        mengeAendern(setNumber) { sets.aendereMengeUm(setNumber, schritt) }

    private fun mengeAendern(setNumber: String, aufruf: suspend () -> Ergebnis<GenericResponse>) {
        viewModelScope.launch {
            when (val r = aufruf()) {
                is Ergebnis.Success -> {
                    r.data.quantity?.let { echt ->
                        _setDetailState.update { st ->
                            if (st.setDetail?.setNumber == setNumber)
                                st.copy(setDetail = st.setDetail.copy(quantity = echt)) else st
                        }
                    }
                    bestand.melde(Aenderung.Sets)
                }
                is Ergebnis.Error -> meldungen.zeige(meldungen.meldungFuerSnackbar(r)?.let { meldungen.text(R.string.vm_error, it) })
            }
        }
    }

    /** Lagerort des Sets, entprellt; massgeblich ist der normalisierte Ort aus der Antwort. */
    override fun setzeSetLagerort(setNumber: String, ort: String) {
        lagerJob?.cancel()
        lagerJob = viewModelScope.launch {
            delay(Alarmeingabe.RUHE_MS)
            when (val r = sets.setSetStorage(setNumber, ort)) {
                is Ergebnis.Success -> {
                    if (!r.data.success) { meldungen.zeige(r.data.error ?: ""); return@launch }
                    bestand.melde(Aenderung.Sets)
                }
                is Ergebnis.Error -> meldungen.zeige(meldungen.meldungFuerSnackbar(r))
            }
        }
    }

    fun deleteSet(setNumber: String) {
        viewModelScope.launch {
            val (geloescht, satz) = setLoeschen(sets, meldungen, setNumber)
            meldungen.zeige(satz)
            if (geloescht) bestand.melde(Aenderung.Sets, Aenderung.Teile, Aenderung.Figuren)
        }
    }

    override fun ladeAnleitungHoch(setNumber: String, datei: DateiRef) {
        viewModelScope.launch {
            val gelesen = leser.liesHoechstens(datei, ANLEITUNG_MAX_BYTES)
            if (gelesen == Gelesen.ZuGross) {
                meldungen.zeige(meldungen.text(R.string.csv_upload_too_big, ANLEITUNG_MAX_BYTES / 1024 / 1024))
                return@launch
            }
            val typ = (gelesen as? Gelesen.Inhalt)?.typ
            if (gelesen !is Gelesen.Inhalt || typ == null) { meldungen.zeige(meldungen.text(R.string.csv_upload_unreadable)); return@launch }
            if (typ !in ANLEITUNG_TYPEN) { meldungen.zeige(meldungen.text(R.string.instr_upload_wrong_type)); return@launch }
            val bytes = gelesen.bytes
            val name = leser.name(datei) ?: "anleitung"
            when (val r = sets.uploadAnleitung(setNumber, name, typ, bytes, name)) {
                is Ergebnis.Success ->
                    if (r.data.success) {
                        meldungen.zeige(meldungen.text(R.string.instr_upload_done))
                        loadSetDetail(setNumber)
                    } else meldungen.zeige(r.data.error ?: meldungen.text(R.string.err_generic))
                is Ergebnis.Error -> meldungen.zeige(meldungen.meldungFuerSnackbar(r))
            }
        }
    }

    override fun loescheAnleitung(setNumber: String, instrId: Int) {
        viewModelScope.launch {
            when (val r = sets.deleteAnleitung(setNumber, instrId)) {
                is Ergebnis.Success ->
                    if (r.data.success) loadSetDetail(setNumber)
                    else meldungen.zeige(r.data.error ?: meldungen.text(R.string.err_generic))
                is Ergebnis.Error -> meldungen.zeige(meldungen.meldungFuerSnackbar(r))
            }
        }
    }

    private fun beiAenderung(aenderung: Aenderung) {
        val betrifftDiesesSet = when (aenderung) {
            Aenderung.Sets -> true
            is Aenderung.SetZusammenfassung -> aenderung.agg.setNumber == setNumber
            Aenderung.Teile, Aenderung.Figuren, Aenderung.Merkliste, Aenderung.Alarme -> false
        }
        if (betrifftDiesesSet && _setDetailState.value.setDetail != null) {
            loadSetDetail(setNumber)
            loadAcquisitions(setNumber)
        }
        if (aenderung == Aenderung.Alarme && setNumber.isNotBlank()) loadPreisalarme(setNumber)
    }

    private fun zuruecksetzen() {
        lagerJob?.cancel()
        _setDetailState.value = SetDetailUiState()
    }

    private companion object {
        const val ARG_SET = "setNumber"
    }
}
