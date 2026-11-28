package ch.brickinventoryapp.management.ui.screens

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import ch.brickinventoryapp.management.ui.ManagementUiState
import ch.brickinventoryapp.management.ui.viewmodel.MonitoringActions
import ch.brickinventoryapp.model.domain.LogRowView
import ch.brickinventoryapp.model.util.fmtClockTime
import ch.brickinventoryapp.resources.R
import ch.brickinventoryapp.ui.components.SearchField
import ch.brickinventoryapp.ui.components.SegmentChoice
import ch.brickinventoryapp.ui.components.SelectionChip
import ch.brickinventoryapp.ui.components.WithTooltip
import ch.brickinventoryapp.ui.sentence
import ch.brickinventoryapp.ui.theme.AppCard
import ch.brickinventoryapp.ui.theme.Spacing
import ch.brickinventoryapp.ui.util.appNumberLocale
import ch.brickinventoryapp.ui.util.twentyFourHours
import ch.brickinventoryapp.uistate.errorMessage
import ch.brickinventoryapp.uistate.loading

/**
 * The server log, like "Logs" in the web app. Not loaded on its own: up to
 * 5000 lines, and whoever opens monitoring usually wants the job cards.
 */
// For the FlowRow of the level switches; on the function, because an @OptIn in the body before a
// trailing lambda does not compile.
@OptIn(ExperimentalLayoutApi::class)
@Composable
internal fun LogSection(admin: ManagementUiState, actions: MonitoringActions) {
    var open by rememberSaveable { mutableStateOf(false) }
    // Both belong to the person and therefore survive a rotation — the
    // rows themselves are fetched fresh from the server anyway.
    var hiddenLevels by rememberSaveable { mutableStateOf(setOf<String>()) }
    var logSearch by rememberSaveable { mutableStateOf("") }

    AppCard {
        Column(Modifier.padding(Spacing.large), verticalArrangement = Arrangement.spacedBy(Spacing.small)) {
            LogHeader(admin.fetch.loading, open,
                loadOnNew = { actions.chooseLog(admin.logMinutes) },
                toggleOn = {
                    open = !open
                    if (open && admin.log.isEmpty()) actions.chooseLog(admin.logMinutes)
                })

            AnimatedVisibility(open) {
                Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    // The same spans the web app offers. The server
                    // itself caps it at 2880 minutes.
                    SegmentChoice(
                        options = listOf(15, 60, 240, 1440).map { it to stringResource(R.string.admin_log_minutes, it) },
                        chosen = admin.logMinutes,
                        onChoice = actions::chooseLog,
                    )
                    LogErrorOrEmpty(admin)
                    // ── Levels and search, as in the web UI ──
                    //
                    // Filtering happens here, not on the server: the rows are already loaded, a
                    // fetch per keystroke would just be a wait.
                    val levels = remember(admin.log) {
                        admin.log.mapNotNull { it.level?.lowercase() }.distinct().sorted()
                    }
                    if (levels.size > 1) {
                        LogLevels(levels, hiddenLevels, onLevel = { level ->
                            hiddenLevels =
                                if (level in hiddenLevels) hiddenLevels - level
                                else hiddenLevels + level
                        })
                    }
                    if (admin.log.isNotEmpty()) {
                        SearchField(logSearch, { logSearch = it },
                            stringResource(R.string.admin_log_search))
                    }

                    val visible = remember(admin.log, hiddenLevels, logSearch) {
                        val search = logSearch.trim().lowercase()
                        admin.log.filter { z ->
                            z.level?.lowercase() !in hiddenLevels &&
                                (search.isEmpty() || z.message.orEmpty().lowercase().contains(search))
                        }
                    }
                    if (admin.log.isNotEmpty() && visible.isEmpty()) {
                        Text(stringResource(R.string.admin_log_no_match),
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                    visible.forEach { row -> LogEntry(row) }
                }
            }
        }
    }
}

/** The error instead of the empty message: „keine Einträge“ would be wrong if the fetch had failed. */
@Composable
private fun LogErrorOrEmpty(admin: ManagementUiState) {
    val error = admin.fetch.errorMessage
    if (error != null) {
        Text(error.sentence(), style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.error)
    } else if (admin.log.isEmpty() && !admin.fetch.loading) {
        Text(stringResource(R.string.admin_log_empty),
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

/** Title, loading spinner or reload, and the button to expand and collapse. */
@Composable
private fun LogHeader(loading: Boolean, open: Boolean, loadOnNew: () -> Unit, toggleOn: () -> Unit) {
    Row(Modifier.fillMaxWidth(), Arrangement.SpaceBetween, Alignment.CenterVertically) {
        Text(stringResource(R.string.admin_log_title),
            fontWeight = FontWeight.Bold, style = MaterialTheme.typography.titleMedium)
        Row(verticalAlignment = Alignment.CenterVertically) {
            if (loading) {
                CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp)
            } else if (open) {
                WithTooltip(stringResource(R.string.admin_log_reload)) {
                    IconButton(onClick = loadOnNew) {
                        Icon(Icons.Default.Refresh, stringResource(R.string.admin_log_reload),
                            Modifier.size(18.dp))
                    }
                }
            }
            WithTooltip(stringResource(if (open) R.string.common_collapse else R.string.common_expand)) {
            IconButton(onClick = toggleOn) {
                // Describes the EFFECT of tapping, not the
                // shown symbol — that is exactly what TalkBack needs.
                Icon(
                    if (open) Icons.Default.ExpandLess else Icons.Default.ExpandMore,
                    stringResource(
                        if (open) R.string.common_collapse else R.string.common_expand))
            }
            }
        }
    }
}

/** One switch per level; selected means: this level's rows are shown. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun LogLevels(levels: List<String>, hiddenLevels: Set<String>, onLevel: (String) -> Unit) {
    FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        levels.forEach { level ->
            SelectionChip(
                selected = level !in hiddenLevels,
                onClick = { onLevel(level) },
                label = { Text(level.uppercase(),
                               style = MaterialTheme.typography.bodySmall) })
        }
    }
}

/** One row of the log: time, level, message. */
@Composable
private fun LogEntry(row: LogRowView) {
    Row(horizontalArrangement = Arrangement.spacedBy(Spacing.small)) {
        // The time first — as in the web UI.
        // `logged_at` has been there all along and was never
        // shown; without it a log row is barely
        // usable.
        Text(fmtClockTime(row.loggedAt, appNumberLocale(), twentyFourHours()) ?: "",
            style = MaterialTheme.typography.bodySmall,
            fontFamily = FontFamily.Monospace,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.widthIn(min = 58.dp))
        Text(row.level.orEmpty().uppercase(),
            style = MaterialTheme.typography.bodySmall,
            fontWeight = FontWeight.Bold,
            color = when (row.level?.lowercase()) {
                "error" -> MaterialTheme.colorScheme.error
                "warn"  -> MaterialTheme.colorScheme.tertiary
                else    -> MaterialTheme.colorScheme.onSurfaceVariant
            },
            modifier = Modifier.width(46.dp))
        Text(row.message.orEmpty(),
            style = MaterialTheme.typography.bodySmall)
    }
}
