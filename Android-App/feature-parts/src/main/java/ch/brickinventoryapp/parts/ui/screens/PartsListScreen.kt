package ch.brickinventoryapp.parts.ui.screens

import ch.brickinventoryapp.model.ui.laeuft
import ch.brickinventoryapp.model.ui.errorMessage
import ch.brickinventoryapp.ui.satz
import ch.brickinventoryapp.model.ui.laedt
import ch.brickinventoryapp.parts.ui.normalized
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.clearAndSetSemantics
import ch.brickinventoryapp.ui.components.ThrottledAnnouncement
import ch.brickinventoryapp.ui.components.announce
import ch.brickinventoryapp.ui.components.BoxRow
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
import ch.brickinventoryapp.ui.components.Prompt
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
import ch.brickinventoryapp.resources.R
import androidx.compose.ui.text.input.ImeAction
import ch.brickinventoryapp.ui.util.NumericInput
import ch.brickinventoryapp.parts.ui.TeilelisteUiState
import ch.brickinventoryapp.parts.ui.viewmodel.PartListViewModel
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import ch.brickinventoryapp.ui.theme.Abstaende
import androidx.compose.material.icons.automirrored.filled.ListAlt
import ch.brickinventoryapp.data.service.partListsSelection
import ch.brickinventoryapp.ui.components.HintText
import ch.brickinventoryapp.ui.components.MitTooltip
import ch.brickinventoryapp.ui.components.ScanButton
import ch.brickinventoryapp.ui.components.StateHint
import ch.brickinventoryapp.ui.components.withFont

// ── Sort order like the web app and PDF ──
//
// Both sort with localeCompare: colors by ICU collation (de), part numbers by
// ICU with numeric segments. The ICU RuleBasedCollator is the counterpart
// on Android; a custom sort visibly deviated.
internal val plColorCollator: android.icu.text.Collator =
    android.icu.text.Collator.getInstance(java.util.Locale.GERMAN)

private val plPartCollator: android.icu.text.Collator =
    (android.icu.text.Collator.getInstance(java.util.Locale.GERMAN) as android.icu.text.RuleBasedCollator)
        .apply { numericCollation = true }

internal fun comparePartNumbers(a: String, b: String): Int = plPartCollator.compare(a, b)

/**
 * The build list at the navigation destination: fetches the ViewModel, accepts a scan and
 * opens a finished PDF. The screen underneath only gets state and events.
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
    vm: PartListViewModel = hiltViewModel(),
) {
    val zustand by vm.zustand.collectAsStateWithLifecycle()
    val pdfStatus by vm.pdfExportStatus.collectAsStateWithLifecycle()
    val ctx = LocalContext.current
    val openWith = stringResource(R.string.pdfexp_oeffnen_mit)
    LaunchedEffect(barcodeSetNumber) {
        if (barcodeSetNumber != null) {
            vm.addAdd(barcodeSetNumber)
            onBarcodeConsumed()
        }
    }
    // Offer the finished PDF for sharing once; an Activity start does not belong in the ViewModel.
    LaunchedEffect(zustand.pdfFile) {
        if (zustand.pdfFile != null) {
            ctx.startActivity(partListsSelection(ctx, openWith))
            vm.pdfOpened()
        }
    }
    PartsListScreen(
        zustand = zustand,
        serverUrl = serverUrl,
        imageLoader = imageLoader,
        onScanBarcode = onScanBarcode,
        onFuegeHinzu = vm::addAdd,
        onEntferne = vm::entferne,
        onLeere = vm::leere,
        onErstelle = vm::erstelle,
        onLadeBestand = vm::loadInventory,
        onNurLose = vm::setOnlyLose,
        onMitUnterkonten = vm::setWithSubAccounts,
        onExportPdf = vm::exportiere,
        onPdfFehlerGesehen = vm::pdfErrorSeen,
        pdfStatus = pdfStatus,
        hatUnterkonten = hatUnterkonten,
        listState = listState,
        manuelleErfassungAnfordern = manuelleErfassungAnfordern,
        onManuelleErfassungQuittiert = onManuelleErfassungQuittiert,
    )
}

// ExperimentalLayoutApi for the FlowRow of the set chips — on the function, because an
// @OptIn in the body does not compile.
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
    /** Takes the typed number along: one step instead of two. */
    onErstelle: (String) -> Unit = {},
    /** "Can I build this?" — fetch one's own stock for this list. */
    onLadeBestand: () -> Unit = {},
    onNurLose: (Boolean) -> Unit = {},
    onMitUnterkonten: (Boolean) -> Unit = {},
    onExportPdf: () -> Unit = {},
    onPdfFehlerGesehen: () -> Unit = {},
    /** Progress of the running PDF export ("…noch ~Xs"), null without an export. */
    pdfStatus: String? = null,
    /**
     * Does this account have sub-accounts? Only then does the choice "Unterkonten mit
     * einbeziehen" appear — a switch with no effect is worse than none.
     */
    hatUnterkonten: Boolean = false,
    /**
     * Scroll state from outside: the screen is left on the way to the barcode scanner;
     * a state of its own would be reset on returning.
     */
    listState: LazyListState = rememberLazyListState(),
    /** The scan came back without a set number → cursor into the set field, keyboard open. */
    manuelleErfassungAnfordern: Boolean = false,
    onManuelleErfassungQuittiert: () -> Unit = {},
) {
    // Only the input field and the open confirmation prompt are the screen's own state; everything
    // else is held by the ViewModel.
    var setInput  by rememberSaveable { mutableStateOf("") }
    var clearAsk by rememberSaveable { mutableStateOf(false) }
    val setFeldFokus = remember { FocusRequester() }
    val sets = zustand.sets
    val parts = zustand.parts
    val isLoading = zustand.erzeugen.laedt
    val status = zustand.status?.satz().orEmpty()
    val generated = zustand.generated
    val onlyLose = zustand.onlyLose
    val withSubAccounts = zustand.withSubAccounts
    val quantities = androidx.compose.ui.platform.LocalResources.current

    fun addSet(nr: String) {
        onFuegeHinzu(nr)
        setInput = ""
    }

    fun erstellen() {
        onErstelle(setInput)
        setInput = ""
    }

    if (clearAsk) {
        Prompt(
            titel = stringResource(R.string.partslist_reset_titel),
            text = stringResource(R.string.partslist_reset_text),
            bestaetigen = stringResource(R.string.partslist_reset),
            onBestaetigen = { clearAsk = false; onLeere() },
            onAbbrechen = { clearAsk = false },
        )
    }

    Column(Modifier.fillMaxSize()) {
        // ── An unsuccessful scan sets the cursor into the set field ──
        //
        // The counterpart to the other screens' entry dialog.
        LaunchedEffect(manuelleErfassungAnfordern) {
            if (manuelleErfassungAnfordern) {
                kotlinx.coroutines.delay(120)
                try { setFeldFokus.requestFocus() } catch (_: Exception) { /* dialog already closed */ }
                onManuelleErfassungQuittiert()
            }
        }

        // Input row
        Surface(tonalElevation = 2.dp) {
            Column(Modifier.padding(Abstaende.mittel), verticalArrangement = Arrangement.spacedBy(Abstaende.klein)) {
                Row(horizontalArrangement = Arrangement.spacedBy(Abstaende.klein), verticalAlignment = Alignment.CenterVertically) {
                    OutlinedTextField(
                        value = setInput,
                        // Filter and keyboard choice like every set-number field (util/NumericInput.kt).
                        // "Fertig" and the "+" in the field take the set into the list: one way in,
                        // one button to create it.
                        onValueChange = { setInput = NumericInput.setNumber(it) },
                        keyboardOptions = NumericInput.setNumberKeyboard(ImeAction.Done),
                        keyboardActions = KeyboardActions(onDone = { if (setInput.isNotBlank()) addSet(setInput) }),
                        // Label instead of placeholder: the long placeholder wrapped into two
                        // lines in the field and disappeared while typing.
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
                    // The same scan button as next to every search; a floating button in the middle
                    // of a row looked like the screen's one main button.
                    ScanButton(onScanBarcode)
                }

                // The collected sets with their reset: it clears this list and so stands
                // next to it, not floating free below the buttons. Without content it is missing entirely.
                if (sets.isNotEmpty() || generated) {
                    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                        Text(quantities.getQuantityString(R.plurals.partslist_sets_in_list, sets.size, sets.size),
                            style = MaterialTheme.typography.labelLarge,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            modifier = Modifier.weight(1f))
                        // With a confirmation prompt: resetting discards the sets and the created list.
                        TextButton(
                            onClick = { clearAsk = true },
                            colors = ButtonDefaults.textButtonColors(contentColor = MaterialTheme.colorScheme.error),
                        ) { Text(stringResource(R.string.partslist_reset)) }
                    }
                    FlowRow(
                        horizontalArrangement = Arrangement.spacedBy(6.dp),
                        verticalArrangement = Arrangement.spacedBy(Abstaende.tiny)
                    ) {
                        sets.forEachIndexed { i, s ->
                            AssistChip(
                                onClick = { onEntferne(i) },
                                label = { Text(if (s.name != s.setNumber) "${s.setNumber} — ${s.name}" else s.setNumber,
                                    style = MaterialTheme.typography.bodySmall) },
                                trailingIcon = { Icon(Icons.Default.Close, null, Modifier.size(withFont(14.dp))) }
                            )
                        }
                    }
                }

                // One main action at full width: create, with the number of sets it
                // takes — the typed one included.
                val anzahl = sets.size + (if (setInput.isNotBlank() && sets.none { it.setNumber == normalized(setInput) }) 1 else 0)
                Button(
                    onClick = { erstellen() },
                    enabled = anzahl > 0 && !isLoading,
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    // Only the icon turns into a spinner, the label stays: otherwise
                    // the button would shrink and the row would jump. Spinner and icon are
                    // both 16 dp wide.
                    if (isLoading) CircularProgressIndicator(Modifier.size(16.dp),
                        color = MaterialTheme.colorScheme.onPrimary, strokeWidth = 2.dp)
                    else Icon(Icons.AutoMirrored.Filled.ListAlt, null, Modifier.size(withFont(16.dp)))
                    Spacer(Modifier.width(Abstaende.tiny))
                    Text(stringResource(R.string.partslist_generate))
                    // The number as a badge: "(2 Sets)" wrapped into a second line at 200 %.
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
                    PdfButton(zustand.pdf.laeuft, zustand.pdf.errorMessage?.satz(), onExportPdf, onPdfFehlerGesehen)
                }

                // ── Own stock: a row of its own ──
                //
                // The row above puts the list together and passes it on; the stock
                // enters numbers into the finished list. "nur lose Teile" stands next to the button,
                // because the choice changes from question to question.
                if (generated && parts.isNotEmpty()) {
                    // Runs in the ViewModel: a rotation does not abort the comparison.
                    val bestandLaeuft = zustand.bestand.laeuft
                    // Stacked: the choice's label is long and does not fit next to the button
                    // on a 360-dp phone.
                    Column(verticalArrangement = Arrangement.spacedBy(Abstaende.tiny)) {
                        // Outlined: a second filled button fought with "Bauliste erstellen"
                        // over being the main action.
                        OutlinedButton(
                            onClick = onLadeBestand,
                            enabled = !bestandLaeuft,
                            colors = nebenKnopfFarben(),
                            border = nebenKnopfRand(!bestandLaeuft),
                        ) {
                            // Only the icon turns into a spinner, the label stays: otherwise
                            // the button would shrink and the row would jump. Spinner and icon are
                            // both 16 dp wide.
                            if (bestandLaeuft) CircularProgressIndicator(Modifier.size(16.dp), strokeWidth = 2.dp)
                            else Icon(Icons.Default.Inventory2, null, Modifier.size(withFont(16.dp)))
                            Spacer(Modifier.width(Abstaende.tiny))
                            Text(stringResource(R.string.partslist_fill_owned))
                        }
                        BoxRow(stringResource(R.string.partslist_only_loose), onlyLose, onNurLose)
                        // Second choice, a different question: the first says WHICH KIND of
                        // parts counts, this one says WHOSE. Both act
                        // together — "nur manuell erfasste" plus "mit
                        // Unterkonten" counts the manually entered parts of the
                        // whole household.
                        if (hatUnterkonten) {
                            BoxRow(stringResource(R.string.partslist_include_subs), withSubAccounts, onMitUnterkonten)
                        }
                    }
                }

                if (status.isNotBlank()) {
                    Text(status, Modifier.announce(), style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant)
                }

                // Live countdown while the PDF is being created (only while an export is running).
                pdfStatus?.let { txt ->
                    // Sichtbar jede Sekunde, angesagt alle zehn.
                    ThrottledAnnouncement(txt)
                    Text(txt, Modifier.clearAndSetSemantics { contentDescription = txt }, style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.primary)
                }
            }
        }

        if (!generated || parts.isEmpty()) {
            // The same empty state as every list (StateHint): centered, with a border.
            if (!isLoading) StateHint {
                HintText(Icons.AutoMirrored.Filled.ListAlt,
                    stringResource(R.string.partslist_empty_title), stringResource(R.string.partslist_empty_hint))
            }
            return@Column
        }

        // Grouping and sorting memoized: `parts` rarely changes on a recomposition.
        val colorGroups = remember(parts) { buildListsGroups(parts) }
        val withInventory = parts.any { it.vorhanden != null }
        LazyColumn(state = listState, contentPadding = PaddingValues(Abstaende.mittel), verticalArrangement = Arrangement.spacedBy(Abstaende.gross)) {
            if (withInventory) item(key = "legende") { BuildListsLegend() }
            colorGroups.forEachIndexed { groupIdx, (colorName, colorParts) ->
                item(key = "header_${groupIdx}_$colorName") {
                    FarbGroupsHeader(colorName, colorParts)
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
