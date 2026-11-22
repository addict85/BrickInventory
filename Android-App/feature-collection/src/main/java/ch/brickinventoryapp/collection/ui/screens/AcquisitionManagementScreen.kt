package ch.brickinventoryapp.collection.ui.screens

import ch.brickinventoryapp.model.util.calendarDay
import java.time.Instant
import java.time.ZoneOffset
import androidx.compose.runtime.remember
import ch.brickinventoryapp.model.ui.loading
import ch.brickinventoryapp.model.domain.CurrencyCode
import ch.brickinventoryapp.model.domain.ItemKind
import ch.brickinventoryapp.model.domain.Condition
import ch.brickinventoryapp.ui.components.Prompt
import ch.brickinventoryapp.ui.components.UndoMessage
import ch.brickinventoryapp.ui.components.DetailTopAppBar
import ch.brickinventoryapp.state.ui.ManualItemDetailUiState
import ch.brickinventoryapp.state.ui.ScopeUiState
import ch.brickinventoryapp.session.AppUiState
import ch.brickinventoryapp.state.ui.viewmodel.PurchasesActions
import ch.brickinventoryapp.model.domain.PurchaseView
import ch.brickinventoryapp.ui.theme.Shapes
import androidx.compose.foundation.clickable
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import ch.brickinventoryapp.resources.R
import ch.brickinventoryapp.state.ui.viewmodel.PurchasesViewModel
import ch.brickinventoryapp.ui.util.fmtMoney
import ch.brickinventoryapp.ui.util.NumericInput
import ch.brickinventoryapp.ui.theme.Spacing
import ch.brickinventoryapp.ui.theme.ReadingWidth
import ch.brickinventoryapp.ui.theme.centeredUntil
import ch.brickinventoryapp.ui.components.WithTooltip
import ch.brickinventoryapp.model.domain.WITHOUT_COLOR
import ch.brickinventoryapp.ui.util.fmtInput
import ch.brickinventoryapp.ui.util.fmtTag
import ch.brickinventoryapp.shared.ui.ConditionToggle
import ch.brickinventoryapp.shared.ui.OwnerPicker

/**
 * Its own screen for purchase-price management — analogous to the web app's acq-modal,
 * for sets, parts and minifigures. The
 * editable rows live in this file (AcquisitionManagementRow further
 * below).
 */
@Composable
fun AcquisitionManagementRoute(
    vm: PurchasesViewModel,
    type: ItemKind,
    id: String,
    colorId: Int = WITHOUT_COLOR,
    title: String,
    onBack: () -> Unit
) {
    val state by vm.state.collectAsStateWithLifecycle()
    val glance by vm.viewport.collectAsStateWithLifecycle()
    val manDetailState by remember(type, id, colorId) { vm.purchasesOf(type, id, colorId) }.collectAsStateWithLifecycle()
    val gone = vm.purchaseRoute.value.collectAsStateWithLifecycle().value
    val message = remember { SnackbarHostState() }
    UndoMessage(gone, stringResource(R.string.acq_deleted), message, vm.purchaseRoute::undo, vm.purchaseRoute::execute)
    AcquisitionManagementScreen(PurchasesState(state, glance, manDetailState, gone?.purchaseId), vm, type, id, colorId, title, onBack,
        message)
}

/** What purchase management shows: one state for sets, parts and figures. */
internal data class PurchasesState(
    val state: AppUiState,
    val glance: ScopeUiState,
    val manDetailState: ManualItemDetailUiState,
    /** The purchase whose deletion currently offers "Undo"; it's already missing from the list. */
    val routePurchaseId: Int? = null,
)

@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun AcquisitionManagementScreen(
    condition: PurchasesState,
    actions: PurchasesActions,
    type: ItemKind,
    id: String,             // setNumber / partNumber / figNumber
    colorId: Int = WITHOUT_COLOR,
    title: String,
    onBack: () -> Unit,
    message: SnackbarHostState = remember { SnackbarHostState() },
) {
    val state = condition.state
    val glance = condition.glance
    val currency = state.currency
    val manDetailState = condition.manDetailState

    val acquisitions = manDetailState.acquisitions.filterNot { it.id == condition.routePurchaseId }
    // Total from the server — the calculation used to sit here, and three more times
    // elsewhere (see utils/acquisitions.ts, acquisitionTotals).
    val totals = manDetailState.acquisitionTotals
    // Feedback after an owner change — the server says whether and what
    // moved along.
    var moveMessage by remember { mutableStateOf<String?>(null) }
    // For the success message with the real numbers from the response. Not
    // `LocalContext.current.getString`: a grabbed context delivers stale values after a
    // config change (Lint: LocalContextGetResourceValueCall).
    // `stringResource` doesn't work, because the numbers only exist in the response;
    // LocalResources is the config-aware form.
    val res = androidx.compose.ui.platform.LocalResources.current
    val isLoading    = manDetailState.purchasesFetch.loading

    Scaffold(
        snackbarHost = { SnackbarHost(message) },
        topBar = {
            // The title is a part or set name: two lines instead of a hard cut-off.
            DetailTopAppBar(title, onBack, close = false)
        }
    ) { innerPadding ->
        if (isLoading && acquisitions.isEmpty()) {
            Box(Modifier.fillMaxSize().padding(innerPadding), Alignment.Center) {
                CircularProgressIndicator()
            }
            return@Scaffold
        }

        if (acquisitions.isEmpty()) {
            Box(Modifier.fillMaxSize().padding(innerPadding), Alignment.Center) {
                Text("—", color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            return@Scaffold
        }

        // Centered at form width on the tablet, like settings: above 1200 dp
        // quantity and price in one row sat too far apart to read together.
        LazyColumn(
            Modifier.fillMaxSize().padding(innerPadding).centeredUntil(ReadingWidth.form),
            contentPadding = PaddingValues(Spacing.large),
            verticalArrangement = Arrangement.spacedBy(Spacing.medium)
        ) {
            // No column headers: quantity and price sit side by side, the condition below;
            // headers over three columns matched none of the rows. Every field carries its own
            // label.
            moveMessage?.let { msg ->
                item {
                    Text(msg, style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.padding(vertical = Spacing.tiny))
                }
            }

            items(acquisitions, key = { it.id }) { acq ->
                AcquisitionManagementRow(
                    acquisition = acq,
                    currency = currency,
                    onSave = { price, cond, qty, date ->
                        when (type) {
                            ItemKind.SET  -> actions.updateAcquisition(id, acq.id, price, cond, qty, date)
                            else   -> actions.updateManualAcquisition(type, id, colorId, acq.id, price, cond, qty, date)
                        }
                        // Reload after save to reflect server-side changes (e.g. market price fill);
                        // the ViewModel already reloads date changes on its own.
                        if (price == null && date == null) {
                            if (type == ItemKind.SET) actions.loadAcquisitions(id)
                            else actions.loadManualAcquisitions(type, id, colorId)
                        }
                    },
                    onDelete = { actions.purchaseDeleteReserve(type, id, colorId, acq.id) }
                )
                // ── Owner of this row ──
                //
                // The purchase price is the level at which a copy exists: three entries
                // are three purchases, which can belong to different children. For sets, manual
                // parts and minifigures — the only way to move inventory between accounts.
                if (glance.householdMembers.size > 1) {
                    OwnerPicker(
                        members = glance.householdMembers,
                        selected = acq.ownerUserId ?: glance.householdMembers.firstOrNull { it.isSelf }?.id,
                        onSelect = { target ->
                            // acq.ownerUserId only for comparison — the
                            // server determines the sender from the row.
                            if (target != acq.ownerUserId) actions.changeAcquisitionOwner(
                                type, id, colorId, acq.id, target
                            ) { err, parts, figures ->
                                // After the switch the list no longer matches:
                                // the row now belongs to the other account.
                                if (type == ItemKind.SET) actions.loadAcquisitions(id)
                                else actions.loadManualAcquisitions(type, id, colorId)
                                // The numbers come from the response, otherwise the message said "0
                                // parts" even when hundreds move. Two numbers, two
                                // matches: a <plurals> only matches one,
                                // hence two fragments in one frame.
                                moveMessage = err ?: res.getString(
                                    R.string.household_move_ok,
                                    res.getQuantityString(R.plurals.household_move_parts, parts, parts),
                                    res.getQuantityString(R.plurals.household_move_minifigs, figures, figures))
                            }
                        },
                        modifier = Modifier.padding(top = Spacing.tiny)
                    )
                }
                HorizontalDivider()
            }

            // The total comes from the server and still counts a pending purchase.
            if (acquisitions.size > 1 && condition.routePurchaseId == null) {
                item {
                    Row(
                        Modifier.fillMaxWidth().padding(top = Spacing.tiny),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Text(stringResource(R.string.acq_total_quantity, totals.quantity),
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant)
                        // null means "no purchase price recorded" — the server makes
                        // that distinction, not this view.
                        totals.amount?.let {
                            Text(fmtMoney(it, currency),
                                fontWeight = FontWeight.Bold,
                                color = MaterialTheme.colorScheme.onSurface)
                        }
                    }
                }
            }
        }
    }
}

/**
 * The purchase date with a visible label, as a button at full tap size: a bare
 * date in small type was hard to hit and gave away neither what it was nor
 * that tapping changes it. The form follows the app language like every date (fmtTag).
 */
@Composable
internal fun PurchaseDate(createdAt: Instant?, changeOn: () -> Unit) {
    Row(
        // heightIn instead of minimumInteractiveComponentSize: that only enlarges the tap area around the
        // button, the button surface itself stayed 44 dp (PurchaseDateTest).
        Modifier
            .heightIn(min = 48.dp)
            .clickable(onClickLabel = stringResource(R.string.acq_purchase_date_edit), role = Role.Button, onClick = changeOn)
            .padding(vertical = Spacing.tiny),
        horizontalArrangement = Arrangement.spacedBy(Spacing.small),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(stringResource(R.string.acq_bought_at), style = MaterialTheme.typography.labelMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant)
        Text(fmtTag(createdAt) ?: "—", style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.primary, fontWeight = FontWeight.SemiBold)
    }
}

@Composable
@OptIn(ExperimentalMaterial3Api::class)
private fun AcquisitionManagementRow(
    acquisition: PurchaseView,
    currency: CurrencyCode,
    onSave: (price: Double?, cond: Condition?, qty: Int?, date: String?) -> Unit,
    onDelete: () -> Unit
) {
    var qtyText   by remember(acquisition.id) { mutableStateOf(acquisition.quantity.toString()) }
    var priceText by remember(acquisition.id) {
        mutableStateOf(acquisition.effectivePrice?.let { fmtInput(it) } ?: "")
    }
    var condition by remember(acquisition.id) { mutableStateOf(acquisition.condition) }
    val estimatedText = stringResource(R.string.acq_price_estimated)
    var showDeleteConfirm by rememberSaveable { mutableStateOf(false) }
    val focusManager = LocalFocusManager.current

    // Capture unsaved input: onFocusChanged for the normal case,
    // DisposableEffect for navigating back. lastSaved prevents a double save
    // and deletion just by tapping an empty field.
    var lastSavedPrice by remember(acquisition.id) {
        mutableStateOf(acquisition.effectivePrice?.let { fmtInput(it) } ?: "")
    }
    var lastSavedQty by remember(acquisition.id) { mutableStateOf(acquisition.quantity.toString()) }

    // Mirror the current input in a holder: onDispose runs AFTER the
    // last redraw, a directly captured priceText would be stale
    // there.
    val pending = remember(acquisition.id) { mutableStateOf(Pair("", "")) }
    pending.value = Pair(priceText, qtyText)

    /** Saves what has changed — and remembers the new state. */
    fun flushPending() {
        val (curPrice, curQty) = pending.value
        if (curPrice != lastSavedPrice) {
            lastSavedPrice = curPrice
            onSave(NumericInput.readAmount(curPrice), null, null, null)
        }
        if (curQty != lastSavedQty) {
            lastSavedQty = curQty
            onSave(null, null, curQty.toIntOrNull()?.coerceAtLeast(1), null)
        }
    }

    DisposableEffect(acquisition.id) { onDispose { flushPending() } }

    if (showDeleteConfirm) {
        Prompt(
            title = stringResource(R.string.acq_delete_question),
            text = stringResource(R.string.acq_delete_text),
            confirm = stringResource(R.string.common_delete),
            onConfirm = { showDeleteConfirm = false; onDelete() },
            onCancel = { showDeleteConfirm = false },
        )
    }

    var showDatePicker by remember(acquisition.id) { mutableStateOf(false) }
    PurchaseDate(acquisition.createdAt) { showDatePicker = true }
    if (showDatePicker) {
        val initialMillis = remember(acquisition.createdAt) {
            acquisition.createdAt?.calendarDay()?.atStartOfDay(ZoneOffset.UTC)?.toInstant()?.toEpochMilli()
        }
        val dpState = rememberDatePickerState(initialSelectedDateMillis = initialMillis)
        DatePickerDialog(
            onDismissRequest = { showDatePicker = false },
            confirmButton = {
                TextButton(onClick = {
                    showDatePicker = false
                    dpState.selectedDateMillis?.let { ms ->
                        val d = java.time.Instant.ofEpochMilli(ms).atZone(java.time.ZoneOffset.UTC).toLocalDate()
                        onSave(null, null, null, "%04d-%02d-%02d".format(d.year, d.monthValue, d.dayOfMonth))
                    }
                }) { Text(stringResource(R.string.common_ok)) }
            },
            dismissButton = {
                TextButton(onClick = { showDatePicker = false }) { Text(stringResource(R.string.common_cancel)) }
            }
        ) {
            DatePicker(state = dpState)
        }
    }

    Column(Modifier.fillMaxWidth()) {
    Row(
        Modifier.fillMaxWidth().padding(bottom = Spacing.tiny),
        horizontalArrangement = Arrangement.spacedBy(Spacing.small),
        verticalAlignment = Alignment.CenterVertically
    ) {
        // Qty
        OutlinedTextField(
            value = qtyText,
            onValueChange = { qtyText = NumericInput.quantity(it) },
            label = { Text(stringResource(R.string.common_quantity)) },
            prefix = { Text(stringResource(R.string.common_times), fontWeight = FontWeight.Bold) },
            // onFocusChanged in addition to onDone: whoever changes the value and taps back without
            // pressing "Done" would lose the input. Only saved on losing focus
            // if the value has actually changed.
            modifier = Modifier
                .width(COUNT_WIDTH)
                .onFocusChanged { st -> if (!st.isFocused) flushPending() },
            singleLine = true,
            keyboardOptions = NumericInput.integerKeyboard(ImeAction.Done),
            keyboardActions = KeyboardActions(
                onDone = { focusManager.clearFocus(); flushPending() }
            ),
            shape = Shapes.tag
        )

        // Price
        OutlinedTextField(
            value = priceText,
            onValueChange = { priceText = NumericInput.price(it) },
            // See the reasoning at the quantity field: without saving on
            // losing focus, every input would be lost where the user didn't
            // explicitly press "Done" on the keyboard.
            modifier = Modifier
                .weight(1f)
                .onFocusChanged { st -> if (!st.isFocused) flushPending() },
            singleLine = true,
            label = { Text(stringResource(R.string.detail_purchase_price)) },
            placeholder = { Text(stringResource(R.string.detail_price_placeholder), style = MaterialTheme.typography.bodySmall) },
            // A market price the server has filled in is not a paid
            // amount; the "≈" says so, until someone enters the real price.
            prefix = if (acquisition.priceEstimated && priceText.isNotEmpty()) {
                { Text("≈", modifier = Modifier.semantics {
                    contentDescription = estimatedText }) }
            } else null,
            suffix = acquisition.currency?.let { w -> { Text(w.code, style = MaterialTheme.typography.bodySmall) } },
            keyboardOptions = NumericInput.priceKeyboard(),
            keyboardActions = KeyboardActions(
                onDone = { focusManager.clearFocus(); flushPending() }
            ),
            shape = Shapes.tag
        )

        // Delete
        WithTooltip(stringResource(R.string.acq_delete_title)) {
            IconButton(onClick = { showDeleteConfirm = true }) {
                Icon(Icons.Default.Delete, stringResource(R.string.acq_delete_title),
                    tint = MaterialTheme.colorScheme.error, modifier = Modifier.size(20.dp))
            }
        }
    }
    // The condition below quantity and price, full width: in the row the
    // segmented button left the price barely any room on the phone.
    ConditionToggle(
        selected = condition,
        onSelect = { newCond -> condition = newCond; onSave(null, newCond, null, null) },
        modifier = Modifier.padding(bottom = Spacing.small),
    )
    }
}

/** Width of the quantity field: room for "×", three digits and the "Quantity" label. */
private val COUNT_WIDTH = 96.dp
