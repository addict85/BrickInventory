package ch.brickinventoryapp.management.ui.screens

import ch.brickinventoryapp.model.domain.Laufstatus
import ch.brickinventoryapp.model.ui.theme.Design
import ch.brickinventoryapp.data.VorwaermNetwork
import ch.brickinventoryapp.management.ui.viewmodel.BackgroundUiState
import ch.brickinventoryapp.management.ui.viewmodel.Jobstart
import ch.brickinventoryapp.model.ui.Meldung
import ch.brickinventoryapp.management.ui.viewmodel.MonitoringUiState
import ch.brickinventoryapp.state.ui.viewmodel.GeraeteEinstellungenViewModel
import ch.brickinventoryapp.management.ui.viewmodel.MonitoringActions
import ch.brickinventoryapp.model.ui.Laden
import ch.brickinventoryapp.model.domain.BricksetEntryView
import ch.brickinventoryapp.model.domain.JobStateView
import ch.brickinventoryapp.model.domain.ScheduleView
import ch.brickinventoryapp.ui.theme.AppKarte
import ch.brickinventoryapp.ui.theme.LocalStatusFarben
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
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.res.stringResource
import ch.brickinventoryapp.resources.R
import ch.brickinventoryapp.management.ui.viewmodel.MonitoringViewModel
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import ch.brickinventoryapp.management.ui.ManagementUiState
import ch.brickinventoryapp.ui.satz
import androidx.lifecycle.repeatOnLifecycle
import ch.brickinventoryapp.ui.theme.Abstaende
import ch.brickinventoryapp.ui.theme.Lesebreite
import ch.brickinventoryapp.ui.theme.centeredUntil
import ch.brickinventoryapp.ui.components.MitTooltip
import ch.brickinventoryapp.ui.components.withFont

/** What the management page shows; the route collects it from the flows. */
data class MonitoringState(
    val monState: MonitoringUiState,
    val hintergrund: BackgroundUiState,
    val verwaltung: ManagementUiState,
    val networks: Map<VorwaermNetwork, Boolean>,
    val appTheme: Design,
    val storeBytes: Long,
)

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
    geraet: GeraeteEinstellungenViewModel = hiltViewModel(),
) {
    val monState by mon.state.collectAsStateWithLifecycle()
    val hintergrund by mon.hintergrund.collectAsStateWithLifecycle()
    val verwaltung by mon.managementState.collectAsStateWithLifecycle()
    val networks by geraet.vorwaermen.collectAsStateWithLifecycle()
    val storeBytes by geraet.storeBytes.collectAsStateWithLifecycle()
    val settingsNew by mon.settingsNew.collectAsStateWithLifecycle()
    val lebenszyklus = LocalLifecycleOwner.current
    LaunchedEffect(Unit) {
        lebenszyklus.lifecycle.repeatOnLifecycle(Lifecycle.State.STARTED) {
            mon.haltAktuell()
        }
    }
    LaunchedEffect(settingsNew) {
        if (settingsNew) { onSettingsNew(); mon.einstellungenGeladen() }
    }
    val cacheEvents = remember(mon, geraet) {
        CacheEvents(
            defaultState = mon::defaultStateChoose,
            clearStore = geraet::clearStore,
            netz = geraet::vorwaermen,
            design = mon::designChoose,
            cacheDuration = mon::saveCacheDuration,
            cacheLeeren = mon::cacheLeeren,
            limits = mon::saveLimits,
        )
    }
    MonitoringScreen(
        MonitoringState(monState, hintergrund, verwaltung, networks, appTheme, storeBytes),
        mon, cacheEvents,
    )
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun MonitoringScreen(zustand: MonitoringState, aktionen: MonitoringActions, cacheEvents: CacheEvents) {
    val monState = zustand.monState
    // Expanded belongs to the person: rememberSaveable survives a process death too.
    var queueOpen by rememberSaveable { mutableStateOf(false) }

    // Centered at form width like the settings: on the tablet the cards otherwise
    // stretched across the whole width, and a job's button and state ended up far apart.
    LazyColumn(
        modifier = Modifier.fillMaxSize().centeredUntil(Lesebreite.formular),
            contentPadding = PaddingValues(horizontal = Abstaende.gross, vertical = Abstaende.mittel),
            verticalArrangement = Arrangement.spacedBy(10.dp)
        ) {
            // No title of its own: the bar above already names the page (VerwaltungGraph).
            item {
                Row(Modifier.fillMaxWidth(), Arrangement.End, Alignment.CenterVertically) {
                    if (monState.aktualisiert) CircularProgressIndicator(Modifier.size(20.dp), strokeWidth = 2.dp)
                    else MitTooltip(stringResource(R.string.monitoring_refresh)) {
                        IconButton(onClick = aktionen::refresh) {
                            Icon(Icons.Default.Refresh, stringResource(R.string.monitoring_refresh))
                        }
                    }
                }
            }

            item {
                BackgroundSection(zustand.hintergrund, aktionen::auftragsArtStarten, aktionen::clearJobKind,
                    aktionen::cancelJob, aktionen::retryJob)
            }

            item {
                CacheAndLimitsSection(monState, zustand.networks, zustand.appTheme,
                    zustand.storeBytes, cacheEvents)
            }

            // No rights check of its own: the server is authoritative (otherwise 403); a
            // third place that decides "is this an admin" would be a second truth.
            item { LogSection(zustand.verwaltung, aktionen) }

            items(monState.jobs.entries.toList(), key = { it.key }) { (key, job) ->
                JobCard(
                    jobKey   = key,
                    job      = job,
                    schedule = monState.jobSchedules[key],
                    queueOpen = queueOpen,
                    queue    = monState.queue,
                    buttons  = monState.buttons,
                    aktionen = aktionen,
                    onToggleQueue = {
                        queueOpen = !queueOpen
                        if (queueOpen) aktionen.showQueue()
                    },
                )
            }
        }
}

@Composable
private fun JobCard(
    jobKey: String,
    job: JobStateView,
    /** This job's schedule, or null — then the row is not shown. */
    schedule: ScheduleView?,
    queueOpen: Boolean,
    queue: Laden<List<BricksetEntryView>>,
    buttons: Map<Jobstart, Meldung>,
    aktionen: MonitoringActions,
    onToggleQueue: () -> Unit,
) {
    AppKarte {
        Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(Abstaende.klein)) {
            JobHeader(jobKey, job)
            schedule?.let { ScheduleRow(jobKey, it, aktionen) }

            val starte = { j: Jobstart -> aktionen.starte(j) }
            when (jobKey) {
                "csvImport" -> StartButton(Jobstart.CSV_ABGLEICH, buttons, Icons.Default.Sync, R.string.monitoring_sync_now, starte)
                "priceJob" -> StartButton(Jobstart.PREISLAUF, buttons, Icons.Default.Refresh, R.string.monitoring_price_update, starte)
                "imgDl" -> {
                    // The first one fetches the stock's images, the second the catalog's (as in the web app).
                    StartButton(Jobstart.BESTANDSBILDER, buttons, Icons.Default.Download, R.string.monitoring_redownload_missing, starte)
                    StartButton(Jobstart.KATALOGBILDER, buttons, Icons.Default.Download, R.string.monitoring_catalog_images, starte)
                }
                "instrQueue" ->
                    StartButton(Jobstart.INSTRUCTIONS, buttons, Icons.Default.Download, R.string.monitoring_import_missing_instr, starte)
            }

            if (jobKey == "bricksetRetry" && job.total > 0) {
                FilledTonalButton(
                    onClick = onToggleQueue,
                    contentPadding = PaddingValues(horizontal = Abstaende.mittel, vertical = 6.dp),
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Icon(if (queueOpen) Icons.Default.ExpandLess else Icons.Default.ExpandMore,
                        null, Modifier.size(16.dp))
                    Spacer(Modifier.width(6.dp))
                    Text(if (queueOpen) stringResource(R.string.monitoring_queue_collapse) else stringResource(R.string.monitoring_queue_show, job.total), style = MaterialTheme.typography.labelMedium)
                }

                AnimatedVisibility(queueOpen) { Warteschlange(queue, aktionen) }
            }
        }
    }
}

/** Name, state, progress and addition of a job. */
@Composable
private fun JobHeader(jobKey: String, job: JobStateView) {
    val statusColor = when (job.status) {
        Laufstatus.LAEUFT -> MaterialTheme.colorScheme.primary
        Laufstatus.FERTIG -> LocalStatusFarben.current.erfolg
        Laufstatus.FEHLER -> MaterialTheme.colorScheme.error
        else              -> MaterialTheme.colorScheme.onSurfaceVariant
    }
    val statusIcon = when (job.status) {
        Laufstatus.LAEUFT -> Icons.Default.HourglassTop
        Laufstatus.FERTIG -> Icons.Default.CheckCircle
        Laufstatus.FEHLER -> Icons.Default.Error
        else              -> Icons.Default.PauseCircle
    }
    val pct = if (job.total > 0) (job.progress.toFloat() / job.total).coerceIn(0f, 1f) else 0f

    Row(Modifier.fillMaxWidth(), Arrangement.SpaceBetween, Alignment.CenterVertically) {
        Text(job.label.ifBlank { jobKey }, fontWeight = FontWeight.SemiBold, style = MaterialTheme.typography.bodyMedium,
            modifier = Modifier.weight(1f))
        Row(verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(Abstaende.tiny)) {
            Icon(statusIcon, null, Modifier.size(withFont(14.dp)), tint = statusColor)
            Text(job.status.kennung, color = statusColor,
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
private fun StartButton(job: Jobstart, buttons: Map<Jobstart, Meldung>, icon: ImageVector, beschriftung: Int, onStart: (Jobstart) -> Unit) {
    val text = buttons[job]?.satz() ?: stringResource(beschriftung)
    FilledTonalButton(
        onClick = { onStart(job) },
        contentPadding = PaddingValues(horizontal = Abstaende.mittel, vertical = 6.dp),
        modifier = Modifier.fillMaxWidth()
    ) {
        Icon(icon, null, Modifier.size(withFont(16.dp)))
        Spacer(Modifier.width(6.dp))
        Text(text, style = MaterialTheme.typography.labelMedium)
    }
}

@Composable
private fun Warteschlange(queue: Laden<List<BricksetEntryView>>, aktionen: MonitoringActions) {
    when (queue) {
        Laden.Loads -> Box(Modifier.fillMaxWidth().padding(Abstaende.klein), Alignment.Center) {
            CircularProgressIndicator(Modifier.size(20.dp), strokeWidth = 2.dp)
        }
        is Laden.Fehler -> Text(queue.meldung.satz(), color = MaterialTheme.colorScheme.error,
            style = MaterialTheme.typography.bodySmall)
        is Laden.Daten -> Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Spacer(Modifier.height(Abstaende.tiny))
            queue.wert.forEach { entry ->
                BricksetQueueRow(entry, aktionen::wiederhole, aktionen::entferne)
            }
        }
    }
}
