package ch.brickinventoryapp.ui.screens

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.background
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.listSaver
import androidx.compose.runtime.saveable.rememberSaveable
import kotlinx.coroutines.launch
import androidx.compose.material.icons.filled.PictureAsPdf
import androidx.compose.material.icons.filled.Inventory2
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import coil3.ImageLoader
import coil3.request.ImageRequest
import coil3.request.crossfade
import androidx.compose.ui.res.stringResource
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.MutableStateFlow
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import ch.brickinventoryapp.ressourcen.R
import androidx.compose.ui.res.vectorResource
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.input.ImeAction
import androidx.core.graphics.toColorInt
import ch.brickinventoryapp.util.NumericInput
import ch.brickinventoryapp.ui.theme.Abstaende
import androidx.compose.material.icons.automirrored.filled.ListAlt

// ── Sortierung wie Webapp und PDF ──
//
// Beide sortieren mit localeCompare: Farben nach ICU-Collation (de), Teilenummern
// ICU mit numerischen Segmenten. Der ICU-RuleBasedCollator ist die Entsprechung
// auf Android; eine eigene Sortierung wich sichtbar ab.
private val plColorCollator: android.icu.text.Collator =
    android.icu.text.Collator.getInstance(java.util.Locale.GERMAN)

private val plPartCollator: android.icu.text.Collator =
    (android.icu.text.Collator.getInstance(java.util.Locale.GERMAN) as android.icu.text.RuleBasedCollator)
        .apply { numericCollation = true }

private fun comparePartNumbers(a: String, b: String): Int = plPartCollator.compare(a, b)


// ExperimentalLayoutApi für die FlowRow der Set-Chips — über der Funktion und mit
// kurzem Namen, so wie SplitFileImportsTest sie sucht; ein @OptIn im Rumpf
// übersetzt nicht.
@OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)
@Composable
fun PartsListScreen(
    serverUrl: String,
    authToken: String = "",
    onExportPdf: suspend (List<PlSet>, List<PlPart>) -> String? = { _, _ -> "Not implemented" },
    pdfStatus: StateFlow<String?> = MutableStateFlow(null),
    imageLoader: ImageLoader,
    onScanBarcode: () -> Unit,
    onResolveSet: suspend (String) -> Pair<String, List<PlPart>>,
    /**
     * „Kann ich das bauen?“ — den eigenen Bestand zu dieser Liste holen. Gibt die
     * Liste mit gesetztem `vorhanden` zurück, oder null bei einem Fehler. Die Vorgabe
     * reicht sie unverändert durch, damit der Bildschirm in einer Vorschau ohne
     * ViewModel baut.
     */
    onLadeBestand: suspend (List<PlPart>, Boolean, Boolean) -> List<PlPart>? = { p, _, _ -> p },
    /**
     * Hat dieses Konto Unterkonten? Nur dann steht die Wahl „Unterkonten mit
     * einbeziehen“ da — ein Schalter ohne Wirkung ist schlechter als keiner.
     */
    hatUnterkonten: Boolean = false,
    barcodeSetNumber: String? = null,
    onBarcodeConsumed: () -> Unit = {},
    /**
     * Scroll-Zustand von aussen: Der Bildschirm wird beim Weg zum Barcode-Scanner
     * verlassen; ein eigener State wäre bei der Rückkehr zurückgesetzt.
     */
    listState: LazyListState = rememberLazyListState(),
    /**
     * Der Scan blieb ohne Setnummer → Cursor ins Set-Feld, Tastatur offen. Die
     * Teileliste erfasst über das Feld auf der Seite, nicht über einen Dialog. Als
     * Parameter, weil dieser Bildschirm kein ViewModel bekommt.
     */
    manuelleErfassungAnfordern: Boolean = false,
    onManuelleErfassungQuittiert: () -> Unit = {},
) {
    var setInput  by rememberSaveable { mutableStateOf("") }
    val setFeldFokus = remember { FocusRequester() }
    // rememberSaveable: Der Weg zum Barcode-Scanner führt aus dem Bildschirm heraus,
    // und mit remember wären die gesammelten Sets nach jedem Scan weg. Gespeichert
    // werden nur die Setnummern (eigener Saver); Namen holt das Erstellen vom Server.
    var sets      by rememberSaveable(
        stateSaver = listSaver(
            save    = { liste -> liste.map { it.setNumber } },
            restore = { nummern -> nummern.map { PlSet(it, it) } }
        )
    ) { mutableStateOf(listOf<PlSet>()) }
    var parts     by remember { mutableStateOf(listOf<PlPart>()) }
    var isLoading by remember { mutableStateOf(false) }
    var status    by rememberSaveable { mutableStateOf("") }
    var generated by rememberSaveable { mutableStateOf(false) }
    // rememberSaveable: Die Wahl gehoert zur Frage, nicht zur Koroutine — sie
    // soll eine Drehung ueberleben, anders als die Ladeanzeige daneben.
    var nurLose   by rememberSaveable { mutableStateOf(false) }
    // Vorgabe aus: Gemeint sind zuerst die eigenen Sets.
    var mitUnterkonten by rememberSaveable { mutableStateOf(false) }
    val pdfStatusText by pdfStatus.collectAsStateWithLifecycle()

    val scope = rememberCoroutineScope()

    // String-Templates einmal composabel aufloesen, dann in Lambdas (scope.launch etc.)
    // per String.format() weiterverwenden (dort ist stringResource() nicht erlaubt).
    val setAlreadyAddedMsg = stringResource(R.string.partslist_set_already_added)
    // Mengenformen brauchen die ZAHL zum Formatierzeitpunkt, und der liegt in
    // den Rueckrufen unten. `pluralStringResource` ist @Composable und dort
    // nicht erlaubt — `LocalResources` liefert eine Resources, die auch dort
    // gilt und bei einem Wechsel der Konfiguration mitgeht.
    val mengen = androidx.compose.ui.platform.LocalResources.current
    val loadingSetFmt      = stringResource(R.string.partslist_loading_set)
    val errorForSetFmt     = stringResource(R.string.partslist_error_for_set)
    val noColorLabel       = stringResource(R.string.partslist_no_color)
    val farbe = ch.brickinventoryapp.ui.components.farbUebersetzer()
    val rbPrefixFmt        = stringResource(R.string.partslist_rb_prefix)
    val bestandVollstaendigText = stringResource(R.string.partslist_owned_complete)
    val bestandFehlerText       = stringResource(R.string.partslist_owned_error)

    // Handle barcode scanner result from Gallery flow
    fun addSet(nr: String) {
        val normalized = if (nr.contains("-")) nr.trim() else "${nr.trim()}-1"
        if (sets.any { it.setNumber == normalized }) { status = setAlreadyAddedMsg; return }
        sets = sets + PlSet(normalized, normalized)
        setInput = ""
        status = mengen.getQuantityString(
            R.plurals.partslist_sets_in_list, sets.size, sets.size)
    }

    LaunchedEffect(barcodeSetNumber) {
        if (barcodeSetNumber != null) {
            addSet(barcodeSetNumber)
            onBarcodeConsumed()
        }
    }


    // Nach einer Drehung passt `generated` nicht mehr zu `parts`: Die Teileliste ist
    // nur `remember` (tausend Einträge sprengten das Bundle), `generated` ist
    // gespeichert. Die Sets bleiben, „Erzeugen“ stellt alles wieder her.
    LaunchedEffect(Unit) { if (parts.isEmpty()) generated = false }

    // Ein Schritt statt zwei: Was im Feld steht, kommt beim Erstellen (oder mit der
    // Eingabetaste) dazu; „+“ braucht es nur für weitere Sets.
    fun erstellen() {
        if (setInput.isNotBlank()) addSet(setInput)
        if (sets.isEmpty() || isLoading) return
        isLoading = true; generated = false; parts = listOf()
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
            // Zwei Zahlen, zwei Uebereinstimmungen: ein
            // <plurals> stimmt nur mit EINER ueberein,
            // darum zwei Bruchstuecke und ein Rahmen.
            val typen = parts.size
            val stueck = parts.sumOf { it.quantity }
            status = mengen.getString(R.string.partslist_summary,
                mengen.getQuantityString(R.plurals.partslist_summary_types, typen, typen),
                mengen.getQuantityString(R.plurals.partslist_summary_parts, stueck, stueck))
            isLoading = false; generated = true
        }
    }

    fun reset() {
        sets = listOf(); parts = listOf(); status = ""; generated = false
    }

    Column(Modifier.fillMaxSize()) {
        // ── Erfolgloser Scan setzt den Cursor ins Set-Feld ──
        //
        // Das Gegenstück zum Erfassungsdialog der anderen Bildschirme.
        LaunchedEffect(manuelleErfassungAnfordern) {
            if (manuelleErfassungAnfordern) {
                kotlinx.coroutines.delay(120)
                try { setFeldFokus.requestFocus() } catch (_: Exception) {}
                onManuelleErfassungQuittiert()
            }
        }

        // Input row
        Surface(tonalElevation = 2.dp) {
            Column(Modifier.padding(Abstaende.mittel), verticalArrangement = Arrangement.spacedBy(Abstaende.klein)) {
                Row(horizontalArrangement = Arrangement.spacedBy(Abstaende.klein), verticalAlignment = Alignment.CenterVertically) {
                    OutlinedTextField(
                        value = setInput,
                        // Filter und Tastaturwahl wie jedes Setnummernfeld (util/NumericInput.kt).
                        // „Fertig“ erstellt die Liste gleich mit diesem Set.
                        onValueChange = { setInput = NumericInput.setNumber(it) },
                        keyboardOptions = NumericInput.ganzzahlTastatur(ImeAction.Done),
                        keyboardActions = KeyboardActions(onDone = { erstellen() }),
                        // Beschriftung statt Platzhalter: Der lange Platzhalter brach im Feld
                        // zweizeilig um und verschwand beim Tippen.
                        label = { Text(stringResource(R.string.gallery_set_number)) },
                        modifier = Modifier.weight(1f).focusRequester(setFeldFokus),
                        singleLine = true,
                        shape = MaterialTheme.shapes.large,
                        trailingIcon = {
                            if (setInput.isNotBlank()) IconButton(onClick = { setInput = "" }) {
                                Icon(Icons.Default.Clear, stringResource(R.string.cd_search_clear), Modifier.size(ch.brickinventoryapp.ui.components.mitSchrift(18.dp)))
                            }
                        }
                    )
                    // Derselbe Scan-Knopf wie neben jeder Suche; ein schwebender Knopf mitten
                    // in einer Zeile sah aus wie der eine Hauptknopf des Bildschirms.
                    ch.brickinventoryapp.ui.components.ScanKnopf(onScanBarcode)
                    // Ein Symbol in voller Grösse statt eines „+“ in Textgrösse, das gesperrt kaum
                    // zu sehen war; tonal, weil „Bauliste erstellen“ darunter die Hauptsache ist.
                    FilledTonalIconButton(
                        onClick = { if (setInput.isNotBlank()) addSet(setInput) },
                        enabled = setInput.isNotBlank(),
                    ) { Icon(Icons.Default.Add, stringResource(R.string.partslist_add_set)) }
                }

                // Set chips
                if (sets.isNotEmpty()) {
                    FlowRow(
                        horizontalArrangement = Arrangement.spacedBy(6.dp),
                        verticalArrangement = Arrangement.spacedBy(Abstaende.winzig)
                    ) {
                        sets.forEachIndexed { i, s ->
                            AssistChip(
                                onClick = { sets = sets.toMutableList().also { it.removeAt(i) }; generated = false },
                                label = { Text(if (s.name != s.setNumber) "${s.setNumber} — ${s.name}" else s.setNumber,
                                    style = MaterialTheme.typography.labelSmall) },
                                trailingIcon = { Icon(Icons.Default.Close, null, Modifier.size(ch.brickinventoryapp.ui.components.mitSchrift(14.dp))) }
                            )
                        }
                    }
                }

                // Eine Hauptsache in voller Breite: Erstellen. Darunter das Weitergeben als PDF
                // und, leise, Zurücksetzen — vorher standen „+“, Erstellen und Zurücksetzen
                // gleichrangig nebeneinander.
                Button(
                    onClick = { erstellen() },
                    enabled = (sets.isNotEmpty() || setInput.isNotBlank()) && !isLoading,
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    // Nur das Symbol wird zum Kreisel, die Beschriftung bleibt: Sonst
                    // schrumpfte der Knopf, und die Zeile spränge. Kreisel und Symbol sind
                    // beide 16 dp breit.
                    if (isLoading) CircularProgressIndicator(Modifier.size(16.dp),
                        color = MaterialTheme.colorScheme.onPrimary, strokeWidth = 2.dp)
                    else Icon(Icons.AutoMirrored.Filled.ListAlt, null, Modifier.size(ch.brickinventoryapp.ui.components.mitSchrift(16.dp)))
                    Spacer(Modifier.width(Abstaende.winzig))
                    Text(stringResource(R.string.partslist_generate))
                }
                Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
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
                        FilledTonalButton(
                            onClick = {
                                isExporting = true
                                scope.launch {
                                    val err = onExportPdf(sets.toList(), parts.toList())
                                    isExporting = false
                                    if (err != null) pdfError = err
                                }
                            },
                            enabled = !isExporting,
                        ) {
                            // Nur das Symbol wird zum Kreisel, die Beschriftung bleibt: Sonst
                            // schrumpfte der Knopf, und die Zeile spränge. Kreisel und Symbol sind
                            // beide 16 dp breit.
                            if (isExporting) CircularProgressIndicator(Modifier.size(16.dp),
                                strokeWidth = 2.dp)
                            else Icon(Icons.Default.PictureAsPdf, null, Modifier.size(ch.brickinventoryapp.ui.components.mitSchrift(16.dp)))
                            Spacer(Modifier.width(Abstaende.winzig))
                            Text("PDF")
                        }
                    }
                    Spacer(Modifier.weight(1f))
                    // Gesperrt, solange es nichts zurückzusetzen gibt: Ein roter Knopf auf der
                    // leeren Seite lud zum Tippen ein, ohne etwas zu tun.
                    TextButton(
                        onClick = { reset() },
                        enabled = sets.isNotEmpty() || generated || status.isNotBlank(),
                        colors = ButtonDefaults.textButtonColors(contentColor = MaterialTheme.colorScheme.error),
                    ) { Text(stringResource(R.string.partslist_reset)) }
                }

                // ── Eigener Bestand: eine Zeile für sich ──
                //
                // Die Zeile darüber stellt die Liste zusammen und gibt sie weiter; der Bestand
                // trägt Zahlen in die fertige Liste ein. „nur lose Teile“ steht neben dem Knopf,
                // weil die Wahl von Frage zu Frage wechselt.
                if (generated && parts.isNotEmpty()) {
                    // remember, nicht rememberSaveable, wie beim PDF-Export. Der Name auf `…Laeuft`
                    // sagt BildschirmZustandTest: laufender Vorgang, darf eine Drehung nicht
                    // überleben.
                    var bestandLaeuft by remember { mutableStateOf(false) }
                    // Untereinander: Die Beschriftung der Wahl ist lang und passt auf einem
                    // 360-dp-Telefon nicht neben den Knopf.
                    Column(verticalArrangement = Arrangement.spacedBy(Abstaende.winzig)) {
                        Button(
                            onClick = {
                                bestandLaeuft = true
                                scope.launch {
                                    val neu = onLadeBestand(parts.toList(), nurLose, mitUnterkonten)
                                    bestandLaeuft = false
                                    if (neu == null) { status = bestandFehlerText; return@launch }
                                    parts = neu
                                    val fehlen = neu.filter { (it.vorhanden ?: 0) < it.quantity }
                                    val fehlendeStueck =
                                        fehlen.sumOf { it.quantity - (it.vorhanden ?: 0) }
                                    status = if (fehlen.isEmpty()) bestandVollstaendigText
                                    // Die Einzahlform laesst die Klammer weg: Fehlt
                                    // genau EIN Teil, ist die Zahl der
                                    // verschiedenen zwangslaeufig auch eins — die
                                    // Angabe waere dort nur Wiederholung.
                                    else mengen.getQuantityString(
                                        R.plurals.partslist_owned_missing, fehlendeStueck, fehlendeStueck,
                                        mengen.getQuantityString(
                                            R.plurals.partslist_owned_missing_distinct,
                                            fehlen.size, fehlen.size))
                                }
                            },
                            enabled = !bestandLaeuft,
                            colors = ButtonDefaults.buttonColors(
                                containerColor = MaterialTheme.colorScheme.secondary)
                        ) {
                            // Nur das Symbol wird zum Kreisel, die Beschriftung bleibt: Sonst
                            // schrumpfte der Knopf, und die Zeile spränge. Kreisel und Symbol sind
                            // beide 16 dp breit.
                            if (bestandLaeuft) CircularProgressIndicator(Modifier.size(16.dp),
                                color = MaterialTheme.colorScheme.onSecondary, strokeWidth = 2.dp)
                            else Icon(Icons.Default.Inventory2, null, Modifier.size(ch.brickinventoryapp.ui.components.mitSchrift(16.dp)))
                            Spacer(Modifier.width(Abstaende.winzig))
                            Text(stringResource(R.string.partslist_fill_owned))
                        }
                        Row(verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(Abstaende.winzig)) {
                            Checkbox(checked = nurLose, onCheckedChange = { nurLose = it })
                            Text(stringResource(R.string.partslist_only_loose),
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                        // Zweite Wahl, andere Frage: Die erste sagt, WELCHE ART
                        // Teile zaehlt, diese sagt, WESSEN. Beide wirken
                        // zusammen — „nur manuell erfasste" plus „mit
                        // Unterkonten" zaehlt die manuell erfassten Teile des
                        // ganzen Haushalts.
                        if (hatUnterkonten) {
                            Row(verticalAlignment = Alignment.CenterVertically,
                                horizontalArrangement = Arrangement.spacedBy(Abstaende.winzig)) {
                                Checkbox(checked = mitUnterkonten,
                                    onCheckedChange = { mitUnterkonten = it })
                                Text(stringResource(R.string.partslist_include_subs),
                                    style = MaterialTheme.typography.bodySmall,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant)
                            }
                        }
                    }
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
            }
        }

        if (!generated || parts.isEmpty()) {
            // Derselbe Leerzustand wie jede Liste (ZustandsHinweis): mittig, mit Rand.
            if (!isLoading) ch.brickinventoryapp.ui.components.ZustandsHinweis {
                ch.brickinventoryapp.ui.components.HinweisText(Icons.AutoMirrored.Filled.ListAlt,
                    stringResource(R.string.partslist_empty_title), stringResource(R.string.partslist_empty_hint))
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
        LazyColumn(state = listState, contentPadding = PaddingValues(Abstaende.mittel), verticalArrangement = Arrangement.spacedBy(Abstaende.gross)) {
            colorGroups.forEachIndexed { groupIdx, (colorName, colorParts) ->
                item(key = "header_${groupIdx}_$colorName") {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        val hex = colorParts.first().colorHex
                        if (hex != null && !colorParts.first().isFig) {
                            Box(Modifier.size(14.dp).clip(CircleShape)
                                .background(try { Color("#$hex".toColorInt()) }
                                catch (_: Exception) { Color.Gray }))
                            Spacer(Modifier.width(6.dp))
                        }
                        val displayName = if (colorName.isEmpty()) noColorLabel else farbe(colorName)
                        Text(displayName, fontWeight = FontWeight.Bold,
                            style = MaterialTheme.typography.titleSmall,
                            color = MaterialTheme.colorScheme.primary)
                        Spacer(Modifier.width(Abstaende.klein))
                        // Uebereinstimmung mit %2$d (den Typen) — %1$d traegt
                        // nur ein „×" und kein Wort.
                        Text(mengen.getQuantityString(R.plurals.partslist_group_summary,
                                colorParts.size, colorParts.sumOf { it.quantity }, colorParts.size),
                            style = MaterialTheme.typography.labelSmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                    HorizontalDivider(Modifier.padding(top = Abstaende.winzig), color = MaterialTheme.colorScheme.primaryContainer)
                }
                items(
                    colorParts,
                    key = { "${groupIdx}_${it.blPartNumber ?: it.partNumber}_${it.colorName}" }
                ) { part ->
                    PartListRow(part, serverUrl, imageLoader)
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
) {
    val ctx = LocalContext.current
    val rbPrefixFmt = stringResource(R.string.partslist_rb_prefix)
    // part.imageUrl ist schon aufgelöst (ui/Teileliste.kt); ein zweites
    // resolveThumbUrl() wickelte die Proxy-Adresse doppelt ein. Nur ein relativer Pfad
    // bekommt den Server davor.
    val imgUrl = remember(part.imageUrl, serverUrl) {
        part.imageUrl?.let { url ->
            if (url.startsWith("/")) "$serverUrl$url" else url
        }
    }
    Row(
        Modifier.fillMaxWidth().padding(vertical = Abstaende.winzig),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp)
    ) {
        // Image
        ch.brickinventoryapp.ui.components.ProduktBild(
            model = imgUrl?.let { ImageRequest.Builder(ctx).data(it).crossfade(true).build() },
            imageLoader = imageLoader,
            contentDescription = part.partName,
            modifier = Modifier.size(48.dp).clip(MaterialTheme.shapes.small),
            contentScale = ContentScale.Fit,
            ersatzGroesse = 24.dp,
        )
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
            Text(ch.brickinventoryapp.ui.components.katalogName(part.partName), style = MaterialTheme.typography.bodySmall,
                maxLines = 2, overflow = TextOverflow.Ellipsis)
        }
        // Quantity badge
        Surface(color = if (part.isFig) MaterialTheme.colorScheme.tertiaryContainer
                        else MaterialTheme.colorScheme.primaryContainer,
                shape = MaterialTheme.shapes.small) {
            Text(ch.brickinventoryapp.ui.mengeAusSet(part.quantity), Modifier.padding(horizontal = Abstaende.klein, vertical = Abstaende.winzig),
                fontWeight = FontWeight.Bold,
                color = if (part.isFig) MaterialTheme.colorScheme.onTertiaryContainer
                        else MaterialTheme.colorScheme.onPrimaryContainer)
        }
        // ── „habe ich“ neben „brauche ich“ ──
        //
        // Wie viele Stück im Blickfeld liegen, sagt der Server. Grün, wenn es reicht,
        // sonst der Fehlbetrag in Rot — „kann ich das bauen?“ ist so schon beim
        // Überfliegen beantwortet.
        part.vorhanden?.let { habe ->
            val reicht = habe >= part.quantity
            Surface(
                color = if (reicht) MaterialTheme.colorScheme.secondaryContainer
                        else MaterialTheme.colorScheme.errorContainer,
                shape = MaterialTheme.shapes.small,
            ) {
                Text(
                    if (reicht) "✓ $habe" else "$habe/${part.quantity}",
                    Modifier.padding(horizontal = Abstaende.klein, vertical = Abstaende.winzig),
                    fontWeight = FontWeight.Bold,
                    color = if (reicht) MaterialTheme.colorScheme.onSecondaryContainer
                            else MaterialTheme.colorScheme.onErrorContainer,
                )
            }
        }
    }
}

// Den PDF-Export führt TeilelisteViewModel.exportPartsPdf über den Vordergrund-Dienst.
