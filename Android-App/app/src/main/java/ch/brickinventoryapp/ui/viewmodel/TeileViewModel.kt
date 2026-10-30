package ch.brickinventoryapp.ui.viewmodel

import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.viewModelScope
import ch.brickinventoryapp.R
import ch.brickinventoryapp.alarm.Alarmeingabe
import ch.brickinventoryapp.data.ScopeFilter
import ch.brickinventoryapp.data.model.KEINE_FARBE
import ch.brickinventoryapp.data.repository.Result
import ch.brickinventoryapp.data.repository.TeileRepository
import ch.brickinventoryapp.ui.Aenderung
import ch.brickinventoryapp.ui.PartsUiState
import ch.brickinventoryapp.ui.SetItemUiState
import ch.brickinventoryapp.ui.Teile
import ch.brickinventoryapp.ui.TeileAbfrage
import ch.brickinventoryapp.ui.TeileQuelle
import ch.brickinventoryapp.ui.retryOnNetwork
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
 * Teile und Minifiguren: Listen, Filter, Erfassen und Ändern manueller
 * Einträge, dazu der Dialog „in welchen Sets steckt dieses Teil“.
 *
 * Die Listenabläufe stehen in [Teile]; Suche, Filter und Ansichten stehen im
 * [SavedStateHandle] — die Teile- und die Figurenansicht haben je ein eigenes
 * ViewModel und merken sich je ihre eigenen.
 */
@HiltViewModel
class TeileViewModel @Inject constructor(
    dienste: AppDienste,
    private val repo: TeileRepository,
    private val gemerkt: SavedStateHandle,
) : BereichsViewModel(dienste) {

    private val teile = Teile(
        scope = viewModelScope,
        quelle = object : TeileQuelle {
            private val teileSicht get() = scopeFor(ScopeFilter.View.PARTS)
            private val teileLager get() = lagerFor(ScopeFilter.View.PARTS)
            private val figurenSicht get() = scopeFor(ScopeFilter.View.MINIFIGS)
            override suspend fun seite(abfrage: TeileAbfrage) = retryOnNetwork {
                repo.getParts(search = abfrage.suche, color = abfrage.farbe,
                    category = abfrage.kategorie, page = abfrage.seite, accounts = teileSicht,
                    spare = abfrage.ersatzteile, withSets = abfrage.mitSets, storage = teileLager)
            }
            override suspend fun manuelleTeile(suche: String?) = repo.getManualParts(teileSicht, suche, teileLager)
            override suspend fun teileKennzahlen() = repo.getPartsStats(teileSicht)
            override suspend fun filterFarben() = repo.getPartsFilterColors(teileSicht)
            override suspend fun kategorien() = repo.getPartsCategories(teileSicht)
            override suspend fun alleFarben() = repo.getBrickColors()
            override suspend fun figurKennzahlen() = repo.getMinifigStats(figurenSicht)
            override suspend fun figuren(suche: String?) = repo.getMinifigs(figurenSicht, suche)
            override suspend fun manuelleFiguren(suche: String?) = repo.getManualMinifigs(figurenSicht, suche)
        },
        meldeFehler = { _snackbar.value = meldungFuerSnackbar(it) },
        vergissScroll = { dienste.scrollMemory.vergiss("parts") },
        beschreibeFehler = { meldung(it) },
    )
    val partsState: StateFlow<PartsUiState> = teile.state

    private val _setItemState = MutableStateFlow(SetItemUiState())
    val setItemState: StateFlow<SetItemUiState> = _setItemState.asStateFlow()

    // Entprellt wie der Preisalarm: Wer „Kiste 3“ tippt, soll nicht fünf halbe
    // Orte im Vorrat hinterlassen, und der Auftrag überlebt das Zurückgehen.
    private var lagerJob: Job? = null

    init {
        teile.stelleFilterWieder { st ->
            st.copy(
                partsQuery = gemerkt[F_SUCHE] ?: st.partsQuery,
                partsSpare = gemerkt[F_ERSATZ] ?: st.partsSpare,
                partsView = gemerkt[F_ANSICHT] ?: st.partsView,
                partsColorFilter = gemerkt[F_FARBE] ?: st.partsColorFilter,
                partsCategoryFilter = gemerkt[F_KATEGORIE] ?: st.partsCategoryFilter,
                minifigsQuery = gemerkt[F_FIGUR_SUCHE] ?: st.minifigsQuery,
                minifigsView = gemerkt[F_FIGUR_ANSICHT] ?: st.minifigsView,
            )
        }
    }

    // ── Listen und Filter ────────────────────────────────────────────────────

    fun loadParts(page: Int = 1, debounce: Boolean = false) = teile.laden(seite = page, entprellt = debounce)
    fun loadMinifigs(debounce: Boolean = false) = teile.ladeFiguren(entprellt = debounce)
    fun loadPartsFilters() = teile.ladeFilter()
    fun loadPartsColors() = teile.ladeFarben()

    fun setPartsQuery(q: String) { gemerkt[F_SUCHE] = q; teile.setzeSuche(q) }
    fun setPartsSpare(wert: String) { gemerkt[F_ERSATZ] = wert; teile.setzeErsatzteile(wert) }
    fun setPartsView(wert: String) { gemerkt[F_ANSICHT] = wert; teile.setzeAnsicht(wert) }
    fun setPartsColorFilter(wert: String) { gemerkt[F_FARBE] = wert; teile.setzeFarbe(wert) }
    fun setPartsCategoryFilter(wert: String) { gemerkt[F_KATEGORIE] = wert; teile.setzeKategorie(wert) }
    fun setMinifigsQuery(q: String) { gemerkt[F_FIGUR_SUCHE] = q; teile.setzeFigurSuche(q) }
    fun setMinifigsView(wert: String) { gemerkt[F_FIGUR_ANSICHT] = wert; teile.setzeFigurAnsicht(wert) }

    // ── Erfassen und Ändern ──────────────────────────────────────────────────

    /**
     * Die Erfolgsmeldung nach dem Erfassen, samt Herkunft des Kaufpreises:
     * BrickLink führt zu vielen Teilen nur einen Zustand, der Server nennt in
     * `price_from_condition`, aus welchem der Wert stammt.
     */
    private fun erfassungsMeldung(angelegt: Boolean, nummer: String?, preisAusZustand: String?): String {
        val kopf = text(if (angelegt) R.string.vm_added else R.string.vm_updated, nummer)
        val hinweis = when (preisAusZustand) {
            "N" -> text(R.string.price_from_other_condition_new)
            "U" -> text(R.string.price_from_other_condition_used)
            else -> null
        }
        return if (hinweis != null) "$kopf — $hinweis" else kopf
    }

    fun addPart(partNumber: String, colorId: Int = KEINE_FARBE, colorName: String? = null, colorHex: String? = null,
                quantity: Int = 1, unitPrice: Double? = null,
                condition: String? = null, ownerUserId: Int? = null,
                storage: String? = null) {
        viewModelScope.launch {
            when (val r = repo.addPart(partNumber.trim(), colorId, colorName, colorHex, quantity,
                                       unitPrice, condition, ownerUserId,
                                       storage?.trim()?.takeIf { it.isNotEmpty() })) {
                is Result.Success ->
                    if (r.data.success) {
                        _snackbar.value = erfassungsMeldung(
                            r.data.action == "added", r.data.partNumber, r.data.priceFromCondition)
                        dienste.bestand.melde(Aenderung.Teile)
                    } else _snackbar.value = r.data.error ?: text(R.string.err_unknown)
                is Result.Error -> _snackbar.value = meldungFuerSnackbar(r)
            }
        }
    }

    fun addMinifig(figNumber: String, blFigNumber: String? = null, quantity: Int = 1,
                   unitPrice: Double? = null, condition: String? = null, ownerUserId: Int? = null,
                   storage: String? = null) {
        viewModelScope.launch {
            when (val r = repo.addMinifig(figNumber.trim(), blFigNumber, quantity, unitPrice,
                                          condition, ownerUserId,
                                          storage?.trim()?.takeIf { it.isNotEmpty() })) {
                is Result.Success ->
                    if (r.data.success) {
                        _snackbar.value = erfassungsMeldung(
                            r.data.action == "added", r.data.figNumber, r.data.priceFromCondition)
                        dienste.bestand.melde(Aenderung.Figuren)
                    } else _snackbar.value = r.data.error ?: text(R.string.err_unknown)
                is Result.Error -> _snackbar.value = meldungFuerSnackbar(r)
            }
        }
    }

    fun updatePart(partNumber: String, colorId: Int, quantity: Int, unitPrice: Double?,
                   condition: String? = null, owner: Int? = null) =
        aendere(Aenderung.Teile, text(R.string.vm_saved)) {
            repo.updatePart(partNumber, colorId, quantity, unitPrice, condition, owner).erfolg()
        }

    fun updateMinifig(figNumber: String, quantity: Int, unitPrice: Double?, blFigNumber: String? = null,
                      condition: String? = null, owner: Int? = null) =
        aendere(Aenderung.Figuren, text(R.string.vm_saved)) {
            repo.updateMinifig(figNumber, quantity, unitPrice, blFigNumber, condition, owner).erfolg()
        }

    fun deletePart(partNumber: String, colorId: Int, owner: Int? = null) =
        aendere(Aenderung.Teile, text(R.string.vm_part_deleted)) {
            repo.deletePart(partNumber, colorId, owner).erfolg()
        }

    fun deleteMinifig(figNumber: String, owner: Int? = null) =
        aendere(Aenderung.Figuren, text(R.string.vm_minifig_deleted)) {
            repo.deleteMinifig(figNumber, owner).erfolg()
        }

    /**
     * Die Farbe eines manuellen Teils ändern. Die Farbe ist Teil des Schlüssels
     * und der Route der Detailansicht — [onFertig] öffnet sie mit der neuen.
     */
    fun setzeTeilFarbe(partNumber: String, colorId: Int, neueFarbe: Int,
                       farbName: String? = null, farbHex: String? = null,
                       owner: Int? = null, onFertig: (Int) -> Unit = {}) {
        if (neueFarbe == colorId) return
        aendere(Aenderung.Teile, text(R.string.vm_saved), danach = { onFertig(neueFarbe) }) {
            when (val r = repo.setPartColor(partNumber, colorId, neueFarbe, farbName, farbHex, owner)) {
                is Result.Success -> r.data.success to (r.data.error ?: text(R.string.err_unknown))
                is Result.Error -> false to meldungFuerSnackbar(r)
            }
        }
    }

    /**
     * Die ändernden Wege: rufen, melden, die Bestandsansichten benachrichtigen.
     * Ein Fehlschlag ohne Satz (null) bleibt still — dann hat ihn die
     * Sitzungsschicht schon gemeldet.
     */
    private fun aendere(
        was: Aenderung, erfolgsSatz: String, danach: () -> Unit = {},
        tun: suspend () -> Pair<Boolean, String?>,
    ) {
        viewModelScope.launch {
            val (gelungen, fehler) = tun()
            if (gelungen) {
                _snackbar.value = erfolgsSatz
                dienste.bestand.melde(was)
                danach()
            } else _snackbar.value = fehler
        }
    }

    private fun Result<ch.brickinventoryapp.data.model.GenericResponse>.erfolg(): Pair<Boolean, String?> =
        when (this) {
            is Result.Success -> data.success to (data.error ?: text(R.string.err_unknown))
            is Result.Error -> false to meldungFuerSnackbar(this)
        }

    // ── „In welchen Sets steckt das?“ ────────────────────────────────────────

    fun oeffneSetItem(art: String, nummer: String, colorId: Int = KEINE_FARBE) {
        _setItemState.value = SetItemUiState(art = art, nummer = nummer, colorId = colorId, laedt = true)
        viewModelScope.launch {
            val blick = scopeFor(if (art == "fig") ScopeFilter.View.MINIFIGS else ScopeFilter.View.PARTS)
            val r = if (art == "fig") repo.getSetsMitFigur(nummer, blick)
                    else              repo.getSetsMitTeil(nummer, colorId, blick)
            // Inzwischen ein anderes Teil geöffnet? Dann gehört die Antwort nicht mehr hierher.
            val jetzt = _setItemState.value
            if (jetzt.art != art || jetzt.nummer != nummer || jetzt.colorId != colorId) return@launch
            when (r) {
                is Result.Success -> _setItemState.update {
                    it.copy(laedt = false, kopf = r.data.item, sets = r.data.sets,
                            fehler = if (r.data.success) null else r.data.error)
                }
                is Result.Error -> _setItemState.update { it.copy(laedt = false, fehler = meldung(r)) }
            }
        }
    }

    fun schliesseSetItem() {
        _setItemState.value = SetItemUiState()
    }

    fun setzeTeilLagerort(nummer: String, farbe: Int, ort: String) {
        lagerJob?.cancel()
        lagerJob = viewModelScope.launch {
            delay(Alarmeingabe.RUHE_MS)
            when (val r = repo.setPartStorage(nummer, farbe, ort)) {
                is Result.Success -> {
                    if (!r.data.success) { _snackbar.value = r.data.error ?: ""; return@launch }
                    _setItemState.update { z -> z.copy(kopf = z.kopf?.copy(storage = r.data.storage)) }
                    dienste.bestand.melde(Aenderung.Teile)
                }
                is Result.Error -> _snackbar.value = meldungFuerSnackbar(r)
            }
        }
    }

    // ── Haken ────────────────────────────────────────────────────────────────

    override fun nachFilter(view: ScopeFilter.View) {
        when (view) {
            ScopeFilter.View.PARTS -> loadParts()
            ScopeFilter.View.MINIFIGS -> loadMinifigs()
            else -> Unit
        }
    }

    override fun beiAenderung(aenderung: Aenderung) {
        when (aenderung) {
            Aenderung.Teile -> loadParts()
            Aenderung.Figuren -> loadMinifigs()
            Aenderung.Sets, Aenderung.Merkliste, Aenderung.Alarme, is Aenderung.SetZusammenfassung -> Unit
        }
    }

    override fun zuruecksetzen() {
        lagerJob?.cancel()
        teile.zuruecksetzen()
        _setItemState.value = SetItemUiState()
        listOf(F_SUCHE, F_ERSATZ, F_ANSICHT, F_FARBE, F_KATEGORIE, F_FIGUR_SUCHE, F_FIGUR_ANSICHT)
            .forEach { gemerkt.remove<String>(it) }
    }

    private companion object {
        const val F_SUCHE = "teile_suche"
        const val F_ERSATZ = "teile_ersatz"
        const val F_ANSICHT = "teile_ansicht"
        const val F_FARBE = "teile_farbe"
        const val F_KATEGORIE = "teile_kategorie"
        const val F_FIGUR_SUCHE = "figuren_suche"
        const val F_FIGUR_ANSICHT = "figuren_ansicht"
    }
}
