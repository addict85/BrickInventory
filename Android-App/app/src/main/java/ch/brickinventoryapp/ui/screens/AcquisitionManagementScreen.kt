package ch.brickinventoryapp.ui.screens

import ch.brickinventoryapp.ui.theme.Formen
import androidx.compose.foundation.clickable
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
import ch.brickinventoryapp.ui.MainViewModel
import ch.brickinventoryapp.ui.changeAcquisitionOwner
import ch.brickinventoryapp.ui.deleteAcquisition
import ch.brickinventoryapp.ui.deleteManualAcquisition
import ch.brickinventoryapp.ui.loadAcquisitions
import ch.brickinventoryapp.ui.loadManualAcquisitions
import ch.brickinventoryapp.ui.updateAcquisition
import ch.brickinventoryapp.ui.updateManualAcquisition
import ch.brickinventoryapp.util.fmtMoney
import ch.brickinventoryapp.util.NumericInput

/**
 * Dedizierter Screen für die Kaufpreis-Verwaltung — analog zum acq-modal in der Webapp.
 * Funktioniert für Sets (type="set"), Teile (type="part") und Minifiguren (type="fig").
 * Die editierbaren Zeilen stehen in DIESER Datei (AcquisitionManagementRow weiter unten). Hier
 * stand bis Nachtrag 119 „Code-Sharing: … nutzen AcquisitionEditRow aus
 * ManualItemComposables.kt" — das stimmte nicht mehr, und AcquisitionEditRow
 * hatte seit Längerem gar keinen Aufrufer. Ein Kommentar, der eine Struktur
 * behauptet, die es nicht gibt, ist schlimmer als keiner: Wer die eine Stelle
 * ändert, glaubt, die andere mitgeändert zu haben.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AcquisitionManagementScreen(
    vm: MainViewModel,
    type: String,           // "set" | "part" | "fig"
    id: String,             // setNumber / partNumber / figNumber
    colorId: Int = 0,
    title: String,
    onBack: () -> Unit
) {
    val state by vm.state.collectAsStateWithLifecycle()
    val currency = state.currency

    // Unified acquisition state — sets use setDetailState, parts/figs use manDetailState
    val detailState by vm.setDetailState.collectAsStateWithLifecycle()
    val manDetailState by vm.manDetailState.collectAsStateWithLifecycle()

    val acquisitions = if (type == "set") detailState.acquisitions else manDetailState.acquisitions
    // Summe vom Server — die Rechnung stand vorher hier und noch dreimal
    // woanders (siehe utils/acquisitions.ts, acquisitionTotals).
    val totals = if (type == "set") detailState.acquisitionTotals else manDetailState.acquisitionTotals
    // Rückmeldung nach einem Eigentümerwechsel — der Server sagt, ob und was
    // mitgewandert ist.
    var moveMessage by remember { mutableStateOf<String?>(null) }
    // Für die Erfolgsmeldung mit den echten Zahlen aus der Antwort.
    val ctx = LocalContext.current
    val isLoading    = if (type == "set") detailState.acquisitionsLoading else manDetailState.isLoading

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
            contentPadding = PaddingValues(16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            // Header row
            item {
                Row(
                    Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
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
                    Spacer(Modifier.width(32.dp))
                }
                HorizontalDivider(Modifier.padding(top = 4.dp), thickness = 2.dp)
            }

            moveMessage?.let { msg ->
                item {
                    Text(msg, style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.padding(vertical = 4.dp))
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
                // ── Eigentümer DIESER Zeile ──────────────────────────────────
                //
                // Der Kaufpreis ist die Ebene, auf der ein Exemplar wirklich
                // existiert: Drei Erfassungen sind drei Käufe, die
                // verschiedenen Kindern gehören können. Deshalb steht die
                // Auswahl hier und nicht nur am ganzen Set.
                //
                // Für ALLE drei Arten: Sets, manuelle Teile, manuelle
                // Minifiguren. Das ist der einzige Weg, Bestand zwischen
                // Konten zu verschieben — die Detailansichten haben keinen.
                if (state.householdMembers.size > 1) {
                    OwnerPicker(
                        members = state.householdMembers,
                        selected = acq.ownerUserId ?: state.householdMembers.firstOrNull { it.isSelf }?.id,
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
                                // Die Zahlen kommen aus der Antwort. Sie standen
                                // hier fest auf 0/0 — die Meldung sagte also
                                // auch dann „0 Teile", wenn hunderte wanderten.
                                moveMessage = err ?: ctx.getString(
                                    R.string.household_move_ok, teile, figuren)
                            }
                        },
                        modifier = Modifier.padding(top = 4.dp)
                    )
                }
                HorizontalDivider()
            }

            // Summary row
            if (acquisitions.size > 1) {
                item {
                    Row(
                        Modifier.fillMaxWidth().padding(top = 4.dp),
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
    var showDeleteConfirm by rememberSaveable { mutableStateOf(false) }
    val focusManager = LocalFocusManager.current

    // ── Ungespeicherte Eingaben festhalten ──────────────────────────────────
    //
    // Gespeichert wurde bisher AUSSCHLIESSLICH bei "Fertig" auf der Tastatur.
    // Wer den Preis ändert und dann oben links auf Zurück tippt, verlässt den
    // Bildschirm, ohne dass je gespeichert wird: Die Eingabe ist weg, beim
    // nächsten Öffnen steht der alte Wert da. Für den Nutzer sieht das aus, als
    // werde der Preis gelöscht.
    //
    // Zwei Auslöser, weil einer allein nicht reicht:
    //   • onFocusChanged deckt den Normalfall ab (Feld verlassen, anderes Feld
    //     antippen, Tastatur schliessen).
    //   • DisposableEffect deckt das Zurücknavigieren ab — dabei wird die
    //     Ansicht verworfen, und ob vorher noch ein Fokusereignis eintrifft, ist
    //     nicht zugesichert.
    //
    // lastSaved verhindert doppeltes Speichern, wenn beide greifen, und sorgt
    // dafür, dass ein blosses Antippen ohne Änderung nichts auslöst — bei einem
    // leeren Preisfeld wäre das ein Schreiben von null, also ein ungewolltes
    // Löschen des bestehenden Preises.
    // effectivePrice, NICHT purchasePrice: priceText wird oben aus effectivePrice
    // gefüllt. Mit einer anderen Quelle hier gälte der Ausgangswert als
    // "geändert", und schon das erste Verlassen der Ansicht hätte einen
    // Schreibvorgang ausgelöst, den niemand angefordert hat.
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
        "📅 ${dateLabel ?: "—"}",
        style = MaterialTheme.typography.labelSmall,
        color = MaterialTheme.colorScheme.primary,
        modifier = Modifier
            .padding(top = 8.dp, bottom = 2.dp)
            .clickable { showDatePicker = true }
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
        Modifier.fillMaxWidth().padding(bottom = 4.dp),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        // Qty
        OutlinedTextField(
            value = qtyText,
            onValueChange = { qtyText = NumericInput.quantity(it) },
            prefix = { Text("×", fontWeight = FontWeight.Bold) },
            // onFocusChanged zusätzlich zu onDone.
            //
            // ── Der gemeldete Fehler ────────────────────────────────────────
            // Gespeichert wurde AUSSCHLIESSLICH bei "Fertig" auf der Tastatur.
            // Wer den Wert ändert und dann oben links auf Zurück tippt, verlässt
            // den Bildschirm, ohne dass je gespeichert wird — die Eingabe ist
            // weg, und beim nächsten Öffnen steht der alte Wert da. Für den
            // Nutzer sieht das aus, als werde der Preis gelöscht.
            //
            // Beim Verlassen des Feldes (Fokusverlust) wird jetzt ebenfalls
            // gespeichert, aber nur wenn sich der Wert tatsächlich geändert hat.
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
            placeholder = { Text(stringResource(R.string.detail_price_placeholder), fontSize = 11.sp) },
            keyboardOptions = NumericInput.preisTastatur(),
            keyboardActions = KeyboardActions(
                onDone = { focusManager.clearFocus(); flushPending() }
            ),
            shape = Formen.etikett
        )

        // Delete
        IconButton(onClick = { showDeleteConfirm = true }, modifier = Modifier.size(36.dp)) {
            Icon(Icons.Default.Delete, stringResource(R.string.acq_delete_title),
                tint = MaterialTheme.colorScheme.error, modifier = Modifier.size(20.dp))
        }
    }
}
