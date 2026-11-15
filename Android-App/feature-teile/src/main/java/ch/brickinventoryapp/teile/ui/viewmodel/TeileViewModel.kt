package ch.brickinventoryapp.teile.ui.viewmodel

import ch.brickinventoryapp.model.fach.Teilerfassung
import ch.brickinventoryapp.model.fach.Zustand
import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.viewModelScope
import ch.brickinventoryapp.ressourcen.R
import ch.brickinventoryapp.data.alarm.Alarmeingabe
import ch.brickinventoryapp.model.data.ScopeFilter
import ch.brickinventoryapp.data.repository.Ergebnis
import ch.brickinventoryapp.data.repository.TeileRepository
import ch.brickinventoryapp.data.repository.Bestandsabgleich
import ch.brickinventoryapp.data.repository.Kontosicht
import ch.brickinventoryapp.teile.ui.Teile
import ch.brickinventoryapp.teile.ui.TeileLokal
import ch.brickinventoryapp.teile.ui.TeileQuelle
import ch.brickinventoryapp.teile.ui.TeileUiState
import ch.brickinventoryapp.teile.ui.Teilefilter
import ch.brickinventoryapp.teile.ui.SetItemAblauf
import ch.brickinventoryapp.teile.ui.SetItemUiState
import ch.brickinventoryapp.model.fach.Postenart
import ch.brickinventoryapp.zustand.ui.viewmodel.Beobachtet
import ch.brickinventoryapp.zustand.ui.viewmodel.ladeJeServer
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import javax.inject.Inject
import androidx.lifecycle.ViewModel
import ch.brickinventoryapp.sitzung.Sitzung
import ch.brickinventoryapp.model.ui.ScrollMemory
import ch.brickinventoryapp.zustand.ui.viewmodel.Filterwahl
import ch.brickinventoryapp.zustand.ui.viewmodel.Meldungen
import ch.brickinventoryapp.zustand.ui.viewmodel.folgeAbmeldung
import ch.brickinventoryapp.model.data.Ersatzteilwahl
import ch.brickinventoryapp.model.ui.Listenansicht
import ch.brickinventoryapp.teile.ui.TeileSitzungUiState
import ch.brickinventoryapp.sitzung.abgeleitet

/**
 * Der Teile-Reiter: Liste, Filter, Erfassen und Ändern manueller Teile, dazu der Dialog
 * „in welchen Sets steckt dieses Teil“. Die Figuren haben ihr eigenes [FigurenViewModel].
 *
 * Der [Teilefilter] liegt im [SavedStateHandle] und übersteht den Prozesstod; Konto und
 * Lagerort nicht, die gelten nur im Speicher (Blickfeld).
 */
@HiltViewModel
class TeileViewModel @Inject constructor(
    private val sitzung: Sitzung,
    private val filter: Filterwahl,
    private val meldungen: Meldungen,
    private val aenderungen: Bestandsabgleich,
    private val scrollMemory: ScrollMemory,
    private val repo: TeileRepository,
    private val kontosicht: Kontosicht,
    private val gemerkt: SavedStateHandle,
) : ViewModel(), Filterwahl by filter, TeileAktionen, MitSetItem {

    internal val state: StateFlow<TeileSitzungUiState> =
        sitzung.state.abgeleitet { TeileSitzungUiState(it.serverUrl, it.currency, it.userDefaultCondition) }

    init {
        folgeAbmeldung(sitzung) { zuruecksetzen() }
    }

    override fun setScope(view: ScopeFilter.View, value: String) {
        viewModelScope.launch {
            filter.setzeKonto(view, value)
            if (view == ScopeFilter.View.PARTS) loadParts()
        }
    }

    override fun setLagerFilter(view: ScopeFilter.View, value: String) {
        viewModelScope.launch {
            filter.setzeLager(view, value)
            if (view == ScopeFilter.View.PARTS) loadParts()
        }
    }

    private val teileKonto get() = filter.kontoFuer(ScopeFilter.View.PARTS)
    private val teileLager get() = filter.lagerFuer(ScopeFilter.View.PARTS)?.ifBlank { null }

    /**
     * Konto und Lagerort teilen die Mengen auf, „In Sets“ zählt die Tabelle: Das
     * rechnet nur der Server (Kontosicht). Sonst gilt die Ablage.
     */
    private fun teileAbfrage(st: TeileUiState): Kontosicht.TeileAbfrage? {
        val f = st.filter
        return if (teileKonto == null && teileLager == null && f.ansicht != Listenansicht.TABELLE) null
        else Kontosicht.TeileAbfrage(teileKonto, f.suche.ifBlank { null }, f.farbe.ifBlank { null },
            f.kategorie.ifBlank { null }, f.ersatz, f.ansicht == Listenansicht.TABELLE, teileLager)
    }

    private fun manuelleAbfrage(st: TeileUiState): Kontosicht.ManuelleAbfrage? =
        if (teileKonto == null && teileLager == null) null
        else Kontosicht.ManuelleAbfrage(teileKonto, st.filter.suche.ifBlank { null }, teileLager)

    private val teile = Teile(
        scope = viewModelScope,
        quelle = object : TeileQuelle {
            override suspend fun teileKennzahlen() = repo.getPartsStats(teileKonto)
            override suspend fun filterFarben() = repo.getPartsFilterColors(teileKonto)
            override suspend fun kategorien() = repo.getPartsCategories(teileKonto)
            override suspend fun alleFarben() = repo.getBrickColors()
        },
        meldeFehler = { meldungen.zeige(meldungen.meldungFuerSnackbar(it)) },
        vergissScroll = { scrollMemory.vergiss("parts") },
        listen = TeileLokal(
            teile = { st -> teileAbfrage(st)?.let { kontosicht.teileliste.beobachte(it) }
                ?: st.filter.let { f -> repo.beobachteTeile(f.suche, f.farbe, f.kategorie, f.ersatz) } },
            manuelleTeile = { st -> manuelleAbfrage(st)?.let { kontosicht.manuelleTeile.beobachte(it) }
                ?: repo.beobachteManuelleTeile(st.filter.suche) },
            aktualisiere = { st -> aktualisiereTeile(st) },
        ),
        filterGeaendert = { gemerkt[F_FILTER] = it },
    )

    /** Jede Quelle füllen, die der Zustand zeigt; die Tabelle allein lässt die manuellen in der Ablage. */
    private suspend fun aktualisiereTeile(st: TeileUiState): Ergebnis<Unit> {
        val liste = teileAbfrage(st) ?: return repo.aktualisiereTeile()
        val r = kontosicht.teileliste.aktualisiere(liste)
        if (r is Ergebnis.Error) return r
        return manuelleAbfrage(st)?.let { kontosicht.manuelleTeile.aktualisiere(it) } ?: repo.aktualisiereManuelleTeile()
    }

    private val teileBeobachtet = Beobachtet(teile.state)
    val teileState: StateFlow<TeileUiState> = teileBeobachtet

    private val setItem = SetItemAblauf(viewModelScope, Postenart.PART,
        abfrage = { nummer, farbe -> repo.getSetsMitTeil(nummer, farbe, teileKonto) },
        nachKopf = filter::loadLagerortVorrat)
    override val setItemState: StateFlow<SetItemUiState> = setItem.state

    // Entprellt wie der Preisalarm: Wer „Kiste 3“ tippt, soll nicht fünf halbe
    // Orte im Vorrat hinterlassen, und der Auftrag überlebt das Zurückgehen.
    private var lagerJob: Job? = null

    init {
        // Die Liste folgt der Ablage selbst; die Kennzahlen rechnet der Server darüber.
        viewModelScope.launch { aenderungen.teileGeaendert().collect { teile.ladeKennzahlen() } }
        gemerkt.get<Teilefilter>(F_FILTER)?.let(teile::stelleFilterWieder)
        // Wer den Reiter oder ein Einzelstück zeigt, bekommt Liste, Farbkatalog und Filterlisten;
        // die beiden Filterlisten kommen von zwei Adressen (TeileApi.getPartsFilterColors).
        ladeJeServer(sitzung, teileBeobachtet) { loadParts(); loadPartsColors(); loadPartsFilters() }
    }

    // ── Liste und Filter ─────────────────────────────────────────────────────

    override fun loadParts(page: Int, debounce: Boolean) = teile.laden(seite = page, entprellt = debounce)
    fun loadPartsFilters() = teile.ladeFilter()
    override fun loadPartsColors() = teile.ladeFarben()

    private fun filtere(aenderung: (Teilefilter) -> Teilefilter) = teile.setzeFilter(aenderung(teile.state.value.filter))
    override fun setPartsQuery(q: String) = filtere { it.copy(suche = q) }
    override fun setPartsSpare(wert: Ersatzteilwahl) = filtere { it.copy(ersatz = wert) }
    override fun setPartsView(wert: Listenansicht) = filtere { it.copy(ansicht = wert) }
    override fun setPartsOrdnung(wert: Teilefilter.Ordnung) = filtere { it.copy(ordnung = wert) }
    override fun setPartsColorFilter(wert: String) = filtere { it.copy(farbe = wert) }
    override fun setPartsCategoryFilter(wert: String) = filtere { it.copy(kategorie = wert) }

    // ── Erfassen und Ändern ──────────────────────────────────────────────────

    override fun addPart(erfassung: Teilerfassung) {
        val e = erfassung
        viewModelScope.launch {
            when (val r = repo.addPart(e.nummer.trim(), e.farbId, e.farbname, e.farbHex, e.menge,
                                       e.stueckpreis, e.zustand, e.besitzer,
                                       e.lagerort?.trim()?.takeIf { it.isNotEmpty() })) {
                is Ergebnis.Success -> meldungen.zeige(erfassungsMeldung(meldungen, r.data.angelegt, r.data.nummer, r.data.preisAusZustand))
                is Ergebnis.Error -> meldungen.zeige(meldungen.meldungFuerSnackbar(r))
            }
        }
    }

    override fun updatePart(partNumber: String, colorId: Int, quantity: Int, unitPrice: Double?,
                   condition: Zustand?, owner: Int?) =
        aendere(meldungen, meldungen.text(R.string.vm_saved)) {
            repo.updatePart(partNumber, colorId, quantity, unitPrice, condition, owner)
        }

    override fun deletePart(partNumber: String, colorId: Int, owner: Int?) =
        aendere(meldungen, meldungen.text(R.string.vm_part_deleted)) {
            repo.deletePart(partNumber, colorId, owner)
        }

    /**
     * Die Farbe eines manuellen Teils ändern. Die Farbe ist Teil des Schlüssels
     * und der Route der Detailansicht — [onFertig] öffnet sie mit der neuen.
     */
    override fun setzeTeilFarbe(partNumber: String, colorId: Int, neueFarbe: Int,
                       farbName: String?, farbHex: String?,
                       owner: Int?, onFertig: (Int) -> Unit) {
        if (neueFarbe == colorId) return
        aendere(meldungen, meldungen.text(R.string.vm_saved), danach = { onFertig(neueFarbe) }) {
            repo.setPartColor(partNumber, colorId, neueFarbe, farbName, farbHex, owner)
        }
    }

    // ── „In welchen Sets steckt das?“ ────────────────────────────────────────

    override fun oeffneSetItem(nummer: String, colorId: Int) = setItem.oeffne(nummer, colorId)

    override fun schliesseSetItem() = setItem.schliesse()

    override fun setzeTeilLagerort(nummer: String, farbe: Int, ort: String) {
        lagerJob?.cancel()
        lagerJob = viewModelScope.launch {
            delay(Alarmeingabe.RUHE_MS)
            when (val r = repo.setPartStorage(nummer, farbe, ort)) {
                is Ergebnis.Success -> setItem.mitOrt(r.data)
                is Ergebnis.Error -> meldungen.zeige(meldungen.meldungFuerSnackbar(r))
            }
        }
    }

    private fun zuruecksetzen() {
        lagerJob?.cancel()
        teile.zuruecksetzen()
        setItem.schliesse()
        gemerkt.remove<Teilefilter>(F_FILTER)
    }

    private companion object {
        const val F_FILTER = "teile_filter"
    }
}
