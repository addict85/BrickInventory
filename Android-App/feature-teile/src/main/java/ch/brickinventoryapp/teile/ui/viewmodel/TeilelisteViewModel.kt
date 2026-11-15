package ch.brickinventoryapp.teile.ui.viewmodel

import ch.brickinventoryapp.model.ui.Vorgang
import ch.brickinventoryapp.model.ui.laeuft
import ch.brickinventoryapp.model.ui.ohneFehler
import ch.brickinventoryapp.zustand.ui.fehlerMeldung
import ch.brickinventoryapp.model.ui.laedt
import ch.brickinventoryapp.model.ui.Meldung
import ch.brickinventoryapp.model.ui.Laden
import ch.brickinventoryapp.model.fach.Teilelistenauftrag
import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.viewModelScope
import ch.brickinventoryapp.ressourcen.R
import ch.brickinventoryapp.data.service.ExportErgebnis
import ch.brickinventoryapp.data.service.PdfFehlschlag
import ch.brickinventoryapp.model.fach.PdfFortschritt
import ch.brickinventoryapp.model.fach.PdfSchritt
import ch.brickinventoryapp.data.service.TeilelistenExport
import ch.brickinventoryapp.teile.ui.TeilelisteUiState
import ch.brickinventoryapp.teile.ui.TeilelistenQuelle
import ch.brickinventoryapp.teile.ui.PlPart
import ch.brickinventoryapp.teile.ui.PlSet
import ch.brickinventoryapp.teile.ui.normalisiert
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
import ch.brickinventoryapp.sitzung.AppUiState
import ch.brickinventoryapp.sitzung.Sitzung
import ch.brickinventoryapp.zustand.ui.viewmodel.Meldungen
import ch.brickinventoryapp.zustand.ui.viewmodel.folgeAbmeldung

/**
 * Die Bauliste: Sets sammeln, auflösen, Bestand abgleichen, PDF erzeugen. Liste und
 * laufende Abrufe liegen hier, damit eine Drehung sie nicht verwirft; die Setnummern
 * stehen zusätzlich im [SavedStateHandle], damit der Weg zum Scanner sie nie kostet.
 */
@HiltViewModel
class TeilelisteViewModel @Inject constructor(
    private val sitzung: Sitzung,
    private val meldungen: Meldungen,
    private val quelle: TeilelistenQuelle,
    private val export: TeilelistenExport,
    private val gemerkt: SavedStateHandle,
) : ViewModel() {

    val state: StateFlow<AppUiState> = sitzung.state

    init {
        folgeAbmeldung(sitzung) { zuruecksetzen() }
    }

    private val _zustand = MutableStateFlow(
        TeilelisteUiState(sets = gemerkt.get<ArrayList<String>>(SETS).orEmpty().map { PlSet(it, it) }),
    )
    val zustand: StateFlow<TeilelisteUiState> = _zustand.asStateFlow()

    val pdfExportStatus: StateFlow<String?> =
        export.fortschritt.map { it?.let(::fortschrittText) }
            .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), null)

    private fun setzeListe(neu: (TeilelisteUiState) -> TeilelisteUiState) {
        _zustand.update(neu)
        gemerkt[SETS] = ArrayList(_zustand.value.sets.map { it.setNumber })
    }

    fun fuegeHinzu(nr: String) {
        val nummer = normalisiert(nr)
        // Die Zahl nennt die Kopfzeile über den Sets; der Status bleibt für Fehler und Ergebnis.
        setzeListe { z ->
            if (z.sets.any { it.setNumber == nummer }) z.copy(status = Meldung.Ressource(R.string.partslist_set_already_added))
            else z.copy(sets = z.sets + PlSet(nummer, nummer), status = null)
        }
    }

    fun entferne(index: Int) = setzeListe { z ->
        z.copy(sets = z.sets.filterIndexed { i, _ -> i != index }, generated = false)
    }

    /** „Zurücksetzen“ an der Liste: Sets und Teile weg, die Wahl der Schalter bleibt. */
    fun leere() = setzeListe { it.copy(sets = emptyList(), parts = emptyList(), status = null, generated = false) }

    private fun zuruecksetzen() {
        _zustand.value = TeilelisteUiState()
        gemerkt[SETS] = ArrayList<String>()
    }

    fun setzeNurLose(an: Boolean) = _zustand.update { it.copy(nurLose = an) }
    fun setzeMitUnterkonten(an: Boolean) = _zustand.update { it.copy(mitUnterkonten = an) }

    /**
     * Ein Schritt statt zwei: Was im Feld steht, kommt beim Erstellen dazu. Gleiche
     * Teile mehrerer Sets (BrickLink-Nummer und Farbe) werden zusammengezählt.
     */
    fun erstelle(eingabe: String) {
        if (eingabe.isNotBlank()) fuegeHinzu(eingabe)
        val start = _zustand.value
        if (start.sets.isEmpty() || start.erzeugen.laedt) return
        setzeListe { it.copy(erzeugen = Laden.Laedt, generated = false, parts = emptyList()) }
        viewModelScope.launch {
            val server = sitzung.state.value.serverUrl
            val combined = linkedMapOf<String, PlPart>()
            val sets = start.sets
            sets.forEachIndexed { i, s ->
                _zustand.update { it.copy(status = Meldung.Ressource(R.string.partslist_loading_set, listOf(s.setNumber, i + 1, sets.size))) }
                try {
                    val (name, neu) = quelle.loeseSetAuf(s.setNumber, server)
                    setzeListe { z -> z.copy(sets = z.sets.map { if (it.setNumber == s.setNumber) it.copy(name = name) else it }) }
                    neu.forEach { p ->
                        val key = "${p.blPartNumber ?: p.partNumber}|${p.colorName}"
                        combined[key] = combined[key]?.let { it.copy(quantity = it.quantity + p.quantity) } ?: p
                    }
                } catch (e: CancellationException) {
                    throw e
                } catch (_: Exception) {
                    _zustand.update { it.copy(status = Meldung.Ressource(R.string.partslist_error_for_set, listOf(s.setNumber))) }
                }
            }
            val parts = quelle.sortiert(combined.values)
            // Zwei Zahlen, zwei Übereinstimmungen: ein <plurals> stimmt nur mit EINER
            // überein, darum zwei Bruchstücke und ein Rahmen.
            val stueck = parts.sumOf { it.quantity }
            val status = Meldung.Ressource(R.string.partslist_summary, listOf(
                Meldung.Menge(R.plurals.partslist_summary_types, parts.size),
                Meldung.Menge(R.plurals.partslist_summary_parts, stueck)))
            _zustand.update { it.copy(parts = parts, status = status, erzeugen = Laden.Daten(Unit), generated = true) }
        }
    }

    /** „Kann ich das bauen?“ — trägt den eigenen Bestand in die fertige Liste ein. */
    fun ladeBestand() {
        val z = _zustand.value
        if (z.bestand.laeuft || z.parts.isEmpty()) return
        _zustand.update { it.copy(bestand = Vorgang.Laeuft) }
        viewModelScope.launch {
            val neu = quelle.mitBestand(z.parts, z.nurLose, z.mitUnterkonten)
            if (neu == null) {
                _zustand.update { it.copy(bestand = Vorgang.Fertig, status = Meldung.Ressource(R.string.partslist_owned_error)) }
                return@launch
            }
            val fehlen = neu.filter { (it.vorhanden ?: 0) < it.quantity }
            val fehlendeStueck = fehlen.sumOf { it.quantity - (it.vorhanden ?: 0) }
            // Die Einzahlform lässt die Klammer weg: Fehlt genau EIN Teil, ist auch die
            // Zahl der verschiedenen eins.
            val status = if (fehlen.isEmpty()) Meldung.Ressource(R.string.partslist_owned_complete)
            else Meldung.Menge(R.plurals.partslist_owned_missing, fehlendeStueck,
                listOf(fehlendeStueck, Meldung.Menge(R.plurals.partslist_owned_missing_distinct, fehlen.size)))
            _zustand.update { it.copy(parts = neu, bestand = Vorgang.Fertig, status = status) }
        }
    }

    /** Startet den Export als Dienst; das fertige PDF bietet der Bildschirm zum Öffnen an. */
    fun exportiere() {
        val z = _zustand.value
        if (z.pdf.laeuft || z.parts.isEmpty()) return
        _zustand.update { it.copy(pdf = Vorgang.Laeuft) }
        viewModelScope.launch {
            val ergebnis = export.erzeuge(exportAuftrag(z.sets, z.parts))
            _zustand.update {
                when (ergebnis) {
                    is ExportErgebnis.Datei -> it.copy(pdf = Vorgang.Fertig, pdfDatei = ergebnis.datei)
                    is ExportErgebnis.Fehler -> it.copy(pdf = Vorgang.Fehlgeschlagen(fehlerText(ergebnis.grund)))
                }
            }
        }
    }

    private fun fortschrittText(f: PdfFortschritt): String = when (f.schritt) {
        PdfSchritt.STARTET -> meldungen.text(R.string.pdfexp_starting)
        PdfSchritt.BILDER_LADEN -> meldungen.text(R.string.pdfexp_loading_images)
        PdfSchritt.ERSTELLT -> f.restSekunden?.takeIf { it > 0 }?.let { meldungen.text(R.string.pdfexp_creating_eta, it) }
            ?: meldungen.text(R.string.pdfexp_almost_done)
        PdfSchritt.ABSCHLUSS -> meldungen.text(R.string.pdfexp_finalizing)
        PdfSchritt.HERUNTERLADEN -> meldungen.text(R.string.pdfexp_downloading)
    }

    /** Nie leer: Ein Abruf spricht wie jeder Abruf, ein gescheiterter Auftrag mit dem Satz des Servers. */
    private fun fehlerText(grund: PdfFehlschlag): Meldung = when (grund) {
        is PdfFehlschlag.Abruf -> fehlerMeldung(grund.fehler)
        is PdfFehlschlag.Auftrag -> grund.satz?.takeIf { it.isNotBlank() }?.let(Meldung::Text)
            ?: Meldung.Ressource(R.string.pdfexp_server_error)
    }

    fun pdfGeoeffnet() = _zustand.update { it.copy(pdfDatei = null) }
    fun pdfFehlerGesehen() = _zustand.update { it.copy(pdf = it.pdf.ohneFehler()) }

    private fun exportAuftrag(sets: List<PlSet>, parts: List<PlPart>): Teilelistenauftrag {
        val serverUrl = sitzung.state.value.serverUrl.trimEnd('/')
        return Teilelistenauftrag(
            sets = sets.map { Teilelistenauftrag.Set(nummer = it.setNumber, name = it.name) },
            zeilen = parts.map { p ->
                val imgUrl = p.imageUrl ?: ""
                Teilelistenauftrag.Zeile(nummer = p.partNumber, blNummer = p.blPartNumber ?: p.partNumber, name = p.partName,
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
