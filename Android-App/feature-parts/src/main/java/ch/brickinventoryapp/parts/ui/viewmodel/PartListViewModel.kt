package ch.brickinventoryapp.parts.ui.viewmodel

import ch.brickinventoryapp.model.ui.Vorgang
import ch.brickinventoryapp.model.ui.laeuft
import ch.brickinventoryapp.model.ui.withoutError
import ch.brickinventoryapp.state.ui.errorMessage
import ch.brickinventoryapp.model.ui.laedt
import ch.brickinventoryapp.model.ui.Meldung
import ch.brickinventoryapp.model.ui.Laden
import ch.brickinventoryapp.model.domain.Teilelistenauftrag
import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.viewModelScope
import ch.brickinventoryapp.resources.R
import ch.brickinventoryapp.data.service.ExportResult
import ch.brickinventoryapp.data.service.PdfFailure
import ch.brickinventoryapp.model.domain.PdfProgress
import ch.brickinventoryapp.model.domain.PdfStep
import ch.brickinventoryapp.data.service.PartListsExport
import ch.brickinventoryapp.parts.ui.TeilelisteUiState
import ch.brickinventoryapp.parts.ui.PartListsSource
import ch.brickinventoryapp.parts.ui.PlPart
import ch.brickinventoryapp.parts.ui.PlSet
import ch.brickinventoryapp.parts.ui.normalized
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject
import androidx.lifecycle.ViewModel
import ch.brickinventoryapp.session.AppUiState
import ch.brickinventoryapp.session.Sitzung
import ch.brickinventoryapp.state.ui.viewmodel.Meldungen
import ch.brickinventoryapp.state.ui.viewmodel.sequenceSignOut

/**
 * Die Bauliste: Sets sammeln, auflösen, Bestand abgleichen, PDF erzeugen. Liste und
 * laufende Abrufe liegen hier, damit eine Drehung sie nicht verwirft; die Setnummern
 * stehen zusätzlich im [SavedStateHandle], damit der Weg zum Scanner sie nie kostet.
 */
@HiltViewModel
class PartListViewModel @Inject constructor(
    private val sitzung: Sitzung,
    private val meldungen: Meldungen,
    private val quelle: PartListsSource,
    private val export: PartListsExport,
    private val gemerkt: SavedStateHandle,
) : ViewModel() {

    val state: StateFlow<AppUiState> = sitzung.state

    init {
        sequenceSignOut(sitzung) { reset() }
    }

    private val _zustand = MutableStateFlow(
        TeilelisteUiState(sets = gemerkt.get<ArrayList<String>>(SETS).orEmpty().map { PlSet(it, it) }),
    )
    val zustand: StateFlow<TeilelisteUiState> = _zustand.asStateFlow()

    val pdfExportStatus: StateFlow<String?> =
        export.fortschritt.map { it?.let(::progressText) }
            .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), null)

    private fun setList(neu: (TeilelisteUiState) -> TeilelisteUiState) {
        _zustand.update(neu)
        gemerkt[SETS] = ArrayList(_zustand.value.sets.map { it.setNumber })
    }

    fun addAdd(nr: String) {
        val nummer = normalized(nr)
        // Die Zahl nennt die Kopfzeile über den Sets; der Status bleibt für Fehler und Ergebnis.
        setList { z ->
            if (z.sets.any { it.setNumber == nummer }) z.copy(status = Meldung.Resource(R.string.partslist_set_already_added))
            else z.copy(sets = z.sets + PlSet(nummer, nummer), status = null)
        }
    }

    fun entferne(index: Int) = setList { z ->
        z.copy(sets = z.sets.filterIndexed { i, _ -> i != index }, generated = false)
    }

    /** „Zurücksetzen“ an der Liste: Sets und Teile weg, die Wahl der Schalter bleibt. */
    fun leere() = setList { it.copy(sets = emptyList(), parts = emptyList(), status = null, generated = false) }

    private fun reset() {
        _zustand.value = TeilelisteUiState()
        gemerkt[SETS] = ArrayList<String>()
    }

    fun setOnlyLose(an: Boolean) = _zustand.update { it.copy(onlyLose = an) }
    fun setWithSubAccounts(an: Boolean) = _zustand.update { it.copy(withSubAccounts = an) }

    /**
     * Ein Schritt statt zwei: Was im Feld steht, kommt beim Erstellen dazu. Gleiche
     * Teile mehrerer Sets (BrickLink-Nummer und Farbe) werden zusammengezählt.
     */
    fun erstelle(eingabe: String) {
        if (eingabe.isNotBlank()) addAdd(eingabe)
        val start = _zustand.value
        if (start.sets.isEmpty() || start.erzeugen.laedt) return
        setList { it.copy(erzeugen = Laden.Loads, generated = false, parts = emptyList()) }
        viewModelScope.launch {
            val server = sitzung.state.value.serverUrl
            val combined = linkedMapOf<String, PlPart>()
            val sets = start.sets
            sets.forEachIndexed { i, s ->
                _zustand.update { it.copy(status = Meldung.Resource(R.string.partslist_loading_set, listOf(s.setNumber, i + 1, sets.size))) }
                try {
                    val (name, neu) = quelle.resolveSetOn(s.setNumber, server)
                    setList { z -> z.copy(sets = z.sets.map { if (it.setNumber == s.setNumber) it.copy(name = name) else it }) }
                    neu.forEach { p ->
                        val key = "${p.blPartNumber ?: p.partNumber}|${p.colorName}"
                        combined[key] = combined[key]?.let { it.copy(quantity = it.quantity + p.quantity) } ?: p
                    }
                } catch (e: CancellationException) {
                    throw e
                } catch (_: Exception) {
                    _zustand.update { it.copy(status = Meldung.Resource(R.string.partslist_error_for_set, listOf(s.setNumber))) }
                }
            }
            val parts = quelle.sortiert(combined.values)
            // Zwei Zahlen, zwei Übereinstimmungen: ein <plurals> stimmt nur mit EINER
            // überein, darum zwei Bruchstücke und ein Rahmen.
            val stueck = parts.sumOf { it.quantity }
            val status = Meldung.Resource(R.string.partslist_summary, listOf(
                Meldung.Menge(R.plurals.partslist_summary_types, parts.size),
                Meldung.Menge(R.plurals.partslist_summary_parts, stueck)))
            _zustand.update { it.copy(parts = parts, status = status, erzeugen = Laden.Daten(Unit), generated = true) }
        }
    }

    /** „Kann ich das bauen?“ — trägt den eigenen Bestand in die fertige Liste ein. */
    fun loadInventory() {
        val z = _zustand.value
        if (z.bestand.laeuft || z.parts.isEmpty()) return
        _zustand.update { it.copy(bestand = Vorgang.Laeuft) }
        viewModelScope.launch {
            val neu = quelle.withInventory(z.parts, z.onlyLose, z.withSubAccounts)
            if (neu == null) {
                _zustand.update { it.copy(bestand = Vorgang.Fertig, status = Meldung.Resource(R.string.partslist_owned_error)) }
                return@launch
            }
            val fehlen = neu.filter { (it.vorhanden ?: 0) < it.quantity }
            val missingPiece = fehlen.sumOf { it.quantity - (it.vorhanden ?: 0) }
            // Die Einzahlform lässt die Klammer weg: Fehlt genau EIN Teil, ist auch die
            // Zahl der verschiedenen eins.
            val status = if (fehlen.isEmpty()) Meldung.Resource(R.string.partslist_owned_complete)
            else Meldung.Menge(R.plurals.partslist_owned_missing, missingPiece,
                listOf(missingPiece, Meldung.Menge(R.plurals.partslist_owned_missing_distinct, fehlen.size)))
            _zustand.update { it.copy(parts = neu, bestand = Vorgang.Fertig, status = status) }
        }
    }

    /** Startet den Export als Dienst; das fertige PDF bietet der Bildschirm zum Öffnen an. */
    fun exportiere() {
        val z = _zustand.value
        if (z.pdf.laeuft || z.parts.isEmpty()) return
        _zustand.update { it.copy(pdf = Vorgang.Laeuft) }
        viewModelScope.launch {
            val ergebnis = export.erzeuge(exportJob(z.sets, z.parts))
            _zustand.update {
                when (ergebnis) {
                    is ExportResult.Datei -> it.copy(pdf = Vorgang.Fertig, pdfFile = ergebnis.datei)
                    is ExportResult.Fehler -> it.copy(pdf = Vorgang.Fehlgeschlagen(errorText(ergebnis.grund)))
                }
            }
        }
    }

    private fun progressText(f: PdfProgress): String = when (f.schritt) {
        PdfStep.STARTET -> meldungen.text(R.string.pdfexp_starting)
        PdfStep.IMAGES_LOAD -> meldungen.text(R.string.pdfexp_loading_images)
        PdfStep.CREATED -> f.restSeconds?.takeIf { it > 0 }?.let { meldungen.text(R.string.pdfexp_creating_eta, it) }
            ?: meldungen.text(R.string.pdfexp_almost_done)
        PdfStep.COMPLETION -> meldungen.text(R.string.pdfexp_finalizing)
        PdfStep.DOWNLOAD -> meldungen.text(R.string.pdfexp_downloading)
    }

    /** Nie leer: Ein Abruf spricht wie jeder Abruf, ein gescheiterter Auftrag mit dem Satz des Servers. */
    private fun errorText(grund: PdfFailure): Meldung = when (grund) {
        is PdfFailure.Abruf -> errorMessage(grund.fehler)
        is PdfFailure.Auftrag -> grund.satz?.takeIf { it.isNotBlank() }?.let(Meldung::Text)
            ?: Meldung.Resource(R.string.pdfexp_server_error)
    }

    fun pdfOpened() = _zustand.update { it.copy(pdfFile = null) }
    fun pdfErrorSeen() = _zustand.update { it.copy(pdf = it.pdf.withoutError()) }

    private fun exportJob(sets: List<PlSet>, parts: List<PlPart>): Teilelistenauftrag {
        val serverUrl = sitzung.state.value.serverUrl.trimEnd('/')
        return Teilelistenauftrag(
            sets = sets.map { Teilelistenauftrag.Set(nummer = it.setNumber, name = it.name) },
            zeilen = parts.map { p ->
                val imgUrl = p.imageUrl ?: ""
                Teilelistenauftrag.Zeile(nummer = p.partNumber, blNumber = p.blPartNumber ?: p.partNumber, name = p.partName,
                    farbname = p.colorName, farbHex = p.colorHex ?: "", farbId = p.colorId, menge = p.quantity,
                    bildLokal = p.imageLocal ?: "",
                    bild = if (imgUrl.startsWith(serverUrl)) imgUrl.removePrefix(serverUrl) else imgUrl, figur = p.isFig)
            },
        )
    }

    private companion object {
        const val SETS = "teileliste_sets"
    }
}
