package ch.brickinventoryapp.ui.screens

import ch.brickinventoryapp.ui.theme.Formen
import ch.brickinventoryapp.ui.theme.AppKarte
import ch.brickinventoryapp.ui.theme.LocalStatusFarben
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import ch.brickinventoryapp.data.PreferencesManager
import ch.brickinventoryapp.data.model.*
import androidx.compose.ui.res.stringResource
import ch.brickinventoryapp.R
import ch.brickinventoryapp.util.fmtUhrzeit
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import ch.brickinventoryapp.ui.AppViewModel
import ch.brickinventoryapp.ui.viewmodel.MonitoringViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import ch.brickinventoryapp.ui.*
import kotlinx.coroutines.launch
import ch.brickinventoryapp.util.NumericInput
import ch.brickinventoryapp.ui.theme.Abstaende

/**
 * Die Abschnitte der Überwachungsseite unterhalb der Job-Liste — ganze Funktionen
 * aus MonitoringScreen.kt, keine zerschnittenen Rümpfe.
 */

@Composable
/**
 * `internal`, weil der Aufrufer in einer anderen Datei steht und `private` in
 * Kotlin dateiweit gilt.
 */
internal fun BricksetQueueRow(
    entry: BricksetQueueEntry,
    onRetry: (String) -> Unit,
    onDelete: (String) -> Unit
) {
    var showError by rememberSaveable { mutableStateOf(false) }

    Surface(
        shape = Formen.kachel,
        color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.5f),
        modifier = Modifier.fillMaxWidth()
    ) {
        Column(Modifier.padding(10.dp), verticalArrangement = Arrangement.spacedBy(Abstaende.winzig)) {
            Row(Modifier.fillMaxWidth(), Arrangement.SpaceBetween, Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    Text(entry.setNumber, fontWeight = FontWeight.Bold, style = MaterialTheme.typography.bodyMedium)
                    entry.name?.let {
                        Text(it, style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                    Text(stringResource(R.string.monitoring_retry_attempt, entry.attempts, entry.retryAfter ?: "—"),
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                Row(horizontalArrangement = Arrangement.spacedBy(Abstaende.winzig)) {
                    FilledTonalIconButton(onClick = { onRetry(entry.setNumber) }) {
                        Icon(Icons.Default.Refresh, stringResource(R.string.monitoring_icon_retry), Modifier.size(14.dp))
                    }
                    FilledTonalIconButton(
                        onClick = { onDelete(entry.setNumber) },
                        colors = IconButtonDefaults.filledTonalIconButtonColors(
                            containerColor = MaterialTheme.colorScheme.errorContainer
                        )
                    ) {
                        Icon(Icons.Default.Delete, stringResource(R.string.common_delete), Modifier.size(14.dp),
                            tint = MaterialTheme.colorScheme.onErrorContainer)
                    }
                }
            }

            // Last error expandable
            if (!entry.lastError.isNullOrBlank()) {
                TextButton(
                    onClick = { showError = !showError },
                    contentPadding = PaddingValues(0.dp),
                    modifier = Modifier.heightIn(min = 24.dp)
                ) {
                    Text(if (showError) stringResource(R.string.monitoring_hide_error) else stringResource(R.string.monitoring_show_error),
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.error)
                }
                AnimatedVisibility(showError) {
                    Surface(
                        shape = Formen.marke,
                        color = MaterialTheme.colorScheme.errorContainer.copy(alpha = 0.4f)
                    ) {
                        Text(
                            entry.lastError,
                            style = MaterialTheme.typography.labelSmall,
                            fontFamily = androidx.compose.ui.text.font.FontFamily.Monospace,
                            color = MaterialTheme.colorScheme.error,
                            modifier = Modifier.padding(Abstaende.klein)
                        )
                    }
                }
            }
        }
    }
}

// ExperimentalLayoutApi: fuer die FlowRow der Design-Auswahl weiter unten.
// Seit es vier Designs gibt, passen die Chips nicht mehr in eine Zeile.
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun CacheAndLimitsSection(vm: AppViewModel, onSnack: (String) -> Unit = {}) {
    val scope = rememberCoroutineScope()
    val cacheSavedMsg  = stringResource(R.string.monitoring_cache_saved)
    val cacheGeleertMsg = stringResource(R.string.monitoring_cache_cleared)
    var zeigeLeerenFrage by rememberSaveable { mutableStateOf(false) }
    var leerenAlles by rememberSaveable { mutableStateOf(false) }
    val limitsSavedMsg = stringResource(R.string.monitoring_limits_saved)

    // Die drei Netzerlaubnisse direkt aus den Einstellungen, nicht über AppUiState: Es
    // sind Geräte-Einstellungen, und eine Kopie im gemeinsamen Zustand wäre eine
    // zweite Fassung derselben Wahrheit. hiltViewModel() liefert im selben Ziel
    // dieselbe Instanz wie MonitoringScreen.
    val netzWlan    by vm.prefs.vorwaermenWlan.collectAsStateWithLifecycle(initialValue = true)
    val netzMobil   by vm.prefs.vorwaermenMobil.collectAsStateWithLifecycle(initialValue = false)
    val netzRoaming by vm.prefs.vorwaermenRoaming.collectAsStateWithLifecycle(initialValue = false)

    val mon: MonitoringViewModel = hiltViewModel()
    val monState by mon.state.collectAsStateWithLifecycle()
    val cacheStats = monState.cacheStats
    val apiLimits  = monState.apiLimits
    val cacheTtl   = monState.cacheTtl
    val defaultCondition = monState.vorgabeZustand
    // Das wirksame Design steht im App-Zustand; die Auswahl hier zeigt aber die
    // Vorgabe des Verwalters, die mit einem eigenen Design des Kontos abweicht.
    val appState by vm.state.collectAsStateWithLifecycle()

    // Bedienzustand: was gerade bearbeitet und halb eingetippt ist. Bleibt hier
    // und speicherbar — das ueberlebt auch den Prozesstod, ein ViewModel nicht.
    var editingTtl by rememberSaveable { mutableStateOf(false) }
    var ttlInput   by rememberSaveable { mutableStateOf("24") }
    var editingLimits by rememberSaveable { mutableStateOf(false) }
    var rbInput    by rememberSaveable { mutableStateOf("0") }
    var blInput    by rememberSaveable { mutableStateOf("0") }
    var bsInput    by rememberSaveable { mutableStateOf("0") }

    LaunchedEffect(Unit) { mon.ladeCacheUndGrenzen(); mon.ladeDesignVorgabe() }

    // Die Eingabefelder mit den geladenen Werten vorbelegen — aber nur, solange
    // NICHT bearbeitet wird. Das Speichern laedt die Grenzwerte selbst neu; ohne
    // die Bedingung schriebe diese Antwort dem Benutzer die halb getippte Zahl
    // wieder um. Vorher stand die Vorbelegung im einmaligen Ladevorgang und
    // konnte das nicht — jetzt haengt sie am Zustand und koennte es.
    LaunchedEffect(apiLimits, editingLimits) {
        val al = apiLimits
        if (al != null && !editingLimits) {
            rbInput = al.rebrickable.toString()
            blInput = al.bricklink.toString()
            bsInput = al.brickset.toString()
        }
    }
    LaunchedEffect(cacheTtl, editingTtl) {
        if (!editingTtl) ttlInput = cacheTtl
    }

    // ── Price Cache ───────────────────────────────────────────────────────────
    AppKarte(Modifier.padding(horizontal = Abstaende.gross, vertical = 5.dp)) {
        Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Text(stringResource(R.string.monitoring_price_cache).uppercase(),
                style = MaterialTheme.typography.labelSmall,
                fontWeight = FontWeight.Bold,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                letterSpacing = 0.8.sp)

            cacheStats?.let { cs ->
                Row(Modifier.fillMaxWidth(), Arrangement.SpaceAround) {
                    CacheStatCell(stringResource(R.string.monitoring_cache_prices), "${cs.prices}")
                    CacheStatCell(stringResource(R.string.monitoring_cache_stale), "${cs.priceStale}")
                    CacheStatCell(stringResource(R.string.monitoring_cache_subsets), "${cs.subsets}")
                    CacheStatCell(stringResource(R.string.monitoring_cache_catalog), "${cs.catalog}")
                }
            }

            // Default condition (Neu/Gebraucht)
            Row(
                Modifier.fillMaxWidth(),
                Arrangement.SpaceBetween,
                Alignment.CenterVertically
            ) {
                Text(stringResource(R.string.monitoring_default_condition),
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant)
                ch.brickinventoryapp.ui.screens.ConditionToggle(
                    selected = defaultCondition,
                    onSelect = { newCond ->
                        scope.launch {
                            if (mon.setzeVorgabeZustand(newCond)) {
                                vm.loadSettings()
                                onSnack(cacheSavedMsg)
                            }
                        }
                    }
                )
            }

            // Die vier Blöcke stehen untereinander in der Column: In einer Row teilten sie
            // sich die Breite, die FlowRows brachen jeden Chip um, und es entstanden grosse
            // leere Abstände.

            // ── Vorschau-Ablage ──
            //
            // Sie liegt unter filesDir und wird von Android nicht geräumt; deshalb muss man
            // sie hier sehen und leeren können. `remember`, nicht `rememberSaveable`: Die Zahl
            // ist eine Messung der Platte und stünde nach einem Prozesstod falsch da
            // (BildschirmZustandTest, Sorte „gemessen“).
            var ablageBytes by remember { mutableStateOf(vm.vorschauAblageBytes()) }
            Row(
                Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(Abstaende.klein),
            ) {
                Text(
                    stringResource(R.string.monitoring_vorschau_ablage,
                        ablageBytes / (1024 * 1024)),
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.weight(1f),
                )
                TextButton(onClick = {
                    vm.vorschauAblageLeeren()
                    ablageBytes = vm.vorschauAblageBytes()
                    onSnack(cacheSavedMsg)
                }) { Text(stringResource(R.string.monitoring_vorschau_leeren), style = MaterialTheme.typography.labelMedium) }
            }

            // ── In welchen Netzen darf vorgewärmt werden ──
            //
            // Drei unabhängige Chips, je einer für eine Lage; die Begründung steht an den
            // Schlüsseln in PreferencesManager.
            Text(stringResource(R.string.monitoring_vorwaermen_netz),
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant)
            androidx.compose.foundation.layout.FlowRow(
                horizontalArrangement = Arrangement.spacedBy(Abstaende.klein),
                verticalArrangement = Arrangement.spacedBy(Abstaende.klein),
            ) {
                for ((erlaubt, schluessel, text) in listOf(
                    Triple(netzWlan, PreferencesManager.VORWAERMEN_WLAN,
                        R.string.monitoring_vorwaermen_wlan),
                    Triple(netzMobil, PreferencesManager.VORWAERMEN_MOBIL,
                        R.string.monitoring_vorwaermen_mobil),
                    Triple(netzRoaming, PreferencesManager.VORWAERMEN_ROAMING,
                        R.string.monitoring_vorwaermen_roaming),
                )) {
                    FilterChip(
                        selected = erlaubt,
                        onClick = {
                            scope.launch {
                                vm.prefs.saveVorwaermenNetz(schluessel, !erlaubt)
                            }
                        },
                        label = { Text(stringResource(text), style = MaterialTheme.typography.labelMedium) },
                    )
                }
            }
            // Ein gemessenes WLAN — der Hotspot eines anderen Telefons —
            // zaehlt als Mobilfunk. Das steht hier, weil es sonst wie ein
            // kaputter Schalter aussieht: „Ich bin doch im WLAN."
            Text(stringResource(R.string.monitoring_vorwaermen_hinweis),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant)

            // ── Design ──
            //
            // Das globale Design auch am Telefon ändern können. loadSettings() danach zieht
            // das wirksame Design neu; ohne eigenes Design des Kontos ist es die neue Vorgabe.
            Text(stringResource(R.string.monitoring_theme),
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant)
            // Vier Designs passen nicht mehr in eine Zeile — FlowRow bricht
            // um, statt die letzten Chips abzuschneiden.
            androidx.compose.foundation.layout.FlowRow(
                // Aus der Abstandsskala, nicht als Zahl (AbstandsskalaTest).
                horizontalArrangement = Arrangement.spacedBy(Abstaende.klein),
                verticalArrangement = Arrangement.spacedBy(Abstaende.klein),
            ) {
                for ((wert, text) in ch.brickinventoryapp.ui.DESIGN_NAMEN) {
                    FilterChip(
                        selected = (monState.vorgabeDesign ?: appState.appTheme) == wert,
                        onClick = {
                            scope.launch {
                                if (mon.setzeDesign(wert)) {
                                    vm.loadSettings()
                                    onSnack(cacheSavedMsg)
                                }
                            }
                        },
                        label = { Text(stringResource(text), style = MaterialTheme.typography.labelMedium) },
                    )
                }
            }
            // Beide Chip-Reihen dieses Blocks tragen dieselbe Rolle
            // (labelMedium): Zwei Reihen direkt uebereinander mit einem Punkt
            // Unterschied waeren nicht als Absicht lesbar.

            // Cache TTL
            Row(
                Modifier.fillMaxWidth(),
                Arrangement.SpaceBetween,
                Alignment.CenterVertically
            ) {
                Text(stringResource(R.string.monitoring_cache_duration),
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant)
                if (editingTtl) {
                    Row(
                        horizontalArrangement = Arrangement.spacedBy(6.dp),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        OutlinedTextField(
                            value = ttlInput,
                            onValueChange = { ttlInput = NumericInput.quantity(it) },
                            suffix = { Text("h") },
                            modifier = Modifier.width(90.dp),
                            singleLine = true,
                            shape = Formen.kachel,
                    keyboardOptions = NumericInput.ganzzahlTastatur()
                )
                        FilledTonalButton(
                            onClick = {
                                scope.launch {
                                    val h = ttlInput.toIntOrNull() ?: 24
                                    if (mon.setzeCacheDauer(h)) onSnack(cacheSavedMsg)
                                    editingTtl = false
                                }
                            },
                            shape = Formen.kachel,
                            contentPadding = PaddingValues(horizontal = 10.dp, vertical = 6.dp)
                        ) { Text("OK", style = MaterialTheme.typography.labelMedium) }
                        IconButton(onClick = { editingTtl = false }) {
                            Icon(Icons.Default.Close, stringResource(R.string.common_cancel))
                        }
                    }
                } else {
                    Row(
                        horizontalArrangement = Arrangement.spacedBy(Abstaende.klein),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Text(stringResource(R.string.monitoring_cache_ttl_hours, cacheTtl), fontWeight = FontWeight.SemiBold, style = MaterialTheme.typography.bodyMedium)
                        FilledTonalIconButton(
                            onClick = { editingTtl = true },
                        ) { Icon(Icons.Default.Edit, stringResource(R.string.cd_edit_cache_ttl), Modifier.size(14.dp)) }
                    }
                }
            }

            // ── Leeren ──
            //
            // Mit Rückfrage: Jeder Neuaufbau kostet Anfragen aus dem gemeinsamen
            // Tageskontingent; ein Fehlgriff nimmt allen anderen Kontingent weg.
            Row(
                Modifier.fillMaxWidth().padding(top = Abstaende.winzig),
                horizontalArrangement = Arrangement.spacedBy(Abstaende.klein),
            ) {
                OutlinedButton(
                    onClick = { leerenAlles = false; zeigeLeerenFrage = true },
                    shape = Formen.kachel,
                    contentPadding = PaddingValues(horizontal = Abstaende.mittel, vertical = 6.dp),
                ) { Text(stringResource(R.string.monitoring_cache_clear_prices), style = MaterialTheme.typography.labelMedium) }
                OutlinedButton(
                    onClick = { leerenAlles = true; zeigeLeerenFrage = true },
                    shape = Formen.kachel,
                    contentPadding = PaddingValues(horizontal = Abstaende.mittel, vertical = 6.dp),
                ) { Text(stringResource(R.string.monitoring_cache_clear_all), style = MaterialTheme.typography.labelMedium) }
            }
        }
    }

    if (zeigeLeerenFrage) {
        AlertDialog(
            onDismissRequest = { zeigeLeerenFrage = false },
            icon = { Icon(Icons.Default.Delete, null, tint = MaterialTheme.colorScheme.error) },
            title = { Text(stringResource(
                if (leerenAlles) R.string.monitoring_cache_clear_all
                else R.string.monitoring_cache_clear_prices)) },
            text = { Text(stringResource(R.string.monitoring_cache_clear_hint)) },
            confirmButton = {
                TextButton(onClick = {
                    zeigeLeerenFrage = false
                    scope.launch { if (mon.leereCache(leerenAlles)) onSnack(cacheGeleertMsg) }
                }) {
                    Text(stringResource(R.string.monitoring_cache_clear_confirm),
                        color = MaterialTheme.colorScheme.error)
                }
            },
            dismissButton = {
                TextButton(onClick = { zeigeLeerenFrage = false }) {
                    Text(stringResource(R.string.common_cancel))
                }
            }
        )
    }

    // ── API Rate Limits ───────────────────────────────────────────────────────
    AppKarte(Modifier.padding(horizontal = Abstaende.gross, vertical = 5.dp)) {
        Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(Abstaende.klein)) {
            Row(Modifier.fillMaxWidth(), Arrangement.SpaceBetween, Alignment.CenterVertically) {
                Text(stringResource(R.string.monitoring_api_calls).uppercase(),
                    style = MaterialTheme.typography.labelSmall,
                    fontWeight = FontWeight.Bold,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    letterSpacing = 0.8.sp)
                FilledTonalIconButton(
                    onClick = { editingLimits = !editingLimits },
                ) { Icon(if (editingLimits) Icons.Default.Close else Icons.Default.Edit, stringResource(R.string.cd_edit_limits), Modifier.size(14.dp)) }
            }

            cacheStats?.rateLimits?.let { rl ->
                RateLimitRow("Brickset",    rl.brickset,    if (editingLimits) bsInput else null, { bsInput = it })
                RateLimitRow("BrickLink",   rl.bricklink,   if (editingLimits) blInput else null, { blInput = it })
                RateLimitRow("Rebrickable", rl.rebrickable, if (editingLimits) rbInput else null, { rbInput = it })
            }

            if (editingLimits) {
                FilledTonalButton(
                    onClick = {
                        scope.launch {
                            val rb = rbInput.toIntOrNull() ?: 0
                            val bl = blInput.toIntOrNull() ?: 0
                            val bs = bsInput.toIntOrNull() ?: 0
                            // Das Nachladen der Grenzwerte steht im ViewModel.
                            if (mon.setzeGrenzwerte(rb, bl, bs)) onSnack(limitsSavedMsg)
                            editingLimits = false
                        }
                    },
                    modifier = Modifier.fillMaxWidth(),
                    shape = Formen.kachel,
                    contentPadding = PaddingValues(vertical = Abstaende.klein)
                ) {
                    Icon(Icons.Default.Save, null, Modifier.size(16.dp))
                    Spacer(Modifier.width(6.dp))
                    Text(stringResource(R.string.monitoring_limits_save), style = MaterialTheme.typography.bodyMedium)
                }
            }
        }
    }
}

@Composable
private fun CacheStatCell(label: String, value: String) {
    Column(horizontalAlignment = Alignment.CenterHorizontally) {
        Text(value, fontWeight = FontWeight.Bold, style = MaterialTheme.typography.titleMedium)
        Text(label, style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

@Composable
private fun RateLimitRow(
    label: String,
    rl: RateLimit,
    editValue: String?,
    onEdit: (String) -> Unit
) {
    val pct = if (rl.limit > 0) (rl.count.toFloat() / rl.limit).coerceIn(0f, 1f) else 0f
    val color = when {
        pct > 0.9f -> MaterialTheme.colorScheme.error
        pct > 0.7f -> LocalStatusFarben.current.warnung
        else       -> MaterialTheme.colorScheme.primary
    }
    // ── Das Zeichen, nicht nur die Farbe ──
    //
    // Gelb gegen Rot fällt bei Rot-Grün-Schwäche zusammen; die Farbe sollte aber auf
    // einen Blick sagen „hier wird es eng“. Ein Zeichen davor trägt das ohne Farbe.
    // Eine Schwelle reicht — wie eng, sagt die Zahl daneben.
    val eng = pct > 0.7f
    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(3.dp)) {
        Row(Modifier.fillMaxWidth(), Arrangement.SpaceBetween, Alignment.CenterVertically) {
            Text(label, style = MaterialTheme.typography.bodyMedium)
            if (editValue != null) {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Abstaende.winzig)) {
                    Text("${rl.count} /", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    OutlinedTextField(
                        value = editValue,
                        onValueChange = { onEdit(NumericInput.quantity(it)) },
                        modifier = Modifier.width(80.dp),
                        singleLine = true,
                        shape = Formen.etikett,
                        textStyle = MaterialTheme.typography.bodyMedium,
                    keyboardOptions = NumericInput.ganzzahlTastatur()
                )
                }
            } else {
                Row(verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(Abstaende.winzig)) {
                    if (eng) Icon(Icons.Default.Warning, stringResource(R.string.monitoring_kontingent_eng),
                        Modifier.size(14.dp), tint = color)
                    Text("${rl.count} / ${rl.limit}",
                        style = MaterialTheme.typography.bodySmall,
                        fontWeight = FontWeight.SemiBold,
                        color = color)
                }
            }
        }
        LinearProgressIndicator(
            progress = { pct },
            modifier = Modifier.fillMaxWidth().height(3.dp),
            color = color,
            trackColor = MaterialTheme.colorScheme.surfaceVariant
        )
    }
}

/**
 * Das Server-Protokoll, wie „Logs“ in der Webapp. Nicht von selbst geladen: bis zu
 * 5000 Zeilen, und wer die Überwachung öffnet, will meist die Job-Karten.
 */
// ExperimentalLayoutApi gilt fuer die FlowRow der Stufenschalter weiter unten.
// Die Annotation gehoert an die FUNKTION, nicht in den Rumpf — die Begruendung
// steht in HouseholdComposables.kt: Ein @OptIn mitten im Rumpf hat dort
// zusammen mit einer nachgestellten Lambda „Unresolved reference 'invoke'"
// ergeben.
@OptIn(ExperimentalLayoutApi::class)
@Composable
internal fun ProtokollSection(mon: MonitoringViewModel) {
    val verwaltung by mon.verwaltungState.collectAsStateWithLifecycle()
    val protokollScope = rememberCoroutineScope()
    var offen by rememberSaveable { mutableStateOf(false) }
    // Beides gehoert dem Menschen und uebersteht deshalb eine Drehung — die
    // Zeilen selbst kommen ohnehin vom Server nach.
    var versteckteStufen by rememberSaveable { mutableStateOf(setOf<String>()) }
    var protokollSuche by rememberSaveable { mutableStateOf("") }

    AppKarte {
        Column(Modifier.padding(Abstaende.gross), verticalArrangement = Arrangement.spacedBy(Abstaende.klein)) {
            Row(Modifier.fillMaxWidth(), Arrangement.SpaceBetween, Alignment.CenterVertically) {
                Text(stringResource(R.string.admin_log_title),
                    fontWeight = FontWeight.Bold, style = MaterialTheme.typography.titleMedium)
                Row(verticalAlignment = Alignment.CenterVertically) {
                    if (verwaltung.protokollLaden) {
                        CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp)
                    } else if (offen) {
                        IconButton(onClick = { protokollScope.launch { mon.ladeProtokoll() } }) {
                            Icon(Icons.Default.Refresh, stringResource(R.string.admin_log_reload),
                                Modifier.size(18.dp))
                        }
                    }
                    IconButton(onClick = {
                        offen = !offen
                        if (offen && verwaltung.protokoll.isEmpty()) protokollScope.launch { mon.ladeProtokoll() }
                    }) {
                        // Beschreibt die WIRKUNG des Tippens, nicht das
                        // gezeigte Zeichen — genau das braucht TalkBack.
                        Icon(
                            if (offen) Icons.Default.ExpandLess else Icons.Default.ExpandMore,
                            stringResource(
                                if (offen) R.string.common_collapse else R.string.common_expand))
                    }
                }
            }

            AnimatedVisibility(offen) {
                Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    // Dieselben Spannen wie die Webapp anbietet. Der Server
                    // begrenzt selbst auf 2880 Minuten.
                    Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        listOf(15, 60, 240, 1440).forEach { min ->
                            FilterChip(
                                selected = verwaltung.protokollMinuten == min,
                                onClick = { protokollScope.launch { mon.ladeProtokoll(min) } },
                                label = { Text(stringResource(R.string.admin_log_minutes, min),
                                               style = MaterialTheme.typography.labelSmall) },
                                shape = Formen.chip)
                        }
                    }
                    // Der Fehler statt der Leermeldung: „keine Einträge“ wäre falsch, wenn der
                    // Abruf scheiterte.
                    if (verwaltung.fehler != null) {
                        Text(verwaltung.fehler!!, style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.error)
                    } else if (verwaltung.protokoll.isEmpty() && !verwaltung.protokollLaden) {
                        Text(stringResource(R.string.admin_log_empty),
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                    // ── Stufen und Suche, wie in der Weboberfläche ──
                    //
                    // Gefiltert wird hier, nicht auf dem Server: Die Zeilen sind schon geladen, ein
                    // Abruf je Tastendruck wäre nur Wartezeit.
                    val stufen = remember(verwaltung.protokoll) {
                        verwaltung.protokoll.mapNotNull { it.level?.lowercase() }.distinct().sorted()
                    }
                    if (stufen.size > 1) {
                        FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                            stufen.forEach { stufe ->
                                FilterChip(
                                    selected = stufe !in versteckteStufen,
                                    onClick = {
                                        versteckteStufen =
                                            if (stufe in versteckteStufen) versteckteStufen - stufe
                                            else versteckteStufen + stufe
                                    },
                                    label = { Text(stufe.uppercase(),
                                                   style = MaterialTheme.typography.labelSmall) },
                                    shape = Formen.chip)
                            }
                        }
                    }
                    if (verwaltung.protokoll.isNotEmpty()) {
                        Suchfeld(protokollSuche, { protokollSuche = it },
                            stringResource(R.string.admin_log_search))
                    }

                    val sichtbar = remember(verwaltung.protokoll, versteckteStufen, protokollSuche) {
                        val suche = protokollSuche.trim().lowercase()
                        verwaltung.protokoll.filter { z ->
                            z.level?.lowercase() !in versteckteStufen &&
                                (suche.isEmpty() || z.message.orEmpty().lowercase().contains(suche))
                        }
                    }
                    if (verwaltung.protokoll.isNotEmpty() && sichtbar.isEmpty()) {
                        Text(stringResource(R.string.admin_log_no_match),
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                    sichtbar.forEach { zeile ->
                        Row(horizontalArrangement = Arrangement.spacedBy(Abstaende.klein)) {
                            // Die Uhrzeit zuerst — wie in der Weboberflaeche.
                            // `logged_at` kam seit jeher mit und wurde nie
                            // gezeigt; ohne sie ist eine Protokollzeile kaum zu
                            // gebrauchen.
                            Text(fmtUhrzeit(zeile.loggedAt) ?: "",
                                style = MaterialTheme.typography.labelSmall,
                                fontFamily = FontFamily.Monospace,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                                modifier = Modifier.width(58.dp))
                            Text(zeile.level.orEmpty().uppercase(),
                                style = MaterialTheme.typography.labelSmall,
                                fontWeight = FontWeight.Bold,
                                color = when (zeile.level?.lowercase()) {
                                    "error" -> MaterialTheme.colorScheme.error
                                    "warn"  -> MaterialTheme.colorScheme.tertiary
                                    else    -> MaterialTheme.colorScheme.onSurfaceVariant
                                },
                                modifier = Modifier.width(46.dp))
                            Text(zeile.message.orEmpty(),
                                style = MaterialTheme.typography.bodySmall)
                        }
                    }
                }
            }
        }
    }
}

/**
 * Der Zeitplan eines Jobs — anzeigen und ändern, wie in der Webapp. Tägliche Jobs
 * haben eine Uhrzeit, der Preis-Job einen Abstand in Minuten; der Server
 * unterscheidet am Feld und normalisiert beides („7:5“ → „07:05“, mindestens fünf
 * Minuten). Deshalb wird nach dem Speichern neu geladen: Es soll dastehen, was
 * gilt.
 */
@Composable
fun ZeitplanZeile(
    jobKey: String,
    plan: ch.brickinventoryapp.data.model.JobSchedule,
    mon: ch.brickinventoryapp.ui.viewmodel.MonitoringViewModel,
    onSnack: (String) -> Unit,
) {
    val scope = rememberCoroutineScope()
    val gespeichert = stringResource(R.string.monitoring_cache_saved)
    val taeglich = plan.type == "daily"
    var bearbeiten by rememberSaveable(jobKey) { mutableStateOf(false) }
    val gezeigt = if (taeglich) plan.time.orEmpty() else (plan.minutes ?: 60).toString()
    var eingabe by rememberSaveable(jobKey, gezeigt) { mutableStateOf(gezeigt) }

    Row(
        Modifier.fillMaxWidth(),
        Arrangement.SpaceBetween,
        Alignment.CenterVertically,
    ) {
        Text(
            stringResource(if (taeglich) R.string.monitoring_schedule_daily
                           else R.string.monitoring_schedule_every),
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        if (bearbeiten) {
            Row(horizontalArrangement = Arrangement.spacedBy(6.dp),
                verticalAlignment = Alignment.CenterVertically) {
                OutlinedTextField(
                    value = eingabe,
                    onValueChange = {
                        // Bei Minuten nur Ziffern; bei der Uhrzeit auch der
                        // Doppelpunkt — sonst liesse sich „03:00" nicht tippen.
                        eingabe = if (taeglich) it.filter { z -> z.isDigit() || z == ':' }.take(5)
                                  else NumericInput.quantity(it)
                    },
                    // Aus den Sprachdateien, nicht als Klartext: „Min." und
                    // „min" sind kurz, aber sie stehen im Bild und werden
                    // gelesen. StringResourceParityTest hat genau das gemeldet.
                    suffix = { if (!taeglich) Text(stringResource(R.string.monitoring_schedule_unit)) },
                    modifier = Modifier.width(if (taeglich) 96.dp else 90.dp),
                    singleLine = true,
                    shape = Formen.kachel,
                    keyboardOptions = NumericInput.ganzzahlTastatur(),
                )
                FilledTonalButton(
                    onClick = {
                        scope.launch {
                            val ok = if (taeglich) mon.setzeJobZeitplan(jobKey, zeit = eingabe.trim())
                                     else mon.setzeJobZeitplan(jobKey, minuten = eingabe.toIntOrNull() ?: 60)
                            if (ok) onSnack(gespeichert)
                            bearbeiten = false
                        }
                    },
                    shape = Formen.kachel,
                    contentPadding = PaddingValues(horizontal = 10.dp, vertical = 6.dp),
                ) { Text("OK", style = MaterialTheme.typography.labelMedium) }
                IconButton(onClick = { bearbeiten = false }) {
                    Icon(Icons.Default.Close, stringResource(R.string.common_cancel))
                }
            }
        } else {
            Row(horizontalArrangement = Arrangement.spacedBy(Abstaende.klein),
                verticalAlignment = Alignment.CenterVertically) {
                Text(
                    if (taeglich) plan.time.orEmpty()
                    else stringResource(R.string.monitoring_schedule_minutes, plan.minutes ?: 60),
                    fontWeight = FontWeight.SemiBold, style = MaterialTheme.typography.bodyMedium,
                )
                FilledTonalIconButton(
                    onClick = { bearbeiten = true },
                ) { Icon(Icons.Default.Edit, stringResource(R.string.cd_edit_schedule), Modifier.size(14.dp)) }
            }
        }
    }
}
