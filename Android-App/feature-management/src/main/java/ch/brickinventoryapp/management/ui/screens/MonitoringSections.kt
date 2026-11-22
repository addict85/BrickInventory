package ch.brickinventoryapp.management.ui.screens

import ch.brickinventoryapp.model.domain.BricksetEntryView
import ch.brickinventoryapp.model.domain.ScheduleView
import ch.brickinventoryapp.ui.theme.Shapes
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
import ch.brickinventoryapp.ui.theme.Spacing
import ch.brickinventoryapp.ui.components.WithTooltip
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
        shape = Shapes.tile,
        color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.5f),
        modifier = Modifier.fillMaxWidth()
    ) {
        Column(Modifier.padding(10.dp), verticalArrangement = Arrangement.spacedBy(Spacing.tiny)) {
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
            val lastError = entry.lastError
            if (!lastError.isNullOrBlank()) {
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
                        shape = Shapes.brand,
                        color = MaterialTheme.colorScheme.errorContainer.copy(alpha = 0.4f)
                    ) {
                        Text(
                            lastError,
                            style = MaterialTheme.typography.bodySmall,
                            fontFamily = androidx.compose.ui.text.font.FontFamily.Monospace,
                            color = MaterialTheme.colorScheme.error,
                            modifier = Modifier.padding(Spacing.small)
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
            title = stringResource(R.string.monitoring_queue_delete_title),
            text = stringResource(R.string.monitoring_queue_delete_text, entry.setNumber),
            // Off the list, not destroyed: the set stays, Brickset is just no longer asked.
            confirm = stringResource(R.string.monitoring_queue_remove),
            onConfirm = { deleteAsk = false; onDelete(entry.setNumber) },
            onCancel = { deleteAsk = false },
            symbol = Icons.Default.Delete,
        )
    }
    val retry = stringResource(R.string.action_for, stringResource(R.string.monitoring_icon_retry), entry.setNumber)
    val delete = stringResource(R.string.action_for, stringResource(R.string.monitoring_queue_remove), entry.setNumber)
    Row(horizontalArrangement = Arrangement.spacedBy(Spacing.tiny)) {
        WithTooltip(retry) {
            FilledTonalIconButton(onClick = { onRetry(entry.setNumber) }) {
                Icon(Icons.Default.Refresh, contentDescription = retry, Modifier.size(withFont(14.dp)))
            }
        }
        WithTooltip(delete) {
            FilledTonalIconButton(
                onClick = { deleteAsk = true },
                colors = IconButtonDefaults.filledTonalIconButtonColors(
                    containerColor = MaterialTheme.colorScheme.errorContainer
                )
            ) {
                Icon(Icons.Default.Delete, contentDescription = delete, Modifier.size(withFont(14.dp)),
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
    actions: MonitoringActions,
) {
    val daily = plan.type == "daily"
    var edit by rememberSaveable(jobKey) { mutableStateOf(false) }
    val shown = if (daily) plan.time.orEmpty() else (plan.minutes ?: 60).toString()
    var input by rememberSaveable(jobKey, shown) { mutableStateOf(shown) }

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
        if (edit) {
            ScheduleInput(daily, input, onInput = { input = it },
                onSave = {
                    if (daily) actions.setSchedule(jobKey, time = input.trim())
                    else actions.setSchedule(jobKey, minutes = input.toIntOrNull() ?: 60)
                    edit = false
                },
                onCancel = { edit = false })
        } else {
            Row(horizontalArrangement = Arrangement.spacedBy(Spacing.small),
                verticalAlignment = Alignment.CenterVertically) {
                Text(
                    if (daily) plan.time.orEmpty()
                    else stringResource(R.string.monitoring_schedule_minutes, plan.minutes ?: 60),
                    fontWeight = FontWeight.SemiBold, style = MaterialTheme.typography.bodyMedium,
                )
                WithTooltip(stringResource(R.string.cd_edit_schedule)) {
                    FilledTonalIconButton(
                        onClick = { edit = true },
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
    input: String,
    onInput: (String) -> Unit,
    onSave: () -> Unit,
    onCancel: () -> Unit,
) {
    Row(horizontalArrangement = Arrangement.spacedBy(6.dp),
        verticalAlignment = Alignment.CenterVertically) {
        OutlinedTextField(
            value = input,
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
            shape = Shapes.tile,
            keyboardOptions = NumericInput.integerKeyboard(),
        )
        FilledTonalButton(
            onClick = onSave,
            contentPadding = PaddingValues(horizontal = 10.dp, vertical = 6.dp),
        ) { Text(stringResource(R.string.common_ok), style = MaterialTheme.typography.labelMedium) }
        WithTooltip(stringResource(R.string.common_cancel)) {
            IconButton(onClick = onCancel) {
                Icon(Icons.Default.Close, stringResource(R.string.common_cancel))
            }
        }
    }
}
