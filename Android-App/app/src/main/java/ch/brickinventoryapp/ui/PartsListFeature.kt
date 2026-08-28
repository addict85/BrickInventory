package ch.brickinventoryapp.ui

import ch.brickinventoryapp.R
import ch.brickinventoryapp.data.model.*
import ch.brickinventoryapp.data.repository.Result
import ch.brickinventoryapp.service.PdfExportService
import ch.brickinventoryapp.service.PdfExportState
import kotlinx.coroutines.flow.*


/**
 * Temporäre Teileliste: Set-Auflösung und PDF-Export (Foreground-Service).
 *
 * Feature-Modul des MainViewModel: Die Funktionen sind Extension-
 * Functions auf dem VM — die Körper sind 1:1 aus MainViewModel.kt
 * verschoben und greifen über internal-Sichtbarkeit auf die geteilten
 * Flows (_state, _snackbar, …) zu. Aufrufer (Screens/Navigation)
 * bleiben unverändert: vm.funktion() löst die Extension auf.
 */

internal fun MainViewModel.clearBarcodeForPartsList() {
    _barcodeState.update { it.copy(fuerTeileliste = null) }
}

// For PartsListScreen — resolves a set number to its parts
internal suspend fun MainViewModel.resolveSetForPartsList(setNumber: String): Pair<String, List<ch.brickinventoryapp.ui.screens.PlPart>> {
    return try {
        // Use user-independent CSV endpoints (work for all users)
        val partsResult = repo.getSetPartsList(setNumber)
        val figsResult  = repo.getSetMinifigsList(setNumber)
        // Set-Name über das Detail-Endpoint statt alle Sets zu laden
        val setName = (repo.getSetDetail(setNumber) as? Result.Success)
            ?.data?.set?.name ?: setNumber
        // Deduplicate by blPartNumber + colorId (same as webapp)
        val deduped = mutableMapOf<String, ch.brickinventoryapp.ui.screens.PlPart>()
        if (partsResult is Result.Success) {
            val serverBase = _state.value.serverUrl.trimEnd('/')
            for (p in partsResult.data.parts) {
                val blNum = p.blPartNumber ?: p.partNumber
                val key   = "${blNum}|${p.colorId}"
                val existing = deduped[key]
                val qty = p.totalQuantity.takeIf { it > 0 } ?: 1
                if (existing != null) {
                    deduped[key] = existing.copy(quantity = existing.quantity + qty)
                } else {
                    // Resolve image URL: prefer image_local (server-relative), then image_url.
                    // image_url from server is already a proxy URL (/api/img-proxy?...) or
                    // a local path (/images/parts/…, /images/minifigs/…) — always prefix
                    // with serverUrl. Der frühere Pfad /data/part_images/ ist seit
                    // Server-Fassung 68 aufgeteilt; die Adresse kommt fertig aus der API,
                    // hier wird nichts selbst zusammengebaut.
                    // Never send bare CDN URLs to Coil — they need server-side headers.
                    val resolvedImageUrl = when {
                        p.imageLocal != null ->
                            "$serverBase${p.imageLocal}"
                        p.imageUrl == null -> null
                        p.imageUrl.startsWith("/") ->
                            "$serverBase${p.imageUrl}"
                        p.imageUrl.startsWith("https://") || p.imageUrl.startsWith("http://") ->
                            // CDN URL not yet proxied — route through our proxy
                            "$serverBase/api/img-proxy?url=${java.net.URLEncoder.encode(p.imageUrl, "UTF-8")}"
                        else -> "$serverBase${p.imageUrl}"
                    }
                    deduped[key] = ch.brickinventoryapp.ui.screens.PlPart(
                        partNumber    = p.partNumber,
                        blPartNumber  = blNum.takeIf { it != p.partNumber },
                        partName      = p.partName ?: p.partNumber,
                        colorName     = p.colorName ?: "",
                        colorHex      = p.colorHex,
                        colorId       = p.colorId,
                        blColorId     = p.blColorId,
                        quantity      = qty,
                        imageUrl      = resolvedImageUrl,
                        imageLocal    = p.imageLocal
                    )
                }
            }
        }
        // Add minifigs as whole (same as webapp) — NOT expanded into parts
        if (figsResult is Result.Success) {
            for (f in figsResult.data.figs) {
                val figQty = f.totalQuantity?.takeIf { it > 0 } ?: f.quantity
                val key = "fig:${f.figNumber}"
                val existing = deduped[key]
                if (existing != null) {
                    deduped[key] = existing.copy(quantity = existing.quantity + figQty)
                } else {
                    deduped[key] = ch.brickinventoryapp.ui.screens.PlPart(
                        partNumber   = f.figNumber,
                        blPartNumber = f.figNumber,  // fig numbers are the BL IDs
                        partName     = f.figName ?: f.figNumber,
                        colorName    = "Minifiguren",
                        colorHex     = "f5a800",
                        quantity     = figQty,
                        imageUrl     = f.imageUrl?.let {
                            if (it.startsWith("/")) "${_state.value.serverUrl}$it" else it
                        },
                        isFig        = true
                    )
                }
            }
        }
        Pair(setName, deduped.values.toList())
    } catch (e: Exception) { Pair(setNumber, listOf()) }
}

/**
 * PDF-Export läuft jetzt im PdfExportService (Foreground Service) statt
 * mit WakeLock im ViewModel — überlebt so auch Activity-Tod und Doze.
 * Diese Funktion baut den Request, startet den Service und wartet auf
 * das Ergebnis, damit der bisherige UI-Vertrag (String? = Fehlermeldung)
 * erhalten bleibt.
 */
internal suspend fun MainViewModel.exportPartsPdf(
    context: android.content.Context,
    sets: List<ch.brickinventoryapp.ui.screens.PlSet>,
    parts: List<ch.brickinventoryapp.ui.screens.PlPart>
): String? {
    val serverUrl = _state.value.serverUrl.trimEnd('/')

    val setsArr = org.json.JSONArray()
    sets.forEach { s -> setsArr.put(org.json.JSONObject().put("set_number", s.setNumber).put("name", s.name)) }
    val partsArr = org.json.JSONArray()
    parts.forEach { p ->
        val imgUrl = p.imageUrl ?: ""
        val imgRelative = if (imgUrl.startsWith(serverUrl)) imgUrl.removePrefix(serverUrl) else imgUrl
        partsArr.put(org.json.JSONObject()
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
    val body = org.json.JSONObject().put("sets", setsArr).put("parts", partsArr).toString()

    pdfExport.reset()
    pdfExport.pendingBody = body
    PdfExportService.start(ctx)

    // Auf Endzustand warten; bei Erfolg PDF direkt öffnen
    return when (val result = pdfExport.state.first { it is PdfExportState.Done || it is PdfExportState.Error }) {
        is PdfExportState.Done -> {
            val uri = androidx.core.content.FileProvider.getUriForFile(
                context, context.packageName + ".provider", result.file)
            val intent = android.content.Intent(android.content.Intent.ACTION_VIEW).apply {
                setDataAndType(uri, "application/pdf")
                addFlags(android.content.Intent.FLAG_GRANT_READ_URI_PERMISSION or
                         android.content.Intent.FLAG_ACTIVITY_NEW_TASK)
            }
            context.startActivity(intent)
            null
        }
        // PdfExportState.Error, NICHT Result.Error — meldung() passt hier nicht.
        is PdfExportState.Error -> result.message
        // Idle und Running ausdrücklich statt eines else-Zweigs: Kommt später
        // ein fünfter Zustand dazu, meldet der Compiler die Stelle, statt sie
        // still in einem Sammelzweig verschwinden zu lassen. Erreichbar sind
        // beide hier nicht — first{} oben lässt nur Done und Error durch —,
        // aber genau das soll sichtbar bleiben.
        is PdfExportState.Idle,
        is PdfExportState.Running -> ctx.getString(ch.brickinventoryapp.R.string.pdfexp_unknown_error)
    }
}
