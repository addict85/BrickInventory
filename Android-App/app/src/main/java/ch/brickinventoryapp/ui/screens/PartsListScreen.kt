package ch.brickinventoryapp.ui.screens

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.background
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.listSaver
import androidx.compose.runtime.saveable.rememberSaveable
import kotlinx.coroutines.launch
import androidx.compose.material.icons.filled.PictureAsPdf
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import coil.compose.AsyncImage
import coil.ImageLoader
import coil.request.ImageRequest
import androidx.compose.ui.res.stringResource
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.MutableStateFlow
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import ch.brickinventoryapp.R
import ch.brickinventoryapp.util.BrickLinkWunschliste
import ch.brickinventoryapp.util.NumericInput
import androidx.compose.ui.res.vectorResource
import androidx.compose.ui.graphics.vector.ImageVector

data class PlSet(val setNumber: String, var name: String = "")

// ── Sortierung: exakt wie Webapp & PDF ──────────────────────────────────────
// Webapp (app.js) und PDF (api_v1.js) sortieren mit JS localeCompare:
//   Farben:       localeCompare('de')                → ICU-Collation, de
//   Teilenummern: localeCompare(undefined,{numeric}) → ICU + numerische Segmente
// Der ICU-RuleBasedCollator ist die 1:1-Entsprechung auf Android. Die frühere
// Eigenbau-Sortierung (lowercase-Binärvergleich + eigener Alphanumerik-Comparator
// + "Minifiguren immer zuerst") wich davon sichtbar ab.
private val plColorCollator: android.icu.text.Collator =
    android.icu.text.Collator.getInstance(java.util.Locale.GERMAN)

private val plPartCollator: android.icu.text.Collator =
    (android.icu.text.Collator.getInstance(java.util.Locale.GERMAN) as android.icu.text.RuleBasedCollator)
        .apply { numericCollation = true }

private fun comparePartNumbers(a: String, b: String): Int = plPartCollator.compare(a, b)

data class PlPart(
    val partNumber: String,
    val blPartNumber: String? = null,
    val partName: String,
    val colorName: String,
    val colorHex: String?,
    val colorId: Int = 0,
    val blColorId: Int? = null,
    var quantity: Int,
    val imageUrl: String?,
    val imageLocal: String? = null,
    val isFig: Boolean = false
)

/**
 * Der Schluessel, unter dem die Eingabe „vorhanden" zu einem Posten gehoert.
 *
 * An EINER Stelle, weil ihn zwei Seiten bilden muessen: der Bildschirm beim
 * Tippen und der Export beim Abgleichen. Stimmen sie nicht ueberein, findet
 * der Export keine einzige Eingabe und meldet alles als fehlend — ein Fehler,
 * der wie ein leeres Formular aussieht und nicht wie ein Fehler.
 *
 * Die Art (P/M) gehoert dazu: Eine Minifigur und ein Teil koennen dieselbe
 * Nummer tragen, und die Figur hat keine Farbe.
 */
fun plSchluessel(typ: String, teil: String, farbe: Int?): String =
    "$typ|$teil|${farbe ?: 0}"

/** Derselbe Schluessel, aus einer Listenzeile gebildet. */
fun plSchluessel(p: PlPart): String =
    plSchluessel(if (p.isFig) "M" else "P", p.blPartNumber ?: p.partNumber, p.blColorId ?: p.colorId)

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun PartsListScreen(
    serverUrl: String,
    authToken: String = "",
    onExportPdf: suspend (List<PlSet>, List<PlPart>) -> String? = { _, _ -> "Not implemented" },
    /**
     * Die fehlenden Teile als BrickLink-Wunschliste ausgeben: Liste, was schon
     * da ist (je [plSchluessel]), gewuenschter Zustand. Rueckgabe ist die
     * Meldung fuer den Nutzer, oder null wenn der Teilen-Dialog aufging.
     */
    onExportBricklink: suspend (List<PlPart>, Map<String, Int>, String) -> String? =
        { _, _, _ -> null },
    pdfStatus: StateFlow<String?> = MutableStateFlow(null),
    imageLoader: ImageLoader,
    onScanBarcode: () -> Unit,
    onResolveSet: suspend (String) -> Pair<String, List<PlPart>>,
    barcodeSetNumber: String? = null,
    onBarcodeConsumed: () -> Unit = {},
    /**
     * Scroll-Zustand der Liste. Kommt von aussen, weil dieser Bildschirm beim
     * Weg zum Barcode-Scanner verlassen und danach neu zusammengesetzt wird —
     * ein `rememberLazyListState()` hier drin wäre bei der Rückkehr
     * zurückgesetzt und die Liste spränge nach oben.
     *
     * Dass dieser Bildschirm beim Scannen verlassen wird, ist hier bekannt:
     * Genau daran hingen schon die verschwundenen Sets aus Nachtrag 64. Nur
     * die Rollposition hatte niemand nachgezogen (Nachtrag 94).
     */
    listState: LazyListState = rememberLazyListState(),
    /**
     * Der Scan blieb ohne Setnummer → Cursor ins Set-Feld (Nachtrag 113).
     *
     * Marcos Vorgabe war „die manuelle Erfassung soll erscheinen". Dieser
     * Bildschirm hat dafür KEINEN Dialog — er erfasst über das Feld gleich hier
     * auf der Seite. Das Gegenstück zum aufgehenden Dialog ist deshalb: Cursor
     * hinein, Tastatur offen, sofort tippbereit.
     *
     * Als Parameter und nicht über `vm`: Dieser Bildschirm nimmt bewusst kein
     * ViewModel entgegen (siehe die übrigen Parameter oben).
     */
    manuelleErfassungAnfordern: Boolean = false,
    onManuelleErfassungQuittiert: () -> Unit = {},
) {
    var setInput  by rememberSaveable { mutableStateOf("") }
    val setFeldFokus = remember { FocusRequester() }
    // rememberSaveable statt remember (Nachtrag 64): Der Weg zum Barcode-Scanner
    // führt aus diesem Bildschirm HERAUS. Compose verwirft dabei den Inhalt von
    // remember{} — die gesammelten Sets waren nach jedem Scan weg, und weil
    // direkt danach das gescannte Set eingefügt wurde, sah es aus, als hätte
    // der zweite Scan den ersten Eintrag GELÖSCHT. Genau so hat Marco es
    // gemeldet.
    //
    // Ein eigener Saver ist nötig, weil PlSet keine von Compose bekannte Form
    // hat. Gespeichert werden nur die Setnummern — der Name wird beim Erfassen
    // ohnehin auf die Nummer gesetzt (siehe addSet unten) und beim Erstellen
    // der Liste vom Server geholt.
    var sets      by rememberSaveable(
        stateSaver = listSaver(
            save    = { liste -> liste.map { it.setNumber } },
            restore = { nummern -> nummern.map { PlSet(it, it) } }
        )
    ) { mutableStateOf(listOf<PlSet>()) }
    var parts     by remember { mutableStateOf(listOf<PlPart>()) }
    // Was der Nutzer schon hat, je Zeile — als TEXT, damit ein leeres Feld
    // waehrend des Tippens leer bleiben darf. Ausgewertet wird beim Export.
    //
    // `remember` und nicht `rememberSaveable`, absichtlich: `parts` daneben ist
    // ebenfalls nur `remember`. Nach dem Weg zum Barcode-Scanner ist die Liste
    // ohnehin neu zu erzeugen; gespeicherte Eingaben ohne die zugehoerigen
    // Zeilen waeren Zahlen ohne Bezug.
    val vorhanden = remember { mutableStateMapOf<String, String>() }
    var blZustand by rememberSaveable { mutableStateOf(BrickLinkWunschliste.ZUSTAND_EGAL) }
    var isLoading by remember { mutableStateOf(false) }
    var status    by rememberSaveable { mutableStateOf("") }
    var generated by rememberSaveable { mutableStateOf(false) }
    val pdfStatusText by pdfStatus.collectAsStateWithLifecycle()

    val scope = rememberCoroutineScope()

    // String-Templates einmal composabel aufloesen, dann in Lambdas (scope.launch etc.)
    // per String.format() weiterverwenden (dort ist stringResource() nicht erlaubt).
    val setAlreadyAddedMsg = stringResource(R.string.partslist_set_already_added)
    val setsInListFmt      = stringResource(R.string.partslist_sets_in_list)
    val loadingSetFmt      = stringResource(R.string.partslist_loading_set)
    val errorForSetFmt     = stringResource(R.string.partslist_error_for_set)
    val summaryFmt         = stringResource(R.string.partslist_summary)
    val noColorLabel       = stringResource(R.string.partslist_no_color)
    val groupSummaryFmt    = stringResource(R.string.partslist_group_summary)
    val rbPrefixFmt        = stringResource(R.string.partslist_rb_prefix)

    // Handle barcode scanner result from Gallery flow
    fun addSet(nr: String) {
        val normalized = if (nr.contains("-")) nr.trim() else "${nr.trim()}-1"
        if (sets.any { it.setNumber == normalized }) { status = setAlreadyAddedMsg; return }
        sets = sets + PlSet(normalized, normalized)
        setInput = ""
        status = String.format(setsInListFmt, sets.size)
    }

    LaunchedEffect(barcodeSetNumber) {
        if (barcodeSetNumber != null) {
            addSet(barcodeSetNumber)
            onBarcodeConsumed()
        }
    }


    // ── Nach einer Drehung passen `generated` und `parts` nicht mehr zusammen ─
    //
    // `parts` ist bewusst nur `remember`: Eine Teileliste aus mehreren Sets
    // hat leicht tausend Eintraege und gehoert nicht ins Bundle (dort endet
    // sie in einer TransactionTooLargeException). `generated` dagegen ist
    // gespeichert — nach einer Drehung stand also „erzeugt" da, waehrend die
    // Liste leer war, und der Bildschirm zeigte den Hinweis fuer den leeren
    // Zustand UNTER den Knoepfen fuer eine fertige Liste.
    //
    // Aufgefallen mit den neuen Eingabefeldern: Wer „vorhanden" ausfuellt und
    // dabei das Telefon dreht, stand vor genau diesem halben Bildschirm. Die
    // Sets bleiben erhalten (die sind gespeichert), ein Druck auf „Erzeugen"
    // stellt alles wieder her.
    LaunchedEffect(Unit) { if (parts.isEmpty()) generated = false }

    fun reset() {
        sets = listOf(); parts = listOf(); status = ""; generated = false
        vorhanden.clear()
    }

    Column(Modifier.fillMaxSize()) {
        // ── Erfolgloser Scan setzt den Cursor ins Set-Feld (Nachtrag 113) ─────
        //
        // Marcos Vorgabe, dass die manuelle Erfassung aufgehen soll. Die
        // Teileliste hat dafür KEINEN Dialog — sie erfasst über das Feld
        // gleich hier auf der Seite. Das Gegenstück zum aufgehenden Dialog ist
        // deshalb: Cursor hinein, Tastatur offen, sofort tippbereit.
        LaunchedEffect(manuelleErfassungAnfordern) {
            if (manuelleErfassungAnfordern) {
                kotlinx.coroutines.delay(120)
                try { setFeldFokus.requestFocus() } catch (_: Exception) {}
                onManuelleErfassungQuittiert()
            }
        }

        // Input row
        Surface(tonalElevation = 2.dp) {
            Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                    OutlinedTextField(
                        value = setInput,
                        onValueChange = { setInput = it },
                        placeholder = { Text(stringResource(R.string.partslist_set_number_placeholder)) },
                        modifier = Modifier.weight(1f).focusRequester(setFeldFokus),
                        singleLine = true,
                        shape = MaterialTheme.shapes.large,
                        trailingIcon = {
                            if (setInput.isNotBlank()) IconButton(onClick = { setInput = "" }) {
                                Icon(Icons.Default.Clear, stringResource(R.string.cd_search_clear), Modifier.size(18.dp))
                            }
                        }
                    )
                    FloatingActionButton(
                        onClick = onScanBarcode,
                        containerColor = MaterialTheme.colorScheme.secondaryContainer,
                        modifier = Modifier.size(48.dp)
                    ) { Icon(Icons.Default.QrCodeScanner, stringResource(R.string.partslist_scan), Modifier.size(22.dp)) }
                    Button(
                        onClick = { if (setInput.isNotBlank()) addSet(setInput) },
                        enabled = setInput.isNotBlank(),
                        colors = ButtonDefaults.buttonColors(containerColor = MaterialTheme.colorScheme.primary)
                    ) { Text("+") }
                }

                // Set chips
                if (sets.isNotEmpty()) {
                    @OptIn(ExperimentalLayoutApi::class)
                    androidx.compose.foundation.layout.FlowRow(
                        horizontalArrangement = Arrangement.spacedBy(6.dp),
                        verticalArrangement = Arrangement.spacedBy(4.dp)
                    ) {
                        sets.forEachIndexed { i, s ->
                            AssistChip(
                                onClick = { sets = sets.toMutableList().also { it.removeAt(i) }; generated = false },
                                label = { Text(if (s.name != s.setNumber) "${s.setNumber} — ${s.name}" else s.setNumber,
                                    style = MaterialTheme.typography.labelSmall) },
                                trailingIcon = { Icon(Icons.Default.Close, null, Modifier.size(14.dp)) }
                            )
                        }
                    }
                }

                // Action buttons
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Button(
                        onClick = {
                            isLoading = true; generated = false; parts = listOf()
                            // Eine neue Liste heisst neue Zeilen; stehen
                            // gebliebene Eingaben gehoerten zur alten.
                            vorhanden.clear()
                            scope.launch {
                                val combined = mutableMapOf<String, PlPart>()
                                sets.toList().forEachIndexed { i, s ->
                                    status = String.format(loadingSetFmt, s.setNumber, i+1, sets.size)
                                    try {
                                        val (name, newParts) = onResolveSet(s.setNumber)
                                        sets = sets.toMutableList().also { it[i] = s.copy(name = name) }
                                        newParts.forEach { p ->
                                            val key = "${p.blPartNumber ?: p.partNumber}|${p.colorName}"
                                            combined[key] = combined[key]?.copy(quantity = combined[key]!!.quantity + p.quantity) ?: p
                                        }
                                    } catch (_: Exception) { status = String.format(errorForSetFmt, s.setNumber) }
                                }
                                parts = combined.values.sortedWith(
                                    Comparator { a, b ->
                                        val cmp = plColorCollator.compare(a.colorName, b.colorName)
                                        if (cmp != 0) cmp
                                        else comparePartNumbers(
                                            a.blPartNumber ?: a.partNumber,
                                            b.blPartNumber ?: b.partNumber
                                        )
                                    }
                                )
                                status = String.format(summaryFmt, parts.size, parts.sumOf { it.quantity })
                                isLoading = false; generated = true
                            }
                        },
                        enabled = sets.isNotEmpty() && !isLoading,
                        colors = ButtonDefaults.buttonColors(containerColor = MaterialTheme.colorScheme.primary)
                    ) {
                        if (isLoading) CircularProgressIndicator(Modifier.size(16.dp),
                            color = MaterialTheme.colorScheme.onPrimary, strokeWidth = 2.dp)
                        else { Icon(Icons.Default.Build, null, Modifier.size(16.dp)); Spacer(Modifier.width(4.dp)); Text(stringResource(R.string.partslist_generate)) }
                    }
                    val ctx = LocalContext.current
                    if (generated && parts.isNotEmpty()) {
                        // remember, NICHT rememberSaveable: Der Wert gehoert
                        // zu einer laufenden Koroutine. Ueberlebte er die
                        // Drehung, kaeme "laeuft" zurueck, ohne dass noch etwas
                        // laeuft — Knopf gesperrt, Kreisel fuer immer.
                        var isExporting by remember { mutableStateOf(false) }
                        var pdfError by remember { mutableStateOf<String?>(null) }
                        if (pdfError != null) {
                            androidx.compose.material3.AlertDialog(
                                onDismissRequest = { pdfError = null },
                                confirmButton = { TextButton(onClick = { pdfError = null }) { Text(stringResource(R.string.partslist_ok)) } },
                                title = { Text(stringResource(R.string.partslist_pdf_error_title)) },
                                text = { Text(pdfError ?: "") }
                            )
                        }
                        Button(
                            onClick = {
                                isExporting = true
                                scope.launch {
                                    val err = onExportPdf(sets.toList(), parts.toList())
                                    isExporting = false
                                    if (err != null) pdfError = err
                                }
                            },
                            enabled = !isExporting,
                            colors = ButtonDefaults.buttonColors(
                                containerColor = MaterialTheme.colorScheme.tertiary)
                        ) {
                            if (isExporting) CircularProgressIndicator(Modifier.size(16.dp),
                                color = MaterialTheme.colorScheme.onTertiary, strokeWidth = 2.dp)
                            else { Icon(Icons.Default.PictureAsPdf, null, Modifier.size(16.dp)); Spacer(Modifier.width(4.dp)); Text("PDF") }
                        }
                    }
                    OutlinedButton(
                        onClick = { reset() },
                        colors = ButtonDefaults.outlinedButtonColors(contentColor = MaterialTheme.colorScheme.error)
                    ) { Text(stringResource(R.string.partslist_reset)) }
                }

                if (status.isNotBlank()) {
                    Text(status, style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant)
                }

                // Live-Countdown während der PDF-Erstellung (nur wenn ein Export läuft).
                pdfStatusText?.let { txt ->
                    Text(txt, style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.primary)
                }

                // ── BrickLink-Wunschliste ────────────────────────────────────
                //
                // Erst sichtbar, wenn eine Liste da ist: Vorher gaebe es nichts
                // zu vergleichen, und ein Knopf, der nur „nichts da" sagen
                // kann, ist ein Knopf zu viel.
                //
                // Unter den uebrigen Knoepfen statt daneben, weil die Zeile
                // darueber mit Erzeugen, PDF und Zuruecksetzen schon voll ist —
                // ein vierter Knopf dort wuerde auf schmalen Geraeten
                // abgeschnitten.
                if (generated && parts.isNotEmpty()) {
                    var blLaeuft by remember { mutableStateOf(false) }
                    var blMeldung by remember { mutableStateOf<String?>(null) }
                    if (blMeldung != null) {
                        androidx.compose.material3.AlertDialog(
                            onDismissRequest = { blMeldung = null },
                            confirmButton = { TextButton(onClick = { blMeldung = null }) { Text(stringResource(R.string.partslist_ok)) } },
                            title = { Text(stringResource(R.string.partslist_bl_title)) },
                            text = { Text(blMeldung ?: "") }
                        )
                    }
                    HorizontalDivider(color = MaterialTheme.colorScheme.outline.copy(alpha = 0.15f))
                    Text(stringResource(R.string.partslist_bl_hint),
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant)
                    Zustandszeile(
                        zustand = blZustand,
                        onZustand = { blZustand = it },
                        // Drei Werte statt zwei: BrickLink kennt bei einer
                        // Wunschliste zusaetzlich „egal", und das ist dort auch
                        // die Vorbelegung.
                        optionen = listOf(
                            BrickLinkWunschliste.ZUSTAND_EGAL to R.string.condition_any,
                            BrickLinkWunschliste.ZUSTAND_NEU to R.string.condition_new,
                            BrickLinkWunschliste.ZUSTAND_GEBRAUCHT to R.string.condition_used,
                        ),
                    )
                    Button(
                        onClick = {
                            blLaeuft = true
                            scope.launch {
                                val zahlen = vorhanden.mapNotNull { (k, v) ->
                                    v.toIntOrNull()?.takeIf { it > 0 }?.let { k to it }
                                }.toMap()
                                blMeldung = onExportBricklink(parts.toList(), zahlen, blZustand)
                                blLaeuft = false
                            }
                        },
                        enabled = !blLaeuft,
                        modifier = Modifier.fillMaxWidth(),
                        colors = ButtonDefaults.buttonColors(
                            containerColor = MaterialTheme.colorScheme.secondary)
                    ) {
                        if (blLaeuft) CircularProgressIndicator(Modifier.size(16.dp),
                            color = MaterialTheme.colorScheme.onSecondary, strokeWidth = 2.dp)
                        else {
                            Icon(Icons.Default.ShoppingCart, null, Modifier.size(16.dp))
                            Spacer(Modifier.width(4.dp))
                            Text(stringResource(R.string.partslist_bl_export))
                        }
                    }
                }
            }
        }

        if (!generated || parts.isEmpty()) {
            if (!isLoading) Box(Modifier.fillMaxSize(), Alignment.Center) {
                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    Text("📋", fontSize = 48.sp)
                    Spacer(Modifier.height(8.dp))
                    Text(stringResource(R.string.partslist_empty_hint),
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
            return@Column
        }

        // Gruppierung nach Farbe + Sortierung (Farbgruppen und Teile je Gruppe)
        // memoisieren — vorher lief beides bei jeder Recomposition erneut, obwohl
        // sich `parts` dabei meist nicht ändert.
        val colorGroups = remember(parts) {
            parts.groupBy { it.colorName }.entries
                .sortedWith(compareBy(plColorCollator) { it.key })
                .map { (colorName, colorParts) ->
                    colorName to colorParts.sortedWith { a, b ->
                        comparePartNumbers(a.blPartNumber ?: a.partNumber, b.blPartNumber ?: b.partNumber)
                    }
                }
        }
        LazyColumn(state = listState, contentPadding = PaddingValues(12.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
            colorGroups.forEachIndexed { groupIdx, (colorName, colorParts) ->
                item(key = "header_${groupIdx}_$colorName") {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        val hex = colorParts.first().colorHex
                        if (hex != null && !colorParts.first().isFig) {
                            Box(Modifier.size(14.dp).clip(CircleShape)
                                .background(try { Color(android.graphics.Color.parseColor("#$hex")) }
                                catch (_: Exception) { Color.Gray }))
                            Spacer(Modifier.width(6.dp))
                        }
                        val displayName = colorName.ifEmpty { noColorLabel }
                        Text(displayName, fontWeight = FontWeight.Bold,
                            style = MaterialTheme.typography.titleSmall,
                            color = MaterialTheme.colorScheme.primary)
                        Spacer(Modifier.width(8.dp))
                        Text(String.format(groupSummaryFmt, colorParts.sumOf { it.quantity }, colorParts.size),
                            style = MaterialTheme.typography.labelSmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                    HorizontalDivider(Modifier.padding(top = 4.dp), color = MaterialTheme.colorScheme.primaryContainer)
                }
                items(
                    colorParts,
                    key = { "${groupIdx}_${it.blPartNumber ?: it.partNumber}_${it.colorName}" }
                ) { part ->
                    val k = plSchluessel(part)
                    PartListRow(
                        part, serverUrl, imageLoader,
                        vorhandenText = vorhanden[k] ?: "",
                        onVorhanden = { vorhanden[k] = it },
                    )
                }
            }
        }
    }
}

@Composable
fun PartListRow(
    part: PlPart,
    serverUrl: String,
    imageLoader: ImageLoader,
    /**
     * „Wie viele habe ich schon?" — leerer Text heisst keine.
     *
     * Der Wert liegt beim Bildschirm und nicht hier, weil die Zeile in einer
     * LazyColumn steht: Was aus dem Bild scrollt, wird verworfen und spaeter
     * neu zusammengesetzt. Eine Eingabe, die in der Zeile selbst gemerkt
     * waere, verschwaende beim Hochscrollen.
     */
    vorhandenText: String = "",
    onVorhanden: (String) -> Unit = {},
) {
    val ctx = LocalContext.current
    val rbPrefixFmt = stringResource(R.string.partslist_rb_prefix)
    // WICHTIG: part.imageUrl ist hier bereits vollständig aufgelöst —
    // PartsListFeature.kt bereitet ihn beim Laden auf (image_local bevorzugt,
    // sonst über den Server-Proxy). Ein erneutes resolveThumbUrl() hier würde
    // eine bereits proxy-gewickelte Adresse ein zweites Mal einwickeln
    // (doppelter /api/img-proxy?url=…). Nur noch den lokalen Server-Präfix
    // ergänzen, falls der Wert ein relativer Pfad ist.
    val imgUrl = remember(part.imageUrl, serverUrl) {
        part.imageUrl?.let { url ->
            if (url.startsWith("/")) "$serverUrl$url" else url
        }
    }
    Row(
        Modifier.fillMaxWidth().padding(vertical = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp)
    ) {
        // Image
        Box(Modifier.size(48.dp)) {
            if (imgUrl != null) {
                AsyncImage(
                    model = ImageRequest.Builder(ctx).data(imgUrl).crossfade(true).build(),
                    imageLoader = imageLoader,
                    contentDescription = part.partName,
                    modifier = Modifier.fillMaxSize().clip(MaterialTheme.shapes.small),
                    contentScale = ContentScale.Fit
                )
            } else {
                Surface(color = MaterialTheme.colorScheme.surfaceVariant,
                    shape = MaterialTheme.shapes.small, modifier = Modifier.fillMaxSize()) {
                    Box(Modifier.fillMaxSize(), Alignment.Center) {
                        // Figur weiter als Emoji, Teile mit dem gemeinsamen
                        // Teile-Symbol (wie Reiter und Webapp).
                        if (part.isFig) Text("🧍", fontSize = 20.sp)
                        else Icon(
                            ImageVector.vectorResource(R.drawable.ic_parts_bricks),
                            contentDescription = null,
                            tint = Color.Unspecified,
                            modifier = Modifier.size(22.dp)
                        )
                    }
                }
            }
        }
        // Info
        Column(Modifier.weight(1f)) {
            // BL-ID (primary) and RB-ID (secondary)
            val displayId = part.blPartNumber ?: part.partNumber
            Text(displayId, style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.primary, fontWeight = FontWeight.SemiBold)
            if (part.blPartNumber != null && part.blPartNumber != part.partNumber) {
                Text(String.format(rbPrefixFmt, part.partNumber), style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            Text(part.partName, style = MaterialTheme.typography.bodySmall,
                maxLines = 2, overflow = TextOverflow.Ellipsis)
        }
        // Quantity badge
        Surface(color = if (part.isFig) MaterialTheme.colorScheme.tertiaryContainer
                        else MaterialTheme.colorScheme.primaryContainer,
                shape = MaterialTheme.shapes.small) {
            Text("${part.quantity}×", Modifier.padding(horizontal = 8.dp, vertical = 4.dp),
                fontWeight = FontWeight.Bold,
                color = if (part.isFig) MaterialTheme.colorScheme.onTertiaryContainer
                        else MaterialTheme.colorScheme.onPrimaryContainer)
        }
        // Wie viele davon habe ich schon? Genau wie die Spalte „vorhanden" der
        // Webapp — die Differenz ist es, was die BrickLink-Wunschliste braucht.
        OutlinedTextField(
            value = vorhandenText,
            onValueChange = { onVorhanden(NumericInput.quantity(it)) },
            placeholder = { Text("0", style = MaterialTheme.typography.labelSmall) },
            label = { Text(stringResource(R.string.partslist_have),
                style = MaterialTheme.typography.labelSmall) },
            singleLine = true,
            keyboardOptions = androidx.compose.foundation.text.KeyboardOptions(
                keyboardType = androidx.compose.ui.text.input.KeyboardType.Number),
            textStyle = MaterialTheme.typography.bodySmall,
            modifier = Modifier.width(76.dp),
        )
    }
}

// PDF export is handled by MainViewModel.exportPartsPdf via async job polling.
