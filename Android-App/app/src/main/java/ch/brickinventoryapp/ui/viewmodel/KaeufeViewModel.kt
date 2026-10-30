package ch.brickinventoryapp.ui.viewmodel

import androidx.lifecycle.viewModelScope
import ch.brickinventoryapp.alarm.Alarmeingabe
import ch.brickinventoryapp.data.model.KEINE_FARBE
import ch.brickinventoryapp.data.model.UpdateAcquisitionRequest
import ch.brickinventoryapp.data.repository.FinanzenRepository
import ch.brickinventoryapp.data.repository.HaushaltRepository
import ch.brickinventoryapp.data.repository.Result
import ch.brickinventoryapp.data.repository.TeileRepository
import ch.brickinventoryapp.ui.Aenderung
import ch.brickinventoryapp.ui.ManualItemDetailUiState
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject

/**
 * Die Käufe eines Eintrags — Set, manuelles Teil oder manuelle Figur:
 * Kaufpreise, Mengen, Daten, Besitzer, dazu Preisverlauf und Lagerort der
 * manuellen Einträge. Dient der Detailansicht manueller Einträge und der
 * Verwaltung der Käufe.
 *
 * Ein Zustand für alle drei Arten ([ManualItemDetailUiState]): Die Verwaltung
 * zeigte vorher je nach Art einen von zwei Zuständen zweier Bildschirme.
 */
@HiltViewModel
class KaeufeViewModel @Inject constructor(
    dienste: AppDienste,
    private val haushalt: HaushaltRepository,
    private val finanzen: FinanzenRepository,
    private val teile: TeileRepository,
) : BereichsViewModel(dienste) {

    private val _manDetailState = MutableStateFlow(ManualItemDetailUiState())
    val manDetailState: StateFlow<ManualItemDetailUiState> = _manDetailState.asStateFlow()

    private var lagerJob: Job? = null

    // ── Laden ────────────────────────────────────────────────────────────────

    fun loadAcquisitions(setNumber: String) = lade("set", setNumber, KEINE_FARBE)

    /** Käufe und Preisverlauf eines manuellen Teils ("part") oder einer Figur ("fig"). */
    fun loadManualAcquisitions(type: String, id: String, colorId: Int = KEINE_FARBE) {
        lade(type, id, colorId)
        loadManualPriceHistory(type, id, colorId)
    }

    private fun lade(type: String, id: String, colorId: Int) {
        viewModelScope.launch {
            _manDetailState.update {
                // Der Verlauf eines anderen Eintrags darf nicht stehen bleiben.
                val gleich = it.itemId == id && it.colorId == colorId && it.itemType == type
                it.copy(isLoading = true, itemType = type, itemId = id, colorId = colorId,
                        priceHistory = if (gleich) it.priceHistory else null)
            }
            val r = when (type) {
                "set" -> haushalt.getAcquisitions(id)
                "fig" -> haushalt.getFigAcquisitions(id)
                else  -> haushalt.getPartAcquisitions(id, colorId)
            }
            when (r) {
                is Result.Success -> _manDetailState.update {
                    it.copy(acquisitions = r.data.acquisitions, acquisitionTotals = r.data.totals, isLoading = false)
                }
                is Result.Error -> _manDetailState.update { it.copy(isLoading = false) }
            }
        }
    }

    fun loadManualPriceHistory(type: String, id: String, colorId: Int = KEINE_FARBE) {
        viewModelScope.launch {
            _manDetailState.update { it.copy(priceHistoryLoading = true) }
            val r = if (type == "fig") finanzen.getFigPriceHistory(id) else finanzen.getPartPriceHistory(id, colorId)
            when (r) {
                is Result.Success -> _manDetailState.update { it.copy(priceHistory = r.data, priceHistoryLoading = false) }
                is Result.Error -> _manDetailState.update { it.copy(priceHistoryLoading = false) }
            }
        }
    }

    private fun neuLaden() {
        val st = _manDetailState.value
        if (st.itemId.isBlank()) return
        lade(st.itemType, st.itemId, st.colorId)
    }

    // ── Ändern ───────────────────────────────────────────────────────────────

    fun updateAcquisition(setNumber: String, acqId: Int, purchasePrice: Double? = null, condition: String? = null,
                          quantity: Int? = null, date: String? = null) {
        viewModelScope.launch {
            when (val r = haushalt.updateAcquisition(setNumber, acqId, purchasePrice, condition, quantity, date)) {
                is Result.Success -> if (r.data.success) setGeaendert(r.data.set)
                is Result.Error -> {
                    _snackbar.value = meldungFuerSnackbar(r)
                    // Eine abgelehnte Datumsänderung steht sonst weiter im Feld.
                    if (date != null) loadAcquisitions(setNumber)
                }
            }
        }
    }

    fun deleteAcquisition(setNumber: String, acqId: Int) {
        viewModelScope.launch {
            when (val r = haushalt.deleteAcquisition(setNumber, acqId)) {
                is Result.Success -> if (r.data.success) setGeaendert(r.data.set)
                is Result.Error -> _snackbar.value = meldungFuerSnackbar(r)?.let { text(ch.brickinventoryapp.R.string.vm_error, it) }
            }
        }
    }

    /**
     * Der Server schickt die neue Zusammenfassung des Sets mit; die Galerie
     * passt damit die Kachel an, ohne die Liste neu zu holen. Diese Liste lädt
     * auf dasselbe Signal nach (beiAenderung).
     */
    private fun setGeaendert(agg: ch.brickinventoryapp.data.model.SetAggregate?) {
        if (agg != null && agg.setNumber.isNotBlank()) {
            dienste.bestand.melde(Aenderung.SetZusammenfassung(agg))
        } else {
            neuLaden()
            dienste.bestand.melde(Aenderung.Sets)
        }
    }

    fun updateManualAcquisition(
        type: String, id: String, colorId: Int, acqId: Int,
        unitPrice: Double? = null, condition: String? = null, quantity: Int? = null, date: String? = null,
    ) {
        viewModelScope.launch {
            val req = UpdateAcquisitionRequest.fuerStueck(preis = unitPrice, condition = condition,
                                                          quantity = quantity, date = date)
            val r = if (type == "fig") haushalt.updateFigAcquisition(id, acqId, req)
                    else haushalt.updatePartAcquisition(id, colorId, acqId, req)
            if (r is Result.Success && r.data.success) {
                dienste.bestand.melde(manuelleArt(type))
            } else if (r is Result.Error) {
                _snackbar.value = meldungFuerSnackbar(r)
                if (date != null) neuLaden()
            }
        }
    }

    fun deleteManualAcquisition(type: String, id: String, colorId: Int, acqId: Int) {
        viewModelScope.launch {
            val r = if (type == "fig") haushalt.deleteFigAcquisition(id, acqId)
                    else haushalt.deletePartAcquisition(id, colorId, acqId)
            when (r) {
                is Result.Success -> dienste.bestand.melde(manuelleArt(type))
                is Result.Error -> _snackbar.value = meldungFuerSnackbar(r)
            }
        }
    }

    /**
     * Eigentümer EINER Kaufpreis-Zeile wechseln — der einzige Weg, Bestand
     * zwischen Konten zu verschieben. [onDone] bekommt Fehler oder null und
     * die vom Server gemeldeten mitgewanderten Teile und Figuren.
     */
    fun changeAcquisitionOwner(
        type: String, id: String, colorId: Int, acqId: Int,
        toUserId: Int, onDone: (String?, Int, Int) -> Unit = { _, _, _ -> },
    ) {
        viewModelScope.launch {
            val req = UpdateAcquisitionRequest.fuerStueck(ownerUserId = toUserId)
            val r = when (type) {
                "set" -> haushalt.updateAcquisition(id, acqId, ownerUserId = toUserId)
                "fig" -> haushalt.updateFigAcquisition(id, acqId, req)
                else  -> haushalt.updatePartAcquisition(id, colorId, acqId, req)
            }
            when (r) {
                is Result.Success ->
                    if (r.data.success) {
                        dienste.bestand.melde(Aenderung.Sets, Aenderung.Teile, Aenderung.Figuren)
                        onDone(null, r.data.parts ?: 0, r.data.minifigs ?: 0)
                    } else onDone(r.data.error ?: "", 0, 0)
                is Result.Error -> onDone(meldung(r), 0, 0)
            }
        }
    }

    /** Lagerort eines manuellen Eintrags, entprellt wie beim Set. */
    fun setzeManuellenLagerort(type: String, id: String, farbe: Int, ort: String) {
        lagerJob?.cancel()
        lagerJob = viewModelScope.launch {
            delay(Alarmeingabe.RUHE_MS)
            val r = if (type == "fig") teile.setFigStorage(id, ort) else teile.setPartStorage(id, farbe, ort)
            when (r) {
                is Result.Success -> {
                    if (!r.data.success) { _snackbar.value = r.data.error ?: ""; return@launch }
                    dienste.bestand.melde(manuelleArt(type))
                    dienste.blickfeld.ladeEigeneLagerorte()
                }
                is Result.Error -> _snackbar.value = meldungFuerSnackbar(r)
            }
        }
    }

    private fun manuelleArt(type: String) = if (type == "fig") Aenderung.Figuren else Aenderung.Teile

    override fun beiAenderung(aenderung: Aenderung) {
        val art = _manDetailState.value.itemType
        val betrifft = when (aenderung) {
            Aenderung.Teile -> art == "part"
            Aenderung.Figuren -> art == "fig"
            is Aenderung.SetZusammenfassung -> art == "set" && aenderung.agg.setNumber == _manDetailState.value.itemId
            Aenderung.Sets, Aenderung.Merkliste, Aenderung.Alarme -> false
        }
        if (betrifft) neuLaden()
    }

    override fun zuruecksetzen() {
        lagerJob?.cancel()
        _manDetailState.value = ManualItemDetailUiState()
    }
}
