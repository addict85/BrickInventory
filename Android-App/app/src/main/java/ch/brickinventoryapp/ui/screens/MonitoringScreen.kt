package ch.brickinventoryapp.ui.screens

import ch.brickinventoryapp.ui.theme.Formen
import ch.brickinventoryapp.ui.theme.AppKarte
import ch.brickinventoryapp.ui.theme.LocalStatusFarben
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
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
import androidx.lifecycle.repeatOnLifecycle
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun MonitoringScreen(vm: MainViewModel) {
    val scope  = rememberCoroutineScope()
    val retryErrorMsg  = stringResource(R.string.monitoring_retry_error)
    val deleteErrorMsg = stringResource(R.string.monitoring_delete_error)
    val startErrorMsg  = stringResource(R.string.monitoring_start_error)
    val cacheSavedMsg  = stringResource(R.string.monitoring_cache_saved)
    val limitsSavedMsg = stringResource(R.string.monitoring_limits_saved)
    val queueShowFmt   = stringResource(R.string.monitoring_queue_show)
    val retryQueuedFmt = stringResource(R.string.monitoring_retry_queued)
    val entryRemovedFmt = stringResource(R.string.monitoring_entry_removed)
    var jobs   by remember { mutableStateOf<Map<String, JobStatus>>(emptyMap()) }
    var queue  by remember { mutableStateOf<List<BricksetQueueEntry>>(emptyList()) }
    var queueOpen      by remember { mutableStateOf(false) }
    var queueToggleKey by remember { mutableIntStateOf(0) }
    var queueLoading   by remember { mutableStateOf(false) }
    var reimportMsg    by remember { mutableStateOf<String?>(null) }
    var isRefreshing   by remember { mutableStateOf(false) }
    var snack          by remember { mutableStateOf<String?>(null) }

    val monCtx = androidx.compose.ui.platform.LocalContext.current
    val reimportLoadingMsg = stringResource(R.string.monitoring_loading)
    val reimportErrorMsg   = stringResource(R.string.monitoring_reimport_error)

    suspend fun loadJobs() {
        isRefreshing = true
        when (val r = vm.repo.getJobs()) {
            is Result.Success -> jobs = r.data.jobs
            is Result.Error -> {}
        }
        isRefreshing = false
    }

    suspend fun loadQueue() {
        queueLoading = true
        when (val r = vm.repo.getBricksetQueue()) {
            is Result.Success -> queue = r.data.entries
            is Result.Error -> {}
        }
        queueLoading = false
    }

    // Auto-refresh jobs every 5s — nur solange der Screen sichtbar ist.
    // repeatOnLifecycle(STARTED) pausiert die Schleife, wenn die App in den
    // Hintergrund geht (statt weiterzupollen, bis der Screen verlassen wird),
    // und startet sie beim Zurückkehren neu.
    val monitoringLifecycleOwner = androidx.lifecycle.compose.LocalLifecycleOwner.current
    LaunchedEffect(Unit) {
        monitoringLifecycleOwner.lifecycle.repeatOnLifecycle(androidx.lifecycle.Lifecycle.State.STARTED) {
            while (true) { loadJobs(); delay(5000) }
        }
    }

    LaunchedEffect(queueToggleKey) {
        if (queueOpen) loadQueue()
    }

    LaunchedEffect(snack) {
        snack?.let { vm.showSnackbar(it); snack = null }
    }

    LazyColumn(
        modifier = Modifier.fillMaxSize(),
            contentPadding = PaddingValues(horizontal = 16.dp, vertical = 12.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp)
        ) {
            // Header
            item {
                Row(Modifier.fillMaxWidth(), Arrangement.SpaceBetween, Alignment.CenterVertically) {
                    Text(stringResource(R.string.monitoring_title), fontWeight = FontWeight.Bold, fontSize = 18.sp)
                    if (isRefreshing) CircularProgressIndicator(Modifier.size(20.dp), strokeWidth = 2.dp)
                    else IconButton(onClick = { scope.launch { loadJobs() } }) {
                        Icon(Icons.Default.Refresh, stringResource(R.string.monitoring_refresh))
                    }
                }
            }

            // Cache stats + API limits
            item {
                CacheAndLimitsSection(vm, onSnack = { snack = it })
            }

            // Job cards
            items(jobs.entries.toList(), key = { it.key }) { (key, job) ->
                JobCard(
                    jobKey   = key,
                    job      = job,
                    queueOpen = queueOpen,
                    queueLoading = queueLoading,
                    queue    = queue,
                    reimportMsg = reimportMsg,
                    vm       = vm,
                    onSnack  = { snack = it },
                    onToggleQueue = {
                        queueOpen = !queueOpen
                        if (queueOpen) queueToggleKey++
                    },
                    onRetry = { sn ->
                        scope.launch {
                            when (vm.repo.retryBricksetEntry(sn)) {
                                is Result.Success -> { snack = String.format(retryQueuedFmt, sn); queueToggleKey++ }
                                is Result.Error -> snack = retryErrorMsg
                            }
                        }
                    },
                    onDelete = { sn ->
                        scope.launch {
                            // Optimistic remove
                            queue = queue.filter { it.setNumber != sn }
                            val result = vm.repo.deleteBricksetEntry(sn)
                            when (result) {
                                is Result.Success -> snack = "$sn entfernt"
                                is Result.Error -> {
                                    // Revert on failure
                                    snack = deleteErrorMsg
                                    loadQueue()
                                }
                            }
                        }
                    },
                    onReimport = {
                        scope.launch {
                            reimportMsg = reimportLoadingMsg
                            when (val r = vm.repo.reimportInstructions()) {
                                is Result.Success -> {
                                    reimportMsg = monCtx.getString(R.string.monitoring_reimport_enqueued, r.data.enqueued)
                                    scope.launch { delay(4000); reimportMsg = null }
                                }
                                is Result.Error -> { reimportMsg = null; snack = reimportErrorMsg }
                            }
                        }
                    }
                )
            }
        }
}

@Composable
private fun JobCard(
    jobKey: String,
    job: JobStatus,
    queueOpen: Boolean,
    queueLoading: Boolean,
    queue: List<BricksetQueueEntry>,
    reimportMsg: String?,
    vm: MainViewModel,
    onSnack: (String) -> Unit,
    onToggleQueue: () -> Unit,
    onRetry: (String) -> Unit,
    onDelete: (String) -> Unit,
    onReimport: () -> Unit
) {
    val scope = rememberCoroutineScope()
    val retryErrorMsg  = stringResource(R.string.monitoring_retry_error)
    val deleteErrorMsg = stringResource(R.string.monitoring_delete_error)
    val startErrorMsg  = stringResource(R.string.monitoring_start_error)
    val startingMsg      = stringResource(R.string.monitoring_starting)
    val startedMsg       = stringResource(R.string.monitoring_started)
    val syncStartedMsg   = stringResource(R.string.monitoring_sync_started_short)
    val cacheSavedMsg  = stringResource(R.string.monitoring_cache_saved)
    val limitsSavedMsg = stringResource(R.string.monitoring_limits_saved)
    val queueShowFmt   = stringResource(R.string.monitoring_queue_show)
    val statusColor = when (job.status) {
        "running" -> MaterialTheme.colorScheme.primary
        "done"    -> LocalStatusFarben.current.erfolg
        "error"   -> MaterialTheme.colorScheme.error
        else      -> MaterialTheme.colorScheme.onSurfaceVariant
    }
    val statusIcon = when (job.status) {
        "running" -> "⏳"
        "done"    -> "✅"
        "error"   -> "❌"
        else      -> "⏸"
    }
    val pct = if (job.total > 0) (job.progress.toFloat() / job.total).coerceIn(0f, 1f) else 0f

    AppKarte {
        Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            // Title row
            Row(Modifier.fillMaxWidth(), Arrangement.SpaceBetween, Alignment.CenterVertically) {
                Text(job.label.ifBlank { jobKey }, fontWeight = FontWeight.SemiBold, fontSize = 14.sp,
                    modifier = Modifier.weight(1f))
                Text("$statusIcon ${job.status}", color = statusColor,
                    style = MaterialTheme.typography.labelSmall, fontWeight = FontWeight.Bold)
            }

            // Progress bar
            if (job.total > 0) {
                LinearProgressIndicator(
                    progress = { pct },
                    modifier = Modifier.fillMaxWidth().height(4.dp).padding(0.dp),
                    color = statusColor,
                    trackColor = MaterialTheme.colorScheme.surfaceVariant
                )
                Text("${job.progress} / ${job.total}", style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant)
            }

            // Sub info
            job.sub?.let {
                Text(it, style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant)
            }

            // Action buttons
            if (jobKey == "csvImport") {
                var csvMsg by remember { mutableStateOf<String?>(null) }
                FilledTonalButton(
                    onClick = {
                        scope.launch {
                            csvMsg = startingMsg
                            when (vm.repo.triggerCsvSync()) {
                                is Result.Success -> {
                                    csvMsg = syncStartedMsg
                                    kotlinx.coroutines.delay(4000)
                                    csvMsg = null
                                }
                                is Result.Error -> { csvMsg = null; onSnack(startErrorMsg) }
                            }
                        }
                    },
                    shape = Formen.kachel,
                    contentPadding = PaddingValues(horizontal = 12.dp, vertical = 6.dp),
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Icon(Icons.Default.Sync, null, Modifier.size(16.dp))
                    Spacer(Modifier.width(6.dp))
                    Text(csvMsg ?: stringResource(R.string.monitoring_sync_now), fontSize = 12.sp)
                }
            }

            if (jobKey == "priceJob") {
                var priceMsg by remember { mutableStateOf<String?>(null) }
                FilledTonalButton(
                    onClick = {
                        scope.launch {
                            priceMsg = startingMsg
                            when (vm.repo.triggerPriceJob()) {
                                is Result.Success -> {
                                    priceMsg = startedMsg
                                    kotlinx.coroutines.delay(4000)
                                    priceMsg = null
                                }
                                is Result.Error -> { priceMsg = null; onSnack(startErrorMsg) }
                            }
                        }
                    },
                    shape = Formen.kachel,
                    contentPadding = PaddingValues(horizontal = 12.dp, vertical = 6.dp),
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Icon(Icons.Default.Refresh, null, Modifier.size(16.dp))
                    Spacer(Modifier.width(6.dp))
                    Text(priceMsg ?: stringResource(R.string.monitoring_price_update), fontSize = 12.sp)
                }
            }

            if (jobKey == "imgDl") {
                var redlMsg by remember { mutableStateOf<String?>(null) }
                FilledTonalButton(
                    onClick = {
                        scope.launch {
                            redlMsg = startingMsg
                            when (vm.repo.redownloadMissingImages()) {
                                is Result.Success -> {
                                    redlMsg = startedMsg
                                    kotlinx.coroutines.delay(4000)
                                    redlMsg = null
                                }
                                is Result.Error -> { redlMsg = null; onSnack(startErrorMsg) }
                            }
                        }
                    },
                    shape = Formen.kachel,
                    contentPadding = PaddingValues(horizontal = 12.dp, vertical = 6.dp),
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Icon(Icons.Default.Download, null, Modifier.size(16.dp))
                    Spacer(Modifier.width(6.dp))
                    Text(redlMsg ?: stringResource(R.string.monitoring_redownload_missing), fontSize = 12.sp)
                }
            }

            if (jobKey == "instrQueue") {
                FilledTonalButton(
                    onClick = onReimport,
                    shape = Formen.kachel,
                    contentPadding = PaddingValues(horizontal = 12.dp, vertical = 6.dp),
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Icon(Icons.Default.Download, null, Modifier.size(16.dp))
                    Spacer(Modifier.width(6.dp))
                    Text(reimportMsg ?: stringResource(R.string.monitoring_import_missing_instr), fontSize = 12.sp)
                }
            }

            if (jobKey == "bricksetRetry" && job.total > 0) {
                FilledTonalButton(
                    onClick = onToggleQueue,
                    shape = Formen.kachel,
                    contentPadding = PaddingValues(horizontal = 12.dp, vertical = 6.dp),
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Icon(if (queueOpen) Icons.Default.ExpandLess else Icons.Default.ExpandMore,
                        null, Modifier.size(16.dp))
                    Spacer(Modifier.width(6.dp))
                    Text(if (queueOpen) stringResource(R.string.monitoring_queue_collapse) else String.format(queueShowFmt, job.total), fontSize = 12.sp)
                }

                AnimatedVisibility(queueOpen) {
                    if (queueLoading) {
                        Box(Modifier.fillMaxWidth().padding(8.dp), Alignment.Center) {
                            CircularProgressIndicator(Modifier.size(20.dp), strokeWidth = 2.dp)
                        }
                    } else {
                        Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                            Spacer(Modifier.height(4.dp))
                            queue.forEach { entry ->
                                BricksetQueueRow(entry, onRetry, onDelete)
                            }
                        }
                    }
                }
            }
        }
    }
}


// ── Cache & API Limits section ────────────────────────────────────────────────



