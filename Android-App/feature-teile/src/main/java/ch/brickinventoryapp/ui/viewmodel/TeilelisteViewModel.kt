package ch.brickinventoryapp.ui.viewmodel

import android.content.Context
import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.viewModelScope
import ch.brickinventoryapp.ressourcen.R
import ch.brickinventoryapp.service.PdfExportManager
import ch.brickinventoryapp.service.PdfExportService
import ch.brickinventoryapp.service.PdfExportState
import ch.brickinventoryapp.ui.TeilelisteUiState
import ch.brickinventoryapp.ui.TeilelistenQuelle
import ch.brickinventoryapp.ui.screens.PlPart
import ch.brickinventoryapp.ui.screens.PlSet
import ch.brickinventoryapp.ui.screens.normalisiert
import dagger.Binds
import dagger.Module
import dagger.hilt.InstallIn
import dagger.hilt.android.lifecycle.HiltViewModel
import dagger.hilt.android.qualifiers.ApplicationContext
import dagger.hilt.components.SingletonComponent
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import javax.inject.Inject

/** Ausgang eines PDF-Exports: die Datei oder die Meldung des Servers. */
sealed interface ExportErgebnis {
    data class Datei(val datei: File) : ExportErgebnis
    data class Fehler(val meldung: String?) : ExportErgebnis
}

/** Der PDF-Export als Vordergrund-Dienst, der länger lebt als der Bildschirm; im Test ein Double. */
interface TeilelistenExport {
    /** „…noch ~Xs“ eines laufenden Exports, null ohne Export. */
    val status: Flow<String?>
    suspend fun erzeuge(rumpf: String): ExportErgebnis
}

internal class DienstExport @Inject constructor(
    private val manager: PdfExportManager,
    @param:ApplicationContext private val ctx: Context,
) : TeilelistenExport {
    override val status: Flow<String?> = manager.state.map { (it as? PdfExportState.Running)?.statusText }

    override suspend fun erzeuge(rumpf: String): ExportErgebnis {
        manager.reset()
        manager.pendingBody = rumpf
        PdfExportService.start(ctx)
        return when (val r = manager.state.first { it is PdfExportState.Done || it is PdfExportState.Error }) {
            is PdfExportState.Done -> ExportErgebnis.Datei(r.file)
            is PdfExportState.Error -> ExportErgebnis.Fehler(r.message)
            // Ohne else-Zweig, damit ein neuer Zustand hier auffällt; first{} lässt beide nicht durch.
            is PdfExportState.Idle, is PdfExportState.Running -> ExportErgebnis.Fehler(null)
        }
    }
}

@Module
@InstallIn(SingletonComponent::class)
internal interface TeilelistenExportModul {
    @Binds fun export(e: DienstExport): TeilelistenExport
}

/**
 * Die Bauliste: Sets sammeln, auflösen, Bestand abgleichen, PDF erzeugen. Liste und
 * laufende Abrufe liegen hier, damit eine Drehung sie nicht verwirft; die Setnummern
 * stehen zusätzlich im [SavedStateHandle], damit der Weg zum Scanner sie nie kostet.
 */
@HiltViewModel
class TeilelisteViewModel @Inject constructor(
    dienste: AppDienste,
    private val quelle: TeilelistenQuelle,
    private val export: TeilelistenExport,
    private val gemerkt: SavedStateHandle,
) : BereichsViewModel(dienste) {

    private val _zustand = MutableStateFlow(
        TeilelisteUiState(sets = gemerkt.get<ArrayList<String>>(SETS).orEmpty().map { PlSet(it, it) }),
    )
    val zustand: StateFlow<TeilelisteUiState> = _zustand.asStateFlow()

    val pdfExportStatus: StateFlow<String?> =
        export.status.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), null)

    private fun setzeListe(neu: (TeilelisteUiState) -> TeilelisteUiState) {
        _zustand.update(neu)
        gemerkt[SETS] = ArrayList(_zustand.value.sets.map { it.setNumber })
    }

    fun fuegeHinzu(nr: String) {
        val nummer = normalisiert(nr)
        // Die Zahl nennt die Kopfzeile über den Sets; der Status bleibt für Fehler und Ergebnis.
        setzeListe { z ->
            if (z.sets.any { it.setNumber == nummer }) z.copy(status = text(R.string.partslist_set_already_added))
            else z.copy(sets = z.sets + PlSet(nummer, nummer), status = "")
        }
    }

    fun entferne(index: Int) = setzeListe { z ->
        z.copy(sets = z.sets.filterIndexed { i, _ -> i != index }, generated = false)
    }

    /** „Zurücksetzen“ an der Liste: Sets und Teile weg, die Wahl der Schalter bleibt. */
    fun leere() = setzeListe { it.copy(sets = emptyList(), parts = emptyList(), status = "", generated = false) }

    override fun zuruecksetzen() {
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
        if (start.sets.isEmpty() || start.isLoading) return
        setzeListe { it.copy(isLoading = true, generated = false, parts = emptyList()) }
        viewModelScope.launch {
            val server = dienste.sitzung.state.value.serverUrl
            val combined = linkedMapOf<String, PlPart>()
            val sets = start.sets
            sets.forEachIndexed { i, s ->
                _zustand.update { it.copy(status = text(R.string.partslist_loading_set, s.setNumber, i + 1, sets.size)) }
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
                    _zustand.update { it.copy(status = text(R.string.partslist_error_for_set, s.setNumber)) }
                }
            }
            val parts = quelle.sortiert(combined.values)
            // Zwei Zahlen, zwei Übereinstimmungen: ein <plurals> stimmt nur mit EINER
            // überein, darum zwei Bruchstücke und ein Rahmen.
            val stueck = parts.sumOf { it.quantity }
            val status = text(R.string.partslist_summary,
                menge(R.plurals.partslist_summary_types, parts.size, parts.size),
                menge(R.plurals.partslist_summary_parts, stueck, stueck))
            _zustand.update { it.copy(parts = parts, status = status, isLoading = false, generated = true) }
        }
    }

    /** „Kann ich das bauen?“ — trägt den eigenen Bestand in die fertige Liste ein. */
    fun ladeBestand() {
        val z = _zustand.value
        if (z.bestandLaeuft || z.parts.isEmpty()) return
        _zustand.update { it.copy(bestandLaeuft = true) }
        viewModelScope.launch {
            val neu = quelle.mitBestand(z.parts, z.nurLose, z.mitUnterkonten)
            if (neu == null) {
                _zustand.update { it.copy(bestandLaeuft = false, status = text(R.string.partslist_owned_error)) }
                return@launch
            }
            val fehlen = neu.filter { (it.vorhanden ?: 0) < it.quantity }
            val fehlendeStueck = fehlen.sumOf { it.quantity - (it.vorhanden ?: 0) }
            // Die Einzahlform lässt die Klammer weg: Fehlt genau EIN Teil, ist auch die
            // Zahl der verschiedenen eins.
            val status = if (fehlen.isEmpty()) text(R.string.partslist_owned_complete)
            else menge(R.plurals.partslist_owned_missing, fehlendeStueck, fehlendeStueck,
                menge(R.plurals.partslist_owned_missing_distinct, fehlen.size, fehlen.size))
            _zustand.update { it.copy(parts = neu, bestandLaeuft = false, status = status) }
        }
    }

    /** Startet den Export als Dienst; das fertige PDF bietet der Bildschirm zum Öffnen an. */
    fun exportiere() {
        val z = _zustand.value
        if (z.isExporting || z.parts.isEmpty()) return
        _zustand.update { it.copy(isExporting = true, pdfError = null) }
        viewModelScope.launch {
            val ergebnis = export.erzeuge(exportRumpf(z.sets, z.parts))
            _zustand.update {
                when (ergebnis) {
                    is ExportErgebnis.Datei -> it.copy(isExporting = false, pdfDatei = ergebnis.datei)
                    is ExportErgebnis.Fehler -> it.copy(isExporting = false,
                        pdfError = ergebnis.meldung ?: text(R.string.pdfexp_unknown_error))
                }
            }
        }
    }

    fun pdfGeoeffnet() = _zustand.update { it.copy(pdfDatei = null) }
    fun pdfFehlerGesehen() = _zustand.update { it.copy(pdfError = null) }

    private fun exportRumpf(sets: List<PlSet>, parts: List<PlPart>): String {
        val serverUrl = dienste.sitzung.state.value.serverUrl.trimEnd('/')
        val setsArr = JSONArray()
        sets.forEach { s -> setsArr.put(JSONObject().put("set_number", s.setNumber).put("name", s.name)) }
        val partsArr = JSONArray()
        parts.forEach { p ->
            val imgUrl = p.imageUrl ?: ""
            val imgRelative = if (imgUrl.startsWith(serverUrl)) imgUrl.removePrefix(serverUrl) else imgUrl
            partsArr.put(JSONObject()
                .put("part_number",    p.partNumber)
                .put("bl_part_number", p.blPartNumber ?: p.partNumber)
                .put("part_name",      p.partName)
                .put("color_name",     p.colorName)
                .put("color_hex",      p.colorHex ?: "")
                .put("color_id",       p.colorId)
                .put("quantity",       p.quantity)
                .put("image_local",    p.imageLocal ?: "")
                .put("image_url",      imgRelative)
                .put("is_fig",         p.isFig))
        }
        return JSONObject().put("sets", setsArr).put("parts", partsArr).toString()
    }

    private companion object {
        const val SETS = "teileliste_sets"
    }
}
