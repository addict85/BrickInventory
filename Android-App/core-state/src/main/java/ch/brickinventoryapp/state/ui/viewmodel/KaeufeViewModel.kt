package ch.brickinventoryapp.state.ui.viewmodel

import ch.brickinventoryapp.state.ui.loadError
import ch.brickinventoryapp.model.ui.Laden
import ch.brickinventoryapp.model.domain.asMoney
import java.time.LocalDate
import ch.brickinventoryapp.model.domain.Postenart
import ch.brickinventoryapp.model.domain.Zustand
import androidx.lifecycle.viewModelScope
import ch.brickinventoryapp.data.alarm.Alarmeingabe
import ch.brickinventoryapp.model.domain.KEINE_FARBE
import ch.brickinventoryapp.model.domain.Kaufkorrektur
import ch.brickinventoryapp.data.repository.FinancesRepository
import ch.brickinventoryapp.data.repository.HouseholdRepository
import ch.brickinventoryapp.data.repository.Ergebnis
import ch.brickinventoryapp.data.repository.PartsRepository
import ch.brickinventoryapp.data.repository.MinifigsRepository
import ch.brickinventoryapp.data.repository.Bestandsabgleich
import ch.brickinventoryapp.data.repository.SetsRepository
import ch.brickinventoryapp.state.ui.ManualItemDetailUiState
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject
import ch.brickinventoryapp.resources.R
import androidx.lifecycle.ViewModel
import ch.brickinventoryapp.session.AppUiState
import ch.brickinventoryapp.session.Sitzung

/**
 * The purchases of an entry — set, manual part or manual figure:
 * purchase prices, quantities, dates, owners, plus price history and storage location of
 * manual entries. Serves the detail view of manual entries and the
 * management of purchases.
 */
@HiltViewModel
class KaeufeViewModel @Inject constructor(
    private val sitzung: Sitzung,
    private val filter: Filterwahl,
    private val meldungen: Meldungen,
    private val changes: Bestandsabgleich,
    private val haushalt: HouseholdRepository,
    private val sets: SetsRepository,
    private val finanzen: FinancesRepository,
    private val teile: PartsRepository,
    private val figuren: MinifigsRepository,
) : ViewModel(), Filterwahl by filter, KaeufeAktionen {

    val state: StateFlow<AppUiState> = sitzung.state

    init {
        sequenceSignOut(sitzung) { reset() }
        // If the inventory changes in the store, the entry's purchases and totals may no longer be correct.
        viewModelScope.launch { changes.inventoryChanged().collect { loadNew() } }
    }

    private val _manDetailState = MutableStateFlow(ManualItemDetailUiState())
    val manDetailState: StateFlow<ManualItemDetailUiState> = _manDetailState.asStateFlow()

    /** An entry's purchases, as its page reads them: whoever shows them loads them. */
    fun purchasesOf(type: Postenart, id: String, colorId: Int): StateFlow<ManualItemDetailUiState> =
        Observed(manDetailState) {
            if (type == Postenart.SET) loadAcquisitions(id) else loadManualAcquisitions(type, id, colorId)
        }

    private var storageJob: Job? = null

    // ── Laden ────────────────────────────────────────────────────────────────

    override fun loadAcquisitions(setNumber: String) = lade(Postenart.SET, setNumber, KEINE_FARBE)

    /** Purchases and price history of a manual part or figure. */
    override fun loadManualAcquisitions(type: Postenart, id: String, colorId: Int) {
        lade(type, id, colorId)
        loadManualPriceHistory(type, id, colorId)
    }

    private fun lade(type: Postenart, id: String, colorId: Int) {
        viewModelScope.launch {
            _manDetailState.update {
                // Another entry's history must not stay on screen.
                val gleich = it.itemId == id && it.colorId == colorId && it.itemType == type
                it.copy(purchasesFetch = Laden.Loads, itemType = type, itemId = id, colorId = colorId,
                        priceHistory = if (gleich) it.priceHistory else null)
            }
            val r = when (type) {
                Postenart.SET -> haushalt.getAcquisitions(id)
                Postenart.FIG -> haushalt.getFigAcquisitions(id)
                else  -> haushalt.getPartAcquisitions(id, colorId)
            }
            when (r) {
                is Ergebnis.Erfolg -> _manDetailState.update {
                    it.copy(acquisitions = r.data.kaeufe, acquisitionTotals = r.data.sums, purchasesFetch = Laden.Daten(Unit))
                }
                is Ergebnis.Fehler -> _manDetailState.update { it.copy(purchasesFetch = loadError(r)) }
            }
        }
    }

    fun loadManualPriceHistory(type: Postenart, id: String, colorId: Int = KEINE_FARBE) {
        viewModelScope.launch {
            _manDetailState.update { it.copy(historyFetch = Laden.Loads) }
            val r = if (type == Postenart.FIG) finanzen.getFigPriceHistory(id) else finanzen.getPartPriceHistory(id, colorId)
            when (r) {
                is Ergebnis.Erfolg -> _manDetailState.update { it.copy(priceHistory = r.data, historyFetch = Laden.Daten(Unit)) }
                is Ergebnis.Fehler -> _manDetailState.update { it.copy(historyFetch = loadError(r)) }
            }
        }
    }

    private fun loadNew() {
        val st = _manDetailState.value
        val art = st.itemType ?: return
        if (st.itemId.isBlank()) return
        lade(art, st.itemId, st.colorId)
    }

    // ── Changing ───────────────────────────────────────────────────────────────

    override fun updateAcquisition(setNumber: String, acqId: Int, purchasePrice: Double?, condition: Zustand?,
                          quantity: Int?, date: String?) {
        viewModelScope.launch {
            when (val r = haushalt.updateAcquisition(setNumber, acqId, purchasePrice, condition, quantity, date)) {
                is Ergebnis.Erfolg -> setChanged(r.data.zusammenfassung)
                is Ergebnis.Fehler -> {
                    meldungen.zeige(meldungen.meldungFuerSnackbar(r))
                    // A rejected date change would otherwise stay in the field.
                    if (date != null) loadAcquisitions(setNumber)
                }
            }
        }
    }

    override fun deleteAcquisition(setNumber: String, acqId: Int) {
        viewModelScope.launch { deleteSetPurchase(setNumber, acqId) }
    }

    private suspend fun deleteSetPurchase(setNumber: String, acqId: Int) {
        when (val r = haushalt.deleteAcquisition(setNumber, acqId)) {
            is Ergebnis.Erfolg -> setChanged(r.data.zusammenfassung)
            is Ergebnis.Fehler -> meldungen.zeige(meldungen.meldungFuerSnackbar(r)?.let { meldungen.text(R.string.vm_error, it) })
        }
    }

    /** A purchase that is only deleted once the snackbar ends without „undo“. */
    data class ReservedPurchase(val type: Postenart, val id: String, val colorId: Int, val purchaseId: Int)

    val purchaseRoute = Loeschvormerkung<ReservedPurchase>(viewModelScope) { v ->
        if (v.type == Postenart.SET) deleteSetPurchase(v.id, v.purchaseId) else deleteManualPurchase(v.type, v.id, v.colorId, v.purchaseId)
    }

    override fun purchaseDeleteReserve(type: Postenart, id: String, colorId: Int, acqId: Int) =
        purchaseRoute.reserve(ReservedPurchase(type, id, colorId, acqId))

    /** If the store has already taken over the set's new total, the tile follows; otherwise the state is fetched. */
    private suspend fun setChanged(uebernommen: Boolean) {
        if (!uebernommen) { loadNew(); sets.aktualisiereSets() }
    }

    /** For manual entries the server sends no summary; the store fetches the state. */
    private suspend fun manualNew(type: Postenart) {
        if (type == Postenart.FIG) figuren.refreshMinifigs() else teile.refreshParts()
    }

    override fun updateManualAcquisition(
        type: Postenart, id: String, colorId: Int, acqId: Int,
        unitPrice: Double?, condition: Zustand?, quantity: Int?, date: String?,
    ) {
        viewModelScope.launch {
            val tag = date?.let { runCatching { LocalDate.parse(it.take(10)) }.getOrNull() }
            val req = Kaufkorrektur(preis = unitPrice.asMoney(), zustand = condition, menge = quantity, datum = tag)
            val r = if (type == Postenart.FIG) haushalt.updateFigAcquisition(id, acqId, req)
                    else haushalt.updatePartAcquisition(id, colorId, acqId, req)
            if (r is Ergebnis.Erfolg) {
                manualNew(type)
            } else if (r is Ergebnis.Fehler) {
                meldungen.zeige(meldungen.meldungFuerSnackbar(r))
                if (date != null) loadNew()
            }
        }
    }

    override fun deleteManualAcquisition(type: Postenart, id: String, colorId: Int, acqId: Int) {
        viewModelScope.launch { deleteManualPurchase(type, id, colorId, acqId) }
    }

    private suspend fun deleteManualPurchase(type: Postenart, id: String, colorId: Int, acqId: Int) {
        val r = if (type == Postenart.FIG) haushalt.deleteFigAcquisition(id, acqId)
                else haushalt.deletePartAcquisition(id, colorId, acqId)
        when (r) {
            is Ergebnis.Erfolg -> manualNew(type)
            is Ergebnis.Fehler -> meldungen.zeige(meldungen.meldungFuerSnackbar(r))
        }
    }

    /**
     * Change the owner of ONE purchase-price row — the only way to move
     * inventory between accounts. [onDone] gets an error or null and
     * the parts and figures reported by the server as moved along.
     */
    override fun changeAcquisitionOwner(
        type: Postenart, id: String, colorId: Int, acqId: Int,
        toUserId: Int, onDone: (String?, Int, Int) -> Unit,
    ) {
        viewModelScope.launch {
            val req = Kaufkorrektur(besitzer = toUserId)
            val r = when (type) {
                Postenart.SET -> haushalt.updateAcquisition(id, acqId, ownerUserId = toUserId)
                Postenart.FIG -> haushalt.updateFigAcquisition(id, acqId, req)
                else  -> haushalt.updatePartAcquisition(id, colorId, acqId, req)
            }
            when (r) {
                is Ergebnis.Erfolg -> {
                    onDone(null, r.data.teile, r.data.figuren)
                    // Parts and figures moved along: only the server knows the state of all three lists.
                    sets.aktualisiereSets(); teile.refreshParts(); figuren.refreshMinifigs()
                }
                is Ergebnis.Fehler -> onDone(meldungen.meldung(r), 0, 0)
            }
        }
    }

    /** Storage location of a manual entry, debounced like for the set. */
    override fun setManualLocation(type: Postenart, id: String, farbe: Int, ort: String) {
        storageJob?.cancel()
        storageJob = viewModelScope.launch {
            delay(Alarmeingabe.RUHE_MS)
            val r = if (type == Postenart.FIG) figuren.setFigStorage(id, ort) else teile.setPartStorage(id, farbe, ort)
            when (r) {
                is Ergebnis.Erfolg -> filter.ownLocationsNew()
                is Ergebnis.Fehler -> meldungen.zeige(meldungen.meldungFuerSnackbar(r))
            }
        }
    }

    private fun reset() {
        storageJob?.cancel()
        _manDetailState.value = ManualItemDetailUiState()
    }
}
