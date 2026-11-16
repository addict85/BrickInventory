package ch.brickinventoryapp.verwaltung.ui.screens

import ch.brickinventoryapp.model.fach.Laufstatus
import ch.brickinventoryapp.model.ui.theme.Design
import ch.brickinventoryapp.data.VorwaermNetz
import ch.brickinventoryapp.verwaltung.ui.viewmodel.HintergrundUiState
import ch.brickinventoryapp.verwaltung.ui.viewmodel.Jobstart
import ch.brickinventoryapp.model.ui.Meldung
import ch.brickinventoryapp.verwaltung.ui.viewmodel.MonitoringUiState
import ch.brickinventoryapp.zustand.ui.viewmodel.GeraeteEinstellungenViewModel
import ch.brickinventoryapp.verwaltung.ui.viewmodel.MonitoringAktionen
import ch.brickinventoryapp.model.ui.Laden
import ch.brickinventoryapp.model.fach.BricksetEintragAnsicht
import ch.brickinventoryapp.model.fach.JobZustandAnsicht
import ch.brickinventoryapp.model.fach.ZeitplanAnsicht
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
import ch.brickinventoryapp.ressourcen.R
import ch.brickinventoryapp.verwaltung.ui.viewmodel.MonitoringViewModel
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import ch.brickinventoryapp.verwaltung.ui.VerwaltungUiState
import ch.brickinventoryapp.ui.satz
import androidx.lifecycle.repeatOnLifecycle
import ch.brickinventoryapp.ui.theme.Abstaende
import ch.brickinventoryapp.ui.theme.Lesebreite
import ch.brickinventoryapp.ui.theme.mittigBis
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
 * Die Verwaltungsseite am Navigationsziel. Die Abfrage alle fünf Sekunden läuft nur,
 * solange die Seite zu sehen ist (repeatOnLifecycle); alles andere lädt das ViewModel.
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
    val lebenszyklus = LocalLifecycleOwner.current
    LaunchedEffect(Unit) {
        lebenszyklus.lifecycle.repeatOnLifecycle(Lifecycle.State.STARTED) {
            mon.haltAktuell()
        }
    }
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
    val monState = zustand.monState
    // Aufgeklappt gehört dem Menschen: rememberSaveable übersteht auch den Prozesstod.
    var queueOpen by rememberSaveable { mutableStateOf(false) }

    // Mittig in Formularbreite wie die Einstellungen: Auf dem Tablet zogen sich die Karten
    // sonst über die ganze Breite, Knopf und Zustand eines Auftrags standen weit auseinander.
    LazyColumn(
        modifier = Modifier.fillMaxSize().mittigBis(Lesebreite.formular),
            contentPadding = PaddingValues(horizontal = Abstaende.gross, vertical = Abstaende.mittel),
            verticalArrangement = Arrangement.spacedBy(10.dp)
        ) {
            item {
                Row(Modifier.fillMaxWidth(), Arrangement.SpaceBetween, Alignment.CenterVertically) {
                    Text(stringResource(R.string.monitoring_title), fontWeight = FontWeight.Bold, style = MaterialTheme.typography.titleLarge)
                    if (monState.aktualisiert) CircularProgressIndicator(Modifier.size(20.dp), strokeWidth = 2.dp)
                    else MitTooltip(stringResource(R.string.monitoring_refresh)) {
                        IconButton(onClick = aktionen::aktualisiere) {
                            Icon(Icons.Default.Refresh, stringResource(R.string.monitoring_refresh))
                        }
                    }
                }
            }

            item {
                HintergrundSection(zustand.hintergrund, aktionen::auftragsArtStarten, aktionen::auftragsArtLeeren,
                    aktionen::auftragAbbrechen, aktionen::auftragWiederholen)
            }

            item {
                CacheAndLimitsSection(monState, zustand.netze, zustand.appTheme,
                    zustand.ablageBytes, cacheEreignisse)
            }

            // Keine eigene Rechteprüfung: Massgeblich ist der Server (sonst 403), eine
            // dritte Stelle, die „ist das ein Verwalter“ entscheidet, wäre eine zweite Wahrheit.
            item { ProtokollSection(zustand.verwaltung, aktionen) }

            items(monState.jobs.entries.toList(), key = { it.key }) { (key, job) ->
                JobCard(
                    jobKey   = key,
                    job      = job,
                    schedule = monState.jobSchedules[key],
                    queueOpen = queueOpen,
                    queue    = monState.queue,
                    knoepfe  = monState.knoepfe,
                    aktionen = aktionen,
                    onToggleQueue = {
                        queueOpen = !queueOpen
                        if (queueOpen) aktionen.zeigeWarteschlange()
                    },
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
    queue: Laden<List<BricksetEintragAnsicht>>,
    knoepfe: Map<Jobstart, Meldung>,
    aktionen: MonitoringAktionen,
    onToggleQueue: () -> Unit,
) {
    AppKarte {
        Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(Abstaende.klein)) {
            JobKopf(jobKey, job)
            schedule?.let { ZeitplanZeile(jobKey, it, aktionen) }

            val starte = { j: Jobstart -> aktionen.starte(j) }
            when (jobKey) {
                "csvImport" -> StartKnopf(Jobstart.CSV_ABGLEICH, knoepfe, Icons.Default.Sync, R.string.monitoring_sync_now, starte)
                "priceJob" -> StartKnopf(Jobstart.PREISLAUF, knoepfe, Icons.Default.Refresh, R.string.monitoring_price_update, starte)
                "imgDl" -> {
                    // Der erste holt die Bilder des Bestands nach, der zweite die des Katalogs (wie in der Webapp).
                    StartKnopf(Jobstart.BESTANDSBILDER, knoepfe, Icons.Default.Download, R.string.monitoring_redownload_missing, starte)
                    StartKnopf(Jobstart.KATALOGBILDER, knoepfe, Icons.Default.Download, R.string.monitoring_catalog_images, starte)
                }
                "instrQueue" ->
                    StartKnopf(Jobstart.ANLEITUNGEN, knoepfe, Icons.Default.Download, R.string.monitoring_import_missing_instr, starte)
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

/** Name, Stand, Fortschritt und Zusatz eines Jobs. */
@Composable
private fun JobKopf(jobKey: String, job: JobZustandAnsicht) {
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
            horizontalArrangement = Arrangement.spacedBy(Abstaende.winzig)) {
            Icon(statusIcon, null, Modifier.size(mitSchrift(14.dp)), tint = statusColor)
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

/** Ein Startknopf: seine Beschriftung, solange er nicht läuft, sonst „startet…“ oder was er gestartet hat. */
@Composable
private fun StartKnopf(job: Jobstart, knoepfe: Map<Jobstart, Meldung>, icon: ImageVector, beschriftung: Int, onStart: (Jobstart) -> Unit) {
    val text = knoepfe[job]?.satz() ?: stringResource(beschriftung)
    FilledTonalButton(
        onClick = { onStart(job) },
        contentPadding = PaddingValues(horizontal = Abstaende.mittel, vertical = 6.dp),
        modifier = Modifier.fillMaxWidth()
    ) {
        Icon(icon, null, Modifier.size(mitSchrift(16.dp)))
        Spacer(Modifier.width(6.dp))
        Text(text, style = MaterialTheme.typography.labelMedium)
    }
}

@Composable
private fun Warteschlange(queue: Laden<List<BricksetEintragAnsicht>>, aktionen: MonitoringAktionen) {
    when (queue) {
        Laden.Laedt -> Box(Modifier.fillMaxWidth().padding(Abstaende.klein), Alignment.Center) {
            CircularProgressIndicator(Modifier.size(20.dp), strokeWidth = 2.dp)
        }
        is Laden.Fehler -> Text(queue.meldung.satz(), color = MaterialTheme.colorScheme.error,
            style = MaterialTheme.typography.bodySmall)
        is Laden.Daten -> Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Spacer(Modifier.height(Abstaende.winzig))
            queue.wert.forEach { entry ->
                BricksetQueueRow(entry, aktionen::wiederhole, aktionen::entferne)
            }
        }
    }
}
