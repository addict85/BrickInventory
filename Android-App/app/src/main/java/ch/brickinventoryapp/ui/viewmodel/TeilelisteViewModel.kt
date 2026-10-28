package ch.brickinventoryapp.ui.viewmodel

import android.content.Context
import android.content.Intent
import androidx.core.content.FileProvider
import androidx.lifecycle.viewModelScope
import ch.brickinventoryapp.R
import ch.brickinventoryapp.data.repository.SetsRepository
import ch.brickinventoryapp.data.repository.TeileRepository
import ch.brickinventoryapp.service.PdfExportManager
import ch.brickinventoryapp.service.PdfExportService
import ch.brickinventoryapp.service.PdfExportState
import ch.brickinventoryapp.ui.Teileliste
import ch.brickinventoryapp.ui.screens.PlPart
import ch.brickinventoryapp.ui.screens.PlSet
import dagger.hilt.android.lifecycle.HiltViewModel
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import org.json.JSONArray
import org.json.JSONObject
import javax.inject.Inject

/**
 * Die temporäre Teileliste: Sets auflösen, Bestand abgleichen, PDF erzeugen.
 *
 * Die Liste selbst hält der Bildschirm (sie ist bewusst flüchtig); dieses
 * ViewModel reicht nur die Abläufe aus [Teileliste] durch und führt den
 * PDF-Export, der als Vordergrund-Dienst länger lebt als der Bildschirm.
 */
@HiltViewModel
class TeilelisteViewModel @Inject constructor(
    dienste: AppDienste,
    sets: SetsRepository,
    teile: TeileRepository,
    private val pdfExport: PdfExportManager,
    @ApplicationContext private val ctx: Context,
) : BereichsViewModel(dienste) {

    private val liste = Teileliste(sets, teile)

    /** Fortschritt des laufenden Exports („…noch ~Xs"), null ohne Export. */
    val pdfExportStatus: StateFlow<String?> =
        pdfExport.state
            .map { (it as? PdfExportState.Running)?.statusText }
            .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5000), null)

    suspend fun resolveSetForPartsList(setNumber: String): Pair<String, List<PlPart>> =
        liste.loeseSetAuf(setNumber, dienste.sitzung.state.value.serverUrl)

    suspend fun ladeTeilelisteBestand(teile: List<PlPart>, nurLose: Boolean, mitUnterkonten: Boolean): List<PlPart>? =
        liste.mitBestand(teile, nurLose, mitUnterkonten)

    /** Startet den Export, wartet auf sein Ende und öffnet das PDF; liefert sonst die Fehlermeldung. */
    suspend fun exportPartsPdf(context: Context, sets: List<PlSet>, parts: List<PlPart>): String? {
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
        pdfExport.reset()
        pdfExport.pendingBody = JSONObject().put("sets", setsArr).put("parts", partsArr).toString()
        PdfExportService.start(ctx)

        return when (val result = pdfExport.state.first { it is PdfExportState.Done || it is PdfExportState.Error }) {
            is PdfExportState.Done -> {
                val uri = FileProvider.getUriForFile(context, context.packageName + ".provider", result.file)
                context.startActivity(Intent(Intent.ACTION_VIEW).apply {
                    setDataAndType(uri, "application/pdf")
                    addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
                })
                null
            }
            is PdfExportState.Error -> result.message
            // Ohne else-Zweig, damit ein neuer Zustand hier auffällt; first{}
            // oben lässt beide ohnehin nicht durch.
            is PdfExportState.Idle,
            is PdfExportState.Running -> text(R.string.pdfexp_unknown_error)
        }
    }
}
