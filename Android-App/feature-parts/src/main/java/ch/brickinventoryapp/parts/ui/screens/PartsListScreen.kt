package ch.brickinventoryapp.parts.ui.screens

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ListAlt
import androidx.compose.material.icons.filled.*
import androidx.compose.material.icons.filled.Inventory2
import androidx.compose.material3.*
import androidx.compose.material3.SnackbarDuration
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.SnackbarResult
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalResources
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.unit.dp
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import ch.brickinventoryapp.dataapi.parts.partListsSelection
import ch.brickinventoryapp.parts.ui.PartListUiState
import ch.brickinventoryapp.parts.ui.PlPart
import ch.brickinventoryapp.parts.ui.PlSet
import ch.brickinventoryapp.parts.ui.normalized
import ch.brickinventoryapp.parts.ui.viewmodel.PartListViewModel
import ch.brickinventoryapp.resources.R
import ch.brickinventoryapp.ui.components.BoxRow
import ch.brickinventoryapp.ui.components.HintText
import ch.brickinventoryapp.ui.components.Prompt
import ch.brickinventoryapp.ui.components.RemovableChip
import ch.brickinventoryapp.ui.components.ScanButton
import ch.brickinventoryapp.ui.components.StateHint
import ch.brickinventoryapp.ui.components.ThrottledAnnouncement
import ch.brickinventoryapp.ui.components.WithTooltip
import ch.brickinventoryapp.ui.components.announce
import ch.brickinventoryapp.ui.components.secondaryButtonColors
import ch.brickinventoryapp.ui.components.secondaryButtonRand
import ch.brickinventoryapp.ui.components.withFont
import ch.brickinventoryapp.ui.sentence
import ch.brickinventoryapp.ui.theme.Spacing
import ch.brickinventoryapp.ui.util.NumericInput
import ch.brickinventoryapp.uistate.errorMessage
import ch.brickinventoryapp.uistate.loading
import ch.brickinventoryapp.uistate.running
import coil3.ImageLoader

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
    barcodeSetNumber: String?,
    onBarcodeConsumed: () -> Unit,
    requestManualEntry: Boolean,
    onManualEntryAcknowledged: () -> Unit,
    /** Does this account have sub-accounts? Only then does "Unterkonten mit einbeziehen" appear. */
    hasSubAccounts: Boolean = false,
    /** Scroll state from outside: the screen is left on the way to the barcode scanner. */
    listState: LazyListState = rememberLazyListState(),
    /** Shows „removed“ with „Undo“; without one (tests), removing has no undo. */
    snackbar: SnackbarHostState? = null,
    vm: PartListViewModel = hiltViewModel(),
) {
    val condition by vm.uiState.collectAsStateWithLifecycle()
    val pdfStatus by vm.pdfExportStatus.collectAsStateWithLifecycle()
    val ctx = LocalContext.current
    val openWith = stringResource(R.string.pdfexp_open_with)
    LaunchedEffect(barcodeSetNumber) {
        if (barcodeSetNumber != null) {
            vm.addAdd(barcodeSetNumber)
            onBarcodeConsumed()
        }
    }
    // A removed set can come back: the chip had vanished on a single tap, without a trace.
    val removed = condition.removed
    val removedText = removed?.let { stringResource(R.string.partslist_set_removed, it.set.setNumber) }
    val undo = stringResource(R.string.common_undo)
    LaunchedEffect(removed) {
        val r = removed ?: return@LaunchedEffect
        val host = snackbar ?: return@LaunchedEffect
        var back = false
        // finally: leaving the page ends the offer too, it does not come back on returning.
        try {
            back = host.showSnackbar(removedText ?: r.set.setNumber, undo, duration = SnackbarDuration.Long) ==
                SnackbarResult.ActionPerformed
        } finally {
            if (back) vm.undoRemove(r) else vm.removalSeen(r)
        }
    }
    // Offer the finished PDF for sharing once; an Activity start does not belong in the ViewModel.
    LaunchedEffect(condition.pdfFile) {
        if (condition.pdfFile != null) {
            ctx.startActivity(partListsSelection(ctx, openWith))
            vm.pdfOpened()
        }
    }
    PartsListScreen(
        condition = condition,
        serverUrl = serverUrl,
        imageLoader = imageLoader,
        onScanBarcode = onScanBarcode,
        onAdd = vm::addAdd,
        onRemove = vm::remove,
        onEmpty = vm::empty,
        onCreate = vm::createNow,
        onLoadStock = vm::loadInventory,
        onOnlyLose = vm::setOnlyLose,
        onWithSubAccounts = vm::setWithSubAccounts,
        onExportPdf = vm::export,
        onPdfErrorSeen = vm::pdfErrorSeen,
        pdfStatus = pdfStatus,
        hasSubAccounts = hasSubAccounts,
        listState = listState,
        requestManualEntry = requestManualEntry,
        onManualEntryAcknowledged = onManualEntryAcknowledged,
    )
}

// ExperimentalLayoutApi for the FlowRow of the set chips — on the function, because an
// @OptIn in the body does not compile.
@OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)
@Composable
fun PartsListScreen(
    condition: PartListUiState,
    serverUrl: String,
    imageLoader: ImageLoader,
    onScanBarcode: () -> Unit,
    onAdd: (String) -> Unit = {},
    onRemove: (Int) -> Unit = {},
    onEmpty: () -> Unit = {},
    /** Takes the typed number along: one step instead of two. */
    onCreate: (String) -> Unit = {},
    /** "Can I build this?" — fetch one's own stock for this list. */
    onLoadStock: () -> Unit = {},
    onOnlyLose: (Boolean) -> Unit = {},
    onWithSubAccounts: (Boolean) -> Unit = {},
    onExportPdf: () -> Unit = {},
    onPdfErrorSeen: () -> Unit = {},
    /** Progress of the running PDF export ("…noch ~Xs"), null without an export. */
    pdfStatus: String? = null,
    /**
     * Does this account have sub-accounts? Only then does the choice "Unterkonten mit
     * einbeziehen" appear — a switch with no effect is worse than none.
     */
    hasSubAccounts: Boolean = false,
    /**
     * Scroll state from outside: the screen is left on the way to the barcode scanner;
     * a state of its own would be reset on returning.
     */
    listState: LazyListState = rememberLazyListState(),
    /** The scan came back without a set number → cursor into the set field, keyboard open. */
    requestManualEntry: Boolean = false,
    onManualEntryAcknowledged: () -> Unit = {},
) {
    // Only the input field and the open confirmation prompt are the screen's own state; everything
    // else is held by the ViewModel.
    var setInput  by rememberSaveable { mutableStateOf("") }
    var clearAsk by rememberSaveable { mutableStateOf(false) }
    // „Create“ with nothing to create marks the field instead of being greyed out without a reason.
    var setMissing by rememberSaveable { mutableStateOf(false) }
    val setFieldFocus = remember { FocusRequester() }
    val sets = condition.sets
    val parts = condition.parts
    val isLoading = condition.generating.loading
    val status = condition.status?.sentence().orEmpty()
    val generated = condition.generated

    fun addSet(nr: String) {
        onAdd(nr)
        setInput = ""
    }

    fun creating(count: Int) {
        if (count == 0) {
            setMissing = true
            runCatching { setFieldFocus.requestFocus() }
            return
        }
        onCreate(setInput)
        setInput = ""
    }

    if (clearAsk) {
        Prompt(
            title = stringResource(R.string.partslist_reset_title),
            text = stringResource(R.string.partslist_reset_text),
            confirm = stringResource(R.string.partslist_reset),
            onConfirm = { clearAsk = false; onEmpty() },
            onCancel = { clearAsk = false },
        )
    }

    Column(Modifier.fillMaxSize()) {
        FocusOnManualEntry(requestManualEntry, setFieldFocus, onManualEntryAcknowledged)

        // Input row
        Surface(tonalElevation = 2.dp) {
            Column(Modifier.padding(Spacing.medium), verticalArrangement = Arrangement.spacedBy(Spacing.small)) {
                SetInputRow(setInput, { setInput = it; setMissing = false }, setMissing,
                    setFieldFocus, ::addSet, onScanBarcode)

                // The collected sets with their reset: it clears this list and so stands
                // next to it, not floating free below the buttons. Without content it is missing entirely.
                if (sets.isNotEmpty() || generated) CollectedSets(sets, onClearAsk = { clearAsk = true }, onRemove = onRemove)

                // One main action at full width: create, with the number of sets it
                // takes — the typed one included.
                val count = setsToCreate(sets, setInput)
                CreateButton(count, isLoading) { creating(count) }
                if (generated && parts.isNotEmpty()) {
                    PdfButton(condition.pdf.running, condition.pdf.errorMessage?.sentence(), onExportPdf, onPdfErrorSeen)
                    StockSection(condition, hasSubAccounts, onLoadStock, onOnlyLose, onWithSubAccounts)
                }

                PartsListStatus(status, pdfStatus)
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

        BuildList(parts, listState, serverUrl, imageLoader)
    }
}

/** The sets "Create" takes: the collected ones and the typed one, unless it is already among them. */
private fun setsToCreate(sets: List<PlSet>, setInput: String): Int =
    sets.size + (if (setInput.isNotBlank() && sets.none { it.setNumber == normalized(setInput) }) 1 else 0)

/** An unsuccessful scan sets the cursor into the set field: the counterpart to the other screens' entry dialog. */
@Composable
private fun FocusOnManualEntry(requested: Boolean, focus: FocusRequester, onAcknowledged: () -> Unit) {
    LaunchedEffect(requested) {
        if (requested) {
            kotlinx.coroutines.delay(120)
            try { focus.requestFocus() } catch (_: Exception) { /* dialog already closed */ }
            onAcknowledged()
        }
    }
}

/** The set number with "+", and the scan button next to it. */
@Composable
private fun SetInputRow(
    setInput: String,
    onInput: (String) -> Unit,
    setMissing: Boolean,
    focus: FocusRequester,
    onAdd: (String) -> Unit,
    onScan: () -> Unit,
) {
    Row(horizontalArrangement = Arrangement.spacedBy(Spacing.small), verticalAlignment = Alignment.CenterVertically) {
        OutlinedTextField(
            value = setInput,
            // Filter and keyboard choice like every set-number field (util/NumericInput.kt).
            // "Fertig" and the "+" in the field take the set into the list: one way in,
            // one button to create it.
            onValueChange = { onInput(NumericInput.setNumber(it)) },
            keyboardOptions = NumericInput.setNumberKeyboard(ImeAction.Done),
            keyboardActions = KeyboardActions(onDone = { if (setInput.isNotBlank()) onAdd(setInput) }),
            // Label instead of placeholder: the long placeholder wrapped into two
            // lines in the field and disappeared while typing.
            label = { Text(stringResource(R.string.gallery_set_number)) },
            isError = setMissing,
            supportingText = if (setMissing) {
                { Text(stringResource(R.string.partslist_set_missing), Modifier.announce()) }
            } else null,
            modifier = Modifier.weight(1f).focusRequester(focus),
            singleLine = true,
            shape = MaterialTheme.shapes.large,
            trailingIcon = {
                if (setInput.isNotBlank()) WithTooltip(stringResource(R.string.partslist_add_set)) {
                    IconButton(onClick = { onAdd(setInput) }) {
                        Icon(Icons.Default.Add, stringResource(R.string.partslist_add_set))
                    }
                }
            }
        )
        // The same scan button as next to every search; a floating button in the middle
        // of a row looked like the screen's one main button.
        ScanButton(onScan)
    }
}

/**
 * The collected sets with their reset: it clears this list and so stands
 * next to it, not floating free below the buttons.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun CollectedSets(sets: List<PlSet>, onClearAsk: () -> Unit, onRemove: (Int) -> Unit) {
    val quantities = LocalResources.current
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        Text(quantities.getQuantityString(R.plurals.partslist_sets_in_list, sets.size, sets.size),
            style = MaterialTheme.typography.labelLarge,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.weight(1f))
        // With a confirmation prompt: resetting discards the sets and the created list.
        TextButton(
            onClick = onClearAsk,
            colors = ButtonDefaults.textButtonColors(contentColor = MaterialTheme.colorScheme.error),
        ) { Text(stringResource(R.string.partslist_reset)) }
    }
    FlowRow(
        horizontalArrangement = Arrangement.spacedBy(6.dp),
        verticalArrangement = Arrangement.spacedBy(Spacing.tiny)
    ) {
        sets.forEachIndexed { i, s ->
            RemovableChip(
                label = if (s.name.isNotBlank() && s.name != s.setNumber) "${s.setNumber} — ${s.name}" else s.setNumber,
                removeLabel = stringResource(R.string.partslist_remove_set, s.setNumber),
                onRemove = { onRemove(i) },
            )
        }
    }
}

/** "Create" with the number of sets as a badge; the icon turns into a spinner while it runs. */
@Composable
private fun CreateButton(count: Int, isLoading: Boolean, onCreate: () -> Unit) {
    Button(
        onClick = onCreate,
        enabled = !isLoading,
        modifier = Modifier.fillMaxWidth(),
    ) {
        // Only the icon turns into a spinner, the label stays: otherwise
        // the button would shrink and the row would jump. Spinner and icon are
        // both 16 dp wide.
        if (isLoading) CircularProgressIndicator(Modifier.size(16.dp),
            color = MaterialTheme.colorScheme.onPrimary, strokeWidth = 2.dp)
        else Icon(Icons.AutoMirrored.Filled.ListAlt, null, Modifier.size(withFont(16.dp)))
        Spacer(Modifier.width(Spacing.tiny))
        Text(stringResource(R.string.partslist_generate))
        // The number as a badge: "(2 Sets)" wrapped into a second line at 200 %.
        if (count > 0) {
            val announced = pluralStringResource(R.plurals.partslist_generate_count, count, count)
            Spacer(Modifier.width(Spacing.small))
            Badge(
                containerColor = MaterialTheme.colorScheme.onPrimary,
                contentColor = MaterialTheme.colorScheme.primary,
                modifier = Modifier.clearAndSetSemantics { contentDescription = announced },
            ) { Text("$count", style = MaterialTheme.typography.labelMedium) }
        }
    }
}

/**
 * Own stock in a row of its own: the row above puts the list together, the stock enters numbers
 * into the finished list. "nur lose Teile" stands next to the button, because the choice changes
 * from question to question.
 */
@Composable
private fun StockSection(
    condition: PartListUiState,
    hasSubAccounts: Boolean,
    onLoadStock: () -> Unit,
    onOnlyLose: (Boolean) -> Unit,
    onWithSubAccounts: (Boolean) -> Unit,
) {
    val onlyLose = condition.onlyLose
    val withSubAccounts = condition.withSubAccounts
    // Runs in the ViewModel: a rotation does not abort the comparison.
    val stockRunning = condition.stock.running
    // Stacked: the choice's label is long and does not fit next to the button
    // on a 360-dp phone.
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.tiny)) {
        // Outlined: a second filled button fought with "Bauliste erstellen"
        // over being the main action.
        OutlinedButton(
            onClick = onLoadStock,
            enabled = !stockRunning,
            colors = secondaryButtonColors(),
            border = secondaryButtonRand(!stockRunning),
        ) {
            // Only the icon turns into a spinner, the label stays: otherwise
            // the button would shrink and the row would jump. Spinner and icon are
            // both 16 dp wide.
            if (stockRunning) CircularProgressIndicator(Modifier.size(16.dp), strokeWidth = 2.dp)
            else Icon(Icons.Default.Inventory2, null, Modifier.size(withFont(16.dp)))
            Spacer(Modifier.width(Spacing.tiny))
            Text(stringResource(R.string.partslist_fill_owned))
        }
        BoxRow(stringResource(R.string.partslist_only_loose), onlyLose, onOnlyLose)
        // Second choice, a different question: the first says WHICH KIND of
        // parts counts, this one says WHOSE. Both act
        // together — "nur manuell erfasste" plus "mit
        // Unterkonten" counts the manually entered parts of the
        // whole household.
        if (hasSubAccounts) {
            BoxRow(stringResource(R.string.partslist_include_subs), withSubAccounts, onWithSubAccounts)
        }
    }
}

/** The last status sentence and, while the PDF is being created, its live countdown. */
@Composable
private fun PartsListStatus(status: String, pdfStatus: String?) {
    if (status.isNotBlank()) {
        Text(status, Modifier.announce(), style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant)
    }

    // Live countdown while the PDF is being created (only while an export is running).
    pdfStatus?.let { txt ->
        // Visible every second, announced every ten.
        ThrottledAnnouncement(txt)
        Text(txt, Modifier.clearAndSetSemantics { contentDescription = txt }, style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.primary)
    }
}

/** The finished list, grouped by color; with stock, the legend on top. */
@Composable
private fun BuildList(parts: List<PlPart>, listState: LazyListState, serverUrl: String, imageLoader: ImageLoader) {
    // Grouping and sorting memoized: `parts` rarely changes on a recomposition.
    val colorGroups = remember(parts) { buildListsGroups(parts) }
    val withInventory = parts.any { it.present != null }
    LazyColumn(state = listState, contentPadding = PaddingValues(Spacing.medium), verticalArrangement = Arrangement.spacedBy(Spacing.large)) {
        if (withInventory) item(key = "legende") { BuildListsLegend() }
        colorGroups.forEachIndexed { groupIdx, (colorName, colorParts) ->
            item(key = "header_${groupIdx}_$colorName") {
                ColorGroupsHeader(colorName, colorParts)
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
