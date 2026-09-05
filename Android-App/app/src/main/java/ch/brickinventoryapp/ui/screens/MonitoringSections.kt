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
import ch.brickinventoryapp.data.model.*
import androidx.compose.ui.res.stringResource
import ch.brickinventoryapp.R
import ch.brickinventoryapp.ui.MainViewModel
import ch.brickinventoryapp.ui.viewmodel.MonitoringViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.hilt.navigation.compose.hiltViewModel
import ch.brickinventoryapp.ui.*  // Feature-Extensions (loadSetDetail, updateQuantity, …)
import kotlinx.coroutines.launch
import ch.brickinventoryapp.util.NumericInput

/**
 * Die Abschnitte der Überwachungsseite unterhalb der Job-Liste.
 *
 * ── Warum eigene Datei (Nachtrag 98) ────────────────────────────────────────
 *
 * MonitoringScreen.kt war 679 Zeilen und enthielt sechs Composables: die Seite
 * selbst, die Job-Karte, die Brickset-Warteschlange, den Preis-Cache samt
 * API-Kontingenten und zwei kleine Zell-Bausteine.
 *
 * Hier wurden GANZE FUNKTIONEN verschoben, nicht Rümpfe zerschnitten. Das ist
 * der risikoärmere Eingriff: Es gibt keine freien Namen zu bestimmen und keine
 * Parameterliste zu erraten — die Funktionen waren schon vorher abgeschlossen.
 *
 * `CacheAndLimitsSection` bleibt damit 185 Zeilen lang. Sie weiter zu
 * zerlegen hiesse, ein halbes Dutzend `var by remember` in
 * MutableState-Parameter zu verwandeln; das ist ohne Compiler die
 * fehleranfälligste Sorte Änderung, und der Gewinn wäre gering.
 */

@Composable
/**
 * `internal` statt `private`: Der Aufrufer steht seit dem Aufteilen in einer
 * ANDEREN Datei, und `private` gilt in Kotlin dateiweit (Nachtrag 101).
 * `internal` hält den Helfer weiterhin aus der öffentlichen Schnittstelle
 * heraus — sichtbar ist er nur innerhalb dieses Moduls.
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
        Column(Modifier.padding(10.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Row(Modifier.fillMaxWidth(), Arrangement.SpaceBetween, Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    Text(entry.setNumber, fontWeight = FontWeight.Bold, fontSize = 13.sp)
                    entry.name?.let {
                        Text(it, style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                    Text(stringResource(R.string.monitoring_retry_attempt, entry.attempts, entry.retryAfter ?: "—"),
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                    FilledTonalIconButton(onClick = { onRetry(entry.setNumber) },
                        modifier = Modifier.size(32.dp)) {
                        Icon(Icons.Default.Refresh, stringResource(R.string.monitoring_icon_retry), Modifier.size(14.dp))
                    }
                    FilledTonalIconButton(
                        onClick = { onDelete(entry.setNumber) },
                        modifier = Modifier.size(32.dp),
                        colors = IconButtonDefaults.filledTonalIconButtonColors(
                            containerColor = MaterialTheme.colorScheme.errorContainer
                        )
                    ) {
                        Icon(Icons.Default.Delete, stringResource(R.string.monitoring_icon_delete), Modifier.size(14.dp),
                            tint = MaterialTheme.colorScheme.onErrorContainer)
                    }
                }
            }

            // Last error expandable
            if (!entry.lastError.isNullOrBlank()) {
                TextButton(
                    onClick = { showError = !showError },
                    contentPadding = PaddingValues(0.dp),
                    modifier = Modifier.height(24.dp)
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
                            modifier = Modifier.padding(8.dp)
                        )
                    }
                }
            }
        }
    }
}

@Composable
fun CacheAndLimitsSection(vm: MainViewModel, onSnack: (String) -> Unit = {}) {
    val scope = rememberCoroutineScope()
    val cacheSavedMsg  = stringResource(R.string.monitoring_cache_saved)
    val limitsSavedMsg = stringResource(R.string.monitoring_limits_saved)

    // Serverdaten aus dem ViewModel; hiltViewModel() liefert im selben
    // NavHost-Ziel dieselbe Instanz wie in MonitoringScreen.
    val mon: MonitoringViewModel = hiltViewModel()
    val monState by mon.state.collectAsStateWithLifecycle()
    val cacheStats = monState.cacheStats
    val apiLimits  = monState.apiLimits
    val cacheTtl   = monState.cacheTtl
    val defaultCondition = monState.vorgabeZustand

    // Bedienzustand: was gerade bearbeitet und halb eingetippt ist. Bleibt hier
    // und speicherbar — das ueberlebt auch den Prozesstod, ein ViewModel nicht.
    var editingTtl by rememberSaveable { mutableStateOf(false) }
    var ttlInput   by rememberSaveable { mutableStateOf("24") }
    var editingLimits by rememberSaveable { mutableStateOf(false) }
    var rbInput    by rememberSaveable { mutableStateOf("0") }
    var blInput    by rememberSaveable { mutableStateOf("0") }
    var bsInput    by rememberSaveable { mutableStateOf("0") }

    LaunchedEffect(Unit) { mon.ladeCacheUndGrenzen() }

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
    AppKarte(Modifier.padding(horizontal = 16.dp, vertical = 5.dp)) {
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
                        ) { Text("OK", fontSize = 12.sp) }
                        TextButton(onClick = { editingTtl = false }) { Text("✕") }
                    }
                } else {
                    Row(
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Text(stringResource(R.string.monitoring_cache_ttl_hours, cacheTtl), fontWeight = FontWeight.SemiBold, fontSize = 14.sp)
                        FilledTonalIconButton(
                            onClick = { editingTtl = true },
                            modifier = Modifier.size(30.dp)
                        ) { Icon(Icons.Default.Edit, stringResource(R.string.cd_edit_cache_ttl), Modifier.size(14.dp)) }
                    }
                }
            }
        }
    }

    // ── API Rate Limits ───────────────────────────────────────────────────────
    AppKarte(Modifier.padding(horizontal = 16.dp, vertical = 5.dp)) {
        Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Row(Modifier.fillMaxWidth(), Arrangement.SpaceBetween, Alignment.CenterVertically) {
                Text(stringResource(R.string.monitoring_api_calls).uppercase(),
                    style = MaterialTheme.typography.labelSmall,
                    fontWeight = FontWeight.Bold,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    letterSpacing = 0.8.sp)
                FilledTonalIconButton(
                    onClick = { editingLimits = !editingLimits },
                    modifier = Modifier.size(30.dp)
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
                    contentPadding = PaddingValues(vertical = 8.dp)
                ) {
                    Icon(Icons.Default.Save, null, Modifier.size(16.dp))
                    Spacer(Modifier.width(6.dp))
                    Text(stringResource(R.string.monitoring_limits_save), fontSize = 13.sp)
                }
            }
        }
    }
}

@Composable
private fun CacheStatCell(label: String, value: String) {
    Column(horizontalAlignment = Alignment.CenterHorizontally) {
        Text(value, fontWeight = FontWeight.Bold, fontSize = 15.sp)
        Text(label, style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant, fontSize = 10.sp)
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
    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(3.dp)) {
        Row(Modifier.fillMaxWidth(), Arrangement.SpaceBetween, Alignment.CenterVertically) {
            Text(label, style = MaterialTheme.typography.bodyMedium)
            if (editValue != null) {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                    Text("${rl.count} /", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    OutlinedTextField(
                        value = editValue,
                        onValueChange = { onEdit(NumericInput.quantity(it)) },
                        modifier = Modifier.width(80.dp),
                        singleLine = true,
                        shape = Formen.etikett,
                        textStyle = LocalTextStyle.current.copy(fontSize = 13.sp),
                    keyboardOptions = NumericInput.ganzzahlTastatur()
                )
                }
            } else {
                Text("${rl.count} / ${rl.limit}",
                    style = MaterialTheme.typography.bodySmall,
                    fontWeight = FontWeight.SemiBold,
                    color = color)
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
 * Das Server-Protokoll — dieselbe Ansicht, die die Webapp unter „Logs" zeigt.
 *
 * Wird NICHT von selbst geladen: Es sind bis zu 5000 Zeilen, und wer das
 * Monitoring oeffnet, will in aller Regel die Job-Karten sehen. Ein Abruf beim
 * Betreten waere Datenverkehr fuer etwas, das niemand angesehen hat.
 */
@Composable
internal fun ProtokollSection(vm: MainViewModel) {
    val verwaltung by vm.verwaltungState.collectAsStateWithLifecycle()
    var offen by rememberSaveable { mutableStateOf(false) }

    AppKarte {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Row(Modifier.fillMaxWidth(), Arrangement.SpaceBetween, Alignment.CenterVertically) {
                Text(stringResource(R.string.admin_log_title),
                    fontWeight = FontWeight.Bold, fontSize = 15.sp)
                Row(verticalAlignment = Alignment.CenterVertically) {
                    if (verwaltung.protokollLaden) {
                        CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp)
                    } else if (offen) {
                        IconButton(onClick = { vm.ladeProtokoll() }) {
                            Icon(Icons.Default.Refresh, stringResource(R.string.admin_log_reload),
                                Modifier.size(18.dp))
                        }
                    }
                    IconButton(onClick = {
                        offen = !offen
                        if (offen && verwaltung.protokoll.isEmpty()) vm.ladeProtokoll()
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
                                onClick = { vm.ladeProtokoll(min) },
                                label = { Text(stringResource(R.string.admin_log_minutes, min),
                                               style = MaterialTheme.typography.labelSmall) },
                                shape = Formen.chip)
                        }
                    }
                    // Der Fehler VOR der Leermeldung, und statt ihrer: „Keine
                    // Eintraege in diesem Zeitraum" waere hier die falsche
                    // Auskunft — es gibt keine Eintraege, WEIL der Abruf
                    // scheiterte, nicht weil der Server still war. Gelesen wird
                    // das Feld nur hier; die Kontenkarte, die es vorher zeigte,
                    // ist entfallen (Nachtrag 129).
                    if (verwaltung.fehler != null) {
                        Text(verwaltung.fehler!!, style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.error)
                    } else if (verwaltung.protokoll.isEmpty() && !verwaltung.protokollLaden) {
                        Text(stringResource(R.string.admin_log_empty),
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                    verwaltung.protokoll.forEach { zeile ->
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
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
