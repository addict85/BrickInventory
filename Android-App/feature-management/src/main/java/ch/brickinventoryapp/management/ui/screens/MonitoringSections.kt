package ch.brickinventoryapp.management.ui.screens

import ch.brickinventoryapp.model.domain.BricksetEntryView
import ch.brickinventoryapp.model.domain.ScheduleView
import ch.brickinventoryapp.ui.theme.Formen
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.res.stringResource
import ch.brickinventoryapp.resources.R
import androidx.compose.ui.text.font.FontFamily
import ch.brickinventoryapp.management.ui.viewmodel.MonitoringActions
import ch.brickinventoryapp.ui.util.NumericInput
import ch.brickinventoryapp.ui.theme.Abstaende
import ch.brickinventoryapp.ui.components.MitTooltip
import ch.brickinventoryapp.ui.components.Prompt
import ch.brickinventoryapp.ui.components.withFont

/**
 * The sections of the monitoring page below the job list — whole functions
 * from MonitoringScreen.kt, not chopped-up bodies.
 */

@Composable
/**
 * `internal`, because the caller lives in a different file and `private` in
 * Kotlin applies file-wide.
 */
internal fun BricksetQueueRow(
    entry: BricksetEntryView,
    onRetry: (String) -> Unit,
    onDelete: (String) -> Unit
) {
    var showError by rememberSaveable { mutableStateOf(false) }

    Surface(
        shape = Formen.kachel,
        color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.5f),
        modifier = Modifier.fillMaxWidth()
    ) {
        Column(Modifier.padding(10.dp), verticalArrangement = Arrangement.spacedBy(Abstaende.tiny)) {
            Row(Modifier.fillMaxWidth(), Arrangement.SpaceBetween, Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    Text(entry.setNumber, fontWeight = FontWeight.Bold, style = MaterialTheme.typography.bodyMedium)
                    entry.name?.let {
                        Text(it, style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                    Text(stringResource(R.string.monitoring_retry_attempt, entry.attempts, entry.retryAfter ?: "—"),
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                BricksetActions(entry, onRetry, onDelete)
            }

            // Last error expandable. Read locally: across the module boundary (core-model)
            // there is no smart cast.
            val letzterFehler = entry.lastError
            if (!letzterFehler.isNullOrBlank()) {
                TextButton(
                    onClick = { showError = !showError },
                    contentPadding = PaddingValues(0.dp),
                    modifier = Modifier.heightIn(min = 24.dp)
                ) {
                    Text(if (showError) stringResource(R.string.monitoring_hide_error) else stringResource(R.string.monitoring_show_error),
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.error)
                }
                AnimatedVisibility(showError) {
                    Surface(
                        shape = Formen.marke,
                        color = MaterialTheme.colorScheme.errorContainer.copy(alpha = 0.4f)
                    ) {
                        Text(
                            letzterFehler,
                            style = MaterialTheme.typography.bodySmall,
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

/**
 * Retry and delete for an entry of the Brickset queue. Delete asks first,
 * and both icons tell TalkBack the set: stacked, there would otherwise just be „Löschen“ twice.
 */
@Composable
private fun BricksetActions(
    entry: BricksetEntryView,
    onRetry: (String) -> Unit,
    onDelete: (String) -> Unit
) {
    var deleteAsk by rememberSaveable(entry.setNumber) { mutableStateOf(false) }
    if (deleteAsk) {
        Prompt(
            titel = stringResource(R.string.monitoring_queue_loeschen_titel),
            text = stringResource(R.string.monitoring_queue_loeschen_text, entry.setNumber),
            bestaetigen = stringResource(R.string.common_delete),
            onBestaetigen = { deleteAsk = false; onDelete(entry.setNumber) },
            onAbbrechen = { deleteAsk = false },
            symbol = Icons.Default.Delete,
        )
    }
    val wiederholen = stringResource(R.string.aktion_fuer, stringResource(R.string.monitoring_icon_retry), entry.setNumber)
    val loeschen = stringResource(R.string.aktion_fuer, stringResource(R.string.common_delete), entry.setNumber)
    Row(horizontalArrangement = Arrangement.spacedBy(Abstaende.tiny)) {
        MitTooltip(wiederholen) {
            FilledTonalIconButton(onClick = { onRetry(entry.setNumber) }) {
                Icon(Icons.Default.Refresh, contentDescription = wiederholen, Modifier.size(withFont(14.dp)))
            }
        }
        MitTooltip(loeschen) {
            FilledTonalIconButton(
                onClick = { deleteAsk = true },
                colors = IconButtonDefaults.filledTonalIconButtonColors(
                    containerColor = MaterialTheme.colorScheme.errorContainer
                )
            ) {
                Icon(Icons.Default.Delete, contentDescription = loeschen, Modifier.size(withFont(14.dp)),
                    tint = MaterialTheme.colorScheme.onErrorContainer)
            }
        }
    }
}

/**
 * A job's schedule — shown and changed, as in the web app. Daily jobs
 * have a time of day, the price job a spacing in minutes; the server
 * distinguishes by field and normalizes both ("7:5" → "07:05", at least five
 * minutes). That is why it reloads after saving: it should show what
 * applies.
 */
@Composable
internal fun ScheduleRow(
    jobKey: String,
    plan: ScheduleView,
    aktionen: MonitoringActions,
) {
    val daily = plan.type == "daily"
    var bearbeiten by rememberSaveable(jobKey) { mutableStateOf(false) }
    val gezeigt = if (daily) plan.time.orEmpty() else (plan.minutes ?: 60).toString()
    var eingabe by rememberSaveable(jobKey, gezeigt) { mutableStateOf(gezeigt) }

    Row(
        Modifier.fillMaxWidth(),
        Arrangement.SpaceBetween,
        Alignment.CenterVertically,
    ) {
        Text(
            stringResource(if (daily) R.string.monitoring_schedule_daily
                           else R.string.monitoring_schedule_every),
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        if (bearbeiten) {
            ScheduleInput(daily, eingabe, onInput = { eingabe = it },
                onSpeichern = {
                    if (daily) aktionen.setSchedule(jobKey, zeit = eingabe.trim())
                    else aktionen.setSchedule(jobKey, minuten = eingabe.toIntOrNull() ?: 60)
                    bearbeiten = false
                },
                onAbbrechen = { bearbeiten = false })
        } else {
            Row(horizontalArrangement = Arrangement.spacedBy(Abstaende.klein),
                verticalAlignment = Alignment.CenterVertically) {
                Text(
                    if (daily) plan.time.orEmpty()
                    else stringResource(R.string.monitoring_schedule_minutes, plan.minutes ?: 60),
                    fontWeight = FontWeight.SemiBold, style = MaterialTheme.typography.bodyMedium,
                )
                MitTooltip(stringResource(R.string.cd_edit_schedule)) {
                    FilledTonalIconButton(
                        onClick = { bearbeiten = true },
                    ) { Icon(Icons.Default.Edit, stringResource(R.string.cd_edit_schedule), Modifier.size(withFont(14.dp))) }
                }
            }
        }
    }
}

/** The schedule's input field with save and cancel. */
@Composable
private fun ScheduleInput(
    daily: Boolean,
    eingabe: String,
    onInput: (String) -> Unit,
    onSpeichern: () -> Unit,
    onAbbrechen: () -> Unit,
) {
    Row(horizontalArrangement = Arrangement.spacedBy(6.dp),
        verticalAlignment = Alignment.CenterVertically) {
        OutlinedTextField(
            value = eingabe,
            onValueChange = {
                // For minutes only digits; for the time of day also the
                // colon — otherwise "03:00" could not be typed.
                onInput(if (daily) it.filter { z -> z.isDigit() || z == ':' }.take(5)
                          else NumericInput.quantity(it))
            },
            // From the language files: "min" is also in the image and gets read out.
            suffix = { if (!daily) Text(stringResource(R.string.monitoring_schedule_unit)) },
            modifier = Modifier.width(if (daily) 96.dp else 90.dp),
            singleLine = true,
            shape = Formen.kachel,
            keyboardOptions = NumericInput.ganzzahlTastatur(),
        )
        FilledTonalButton(
            onClick = onSpeichern,
            contentPadding = PaddingValues(horizontal = 10.dp, vertical = 6.dp),
        ) { Text(stringResource(R.string.common_ok), style = MaterialTheme.typography.labelMedium) }
        MitTooltip(stringResource(R.string.common_cancel)) {
            IconButton(onClick = onAbbrechen) {
                Icon(Icons.Default.Close, stringResource(R.string.common_cancel))
            }
        }
    }
}
