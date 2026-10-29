package ch.brickinventoryapp.ui.screens

import ch.brickinventoryapp.ui.theme.Formen
import androidx.compose.foundation.clickable
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import ch.brickinventoryapp.R
import ch.brickinventoryapp.data.model.Acquisition
import ch.brickinventoryapp.ui.viewmodel.KaeufeViewModel
import ch.brickinventoryapp.util.fmtMoney
import ch.brickinventoryapp.util.NumericInput
import ch.brickinventoryapp.ui.theme.Abstaende

/**
 * Eigener Screen für die Kaufpreis-Verwaltung — analog zum acq-modal der Webapp,
 * für Sets (type="set"), Teile (type="part") und Minifiguren (type="fig"). Die
 * editierbaren Zeilen stehen in dieser Datei (AcquisitionManagementRow weiter
 * unten).
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AcquisitionManagementScreen(
    vm: KaeufeViewModel,
    type: String,           // "set" | "part" | "fig"
    id: String,             // setNumber / partNumber / figNumber
    colorId: Int = 0,
    title: String,
    onBack: () -> Unit
) {
    val state by vm.state.collectAsStateWithLifecycle()
    val blick by vm.blickfeld.collectAsStateWithLifecycle()
    val currency = state.currency

    // Ein Zustand für Sets, Teile und Figuren (KaeufeViewModel).
    val manDetailState by vm.manDetailState.collectAsStateWithLifecycle()

    val acquisitions = manDetailState.acquisitions
    // Summe vom Server — die Rechnung stand vorher hier und noch dreimal
    // woanders (siehe utils/acquisitions.ts, acquisitionTotals).
    val totals = manDetailState.acquisitionTotals
    // Rückmeldung nach einem Eigentümerwechsel — der Server sagt, ob und was
    // mitgewandert ist.
    var moveMessage by remember { mutableStateOf<String?>(null) }
    // Für die Erfolgsmeldung mit den echten Zahlen aus der Antwort.
    val ctx = LocalContext.current
    // Nicht `ctx.getString`: Ein gegriffener Context liefert nach einem
    // Konfigurationswechsel veraltete Werte (Lint: LocalContextGetResourceValueCall).
    // `stringResource` geht nicht, weil die Zahlen erst in der Antwort entstehen;
    // LocalResources ist die konfigurationsbewusste Form.
    val res = androidx.compose.ui.platform.LocalResources.current
    val isLoading    = manDetailState.isLoading

    LaunchedEffect(type, id, colorId) {
        when (type) {
            "set"  -> vm.loadAcquisitions(id)
            else   -> vm.loadManualAcquisitions(type, id, colorId)
        }
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(title, fontWeight = FontWeight.Bold, maxLines = 1) },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, stringResource(R.string.common_back))
                    }
                }
            )
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

        LazyColumn(
            Modifier.fillMaxSize().padding(innerPadding),
            contentPadding = PaddingValues(Abstaende.gross),
            verticalArrangement = Arrangement.spacedBy(Abstaende.mittel)
        ) {
            // Header row
            item {
                Row(
                    Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(Abstaende.klein),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Text(stringResource(R.string.common_quantity),
                        Modifier.width(72.dp),
                        style = MaterialTheme.typography.labelMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        fontWeight = FontWeight.Bold)
                    Text(stringResource(R.string.common_condition),
                        Modifier.weight(1f),
                        style = MaterialTheme.typography.labelMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        fontWeight = FontWeight.Bold,
                        textAlign = TextAlign.Center)
                    Text(stringResource(R.string.detail_purchase_price),
                        Modifier.weight(1f),
                        style = MaterialTheme.typography.labelMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        fontWeight = FontWeight.Bold,
                        textAlign = TextAlign.End)
                    Spacer(Modifier.width(Abstaende.riesig))
                }
                HorizontalDivider(Modifier.padding(top = Abstaende.winzig), thickness = 2.dp)
            }

            moveMessage?.let { msg ->
                item {
                    Text(msg, style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.padding(vertical = Abstaende.winzig))
                }
            }

            items(acquisitions, key = { it.id }) { acq ->
                AcquisitionManagementRow(
                    acquisition = acq,
                    currency = currency,
                    onSave = { price, cond, qty, date ->
                        when (type) {
                            "set"  -> vm.updateAcquisition(id, acq.id, price, cond, qty, date)
                            else   -> vm.updateManualAcquisition(type, id, colorId, acq.id, price, cond, qty, date)
                        }
                        // Reload after save to reflect server-side changes (e.g. market price fill);
                        // Datumsänderungen lädt das ViewModel bereits selbst neu.
                        if (price == null && date == null) {
                            if (type == "set") vm.loadAcquisitions(id)
                            else vm.loadManualAcquisitions(type, id, colorId)
                        }
                    },
                    onDelete = {
                        when (type) {
                            "set"  -> vm.deleteAcquisition(id, acq.id)
                            else   -> vm.deleteManualAcquisition(type, id, colorId, acq.id)
                        }
                    }
                )
                // ── Eigentümer dieser Zeile ──
                //
                // Der Kaufpreis ist die Ebene, auf der ein Exemplar existiert: Drei Erfassungen
                // sind drei Käufe, die verschiedenen Kindern gehören können. Für Sets, manuelle
                // Teile und Minifiguren — der einzige Weg, Bestand zwischen Konten zu verschieben.
                if (blick.householdMembers.size > 1) {
                    OwnerPicker(
                        members = blick.householdMembers,
                        selected = acq.ownerUserId ?: blick.householdMembers.firstOrNull { it.isSelf }?.id,
                        onSelect = { target ->
                            // acq.ownerUserId nur für den Vergleich — der
                            // Server ermittelt den Absender aus der Zeile.
                            if (target != acq.ownerUserId) vm.changeAcquisitionOwner(
                                type, id, colorId, acq.id, target
                            ) { err, teile, figuren ->
                                // Nach dem Wechsel stimmt die Liste nicht mehr:
                                // Die Zeile liegt jetzt beim anderen Konto.
                                if (type == "set") vm.loadAcquisitions(id)
                                else vm.loadManualAcquisitions(type, id, colorId)
                                // Die Zahlen kommen aus der Antwort, sonst sagte die Meldung „0
                                // Teile“, auch wenn hunderte wandern. Zwei Zahlen, zwei
                                // Übereinstimmungen: Ein <plurals> stimmt nur mit einer überein,
                                // darum zwei Bruchstücke in einem Rahmen.
                                moveMessage = err ?: res.getString(
                                    R.string.household_move_ok,
                                    res.getQuantityString(R.plurals.household_move_parts, teile, teile),
                                    res.getQuantityString(R.plurals.household_move_minifigs, figuren, figuren))
                            }
                        },
                        modifier = Modifier.padding(top = Abstaende.winzig)
                    )
                }
                HorizontalDivider()
            }

            // Summary row
            if (acquisitions.size > 1) {
                item {
                    Row(
                        Modifier.fillMaxWidth().padding(top = Abstaende.winzig),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Text(stringResource(R.string.acq_total_quantity, totals.quantity),
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant)
                        // null heisst „kein Kaufpreis erfasst" — die Unterscheidung
                        // trifft der Server, nicht diese Ansicht.
                        totals.amount?.let {
                            Text(fmtMoney(it, currency),
                                fontWeight = FontWeight.Bold,
                                color = MaterialTheme.colorScheme.primary)
                        }
                    }
                }
            }
        }
    }
}

@Composable
@OptIn(ExperimentalMaterial3Api::class)
private fun AcquisitionManagementRow(
    acquisition: Acquisition,
    currency: String,
    onSave: (price: Double?, cond: String?, qty: Int?, date: String?) -> Unit,
    onDelete: () -> Unit
) {
    var qtyText   by remember(acquisition.id) { mutableStateOf(acquisition.quantity.toString()) }
    var priceText by remember(acquisition.id) {
        mutableStateOf(acquisition.effectivePrice?.let { "%.2f".format(it) } ?: "")
    }
    var condition by remember(acquisition.id) { mutableStateOf(acquisition.condition) }
    val geschaetztText = stringResource(R.string.acq_preis_geschaetzt)
    var showDeleteConfirm by rememberSaveable { mutableStateOf(false) }
    val focusManager = LocalFocusManager.current

    // ── Ungespeicherte Eingaben festhalten ──
    //
    // Wer den Preis ändert und oben links auf Zurück tippt, darf die Eingabe nicht
    // verlieren. Zwei Auslöser, weil einer allein nicht reicht:
    //   • onFocusChanged deckt den Normalfall ab (Feld verlassen, anderes Feld antippen, Tastatur schliessen).
    //   • DisposableEffect deckt das Zurücknavigieren ab — ob vorher ein Fokusereignis eintrifft, ist nicht zugesichert.
    //
    // lastSaved verhindert doppeltes Speichern, und ein blosses Antippen ohne Änderung
    // löst nichts aus — bei leerem Feld wäre das ein Schreiben von null, also ein
    // Löschen. effectivePrice, nicht purchasePrice: priceText wird aus effectivePrice
    // gefüllt; mit einer anderen Quelle gälte der Ausgangswert als „geändert“.
    var lastSavedPrice by remember(acquisition.id) {
        mutableStateOf(acquisition.effectivePrice?.let { "%.2f".format(it) } ?: "")
    }
    var lastSavedQty by remember(acquisition.id) { mutableStateOf(acquisition.quantity.toString()) }

    // Aktuelle Eingaben in einem Halter spiegeln: onDispose läuft NACH der
    // letzten Neuzeichnung, ein direkt eingefangenes priceText wäre dort
    // veraltet.
    val pending = remember(acquisition.id) { mutableStateOf(Pair("", "")) }
    pending.value = Pair(priceText, qtyText)

    /** Speichert, was sich geändert hat — und merkt sich den neuen Stand. */
    fun flushPending() {
        val (curPrice, curQty) = pending.value
        if (curPrice != lastSavedPrice) {
            lastSavedPrice = curPrice
            onSave(curPrice.replace(',', '.').toDoubleOrNull(), null, null, null)
        }
        if (curQty != lastSavedQty) {
            lastSavedQty = curQty
            onSave(null, null, curQty.toIntOrNull()?.coerceAtLeast(1), null)
        }
    }

    DisposableEffect(acquisition.id) { onDispose { flushPending() } }

    if (showDeleteConfirm) {
        AlertDialog(
            onDismissRequest = { showDeleteConfirm = false },
            title = { Text(stringResource(R.string.acq_delete_title), fontWeight = FontWeight.Bold) },
            text  = { Text(stringResource(R.string.acq_delete_text)) },
            confirmButton = {
                TextButton(onClick = { showDeleteConfirm = false; onDelete() }) {
                    Text(stringResource(R.string.common_delete),
                        color = MaterialTheme.colorScheme.error)
                }
            },
            dismissButton = {
                TextButton(onClick = { showDeleteConfirm = false }) {
                    Text(stringResource(R.string.common_cancel))
                }
            }
        )
    }

    // Date (Kaufdatum) — antippen zum Ändern
    var showDatePicker by remember(acquisition.id) { mutableStateOf(false) }
    val dateLabel = remember(acquisition.createdAt) {
        acquisition.createdAt?.let { dateStr ->
            runCatching {
                val d = java.time.LocalDate.parse(dateStr.take(10))
                "%02d.%02d.%04d".format(d.dayOfMonth, d.monthValue, d.year)
            }.getOrNull()
        }
    }
    Text(
        dateLabel ?: "—",
        style = MaterialTheme.typography.labelSmall,
        color = MaterialTheme.colorScheme.primary,
        modifier = Modifier
            .padding(top = Abstaende.klein, bottom = Abstaende.haar)
            .clickable(role = Role.Button) { showDatePicker = true }
    )
    if (showDatePicker) {
        val initialMillis = remember(acquisition.createdAt) {
            runCatching {
                java.time.LocalDate.parse(acquisition.createdAt!!.take(10))
                    .atStartOfDay(java.time.ZoneOffset.UTC).toInstant().toEpochMilli()
            }.getOrNull()
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
                }) { Text(stringResource(R.string.partslist_ok)) }
            },
            dismissButton = {
                TextButton(onClick = { showDatePicker = false }) { Text(stringResource(R.string.common_cancel)) }
            }
        ) {
            DatePicker(state = dpState)
        }
    }

    Row(
        Modifier.fillMaxWidth().padding(bottom = Abstaende.winzig),
        horizontalArrangement = Arrangement.spacedBy(Abstaende.klein),
        verticalAlignment = Alignment.CenterVertically
    ) {
        // Qty
        OutlinedTextField(
            value = qtyText,
            onValueChange = { qtyText = NumericInput.quantity(it) },
            prefix = { Text("×", fontWeight = FontWeight.Bold) },
            // onFocusChanged zusätzlich zu onDone: Wer den Wert ändert und zurücktippt, ohne
            // „Fertig“ zu drücken, verlöre die Eingabe. Gespeichert wird beim Fokusverlust
            // nur, wenn sich der Wert geändert hat.
            modifier = Modifier
                .width(72.dp)
                .onFocusChanged { st -> if (!st.isFocused) flushPending() },
            singleLine = true,
            keyboardOptions = NumericInput.ganzzahlTastatur(ImeAction.Done),
            keyboardActions = KeyboardActions(
                onDone = { focusManager.clearFocus(); flushPending() }
            ),
            shape = Formen.etikett
        )

        // Condition toggle
        ConditionToggle(
            selected = condition,
            onSelect = { newCond -> condition = newCond; onSave(null, newCond, null, null) }
        )

        // Price
        OutlinedTextField(
            value = priceText,
            onValueChange = { priceText = NumericInput.price(it) },
            // Siehe die Begründung beim Mengenfeld: Ohne Speichern beim
            // Fokusverlust ging jede Eingabe verloren, bei der der Nutzer nicht
            // ausdrücklich "Fertig" auf der Tastatur drückte.
            modifier = Modifier
                .weight(1f)
                .onFocusChanged { st -> if (!st.isFocused) flushPending() },
            singleLine = true,
            placeholder = { Text(stringResource(R.string.detail_price_placeholder), style = MaterialTheme.typography.labelSmall) },
            // Ein Marktpreis, den der Server eingesetzt hat, ist kein bezahlter
            // Betrag; das „≈" sagt es, bis jemand den echten Preis einträgt.
            prefix = if (acquisition.priceEstimated && priceText.isNotEmpty()) {
                { Text("≈", modifier = Modifier.semantics {
                    contentDescription = geschaetztText }) }
            } else null,
            suffix = acquisition.currency?.let { w -> { Text(w, style = MaterialTheme.typography.labelSmall) } },
            keyboardOptions = NumericInput.preisTastatur(),
            keyboardActions = KeyboardActions(
                onDone = { focusManager.clearFocus(); flushPending() }
            ),
            shape = Formen.etikett
        )

        // Delete
        IconButton(onClick = { showDeleteConfirm = true }) {
            Icon(Icons.Default.Delete, stringResource(R.string.acq_delete_title),
                tint = MaterialTheme.colorScheme.error, modifier = Modifier.size(20.dp))
        }
    }
}
