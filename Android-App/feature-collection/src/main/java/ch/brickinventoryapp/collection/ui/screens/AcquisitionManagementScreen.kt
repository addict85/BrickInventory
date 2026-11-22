package ch.brickinventoryapp.collection.ui.screens

import ch.brickinventoryapp.model.util.calendarDay
import java.time.Instant
import java.time.ZoneOffset
import androidx.compose.runtime.remember
import ch.brickinventoryapp.model.ui.laedt
import ch.brickinventoryapp.model.domain.Waehrung
import ch.brickinventoryapp.model.domain.Postenart
import ch.brickinventoryapp.model.domain.Zustand
import ch.brickinventoryapp.ui.components.Prompt
import ch.brickinventoryapp.ui.components.UndoMessage
import ch.brickinventoryapp.ui.components.DetailTopAppBar
import ch.brickinventoryapp.state.ui.ManualItemDetailUiState
import ch.brickinventoryapp.state.ui.ScopeUiState
import ch.brickinventoryapp.session.AppUiState
import ch.brickinventoryapp.state.ui.viewmodel.KaeufeAktionen
import ch.brickinventoryapp.model.domain.KaufAnsicht
import ch.brickinventoryapp.ui.theme.Formen
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
import ch.brickinventoryapp.state.ui.viewmodel.KaeufeViewModel
import ch.brickinventoryapp.ui.util.fmtMoney
import ch.brickinventoryapp.ui.util.NumericInput
import ch.brickinventoryapp.ui.theme.Abstaende
import ch.brickinventoryapp.ui.theme.Lesebreite
import ch.brickinventoryapp.ui.theme.centeredUntil
import ch.brickinventoryapp.ui.components.MitTooltip
import ch.brickinventoryapp.model.domain.OHNE_FARBE
import ch.brickinventoryapp.ui.util.fmtEingabe
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
    vm: KaeufeViewModel,
    type: Postenart,
    id: String,
    colorId: Int = OHNE_FARBE,
    title: String,
    onBack: () -> Unit
) {
    val state by vm.state.collectAsStateWithLifecycle()
    val blick by vm.blickfeld.collectAsStateWithLifecycle()
    val manDetailState by remember(type, id, colorId) { vm.purchasesOf(type, id, colorId) }.collectAsStateWithLifecycle()
    val weg = vm.purchaseRoute.wert.collectAsStateWithLifecycle().value
    val meldung = remember { SnackbarHostState() }
    UndoMessage(weg, stringResource(R.string.acq_geloescht), meldung, vm.purchaseRoute::rueckgaengig, vm.purchaseRoute::ausfuehren)
    AcquisitionManagementScreen(KaeufeZustand(state, blick, manDetailState, weg?.purchaseId), vm, type, id, colorId, title, onBack,
        meldung)
}

/** What purchase management shows: one state for sets, parts and figures. */
internal data class KaeufeZustand(
    val state: AppUiState,
    val blick: ScopeUiState,
    val manDetailState: ManualItemDetailUiState,
    /** The purchase whose deletion currently offers "Undo"; it's already missing from the list. */
    val routePurchaseId: Int? = null,
)

@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun AcquisitionManagementScreen(
    zustand: KaeufeZustand,
    aktionen: KaeufeAktionen,
    type: Postenart,
    id: String,             // setNumber / partNumber / figNumber
    colorId: Int = OHNE_FARBE,
    title: String,
    onBack: () -> Unit,
    meldung: SnackbarHostState = remember { SnackbarHostState() },
) {
    val state = zustand.state
    val blick = zustand.blick
    val currency = state.currency
    val manDetailState = zustand.manDetailState

    val acquisitions = manDetailState.acquisitions.filterNot { it.id == zustand.routePurchaseId }
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
    val isLoading    = manDetailState.purchasesFetch.laedt

    Scaffold(
        snackbarHost = { SnackbarHost(meldung) },
        topBar = {
            // The title is a part or set name: two lines instead of a hard cut-off.
            DetailTopAppBar(title, onBack, schliessen = false)
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
            Modifier.fillMaxSize().padding(innerPadding).centeredUntil(Lesebreite.formular),
            contentPadding = PaddingValues(Abstaende.gross),
            verticalArrangement = Arrangement.spacedBy(Abstaende.mittel)
        ) {
            // No column headers: quantity and price sit side by side, the condition below;
            // headers over three columns matched none of the rows. Every field carries its own
            // label.
            moveMessage?.let { msg ->
                item {
                    Text(msg, style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.padding(vertical = Abstaende.tiny))
                }
            }

            items(acquisitions, key = { it.id }) { acq ->
                AcquisitionManagementRow(
                    acquisition = acq,
                    currency = currency,
                    onSave = { price, cond, qty, date ->
                        when (type) {
                            Postenart.SET  -> aktionen.updateAcquisition(id, acq.id, price, cond, qty, date)
                            else   -> aktionen.updateManualAcquisition(type, id, colorId, acq.id, price, cond, qty, date)
                        }
                        // Reload after save to reflect server-side changes (e.g. market price fill);
                        // the ViewModel already reloads date changes on its own.
                        if (price == null && date == null) {
                            if (type == Postenart.SET) aktionen.loadAcquisitions(id)
                            else aktionen.loadManualAcquisitions(type, id, colorId)
                        }
                    },
                    onDelete = { aktionen.purchaseDeleteReserve(type, id, colorId, acq.id) }
                )
                // ── Owner of this row ──
                //
                // The purchase price is the level at which a copy exists: three entries
                // are three purchases, which can belong to different children. For sets, manual
                // parts and minifigures — the only way to move inventory between accounts.
                if (blick.householdMembers.size > 1) {
                    OwnerPicker(
                        members = blick.householdMembers,
                        selected = acq.ownerUserId ?: blick.householdMembers.firstOrNull { it.isSelf }?.id,
                        onSelect = { target ->
                            // acq.ownerUserId only for comparison — the
                            // server determines the sender from the row.
                            if (target != acq.ownerUserId) aktionen.changeAcquisitionOwner(
                                type, id, colorId, acq.id, target
                            ) { err, teile, figuren ->
                                // After the switch the list no longer matches:
                                // the row now belongs to the other account.
                                if (type == Postenart.SET) aktionen.loadAcquisitions(id)
                                else aktionen.loadManualAcquisitions(type, id, colorId)
                                // The numbers come from the response, otherwise the message said "0
                                // parts" even when hundreds move. Two numbers, two
                                // matches: a <plurals> only matches one,
                                // hence two fragments in one frame.
                                moveMessage = err ?: res.getString(
                                    R.string.household_move_ok,
                                    res.getQuantityString(R.plurals.household_move_parts, teile, teile),
                                    res.getQuantityString(R.plurals.household_move_minifigs, figuren, figuren))
                            }
                        },
                        modifier = Modifier.padding(top = Abstaende.tiny)
                    )
                }
                HorizontalDivider()
            }

            // The total comes from the server and still counts a pending purchase.
            if (acquisitions.size > 1 && zustand.routePurchaseId == null) {
                item {
                    Row(
                        Modifier.fillMaxWidth().padding(top = Abstaende.tiny),
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
internal fun Kaufdatum(createdAt: Instant?, changeOn: () -> Unit) {
    Row(
        // heightIn instead of minimumInteractiveComponentSize: that only enlarges the tap area around the
        // button, the button surface itself stayed 44 dp (PurchaseDateTest).
        Modifier
            .heightIn(min = 48.dp)
            .clickable(onClickLabel = stringResource(R.string.acq_kaufdatum_aendern), role = Role.Button, onClick = changeOn)
            .padding(vertical = Abstaende.tiny),
        horizontalArrangement = Arrangement.spacedBy(Abstaende.klein),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(stringResource(R.string.acq_gekauft_am), style = MaterialTheme.typography.labelMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant)
        Text(fmtTag(createdAt) ?: "—", style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.primary, fontWeight = FontWeight.SemiBold)
    }
}

@Composable
@OptIn(ExperimentalMaterial3Api::class)
private fun AcquisitionManagementRow(
    acquisition: KaufAnsicht,
    currency: Waehrung,
    onSave: (price: Double?, cond: Zustand?, qty: Int?, date: String?) -> Unit,
    onDelete: () -> Unit
) {
    var qtyText   by remember(acquisition.id) { mutableStateOf(acquisition.quantity.toString()) }
    var priceText by remember(acquisition.id) {
        mutableStateOf(acquisition.effectivePrice?.let { fmtEingabe(it) } ?: "")
    }
    var condition by remember(acquisition.id) { mutableStateOf(acquisition.condition) }
    val estimatedText = stringResource(R.string.acq_preis_geschaetzt)
    var showDeleteConfirm by rememberSaveable { mutableStateOf(false) }
    val focusManager = LocalFocusManager.current

    // Capture unsaved input: onFocusChanged for the normal case,
    // DisposableEffect for navigating back. lastSaved prevents a double save
    // and deletion just by tapping an empty field.
    var lastSavedPrice by remember(acquisition.id) {
        mutableStateOf(acquisition.effectivePrice?.let { fmtEingabe(it) } ?: "")
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
            titel = stringResource(R.string.acq_delete_question),
            text = stringResource(R.string.acq_delete_text),
            bestaetigen = stringResource(R.string.common_delete),
            onBestaetigen = { showDeleteConfirm = false; onDelete() },
            onAbbrechen = { showDeleteConfirm = false },
        )
    }

    var showDatePicker by remember(acquisition.id) { mutableStateOf(false) }
    Kaufdatum(acquisition.createdAt) { showDatePicker = true }
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
        Modifier.fillMaxWidth().padding(bottom = Abstaende.tiny),
        horizontalArrangement = Arrangement.spacedBy(Abstaende.klein),
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
            keyboardOptions = NumericInput.ganzzahlTastatur(ImeAction.Done),
            keyboardActions = KeyboardActions(
                onDone = { focusManager.clearFocus(); flushPending() }
            ),
            shape = Formen.etikett
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
            shape = Formen.etikett
        )

        // Delete
        MitTooltip(stringResource(R.string.acq_delete_title)) {
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
        modifier = Modifier.padding(bottom = Abstaende.klein),
    )
    }
}

/** Width of the quantity field: room for "×", three digits and the "Quantity" label. */
private val COUNT_WIDTH = 96.dp
