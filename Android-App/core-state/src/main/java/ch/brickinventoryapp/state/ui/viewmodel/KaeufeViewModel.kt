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
        // Ändert sich der Bestand in der Ablage, stimmen Käufe und Summen des Eintrags vielleicht nicht mehr.
        viewModelScope.launch { changes.inventoryChanged().collect { loadNew() } }
    }

    private val _manDetailState = MutableStateFlow(ManualItemDetailUiState())
    val manDetailState: StateFlow<ManualItemDetailUiState> = _manDetailState.asStateFlow()

    /** Die Käufe eines Eintrags, wie seine Seite sie liest: Wer sie zeigt, lädt sie. */
    fun purchasesOf(type: Postenart, id: String, colorId: Int): StateFlow<ManualItemDetailUiState> =
        Observed(manDetailState) {
            if (type == Postenart.SET) loadAcquisitions(id) else loadManualAcquisitions(type, id, colorId)
        }

    private var storageJob: Job? = null

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

    // ── Ändern ───────────────────────────────────────────────────────────────

    override fun updateAcquisition(setNumber: String, acqId: Int, purchasePrice: Double?, condition: Zustand?,
                          quantity: Int?, date: String?) {
        viewModelScope.launch {
            when (val r = haushalt.updateAcquisition(setNumber, acqId, purchasePrice, condition, quantity, date)) {
                is Ergebnis.Erfolg -> setChanged(r.data.zusammenfassung)
                is Ergebnis.Fehler -> {
                    meldungen.zeige(meldungen.meldungFuerSnackbar(r))
                    // Eine abgelehnte Datumsänderung steht sonst weiter im Feld.
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

    /** Ein Kauf, der erst gelöscht wird, wenn die Snackbar ohne „Rückgängig“ endet. */
    data class ReservedPurchase(val type: Postenart, val id: String, val colorId: Int, val purchaseId: Int)

    val purchaseRoute = Loeschvormerkung<ReservedPurchase>(viewModelScope) { v ->
        if (v.type == Postenart.SET) deleteSetPurchase(v.id, v.purchaseId) else deleteManualPurchase(v.type, v.id, v.colorId, v.purchaseId)
    }

    override fun purchaseDeleteReserve(type: Postenart, id: String, colorId: Int, acqId: Int) =
        purchaseRoute.reserve(ReservedPurchase(type, id, colorId, acqId))

    /** Hat die Ablage die neue Summe des Sets schon übernommen, folgt die Kachel; sonst wird der Stand geholt. */
    private suspend fun setChanged(uebernommen: Boolean) {
        if (!uebernommen) { loadNew(); sets.aktualisiereSets() }
    }

    /** Für manuelle Einträge schickt der Server keine Zusammenfassung; die Ablage holt den Stand. */
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
     * Eigentümer EINER Kaufpreis-Zeile wechseln — der einzige Weg, Bestand
     * zwischen Konten zu verschieben. [onDone] bekommt Fehler oder null und
     * die vom Server gemeldeten mitgewanderten Teile und Figuren.
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
                    // Mitgewanderte Teile und Figuren: Den Stand aller drei Listen kennt nur der Server.
                    sets.aktualisiereSets(); teile.refreshParts(); figuren.refreshMinifigs()
                }
                is Ergebnis.Fehler -> onDone(meldungen.meldung(r), 0, 0)
            }
        }
    }

    /** Lagerort eines manuellen Eintrags, entprellt wie beim Set. */
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
