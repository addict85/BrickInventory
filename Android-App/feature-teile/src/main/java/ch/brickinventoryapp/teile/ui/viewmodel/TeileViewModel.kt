package ch.brickinventoryapp.teile.ui.viewmodel

import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.viewModelScope
import ch.brickinventoryapp.ressourcen.R
import ch.brickinventoryapp.data.alarm.Alarmeingabe
import ch.brickinventoryapp.model.data.ScopeFilter
import ch.brickinventoryapp.data.repository.Ergebnis
import ch.brickinventoryapp.data.repository.TeileRepository
import ch.brickinventoryapp.data.repository.FigurenRepository
import ch.brickinventoryapp.zustand.ui.Aenderung
import ch.brickinventoryapp.teile.ui.PartsUiState
import ch.brickinventoryapp.teile.ui.SetItemUiState
import ch.brickinventoryapp.teile.ui.Teile
import ch.brickinventoryapp.teile.ui.TeileAbfrage
import ch.brickinventoryapp.teile.ui.TeileLokal
import ch.brickinventoryapp.teile.ui.TeileQuelle
import ch.brickinventoryapp.model.ui.model.alsAnsicht
import ch.brickinventoryapp.zustand.ui.retryOnNetwork
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject
import ch.brickinventoryapp.model.data.model.GenericResponse
import androidx.lifecycle.ViewModel
import ch.brickinventoryapp.zustand.ui.AppUiState
import ch.brickinventoryapp.zustand.ui.Sitzung
import ch.brickinventoryapp.zustand.ui.Bestandssignal
import ch.brickinventoryapp.ui.ScrollMemory
import ch.brickinventoryapp.zustand.ui.viewmodel.Filterwahl
import ch.brickinventoryapp.zustand.ui.viewmodel.Meldungen
import ch.brickinventoryapp.zustand.ui.viewmodel.folgeAbmeldung
import ch.brickinventoryapp.zustand.ui.viewmodel.folgeBestand

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
    private val sitzung: Sitzung,
    private val filter: Filterwahl,
    private val meldungen: Meldungen,
    private val bestand: Bestandssignal,
    private val scrollMemory: ScrollMemory,
    private val repo: TeileRepository,
    private val figuren: FigurenRepository,
    private val gemerkt: SavedStateHandle,
) : ViewModel(), Filterwahl by filter, TeileAktionen {

    val state: StateFlow<AppUiState> = sitzung.state

    init {
        folgeAbmeldung(sitzung) { zuruecksetzen() }
        folgeBestand(bestand) { beiAenderung(it) }
    }

    override fun setScope(view: ScopeFilter.View, value: String) {
        viewModelScope.launch {
            filter.setzeKonto(view, value)
            nachFilter(view)
        }
    }

    override fun setLagerFilter(view: ScopeFilter.View, value: String) {
        viewModelScope.launch {
            filter.setzeLager(view, value)
            nachFilter(view)
        }
    }

    private val teile = Teile(
        scope = viewModelScope,
        quelle = object : TeileQuelle {
            private val teileSicht get() = filter.kontoFuer(ScopeFilter.View.PARTS)
            private val teileLager get() = filter.lagerFuer(ScopeFilter.View.PARTS)
            private val figurenSicht get() = filter.kontoFuer(ScopeFilter.View.MINIFIGS)
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
            override suspend fun figurKennzahlen() = figuren.getMinifigStats(figurenSicht)
            override suspend fun figuren(suche: String?) = figuren.getMinifigs(figurenSicht, suche)
            override suspend fun manuelleFiguren(suche: String?) = figuren.getManualMinifigs(figurenSicht, suche)
        },
        meldeFehler = { meldungen.zeige(meldungen.meldungFuerSnackbar(it)) },
        vergissScroll = { scrollMemory.vergiss("parts") },
        beschreibeFehler = { meldungen.meldung(it) },
        lokal = TeileLokal(repo.beobachteTeile(), repo.beobachteManuelleTeile(),
            figuren.beobachteFiguren(), figuren.beobachteManuelleFiguren()),
        teileEingeschraenkt = {
            filter.kontoFuer(ScopeFilter.View.PARTS) != null || !filter.lagerFuer(ScopeFilter.View.PARTS).isNullOrBlank()
        },
        figurenEingeschraenkt = { filter.kontoFuer(ScopeFilter.View.MINIFIGS) != null },
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

    override fun loadParts(page: Int, debounce: Boolean) = teile.laden(seite = page, entprellt = debounce)
    override fun loadMinifigs(debounce: Boolean) = teile.ladeFiguren(entprellt = debounce)
    fun loadPartsFilters() = teile.ladeFilter()
    override fun loadPartsColors() = teile.ladeFarben()

    override fun setPartsQuery(q: String) { gemerkt[F_SUCHE] = q; teile.setzeSuche(q) }
    override fun setPartsSpare(wert: String) { gemerkt[F_ERSATZ] = wert; teile.setzeErsatzteile(wert) }
    override fun setPartsView(wert: String) { gemerkt[F_ANSICHT] = wert; teile.setzeAnsicht(wert) }
    override fun setPartsColorFilter(wert: String) { gemerkt[F_FARBE] = wert; teile.setzeFarbe(wert) }
    override fun setPartsCategoryFilter(wert: String) { gemerkt[F_KATEGORIE] = wert; teile.setzeKategorie(wert) }
    override fun setMinifigsQuery(q: String) { gemerkt[F_FIGUR_SUCHE] = q; teile.setzeFigurSuche(q) }
    override fun setMinifigsView(wert: String) { gemerkt[F_FIGUR_ANSICHT] = wert; teile.setzeFigurAnsicht(wert) }

    // ── Erfassen und Ändern ──────────────────────────────────────────────────

    /**
     * Die Erfolgsmeldung nach dem Erfassen, samt Herkunft des Kaufpreises:
     * BrickLink führt zu vielen Teilen nur einen Zustand, der Server nennt in
     * `price_from_condition`, aus welchem der Wert stammt.
     */
    private fun erfassungsMeldung(angelegt: Boolean, nummer: String?, preisAusZustand: String?): String {
        val kopf = meldungen.text(if (angelegt) R.string.vm_added else R.string.vm_updated, nummer)
        val hinweis = when (preisAusZustand) {
            "N" -> meldungen.text(R.string.price_from_other_condition_new)
            "U" -> meldungen.text(R.string.price_from_other_condition_used)
            else -> null
        }
        return if (hinweis != null) "$kopf — $hinweis" else kopf
    }

    override fun addPart(partNumber: String, colorId: Int, colorName: String?, colorHex: String?,
                quantity: Int, unitPrice: Double?,
                condition: String?, ownerUserId: Int?,
                storage: String?) {
        viewModelScope.launch {
            when (val r = repo.addPart(partNumber.trim(), colorId, colorName, colorHex, quantity,
                                       unitPrice, condition, ownerUserId,
                                       storage?.trim()?.takeIf { it.isNotEmpty() })) {
                is Ergebnis.Success ->
                    if (r.data.success) {
                        meldungen.zeige(erfassungsMeldung(
                            r.data.action == "added", r.data.partNumber, r.data.priceFromCondition))
                        bestand.melde(Aenderung.Teile)
                    } else meldungen.zeige(r.data.error ?: meldungen.text(R.string.err_unknown))
                is Ergebnis.Error -> meldungen.zeige(meldungen.meldungFuerSnackbar(r))
            }
        }
    }

    override fun addMinifig(figNumber: String, blFigNumber: String?, quantity: Int,
                   unitPrice: Double?, condition: String?, ownerUserId: Int?,
                   storage: String?) {
        viewModelScope.launch {
            when (val r = figuren.addMinifig(figNumber.trim(), blFigNumber, quantity, unitPrice,
                                          condition, ownerUserId,
                                          storage?.trim()?.takeIf { it.isNotEmpty() })) {
                is Ergebnis.Success ->
                    if (r.data.success) {
                        meldungen.zeige(erfassungsMeldung(
                            r.data.action == "added", r.data.figNumber, r.data.priceFromCondition))
                        bestand.melde(Aenderung.Figuren)
                    } else meldungen.zeige(r.data.error ?: meldungen.text(R.string.err_unknown))
                is Ergebnis.Error -> meldungen.zeige(meldungen.meldungFuerSnackbar(r))
            }
        }
    }

    override fun updatePart(partNumber: String, colorId: Int, quantity: Int, unitPrice: Double?,
                   condition: String?, owner: Int?) =
        aendere(Aenderung.Teile, meldungen.text(R.string.vm_saved)) {
            repo.updatePart(partNumber, colorId, quantity, unitPrice, condition, owner).erfolg()
        }

    override fun updateMinifig(figNumber: String, quantity: Int, unitPrice: Double?, blFigNumber: String?,
                      condition: String?, owner: Int?) =
        aendere(Aenderung.Figuren, meldungen.text(R.string.vm_saved)) {
            figuren.updateMinifig(figNumber, quantity, unitPrice, blFigNumber, condition, owner).erfolg()
        }

    override fun deletePart(partNumber: String, colorId: Int, owner: Int?) =
        aendere(Aenderung.Teile, meldungen.text(R.string.vm_part_deleted)) {
            repo.deletePart(partNumber, colorId, owner).erfolg()
        }

    override fun deleteMinifig(figNumber: String, owner: Int?) =
        aendere(Aenderung.Figuren, meldungen.text(R.string.vm_minifig_deleted)) {
            figuren.deleteMinifig(figNumber, owner).erfolg()
        }

    /**
     * Die Farbe eines manuellen Teils ändern. Die Farbe ist Teil des Schlüssels
     * und der Route der Detailansicht — [onFertig] öffnet sie mit der neuen.
     */
    override fun setzeTeilFarbe(partNumber: String, colorId: Int, neueFarbe: Int,
                       farbName: String?, farbHex: String?,
                       owner: Int?, onFertig: (Int) -> Unit) {
        if (neueFarbe == colorId) return
        aendere(Aenderung.Teile, meldungen.text(R.string.vm_saved), danach = { onFertig(neueFarbe) }) {
            when (val r = repo.setPartColor(partNumber, colorId, neueFarbe, farbName, farbHex, owner)) {
                is Ergebnis.Success -> r.data.success to (r.data.error ?: meldungen.text(R.string.err_unknown))
                is Ergebnis.Error -> false to meldungen.meldungFuerSnackbar(r)
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
                meldungen.zeige(erfolgsSatz)
                bestand.melde(was)
                danach()
            } else meldungen.zeige(fehler)
        }
    }

    private fun Ergebnis<GenericResponse>.erfolg(): Pair<Boolean, String?> =
        when (this) {
            is Ergebnis.Success -> data.success to (data.error ?: meldungen.text(R.string.err_unknown))
            is Ergebnis.Error -> false to meldungen.meldungFuerSnackbar(this)
        }

    // ── „In welchen Sets steckt das?“ ────────────────────────────────────────

    override fun oeffneSetItem(art: String, nummer: String, colorId: Int) {
        _setItemState.value = SetItemUiState(art = art, nummer = nummer, colorId = colorId, laedt = true)
        viewModelScope.launch {
            val blick = filter.kontoFuer(if (art == "fig") ScopeFilter.View.MINIFIGS else ScopeFilter.View.PARTS)
            val r = if (art == "fig") figuren.getSetsMitFigur(nummer, blick)
                    else              repo.getSetsMitTeil(nummer, colorId, blick)
            // Inzwischen ein anderes Teil geöffnet? Dann gehört die Antwort nicht mehr hierher.
            val jetzt = _setItemState.value
            if (jetzt.art != art || jetzt.nummer != nummer || jetzt.colorId != colorId) return@launch
            when (r) {
                is Ergebnis.Success -> _setItemState.update {
                    it.copy(laedt = false, kopf = r.data.item?.alsAnsicht(), sets = r.data.sets.map { s -> s.alsAnsicht() },
                            fehler = if (r.data.success) null else r.data.error)
                }
                is Ergebnis.Error -> _setItemState.update { it.copy(laedt = false, fehler = meldungen.meldung(r)) }
            }
        }
    }

    override fun schliesseSetItem() {
        _setItemState.value = SetItemUiState()
    }

    override fun setzeTeilLagerort(nummer: String, farbe: Int, ort: String) {
        lagerJob?.cancel()
        lagerJob = viewModelScope.launch {
            delay(Alarmeingabe.RUHE_MS)
            when (val r = repo.setPartStorage(nummer, farbe, ort)) {
                is Ergebnis.Success -> {
                    if (!r.data.success) { meldungen.zeige(r.data.error ?: ""); return@launch }
                    _setItemState.update { z -> z.copy(kopf = z.kopf?.copy(storage = r.data.storage)) }
                    bestand.melde(Aenderung.Teile)
                }
                is Ergebnis.Error -> meldungen.zeige(meldungen.meldungFuerSnackbar(r))
            }
        }
    }

    // ── Haken ────────────────────────────────────────────────────────────────

    private fun nachFilter(view: ScopeFilter.View) {
        when (view) {
            ScopeFilter.View.PARTS -> loadParts()
            ScopeFilter.View.MINIFIGS -> loadMinifigs()
            else -> Unit
        }
    }

    private fun beiAenderung(aenderung: Aenderung) {
        when (aenderung) {
            Aenderung.Teile -> loadParts()
            Aenderung.Figuren -> loadMinifigs()
            Aenderung.Sets, Aenderung.Merkliste, Aenderung.Alarme, is Aenderung.SetZusammenfassung -> Unit
        }
    }

    private fun zuruecksetzen() {
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
