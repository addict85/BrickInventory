package ch.brickinventoryapp.verwaltung.ui.screens

import ch.brickinventoryapp.model.fach.Laufstatus
import ch.brickinventoryapp.model.ui.theme.Design
import ch.brickinventoryapp.data.VorwaermNetz
import ch.brickinventoryapp.verwaltung.ui.viewmodel.HintergrundUiState
import ch.brickinventoryapp.verwaltung.ui.viewmodel.MonitoringUiState
import ch.brickinventoryapp.zustand.ui.viewmodel.GeraeteEinstellungenViewModel
import ch.brickinventoryapp.verwaltung.ui.viewmodel.MonitoringAktionen
import ch.brickinventoryapp.model.ui.model.BricksetEintragAnsicht
import ch.brickinventoryapp.model.ui.model.JobZustandAnsicht
import ch.brickinventoryapp.model.ui.model.ZeitplanAnsicht
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
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import ch.brickinventoryapp.model.ui.model.*
import androidx.compose.ui.res.stringResource
import ch.brickinventoryapp.ressourcen.R
import ch.brickinventoryapp.verwaltung.ui.viewmodel.MonitoringViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import ch.brickinventoryapp.model.ui.*
import ch.brickinventoryapp.ui.*
import ch.brickinventoryapp.verwaltung.ui.*
import ch.brickinventoryapp.zustand.ui.*
import androidx.lifecycle.repeatOnLifecycle
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import ch.brickinventoryapp.ui.theme.Abstaende
import ch.brickinventoryapp.ui.components.MitTooltip
import ch.brickinventoryapp.ui.components.mitSchrift

/** Was die Verwaltungsseite zeigt; die Route sammelt es aus den Flüssen. */
data class MonitoringZustand(
    val monState: MonitoringUiState,
    val hintergrund: HintergrundUiState,
    val verwaltung: VerwaltungUiState,
    val netze: Map<VorwaermNetz, Boolean>,
    val appTheme: Design,
    val ablageBytes: Long,
)

/**
 * Die Verwaltungsseite am Navigationsziel. Hier laufen die Abfrage alle fünf
 * Sekunden (nur sichtbar, repeatOnLifecycle) und das Nachladen der Einstellungen.
 */
@Composable
internal fun MonitoringRoute(
    appTheme: Design,
    /** Design oder Vorgabe-Zustand geändert: Die App lädt ihre Einstellungen nach. */
    onEinstellungenNeu: () -> Unit,
    mon: MonitoringViewModel = hiltViewModel(),
    geraet: GeraeteEinstellungenViewModel = hiltViewModel(),
) {
    val monState by mon.state.collectAsStateWithLifecycle()
    val hintergrund by mon.hintergrund.collectAsStateWithLifecycle()
    val verwaltung by mon.verwaltungState.collectAsStateWithLifecycle()
    val netze by geraet.vorwaermen.collectAsStateWithLifecycle()
    val ablageBytes by geraet.ablageBytes.collectAsStateWithLifecycle()
    val einstellungenNeu by mon.einstellungenNeu.collectAsStateWithLifecycle()
    val lebenszyklus = androidx.lifecycle.compose.LocalLifecycleOwner.current
    LaunchedEffect(Unit) {
        lebenszyklus.lifecycle.repeatOnLifecycle(androidx.lifecycle.Lifecycle.State.STARTED) {
            mon.haltAktuell()
        }
    }
    LaunchedEffect(Unit) { mon.ladeCacheAbschnitt() }
    LaunchedEffect(einstellungenNeu) {
        if (einstellungenNeu) { onEinstellungenNeu(); mon.einstellungenGeladen() }
    }
    val cacheEreignisse = remember(mon, geraet) {
        CacheEreignisse(
            vorgabeZustand = mon::vorgabeZustandWaehlen,
            ablageLeeren = geraet::ablageLeeren,
            netz = geraet::vorwaermen,
            design = mon::designWaehlen,
            cacheDauer = mon::cacheDauerSpeichern,
            cacheLeeren = mon::cacheLeeren,
            grenzwerte = mon::grenzwerteSpeichern,
        )
    }
    MonitoringScreen(
        MonitoringZustand(monState, hintergrund, verwaltung, netze, appTheme, ablageBytes),
        mon, cacheEreignisse,
    )
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun MonitoringScreen(zustand: MonitoringZustand, aktionen: MonitoringAktionen, cacheEreignisse: CacheEreignisse) {
    val scope  = rememberCoroutineScope()
    val retryErrorMsg  = stringResource(R.string.monitoring_retry_error)
    val deleteErrorMsg = stringResource(R.string.monitoring_delete_error)
    val retryQueuedFmt = stringResource(R.string.monitoring_retry_queued)
    val entryRemovedFmt = stringResource(R.string.monitoring_entry_removed)
    val monState = zustand.monState
    val jobs = monState.jobs
    val queue = monState.queue
    val queueLoading = monState.queueLoading
    val isRefreshing = monState.aktualisiert

    // Bedienzustand bleibt hier: rememberSaveable ueberlebt auch den Prozesstod,
    // ein ViewModel nur die Drehung.
    var queueOpen      by rememberSaveable { mutableStateOf(false) }
    var queueToggleKey by remember { mutableIntStateOf(0) }
    // Laufender Vorgang bzw. fluechtige Meldung — soll die Drehung NICHT ueberleben.
    var reimportMsg    by remember { mutableStateOf<String?>(null) }
    var snack          by remember { mutableStateOf<String?>(null) }

    // LocalResources statt Context: Die Zahl fuer den Platzhalter ist erst im
    // Rueckruf bekannt, und ein gegriffener Context veraltet bei Konfigurationswechsel.
    val monRes = androidx.compose.ui.platform.LocalResources.current
    val reimportLoadingMsg = stringResource(R.string.common_loading)
    val reimportErrorMsg   = stringResource(R.string.monitoring_reimport_error)

    LaunchedEffect(queueToggleKey) {
        if (queueOpen) aktionen.ladeWarteschlange()
    }

    LaunchedEffect(snack) {
        snack?.let { aktionen.melde(it); snack = null }
    }
    val hintergrund = zustand.hintergrund

    LazyColumn(
        modifier = Modifier.fillMaxSize(),
            contentPadding = PaddingValues(horizontal = Abstaende.gross, vertical = Abstaende.mittel),
            verticalArrangement = Arrangement.spacedBy(10.dp)
        ) {
            // Header
            item {
                Row(Modifier.fillMaxWidth(), Arrangement.SpaceBetween, Alignment.CenterVertically) {
                    Text(stringResource(R.string.monitoring_title), fontWeight = FontWeight.Bold, style = MaterialTheme.typography.titleLarge)
                    if (isRefreshing) CircularProgressIndicator(Modifier.size(20.dp), strokeWidth = 2.dp)
                    else MitTooltip(stringResource(R.string.monitoring_refresh)) {
                        IconButton(onClick = { scope.launch { aktionen.ladeJobs() } }) {
                            Icon(Icons.Default.Refresh, stringResource(R.string.monitoring_refresh))
                        }
                    }
                }
            }

            // Die Auftragstabelle: was im Hintergrund wartet, läuft oder scheiterte.
            item {
                HintergrundSection(hintergrund, aktionen::auftragsArtStarten, aktionen::auftragsArtLeeren,
                    aktionen::auftragAbbrechen, aktionen::auftragWiederholen)
            }

            // Cache stats + API limits
            item {
                CacheAndLimitsSection(monState, zustand.netze, zustand.appTheme,
                    zustand.ablageBytes, cacheEreignisse)
            }

            // Das Server-Protokoll — dieselbe Ansicht wie in der Webapp. Keine eigene
            // Rechteprüfung hier: Der einzige Weg hierher ist der Menüeintrag in MainScaffold,
            // der nur bei `isAdmin` steht, und massgeblich ist der Server (requireApiAdmin,
            // sonst 403). Eine dritte Stelle, die „ist das ein Verwalter“ entscheidet, wäre
            // eine zweite Wahrheit.
            item { ProtokollSection(zustand.verwaltung, aktionen) }

            // Job cards
            items(jobs.entries.toList(), key = { it.key }) { (key, job) ->
                JobCard(
                    jobKey   = key,
                    job      = job,
                    schedule = monState.jobSchedules[key],
                    queueOpen = queueOpen,
                    queueLoading = queueLoading,
                    queue    = queue,
                    reimportMsg = reimportMsg,
                    aktionen = aktionen,
                    onSnack  = { snack = it },
                    onToggleQueue = {
                        queueOpen = !queueOpen
                        if (queueOpen) queueToggleKey++
                    },
                    onRetry = { sn ->
                        scope.launch {
                            snack = if (aktionen.wiederholeEintrag(sn)) String.format(retryQueuedFmt, sn)
                                    else retryErrorMsg
                        }
                    },
                    onDelete = { sn ->
                        scope.launch {
                            // Das Vorwegnehmen und das Wiederherstellen bei Fehlschlag
                            // stehen jetzt im ViewModel — hier bleibt die Meldung.
                            snack = if (aktionen.entferneEintrag(sn)) String.format(entryRemovedFmt, sn)
                                    else deleteErrorMsg
                        }
                    },
                    onReimport = {
                        scope.launch {
                            reimportMsg = reimportLoadingMsg
                            val eingereiht = aktionen.leseAnleitungenNeuEin()
                            if (eingereiht != null) {
                                reimportMsg = monRes.getQuantityString(
                                    R.plurals.monitoring_reimport_enqueued,
                                    eingereiht, eingereiht)
                                scope.launch { delay(4000); reimportMsg = null }
                            } else {
                                reimportMsg = null; snack = reimportErrorMsg
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
    job: JobZustandAnsicht,
    /** Zeitplan dieses Jobs, oder null — dann steht die Zeile nicht da. */
    schedule: ZeitplanAnsicht?,
    queueOpen: Boolean,
    queueLoading: Boolean,
    queue: List<BricksetEintragAnsicht>,
    reimportMsg: String?,
    aktionen: MonitoringAktionen,
    onSnack: (String) -> Unit,
    onToggleQueue: () -> Unit,
    onRetry: (String) -> Unit,
    onDelete: (String) -> Unit,
    onReimport: () -> Unit
) {
    val scope = rememberCoroutineScope()
    val startErrorMsg  = stringResource(R.string.monitoring_start_error)
    val startingMsg      = stringResource(R.string.monitoring_starting)
    val startedMsg       = stringResource(R.string.monitoring_started)
    val syncStartedMsg   = stringResource(R.string.monitoring_sync_started_short)
    val queueShowFmt   = stringResource(R.string.monitoring_queue_show)
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

    AppKarte {
        Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(Abstaende.klein)) {
            // Title row
            Row(Modifier.fillMaxWidth(), Arrangement.SpaceBetween, Alignment.CenterVertically) {
                Text(job.label.ifBlank { jobKey }, fontWeight = FontWeight.SemiBold, style = MaterialTheme.typography.bodyMedium,
                    modifier = Modifier.weight(1f))
                Row(verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(Abstaende.winzig)) {
                    Icon(statusIcon, null, Modifier.size(mitSchrift(14.dp)), tint = statusColor)
                    Text(job.status.kennung, color = statusColor,
                        style = MaterialTheme.typography.labelSmall, fontWeight = FontWeight.Bold)
                }
            }

            // Progress bar
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

            // Sub info
            job.sub?.let {
                Text(it, style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant)
            }

            // ── Zeitplan ──
            //
            // Kommt mit `/admin/jobs` und zeigt, wann ein Job das nächste Mal läuft — nicht
            // nur, dass er läuft.
            schedule?.let { ZeitplanZeile(jobKey, it, aktionen, onSnack) }

            // Action buttons
            if (jobKey == "csvImport") {
                var csvMsg by remember { mutableStateOf<String?>(null) }
                FilledTonalButton(
                    onClick = {
                        scope.launch {
                            csvMsg = startingMsg
                            if (aktionen.starteCsvAbgleich()) {
                                csvMsg = syncStartedMsg
                                kotlinx.coroutines.delay(4000)
                                csvMsg = null
                            } else { csvMsg = null; onSnack(startErrorMsg) }
                        }
                    },
                    contentPadding = PaddingValues(horizontal = Abstaende.mittel, vertical = 6.dp),
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Icon(Icons.Default.Sync, null, Modifier.size(mitSchrift(16.dp)))
                    Spacer(Modifier.width(6.dp))
                    Text(csvMsg ?: stringResource(R.string.monitoring_sync_now), style = MaterialTheme.typography.labelMedium)
                }
            }

            if (jobKey == "priceJob") {
                var priceMsg by remember { mutableStateOf<String?>(null) }
                FilledTonalButton(
                    onClick = {
                        scope.launch {
                            priceMsg = startingMsg
                            if (aktionen.startePreislauf()) {
                                priceMsg = startedMsg
                                kotlinx.coroutines.delay(4000)
                                priceMsg = null
                            } else { priceMsg = null; onSnack(startErrorMsg) }
                        }
                    },
                    contentPadding = PaddingValues(horizontal = Abstaende.mittel, vertical = 6.dp),
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Icon(Icons.Default.Refresh, null, Modifier.size(mitSchrift(16.dp)))
                    Spacer(Modifier.width(6.dp))
                    Text(priceMsg ?: stringResource(R.string.monitoring_price_update), style = MaterialTheme.typography.labelMedium)
                }
            }

            if (jobKey == "imgDl") {
                var redlMsg by remember { mutableStateOf<String?>(null) }
                FilledTonalButton(
                    onClick = {
                        scope.launch {
                            redlMsg = startingMsg
                            if (aktionen.ladeFehlendeBilderNach()) {
                                redlMsg = startedMsg
                                kotlinx.coroutines.delay(4000)
                                redlMsg = null
                            } else { redlMsg = null; onSnack(startErrorMsg) }
                        }
                    },
                    contentPadding = PaddingValues(horizontal = Abstaende.mittel, vertical = 6.dp),
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Icon(Icons.Default.Download, null, Modifier.size(mitSchrift(16.dp)))
                    Spacer(Modifier.width(6.dp))
                    Text(redlMsg ?: stringResource(R.string.monitoring_redownload_missing), style = MaterialTheme.typography.labelMedium)
                }
                // Der zweite Bilderknopf: Der darüber holt die Bilder des Bestands nach, dieser
                // die des Katalogs — wie in der Webapp (admin.js, queueCatalogImages), damit
                // sich ein fehlendes Katalogbild nachziehen lässt.
                var katMsg by remember { mutableStateOf<String?>(null) }
                FilledTonalButton(
                    onClick = {
                        scope.launch {
                            katMsg = startingMsg
                            if (aktionen.reiheKatalogbilderEin()) {
                                katMsg = startedMsg
                                kotlinx.coroutines.delay(4000)
                                katMsg = null
                            } else { katMsg = null; onSnack(startErrorMsg) }
                        }
                    },
                    contentPadding = PaddingValues(horizontal = Abstaende.mittel, vertical = 6.dp),
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Icon(Icons.Default.Download, null, Modifier.size(mitSchrift(16.dp)))
                    Spacer(Modifier.width(6.dp))
                    Text(katMsg ?: stringResource(R.string.monitoring_catalog_images), style = MaterialTheme.typography.labelMedium)
                }
            }

            if (jobKey == "instrQueue") {
                FilledTonalButton(
                    onClick = onReimport,
                    contentPadding = PaddingValues(horizontal = Abstaende.mittel, vertical = 6.dp),
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Icon(Icons.Default.Download, null, Modifier.size(mitSchrift(16.dp)))
                    Spacer(Modifier.width(6.dp))
                    Text(reimportMsg ?: stringResource(R.string.monitoring_import_missing_instr), style = MaterialTheme.typography.labelMedium)
                }
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
                    Text(if (queueOpen) stringResource(R.string.monitoring_queue_collapse) else String.format(queueShowFmt, job.total), style = MaterialTheme.typography.labelMedium)
                }

                AnimatedVisibility(queueOpen) {
                    if (queueLoading) {
                        Box(Modifier.fillMaxWidth().padding(Abstaende.klein), Alignment.Center) {
                            CircularProgressIndicator(Modifier.size(20.dp), strokeWidth = 2.dp)
                        }
                    } else {
                        Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                            Spacer(Modifier.height(Abstaende.winzig))
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
