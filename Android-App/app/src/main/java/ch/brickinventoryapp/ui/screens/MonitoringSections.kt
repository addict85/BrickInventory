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
import ch.brickinventoryapp.data.repository.Result
import androidx.compose.ui.res.stringResource
import ch.brickinventoryapp.R
import ch.brickinventoryapp.ui.MainViewModel
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
    val retryErrorMsg  = stringResource(R.string.monitoring_retry_error)
    val deleteErrorMsg = stringResource(R.string.monitoring_delete_error)
    val startErrorMsg  = stringResource(R.string.monitoring_start_error)
    val cacheSavedMsg  = stringResource(R.string.monitoring_cache_saved)
    val limitsSavedMsg = stringResource(R.string.monitoring_limits_saved)
    val queueShowFmt   = stringResource(R.string.monitoring_queue_show)
    var cacheStats by remember { mutableStateOf<CacheStatsResponse?>(null) }
    var apiLimits  by remember { mutableStateOf<ApiLimits?>(null) }
    var cacheTtl   by rememberSaveable { mutableStateOf("24") }
    var editingTtl by rememberSaveable { mutableStateOf(false) }
    var ttlInput   by rememberSaveable { mutableStateOf("24") }
    var defaultCondition by rememberSaveable { mutableStateOf("N") }
    var editingLimits by rememberSaveable { mutableStateOf(false) }
    var rbInput    by rememberSaveable { mutableStateOf("0") }
    var blInput    by rememberSaveable { mutableStateOf("0") }
    var bsInput    by rememberSaveable { mutableStateOf("0") }

    LaunchedEffect(Unit) {
        val cs = vm.repo.getCacheStats()
        if (cs is Result.Success) cacheStats = cs.data
        val al = vm.repo.getApiLimits()
        if (al is Result.Success) { apiLimits = al.data.limits; rbInput = al.data.limits.rebrickable.toString(); blInput = al.data.limits.bricklink.toString(); bsInput = al.data.limits.brickset.toString() }
        val ttl = vm.repo.getCacheTtl()
        if (ttl is Result.Success) { cacheTtl = ttl.data.ttl; ttlInput = ttl.data.ttl }
        val dc = vm.repo.getDefaultCondition()
        if (dc is Result.Success) defaultCondition = dc.data.condition
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
                        defaultCondition = newCond
                        scope.launch {
                            val r = vm.repo.setDefaultCondition(newCond)
                            if (r is Result.Success) {
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
                                    val r = vm.repo.setCacheTtl(h)
                                    if (r is Result.Success) { cacheTtl = h.toString(); onSnack(cacheSavedMsg) }
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
                            val r = vm.repo.setApiLimits(rb, bl, bs)
                            if (r is Result.Success) {
                                // refresh
                                val al2 = vm.repo.getApiLimits()
                                if (al2 is Result.Success) apiLimits = al2.data.limits
                                onSnack(limitsSavedMsg)
                            }
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
