package ch.brickinventoryapp.management.ui.screens

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.repeatOnLifecycle
import ch.brickinventoryapp.data.PrewarmNetwork
import ch.brickinventoryapp.management.ui.ManagementUiState
import ch.brickinventoryapp.management.ui.viewmodel.BackgroundUiState
import ch.brickinventoryapp.management.ui.viewmodel.Jobstart
import ch.brickinventoryapp.management.ui.viewmodel.MonitoringActions
import ch.brickinventoryapp.management.ui.viewmodel.MonitoringUiState
import ch.brickinventoryapp.management.ui.viewmodel.MonitoringViewModel
import ch.brickinventoryapp.model.domain.BricksetEntryView
import ch.brickinventoryapp.model.domain.JobStateView
import ch.brickinventoryapp.model.domain.RunStatus
import ch.brickinventoryapp.model.ui.Load
import ch.brickinventoryapp.model.ui.Message
import ch.brickinventoryapp.model.ui.theme.Design
import ch.brickinventoryapp.resources.R
import ch.brickinventoryapp.state.ui.viewmodel.DevicesSettingsViewModel
import ch.brickinventoryapp.ui.components.WithTooltip
import ch.brickinventoryapp.ui.components.withFont
import ch.brickinventoryapp.ui.sentence
import ch.brickinventoryapp.ui.theme.AppCard
import ch.brickinventoryapp.ui.theme.LocalStatusColors
import ch.brickinventoryapp.ui.theme.ReadingWidth
import ch.brickinventoryapp.ui.theme.Spacing
import ch.brickinventoryapp.ui.theme.centeredUntil

/** What the management page shows; the route collects it from the flows. */
data class MonitoringState(
    val monState: MonitoringUiState,
    val background: BackgroundUiState,
    val admin: ManagementUiState,
    val networks: Map<PrewarmNetwork, Boolean>,
    val appTheme: Design,
    val storeBytes: Long,
)

/**
 * Runs [poll] only while the page is at least STARTED: a LaunchedEffect alone ends on leaving
 * the page, not on going to the background, and the app would keep polling there.
 */
@Composable
internal fun PollWhileVisible(poll: suspend () -> Unit) {
    val lifecycle = LocalLifecycleOwner.current
    val current by rememberUpdatedState(poll)
    LaunchedEffect(lifecycle) {
        lifecycle.lifecycle.repeatOnLifecycle(Lifecycle.State.STARTED) { current() }
    }
}

/**
 * The management page at the navigation destination. The query every five seconds only runs
 * while the page is visible (repeatOnLifecycle); the ViewModel loads everything else.
 */
@Composable
internal fun MonitoringRoute(
    appTheme: Design,
    /** Theme or default state changed: the app reloads its settings. */
    onSettingsNew: () -> Unit,
    mon: MonitoringViewModel = hiltViewModel(),
    device: DevicesSettingsViewModel = hiltViewModel(),
) {
    val monState by mon.state.collectAsStateWithLifecycle()
    val background by mon.background.collectAsStateWithLifecycle()
    val admin by mon.managementState.collectAsStateWithLifecycle()
    val networks by device.prewarm.collectAsStateWithLifecycle()
    val storeBytes by device.storeBytes.collectAsStateWithLifecycle()
    val settingsNew by mon.settingsNew.collectAsStateWithLifecycle()
    PollWhileVisible { mon.holdCurrent() }
    LaunchedEffect(settingsNew) {
        if (settingsNew) { onSettingsNew(); mon.settingsLoaded() }
    }
    val cacheEvents = remember(mon, device) {
        CacheEvents(
            defaultState = mon::defaultStateChoose,
            clearStore = device::clearStore,
            network = device::prewarm,
            design = mon::designChoose,
            cacheDuration = mon::saveCacheDuration,
            cacheClear = mon::cacheClear,
            limits = mon::saveLimits,
            retry = mon::reloadSettings,
        )
    }
    MonitoringScreen(
        MonitoringState(monState, background, admin, networks, appTheme, storeBytes),
        mon, cacheEvents,
    )
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun MonitoringScreen(condition: MonitoringState, actions: MonitoringActions, cacheEvents: CacheEvents) {
    val monState = condition.monState
    // Expanded belongs to the person: rememberSaveable survives a process death too.
    var queueOpen by rememberSaveable { mutableStateOf(false) }

    // Centered at form width like the settings: on the tablet the cards otherwise
    // stretched across the whole width, and a job's button and state ended up far apart.
    LazyColumn(
        modifier = Modifier.fillMaxSize().centeredUntil(ReadingWidth.form),
            contentPadding = PaddingValues(horizontal = Spacing.large, vertical = Spacing.medium),
            verticalArrangement = Arrangement.spacedBy(10.dp)
        ) {
            // No title of its own: the bar above already names the page (VerwaltungGraph).
            item {
                Row(Modifier.fillMaxWidth(), Arrangement.End, Alignment.CenterVertically) {
                    if (monState.updated) CircularProgressIndicator(Modifier.size(20.dp), strokeWidth = 2.dp)
                    else WithTooltip(stringResource(R.string.monitoring_refresh)) {
                        IconButton(onClick = actions::refresh) {
                            Icon(Icons.Default.Refresh, stringResource(R.string.monitoring_refresh))
                        }
                    }
                }
            }

            item {
                BackgroundSection(condition.background, actions::jobKindStart, actions::clearJobKind,
                    actions::cancelJob, actions::retryJob)
            }

            item {
                CacheAndLimitsSection(monState, condition.networks, condition.appTheme,
                    condition.storeBytes, cacheEvents)
            }

            // No rights check of its own: the server is authoritative (otherwise 403); a
            // third place that decides "is this an admin" would be a second truth.
            item { LogSection(condition.admin, actions) }

            items(monState.jobs.entries.toList(), key = { it.key }) { (key, job) ->
                JobCard(
                    jobKey   = key,
                    job      = job,
                    monState = monState,
                    queueOpen = queueOpen,
                    actions = actions,
                    onToggleQueue = {
                        queueOpen = !queueOpen
                        if (queueOpen) actions.showQueue()
                    },
                )
            }
        }
}

@Composable
private fun JobCard(
    jobKey: String,
    job: JobStateView,
    /** Schedules, queue and start buttons of all jobs; this card takes its own. */
    monState: MonitoringUiState,
    queueOpen: Boolean,
    actions: MonitoringActions,
    onToggleQueue: () -> Unit,
) {
    // This job's schedule, or null — then the row is not shown.
    val schedule = monState.jobSchedules[jobKey]
    val buttons = monState.buttons
    AppCard {
        Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(Spacing.small)) {
            JobHeader(jobKey, job)
            schedule?.let { ScheduleRow(jobKey, it, actions) }

            val launch = { j: Jobstart -> actions.launch(j) }
            when (jobKey) {
                "csvImport" -> StartButton(Jobstart.CSV_RECONCILE, buttons, Icons.Default.Sync, R.string.monitoring_sync_now, launch)
                "priceJob" -> StartButton(Jobstart.PRICE_RUN, buttons, Icons.Default.Refresh, R.string.monitoring_price_update, launch)
                "imgDl" -> {
                    // The first one fetches the stock's images, the second the catalog's (as in the web app).
                    StartButton(Jobstart.STOCK_IMAGES, buttons, Icons.Default.Download, R.string.monitoring_redownload_missing, launch)
                    StartButton(Jobstart.CATALOG_IMAGES, buttons, Icons.Default.Download, R.string.monitoring_catalog_images, launch)
                }
                "instrQueue" ->
                    StartButton(Jobstart.INSTRUCTIONS, buttons, Icons.Default.Download, R.string.monitoring_import_missing_instr, launch)
            }

            if (jobKey == "bricksetRetry" && job.total > 0) {
                FilledTonalButton(
                    onClick = onToggleQueue,
                    contentPadding = PaddingValues(horizontal = Spacing.medium, vertical = 6.dp),
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Icon(if (queueOpen) Icons.Default.ExpandLess else Icons.Default.ExpandMore,
                        null, Modifier.size(16.dp))
                    Spacer(Modifier.width(6.dp))
                    Text(if (queueOpen) stringResource(R.string.monitoring_queue_collapse) else stringResource(R.string.monitoring_queue_show, job.total), style = MaterialTheme.typography.labelMedium)
                }

                AnimatedVisibility(queueOpen) { Queue(monState.queue, actions) }
            }
        }
    }
}

/** Name, state, progress and addition of a job. */
@Composable
private fun JobHeader(jobKey: String, job: JobStateView) {
    val statusColor = when (job.status) {
        RunStatus.RUNNING -> MaterialTheme.colorScheme.primary
        RunStatus.DONE -> LocalStatusColors.current.success
        RunStatus.ERROR -> MaterialTheme.colorScheme.error
        else              -> MaterialTheme.colorScheme.onSurfaceVariant
    }
    val statusIcon = when (job.status) {
        RunStatus.RUNNING -> Icons.Default.HourglassTop
        RunStatus.DONE -> Icons.Default.CheckCircle
        RunStatus.ERROR -> Icons.Default.Error
        else              -> Icons.Default.PauseCircle
    }
    val pct = if (job.total > 0) (job.progress.toFloat() / job.total).coerceIn(0f, 1f) else 0f

    Row(Modifier.fillMaxWidth(), Arrangement.SpaceBetween, Alignment.CenterVertically) {
        Text(job.label.ifBlank { jobKey }, fontWeight = FontWeight.SemiBold, style = MaterialTheme.typography.bodyMedium,
            modifier = Modifier.weight(1f))
        Row(verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(Spacing.tiny)) {
            Icon(statusIcon, null, Modifier.size(withFont(14.dp)), tint = statusColor)
            Text(job.status.identifier, color = statusColor,
                style = MaterialTheme.typography.labelSmall, fontWeight = FontWeight.Bold)
        }
    }

    if (job.total > 0) {
        LinearProgressIndicator(
            progress = { pct },
            modifier = Modifier.fillMaxWidth().height(4.dp).padding(0.dp),
            color = statusColor,
            trackColor = MaterialTheme.colorScheme.surfaceVariant
        )
        Text("${job.progress} / ${job.total}", style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant)
    }

    job.sub?.let {
        Text(it, style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

/** A start button: its label while it is not running, otherwise "starting…" or what it started. */
@Composable
private fun StartButton(job: Jobstart, buttons: Map<Jobstart, Message>, icon: ImageVector, label: Int, onStart: (Jobstart) -> Unit) {
    val text = buttons[job]?.sentence() ?: stringResource(label)
    FilledTonalButton(
        onClick = { onStart(job) },
        contentPadding = PaddingValues(horizontal = Spacing.medium, vertical = 6.dp),
        modifier = Modifier.fillMaxWidth()
    ) {
        Icon(icon, null, Modifier.size(withFont(16.dp)))
        Spacer(Modifier.width(6.dp))
        Text(text, style = MaterialTheme.typography.labelMedium)
    }
}

@Composable
private fun Queue(queue: Load<List<BricksetEntryView>>, actions: MonitoringActions) {
    when (queue) {
        Load.Loads -> Box(Modifier.fillMaxWidth().padding(Spacing.small), Alignment.Center) {
            CircularProgressIndicator(Modifier.size(20.dp), strokeWidth = 2.dp)
        }
        is Load.Failure -> Text(queue.message.sentence(), color = MaterialTheme.colorScheme.error,
            style = MaterialTheme.typography.bodySmall)
        is Load.Data -> Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Spacer(Modifier.height(Spacing.tiny))
            queue.value.forEach { entry ->
                BricksetQueueRow(entry, actions::retry, actions::remove)
            }
        }
    }
}
