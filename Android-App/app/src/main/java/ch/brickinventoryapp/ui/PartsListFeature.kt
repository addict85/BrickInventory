package ch.brickinventoryapp.ui

import ch.brickinventoryapp.R
import ch.brickinventoryapp.data.model.*
import ch.brickinventoryapp.data.repository.Result
import ch.brickinventoryapp.service.PdfExportService
import ch.brickinventoryapp.service.PdfExportState
import ch.brickinventoryapp.util.BrickLinkWunschliste
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
        val partsResult = repo.sets.getSetPartsList(setNumber)
        val figsResult  = repo.sets.getSetMinifigsList(setNumber)
        // ── Der Name kommt aus dem KATALOG, nicht aus dem eigenen Bestand ───
        //
        // Hier stand getSetDetail — /api/v1/sets/{nr}. Das sucht im Blickfeld
        // des Nutzers und antwortet 404, wenn das Set niemandem im Haushalt
        // gehoert. In der temporaeren Teileliste ist genau das der Regelfall:
        // Man traegt dort Sets ein, die man NICHT hat, um zu sehen, welche
        // Teile fehlen. Der Name fiel deshalb auf die Nummer zurueck, und die
        // Liste zeigte „75192-1" statt „Millennium Falcon" — die Webapp zeigt
        // den Namen, weil sie /v1/sets/info ruft (08-init.js, plAddSet).
        //
        // Der Server sucht dort erst im gemeinsamen Katalog, dann in den
        // eigenen Sets; der Rueckfall auf die Nummer passiert also schon dort.
        val setName = (repo.sets.getSetInfo(setNumber) as? Result.Success)
            ?.data?.name?.takeIf { it.isNotBlank() } ?: setNumber
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
        is PdfExportState.Running -> text(ch.brickinventoryapp.R.string.pdfexp_unknown_error)
    }
}

/**
 * Die fehlenden Teile als BrickLink-Wunschliste (XML) ausgeben.
 *
 * ── Was die Webapp hier tut, und warum das nachgezogen wird ─────────────────
 *
 * In der Webapp hat jede Zeile der Teileliste ein Feld „vorhanden"; der Knopf
 * daneben exportiert die Differenz als XML, das BrickLink direkt als
 * Wunschliste einliest (08-init.js, plExportBricklink). Die App hatte die
 * Teileliste und den PDF-Export, aber nicht diesen Weg — man konnte unterwegs
 * ein Set durchgehen und trotzdem nichts bestellen.
 *
 * ── Warum Minifiguren aufgeloest werden ─────────────────────────────────────
 *
 * In der Teileliste steht eine Minifigur als EIN Posten. Wer sie nicht
 * vollstaendig hat, will aber die fehlenden EINZELTEILE bestellen, nicht die
 * ganze Figur — die gibt es oft gar nicht einzeln zu kaufen. Deshalb fragt
 * dieser Export je fehlender Figur ihre Teile beim Server nach und traegt
 * diese ein. Antwortet der Server nicht oder kennt die Figur nicht, bleibt
 * die Figur als Ganzes stehen: lieber ein Posten, den es vielleicht nicht
 * gibt, als ein stillschweigend fehlender.
 *
 * ── Warum die Farbe dreifach abgesichert ist ────────────────────────────────
 *
 * BrickLink kennt eigene Farbnummern. Der Server liefert `bl_color_id` je
 * Teil meist mit; fehlt sie, hilft die Farbkarte /parts/bl-color-map; fehlt
 * auch die, bleibt die Rebrickable-Nummer stehen. Dieselbe Reihenfolge wie in
 * der Webapp — eine falsche Farbe ist dort ein Posten, den man von Hand
 * korrigiert, eine fehlende waere ein Posten, den BrickLink zurueckweist.
 *
 * @param vorhanden Was der Nutzer laut Eingabefeldern schon hat, je
 *                  [ch.brickinventoryapp.ui.screens.plSchluessel].
 * @param zustand   "X", "N" oder "U" — siehe BrickLinkWunschliste.
 * @return Meldung fuer den Nutzer, oder null wenn der Teilen-Dialog aufging.
 */
internal suspend fun MainViewModel.exportPartsBricklink(
    context: android.content.Context,
    parts: List<ch.brickinventoryapp.ui.screens.PlPart>,
    vorhanden: Map<String, Int>,
    zustand: String,
): String? {
    return try {
        val gebraucht = parts.map { p ->
            BrickLinkWunschliste.Posten(
                typ   = if (p.isFig) "M" else "P",
                teil  = p.blPartNumber ?: p.partNumber,
                farbe = p.blColorId ?: p.colorId,
                menge = p.quantity,
            )
        }
        val fehlend = BrickLinkWunschliste.ausBestand(gebraucht, vorhanden) { posten ->
            ch.brickinventoryapp.ui.screens.plSchluessel(posten.typ, posten.teil, posten.farbe)
        }
        if (fehlend.isEmpty()) return text(R.string.partslist_bl_nothing_missing)

        // Die Farbkarte nur holen, wenn ueberhaupt eine Farbe offen ist. Sie
        // umfasst den ganzen Farbkatalog; fuer eine Liste, in der jeder Posten
        // seine BrickLink-Farbe schon mitbringt, waere das eine Anfrage ohne
        // Wirkung.
        val ohneBlFarbe = parts.any { !it.isFig && it.blColorId == null }
        val farbkarte: Map<Int, Int> =
            if (!ohneBlFarbe) emptyMap()
            else (repo.teile.getBlColorMap() as? Result.Success)
                ?.data?.map.orEmpty()
                .mapNotNull { (rb, bl) -> rb.toIntOrNull()?.let { it to bl } }
                .toMap()

        // Ueber den SCHLUESSEL zurueck zur Zeile, nicht ueber die Teilenummer
        // allein: Dieselbe Nummer steht in der Liste einmal je Farbe. Ein
        // firstOrNull auf die Nummer haette fuer alle Farben die Angaben der
        // ERSTEN genommen — und damit rote Steine in blau bestellt.
        val jeSchluessel = parts.associateBy { ch.brickinventoryapp.ui.screens.plSchluessel(it) }

        val ausgepackt = mutableListOf<BrickLinkWunschliste.Posten>()
        for (p in fehlend) {
            if (p.typ != "M") {
                // Farbkarte NUR als Rueckfall: Kam die BrickLink-Farbe schon
                // vom Server, bleibt sie stehen. `p.farbe` kann null sein —
                // dann gibt es auch nichts nachzuschlagen.
                val zeile = jeSchluessel[
                    ch.brickinventoryapp.ui.screens.plSchluessel(p.typ, p.teil, p.farbe)]
                val farbe = zeile?.blColorId ?: p.farbe?.let { farbkarte[it] } ?: p.farbe
                ausgepackt += p.copy(farbe = farbe)
                continue
            }
            val figTeile = (repo.teile.getMinifigParts(p.teil) as? Result.Success)?.data?.parts
            if (figTeile.isNullOrEmpty()) { ausgepackt += p; continue }
            for (ft in figTeile) {
                ausgepackt += BrickLinkWunschliste.Posten(
                    typ   = "P",
                    teil  = ft.blPartNumber ?: ft.partNumber,
                    farbe = ft.blColorId ?: farbkarte[ft.colorId] ?: ft.colorId,
                    // Menge je Figur mal Anzahl fehlender Figuren.
                    menge = (ft.totalQuantity.takeIf { it > 0 } ?: 1) * p.menge,
                )
            }
        }

        val posten = BrickLinkWunschliste.zusammenfassen(ausgepackt)
        val xml = BrickLinkWunschliste.xml(posten, zustand)

        // Genau das Verzeichnis, das der FileProvider freigibt — siehe
        // res/xml/file_paths.xml. Ein anderer Ordner liesse den Teilen-Dialog
        // mit "Failed to find configured root" abbrechen.
        val basis = context.getExternalFilesDir(null) ?: context.filesDir
        val dir = java.io.File(basis, "export").apply { mkdirs() }
        val datei = java.io.File(dir, "bricklink-wanted.xml")
        datei.writeText(xml)

        val uri = androidx.core.content.FileProvider.getUriForFile(
            context, context.packageName + ".provider", datei)
        context.startActivity(
            android.content.Intent.createChooser(
                android.content.Intent(android.content.Intent.ACTION_SEND).apply {
                    type = "text/xml"
                    putExtra(android.content.Intent.EXTRA_STREAM, uri)
                    addFlags(android.content.Intent.FLAG_GRANT_READ_URI_PERMISSION)
                // text() und NICHT context.getString(): Die App hat eine
                // eigene Sprachwahl, die nicht die des Geraets sein muss.
                // context.getString naehme die des Geraets — der Titel des
                // Teilen-Dialogs stuende dann als einziger in einer anderen
                // Sprache als alles daneben.
                }, text(R.string.partslist_bl_share)
            ).addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK)
        )
        null
    } catch (e: Exception) {
        // Gemeldet statt verschluckt: Ein Export, der nichts tut und nichts
        // sagt, sieht aus wie ein kaputter Knopf.
        e.message ?: text(R.string.partslist_bl_failed)
    }
}
