package ch.brickinventoryapp.zustand.ui.viewmodel

import ch.brickinventoryapp.model.fach.Postenart
import ch.brickinventoryapp.model.fach.Zustand
import ch.brickinventoryapp.vertrag.abbildung.alsAnsicht
import androidx.lifecycle.viewModelScope
import ch.brickinventoryapp.data.alarm.Alarmeingabe
import ch.brickinventoryapp.model.fach.KEINE_FARBE
import ch.brickinventoryapp.vertrag.UpdateAcquisitionRequest
import ch.brickinventoryapp.data.repository.FinanzenRepository
import ch.brickinventoryapp.data.repository.HaushaltRepository
import ch.brickinventoryapp.data.repository.Ergebnis
import ch.brickinventoryapp.data.repository.TeileRepository
import ch.brickinventoryapp.data.repository.FigurenRepository
import ch.brickinventoryapp.data.repository.Bestandsabgleich
import ch.brickinventoryapp.data.repository.SetsRepository
import ch.brickinventoryapp.zustand.ui.ManualItemDetailUiState
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject
import ch.brickinventoryapp.vertrag.SetAggregate
import ch.brickinventoryapp.ressourcen.R
import androidx.lifecycle.ViewModel
import ch.brickinventoryapp.sitzung.AppUiState
import ch.brickinventoryapp.sitzung.Sitzung

/**
 * Die Käufe eines Eintrags — Set, manuelles Teil oder manuelle Figur:
 * Kaufpreise, Mengen, Daten, Besitzer, dazu Preisverlauf und Lagerort der
 * manuellen Einträge. Dient der Detailansicht manueller Einträge und der
 * Verwaltung der Käufe.
 */
@HiltViewModel
class KaeufeViewModel @Inject constructor(
    private val sitzung: Sitzung,
    private val filter: Filterwahl,
    private val meldungen: Meldungen,
    private val aenderungen: Bestandsabgleich,
    private val haushalt: HaushaltRepository,
    private val sets: SetsRepository,
    private val finanzen: FinanzenRepository,
    private val teile: TeileRepository,
    private val figuren: FigurenRepository,
) : ViewModel(), Filterwahl by filter, KaeufeAktionen {

    val state: StateFlow<AppUiState> = sitzung.state

    init {
        folgeAbmeldung(sitzung) { zuruecksetzen() }
        // Ändert sich der Bestand in der Ablage, stimmen Käufe und Summen des Eintrags vielleicht nicht mehr.
        viewModelScope.launch { aenderungen.bestandGeaendert().collect { neuLaden() } }
    }

    private val _manDetailState = MutableStateFlow(ManualItemDetailUiState())
    val manDetailState: StateFlow<ManualItemDetailUiState> = _manDetailState.asStateFlow()

    private var lagerJob: Job? = null

    // ── Laden ────────────────────────────────────────────────────────────────

    override fun loadAcquisitions(setNumber: String) = lade(Postenart.SET, setNumber, KEINE_FARBE)

    /** Käufe und Preisverlauf eines manuellen Teils oder einer Figur. */
    override fun loadManualAcquisitions(type: Postenart, id: String, colorId: Int) {
        lade(type, id, colorId)
        loadManualPriceHistory(type, id, colorId)
    }

    private fun lade(type: Postenart, id: String, colorId: Int) {
        viewModelScope.launch {
            _manDetailState.update {
                // Der Verlauf eines anderen Eintrags darf nicht stehen bleiben.
                val gleich = it.itemId == id && it.colorId == colorId && it.itemType == type
                it.copy(isLoading = true, itemType = type, itemId = id, colorId = colorId,
                        priceHistory = if (gleich) it.priceHistory else null)
            }
            val r = when (type) {
                Postenart.SET -> haushalt.getAcquisitions(id)
                Postenart.FIG -> haushalt.getFigAcquisitions(id)
                else  -> haushalt.getPartAcquisitions(id, colorId)
            }
            when (r) {
                is Ergebnis.Success -> _manDetailState.update {
                    it.copy(acquisitions = r.data.acquisitions.map { a -> a.alsAnsicht() }, acquisitionTotals = r.data.totals.alsAnsicht(), isLoading = false)
                }
                is Ergebnis.Error -> _manDetailState.update { it.copy(isLoading = false) }
            }
        }
    }

    fun loadManualPriceHistory(type: Postenart, id: String, colorId: Int = KEINE_FARBE) {
        viewModelScope.launch {
            _manDetailState.update { it.copy(priceHistoryLoading = true) }
            val r = if (type == Postenart.FIG) finanzen.getFigPriceHistory(id) else finanzen.getPartPriceHistory(id, colorId)
            when (r) {
                is Ergebnis.Success -> _manDetailState.update { it.copy(priceHistory = r.data.alsAnsicht(), priceHistoryLoading = false) }
                is Ergebnis.Error -> _manDetailState.update { it.copy(priceHistoryLoading = false) }
            }
        }
    }

    private fun neuLaden() {
        val st = _manDetailState.value
        val art = st.itemType ?: return
        if (st.itemId.isBlank()) return
        lade(art, st.itemId, st.colorId)
    }

    // ── Ändern ───────────────────────────────────────────────────────────────

    override fun updateAcquisition(setNumber: String, acqId: Int, purchasePrice: Double?, condition: Zustand?,
                          quantity: Int?, date: String?) {
        viewModelScope.launch {
            when (val r = haushalt.updateAcquisition(setNumber, acqId, purchasePrice, condition, quantity, date)) {
                is Ergebnis.Success -> if (r.data.success) setGeaendert(r.data.set)
                is Ergebnis.Error -> {
                    meldungen.zeige(meldungen.meldungFuerSnackbar(r))
                    // Eine abgelehnte Datumsänderung steht sonst weiter im Feld.
                    if (date != null) loadAcquisitions(setNumber)
                }
            }
        }
    }

    override fun deleteAcquisition(setNumber: String, acqId: Int) {
        viewModelScope.launch {
            when (val r = haushalt.deleteAcquisition(setNumber, acqId)) {
                is Ergebnis.Success -> if (r.data.success) setGeaendert(r.data.set)
                is Ergebnis.Error -> meldungen.zeige(meldungen.meldungFuerSnackbar(r)?.let { meldungen.text(R.string.vm_error, it) })
            }
        }
    }

    /**
     * Der Server schickt die neue Zusammenfassung des Sets mit; sie geht in die
     * Ablage, die Kachel folgt ohne neue Liste. Ohne sie holt die Ablage den Stand.
     */
    private suspend fun setGeaendert(agg: SetAggregate?) {
        if (agg != null && agg.setNumber.isNotBlank()) sets.uebernimmZusammenfassung(agg)
        else { neuLaden(); sets.aktualisiereSets() }
    }

    /** Für manuelle Einträge schickt der Server keine Zusammenfassung; die Ablage holt den Stand. */
    private suspend fun manuelleNeu(type: Postenart) {
        if (type == Postenart.FIG) figuren.aktualisiereFiguren() else teile.aktualisiereTeile()
    }

    override fun updateManualAcquisition(
        type: Postenart, id: String, colorId: Int, acqId: Int,
        unitPrice: Double?, condition: Zustand?, quantity: Int?, date: String?,
    ) {
        viewModelScope.launch {
            val req = UpdateAcquisitionRequest.fuerStueck(preis = unitPrice, condition = condition,
                                                          quantity = quantity, date = date)
            val r = if (type == Postenart.FIG) haushalt.updateFigAcquisition(id, acqId, req)
                    else haushalt.updatePartAcquisition(id, colorId, acqId, req)
            if (r is Ergebnis.Success && r.data.success) {
                manuelleNeu(type)
            } else if (r is Ergebnis.Error) {
                meldungen.zeige(meldungen.meldungFuerSnackbar(r))
                if (date != null) neuLaden()
            }
        }
    }

    override fun deleteManualAcquisition(type: Postenart, id: String, colorId: Int, acqId: Int) {
        viewModelScope.launch {
            val r = if (type == Postenart.FIG) haushalt.deleteFigAcquisition(id, acqId)
                    else haushalt.deletePartAcquisition(id, colorId, acqId)
            when (r) {
                is Ergebnis.Success -> manuelleNeu(type)
                is Ergebnis.Error -> meldungen.zeige(meldungen.meldungFuerSnackbar(r))
            }
        }
    }

    /**
     * Eigentümer EINER Kaufpreis-Zeile wechseln — der einzige Weg, Bestand
     * zwischen Konten zu verschieben. [onDone] bekommt Fehler oder null und
     * die vom Server gemeldeten mitgewanderten Teile und Figuren.
     */
    override fun changeAcquisitionOwner(
        type: Postenart, id: String, colorId: Int, acqId: Int,
        toUserId: Int, onDone: (String?, Int, Int) -> Unit,
    ) {
        viewModelScope.launch {
            val req = UpdateAcquisitionRequest.fuerStueck(ownerUserId = toUserId)
            val r = when (type) {
                Postenart.SET -> haushalt.updateAcquisition(id, acqId, ownerUserId = toUserId)
                Postenart.FIG -> haushalt.updateFigAcquisition(id, acqId, req)
                else  -> haushalt.updatePartAcquisition(id, colorId, acqId, req)
            }
            when (r) {
                is Ergebnis.Success ->
                    if (r.data.success) {
                        onDone(null, r.data.parts ?: 0, r.data.minifigs ?: 0)
                        // Mitgewanderte Teile und Figuren: Den Stand aller drei Listen kennt nur der Server.
                        sets.aktualisiereSets(); teile.aktualisiereTeile(); figuren.aktualisiereFiguren()
                    } else onDone(r.data.error ?: "", 0, 0)
                is Ergebnis.Error -> onDone(meldungen.meldung(r), 0, 0)
            }
        }
    }

    /** Lagerort eines manuellen Eintrags, entprellt wie beim Set. */
    override fun setzeManuellenLagerort(type: Postenart, id: String, farbe: Int, ort: String) {
        lagerJob?.cancel()
        lagerJob = viewModelScope.launch {
            delay(Alarmeingabe.RUHE_MS)
            val r = if (type == Postenart.FIG) figuren.setFigStorage(id, ort) else teile.setPartStorage(id, farbe, ort)
            when (r) {
                is Ergebnis.Success -> {
                    if (!r.data.success) { meldungen.zeige(r.data.error ?: ""); return@launch }
                    filter.eigeneLagerorteNeu()
                }
                is Ergebnis.Error -> meldungen.zeige(meldungen.meldungFuerSnackbar(r))
            }
        }
    }

    private fun zuruecksetzen() {
        lagerJob?.cancel()
        _manDetailState.value = ManualItemDetailUiState()
    }
}
