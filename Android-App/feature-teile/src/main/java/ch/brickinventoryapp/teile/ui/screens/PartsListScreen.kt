package ch.brickinventoryapp.teile.ui.screens

import ch.brickinventoryapp.teile.ui.normalisiert
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.clearAndSetSemantics
import ch.brickinventoryapp.ui.components.GedrosselteAnsage
import ch.brickinventoryapp.ui.components.ansagen
import ch.brickinventoryapp.ui.components.KaestchenZeile
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import ch.brickinventoryapp.ui.components.Rueckfrage
import ch.brickinventoryapp.ui.components.nebenKnopfFarben
import ch.brickinventoryapp.ui.components.nebenKnopfRand
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.material.icons.filled.Inventory2
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import coil3.ImageLoader
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import ch.brickinventoryapp.ressourcen.R
import androidx.compose.ui.text.input.ImeAction
import ch.brickinventoryapp.ui.util.NumericInput
import ch.brickinventoryapp.teile.ui.TeilelisteUiState
import ch.brickinventoryapp.teile.ui.viewmodel.TeilelisteViewModel
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import ch.brickinventoryapp.ui.theme.Abstaende
import androidx.compose.material.icons.automirrored.filled.ListAlt
import ch.brickinventoryapp.data.service.teilelistenAuswahl
import ch.brickinventoryapp.ui.components.HinweisText
import ch.brickinventoryapp.ui.components.MitTooltip
import ch.brickinventoryapp.ui.components.ScanKnopf
import ch.brickinventoryapp.ui.components.ZustandsHinweis
import ch.brickinventoryapp.ui.components.mitSchrift

// ── Sortierung wie Webapp und PDF ──
//
// Beide sortieren mit localeCompare: Farben nach ICU-Collation (de), Teilenummern
// ICU mit numerischen Segmenten. Der ICU-RuleBasedCollator ist die Entsprechung
// auf Android; eine eigene Sortierung wich sichtbar ab.
internal val plColorCollator: android.icu.text.Collator =
    android.icu.text.Collator.getInstance(java.util.Locale.GERMAN)

private val plPartCollator: android.icu.text.Collator =
    (android.icu.text.Collator.getInstance(java.util.Locale.GERMAN) as android.icu.text.RuleBasedCollator)
        .apply { numericCollation = true }

internal fun comparePartNumbers(a: String, b: String): Int = plPartCollator.compare(a, b)

/**
 * Die Bauliste am Navigationsziel: holt das ViewModel, nimmt einen Scan an und
 * öffnet ein fertiges PDF. Der Bildschirm darunter bekommt nur Zustand und Ereignisse.
 */
@Composable
fun PartsListRoute(
    serverUrl: String,
    imageLoader: ImageLoader,
    onScanBarcode: () -> Unit,
    hatUnterkonten: Boolean,
    barcodeSetNumber: String?,
    onBarcodeConsumed: () -> Unit,
    listState: LazyListState,
    manuelleErfassungAnfordern: Boolean,
    onManuelleErfassungQuittiert: () -> Unit,
    vm: TeilelisteViewModel = hiltViewModel(),
) {
    val zustand by vm.zustand.collectAsStateWithLifecycle()
    val pdfStatus by vm.pdfExportStatus.collectAsStateWithLifecycle()
    val ctx = LocalContext.current
    val oeffnenMit = stringResource(R.string.pdfexp_oeffnen_mit)
    LaunchedEffect(barcodeSetNumber) {
        if (barcodeSetNumber != null) {
            vm.fuegeHinzu(barcodeSetNumber)
            onBarcodeConsumed()
        }
    }
    // Das fertige PDF einmal zur Auswahl anbieten; ein Activity-Start gehört nicht ins ViewModel.
    LaunchedEffect(zustand.pdfDatei) {
        if (zustand.pdfDatei != null) {
            ctx.startActivity(teilelistenAuswahl(ctx, oeffnenMit))
            vm.pdfGeoeffnet()
        }
    }
    PartsListScreen(
        zustand = zustand,
        serverUrl = serverUrl,
        imageLoader = imageLoader,
        onScanBarcode = onScanBarcode,
        onFuegeHinzu = vm::fuegeHinzu,
        onEntferne = vm::entferne,
        onLeere = vm::leere,
        onErstelle = vm::erstelle,
        onLadeBestand = vm::ladeBestand,
        onNurLose = vm::setzeNurLose,
        onMitUnterkonten = vm::setzeMitUnterkonten,
        onExportPdf = vm::exportiere,
        onPdfFehlerGesehen = vm::pdfFehlerGesehen,
        pdfStatus = pdfStatus,
        hatUnterkonten = hatUnterkonten,
        listState = listState,
        manuelleErfassungAnfordern = manuelleErfassungAnfordern,
        onManuelleErfassungQuittiert = onManuelleErfassungQuittiert,
    )
}

// ExperimentalLayoutApi für die FlowRow der Set-Chips — über der Funktion, weil ein
// @OptIn im Rumpf nicht übersetzt.
@OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)
@Composable
fun PartsListScreen(
    zustand: TeilelisteUiState,
    serverUrl: String,
    imageLoader: ImageLoader,
    onScanBarcode: () -> Unit,
    onFuegeHinzu: (String) -> Unit = {},
    onEntferne: (Int) -> Unit = {},
    onLeere: () -> Unit = {},
    /** Nimmt die getippte Nummer mit: ein Schritt statt zwei. */
    onErstelle: (String) -> Unit = {},
    /** „Kann ich das bauen?“ — den eigenen Bestand zu dieser Liste holen. */
    onLadeBestand: () -> Unit = {},
    onNurLose: (Boolean) -> Unit = {},
    onMitUnterkonten: (Boolean) -> Unit = {},
    onExportPdf: () -> Unit = {},
    onPdfFehlerGesehen: () -> Unit = {},
    /** Fortschritt des laufenden PDF-Exports („…noch ~Xs“), null ohne Export. */
    pdfStatus: String? = null,
    /**
     * Hat dieses Konto Unterkonten? Nur dann steht die Wahl „Unterkonten mit
     * einbeziehen“ da — ein Schalter ohne Wirkung ist schlechter als keiner.
     */
    hatUnterkonten: Boolean = false,
    /**
     * Scroll-Zustand von aussen: Der Bildschirm wird beim Weg zum Barcode-Scanner
     * verlassen; ein eigener State wäre bei der Rückkehr zurückgesetzt.
     */
    listState: LazyListState = rememberLazyListState(),
    /** Der Scan blieb ohne Setnummer → Cursor ins Set-Feld, Tastatur offen. */
    manuelleErfassungAnfordern: Boolean = false,
    onManuelleErfassungQuittiert: () -> Unit = {},
) {
    // Nur das Eingabefeld und die offene Rückfrage sind Zustand des Bildschirms; alles
    // andere hält das ViewModel.
    var setInput  by rememberSaveable { mutableStateOf("") }
    var leerenFragen by rememberSaveable { mutableStateOf(false) }
    val setFeldFokus = remember { FocusRequester() }
    val sets = zustand.sets
    val parts = zustand.parts
    val isLoading = zustand.isLoading
    val status = zustand.status
    val generated = zustand.generated
    val nurLose = zustand.nurLose
    val mitUnterkonten = zustand.mitUnterkonten
    val mengen = androidx.compose.ui.platform.LocalResources.current

    fun addSet(nr: String) {
        onFuegeHinzu(nr)
        setInput = ""
    }

    fun erstellen() {
        onErstelle(setInput)
        setInput = ""
    }

    if (leerenFragen) {
        Rueckfrage(
            titel = stringResource(R.string.partslist_reset_titel),
            text = stringResource(R.string.partslist_reset_text),
            bestaetigen = stringResource(R.string.partslist_reset),
            onBestaetigen = { leerenFragen = false; onLeere() },
            onAbbrechen = { leerenFragen = false },
        )
    }

    Column(Modifier.fillMaxSize()) {
        // ── Erfolgloser Scan setzt den Cursor ins Set-Feld ──
        //
        // Das Gegenstück zum Erfassungsdialog der anderen Bildschirme.
        LaunchedEffect(manuelleErfassungAnfordern) {
            if (manuelleErfassungAnfordern) {
                kotlinx.coroutines.delay(120)
                try { setFeldFokus.requestFocus() } catch (_: Exception) { /* Dialog schon zu */ }
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
                        // „Fertig“ und das „+“ im Feld nehmen das Set in die Liste: ein Weg hinein,
                        // ein Knopf zum Erstellen.
                        onValueChange = { setInput = NumericInput.setNumber(it) },
                        keyboardOptions = NumericInput.setnummerTastatur(ImeAction.Done),
                        keyboardActions = KeyboardActions(onDone = { if (setInput.isNotBlank()) addSet(setInput) }),
                        // Beschriftung statt Platzhalter: Der lange Platzhalter brach im Feld
                        // zweizeilig um und verschwand beim Tippen.
                        label = { Text(stringResource(R.string.gallery_set_number)) },
                        modifier = Modifier.weight(1f).focusRequester(setFeldFokus),
                        singleLine = true,
                        shape = MaterialTheme.shapes.large,
                        trailingIcon = {
                            if (setInput.isNotBlank()) MitTooltip(stringResource(R.string.partslist_add_set)) {
                                IconButton(onClick = { addSet(setInput) }) {
                                    Icon(Icons.Default.Add, stringResource(R.string.partslist_add_set))
                                }
                            }
                        }
                    )
                    // Derselbe Scan-Knopf wie neben jeder Suche; ein schwebender Knopf mitten
                    // in einer Zeile sah aus wie der eine Hauptknopf des Bildschirms.
                    ScanKnopf(onScanBarcode)
                }

                // Die gesammelten Sets mit ihrem Zurücksetzen: Es leert diese Liste und steht
                // deshalb bei ihr, nicht frei unter den Knöpfen. Ohne Inhalt fehlt es ganz.
                if (sets.isNotEmpty() || generated) {
                    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                        Text(mengen.getQuantityString(R.plurals.partslist_sets_in_list, sets.size, sets.size),
                            style = MaterialTheme.typography.labelLarge,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            modifier = Modifier.weight(1f))
                        // Mit Rückfrage: Zurücksetzen wirft Sets und erstellte Liste weg.
                        TextButton(
                            onClick = { leerenFragen = true },
                            colors = ButtonDefaults.textButtonColors(contentColor = MaterialTheme.colorScheme.error),
                        ) { Text(stringResource(R.string.partslist_reset)) }
                    }
                    FlowRow(
                        horizontalArrangement = Arrangement.spacedBy(6.dp),
                        verticalArrangement = Arrangement.spacedBy(Abstaende.winzig)
                    ) {
                        sets.forEachIndexed { i, s ->
                            AssistChip(
                                onClick = { onEntferne(i) },
                                label = { Text(if (s.name != s.setNumber) "${s.setNumber} — ${s.name}" else s.setNumber,
                                    style = MaterialTheme.typography.bodySmall) },
                                trailingIcon = { Icon(Icons.Default.Close, null, Modifier.size(mitSchrift(14.dp))) }
                            )
                        }
                    }
                }

                // Eine Hauptsache in voller Breite: Erstellen, mit der Zahl der Sets, die es
                // nimmt — das getippte eingeschlossen.
                val anzahl = sets.size + (if (setInput.isNotBlank() && sets.none { it.setNumber == normalisiert(setInput) }) 1 else 0)
                Button(
                    onClick = { erstellen() },
                    enabled = anzahl > 0 && !isLoading,
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    // Nur das Symbol wird zum Kreisel, die Beschriftung bleibt: Sonst
                    // schrumpfte der Knopf, und die Zeile spränge. Kreisel und Symbol sind
                    // beide 16 dp breit.
                    if (isLoading) CircularProgressIndicator(Modifier.size(16.dp),
                        color = MaterialTheme.colorScheme.onPrimary, strokeWidth = 2.dp)
                    else Icon(Icons.AutoMirrored.Filled.ListAlt, null, Modifier.size(mitSchrift(16.dp)))
                    Spacer(Modifier.width(Abstaende.winzig))
                    Text(stringResource(R.string.partslist_generate))
                    // Die Zahl als Plakette: „(2 Sets)“ brach bei 200 % in eine zweite Zeile.
                    if (anzahl > 0) {
                        val vorgelesen = pluralStringResource(R.plurals.partslist_generate_anzahl, anzahl, anzahl)
                        Spacer(Modifier.width(Abstaende.klein))
                        Badge(
                            containerColor = MaterialTheme.colorScheme.onPrimary,
                            contentColor = MaterialTheme.colorScheme.primary,
                            modifier = Modifier.clearAndSetSemantics { contentDescription = vorgelesen },
                        ) { Text("$anzahl", style = MaterialTheme.typography.labelMedium) }
                    }
                }
                if (generated && parts.isNotEmpty()) {
                    PdfKnopf(zustand.isExporting, zustand.pdfError, onExportPdf, onPdfFehlerGesehen)
                }

                // ── Eigener Bestand: eine Zeile für sich ──
                //
                // Die Zeile darüber stellt die Liste zusammen und gibt sie weiter; der Bestand
                // trägt Zahlen in die fertige Liste ein. „nur lose Teile“ steht neben dem Knopf,
                // weil die Wahl von Frage zu Frage wechselt.
                if (generated && parts.isNotEmpty()) {
                    // Läuft im ViewModel: Eine Drehung bricht den Abgleich nicht ab.
                    val bestandLaeuft = zustand.bestandLaeuft
                    // Untereinander: Die Beschriftung der Wahl ist lang und passt auf einem
                    // 360-dp-Telefon nicht neben den Knopf.
                    Column(verticalArrangement = Arrangement.spacedBy(Abstaende.winzig)) {
                        // Umrandet: Ein zweiter gefüllter Knopf stritt mit „Bauliste erstellen“
                        // um die Hauptsache.
                        OutlinedButton(
                            onClick = onLadeBestand,
                            enabled = !bestandLaeuft,
                            colors = nebenKnopfFarben(),
                            border = nebenKnopfRand(!bestandLaeuft),
                        ) {
                            // Nur das Symbol wird zum Kreisel, die Beschriftung bleibt: Sonst
                            // schrumpfte der Knopf, und die Zeile spränge. Kreisel und Symbol sind
                            // beide 16 dp breit.
                            if (bestandLaeuft) CircularProgressIndicator(Modifier.size(16.dp), strokeWidth = 2.dp)
                            else Icon(Icons.Default.Inventory2, null, Modifier.size(mitSchrift(16.dp)))
                            Spacer(Modifier.width(Abstaende.winzig))
                            Text(stringResource(R.string.partslist_fill_owned))
                        }
                        KaestchenZeile(stringResource(R.string.partslist_only_loose), nurLose, onNurLose)
                        // Zweite Wahl, andere Frage: Die erste sagt, WELCHE ART
                        // Teile zaehlt, diese sagt, WESSEN. Beide wirken
                        // zusammen — „nur manuell erfasste" plus „mit
                        // Unterkonten" zaehlt die manuell erfassten Teile des
                        // ganzen Haushalts.
                        if (hatUnterkonten) {
                            KaestchenZeile(stringResource(R.string.partslist_include_subs), mitUnterkonten, onMitUnterkonten)
                        }
                    }
                }

                if (status.isNotBlank()) {
                    Text(status, Modifier.ansagen(), style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant)
                }

                // Live-Countdown während der PDF-Erstellung (nur wenn ein Export läuft).
                pdfStatus?.let { txt ->
                    // Sichtbar jede Sekunde, angesagt alle zehn.
                    GedrosselteAnsage(txt)
                    Text(txt, Modifier.clearAndSetSemantics { contentDescription = txt }, style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.primary)
                }
            }
        }

        if (!generated || parts.isEmpty()) {
            // Derselbe Leerzustand wie jede Liste (ZustandsHinweis): mittig, mit Rand.
            if (!isLoading) ZustandsHinweis {
                HinweisText(Icons.AutoMirrored.Filled.ListAlt,
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
                    FarbGruppenKopf(colorName, colorParts)
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
