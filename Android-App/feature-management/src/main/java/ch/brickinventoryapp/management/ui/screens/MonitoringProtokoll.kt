package ch.brickinventoryapp.management.ui.screens

import ch.brickinventoryapp.ui.components.AuswahlChip
import ch.brickinventoryapp.ui.theme.AppKarte
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
import ch.brickinventoryapp.model.domain.LogRowView
import androidx.compose.ui.res.stringResource
import ch.brickinventoryapp.resources.R
import ch.brickinventoryapp.model.util.fmtUhrzeit
import ch.brickinventoryapp.ui.util.appNumberLocale
import ch.brickinventoryapp.ui.util.twentyFourHours
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import ch.brickinventoryapp.management.ui.viewmodel.MonitoringActions
import ch.brickinventoryapp.management.ui.ManagementUiState
import ch.brickinventoryapp.model.ui.errorMessage
import ch.brickinventoryapp.model.ui.laedt
import ch.brickinventoryapp.ui.satz
import ch.brickinventoryapp.ui.theme.Abstaende
import ch.brickinventoryapp.ui.components.MitTooltip
import ch.brickinventoryapp.ui.components.SegmentChoice
import ch.brickinventoryapp.ui.components.Suchfeld

/**
 * The server log, like "Logs" in the web app. Not loaded on its own: up to
 * 5000 lines, and whoever opens monitoring usually wants the job cards.
 */
// For the FlowRow of the level switches; on the function, because an @OptIn in the body before a
// trailing lambda does not compile.
@OptIn(ExperimentalLayoutApi::class)
@Composable
internal fun LogSection(verwaltung: ManagementUiState, aktionen: MonitoringActions) {
    var offen by rememberSaveable { mutableStateOf(false) }
    // Both belong to the person and therefore survive a rotation — the
    // rows themselves are fetched fresh from the server anyway.
    var hiddenLevels by rememberSaveable { mutableStateOf(setOf<String>()) }
    var logSearch by rememberSaveable { mutableStateOf("") }

    AppKarte {
        Column(Modifier.padding(Abstaende.gross), verticalArrangement = Arrangement.spacedBy(Abstaende.klein)) {
            LogHeader(verwaltung.abruf.laedt, offen,
                loadOnNew = { aktionen.chooseLog(verwaltung.logMinutes) },
                toggleOn = {
                    offen = !offen
                    if (offen && verwaltung.protokoll.isEmpty()) aktionen.chooseLog(verwaltung.logMinutes)
                })

            AnimatedVisibility(offen) {
                Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    // The same spans the web app offers. The server
                    // itself caps it at 2880 minutes.
                    SegmentChoice(
                        optionen = listOf(15, 60, 240, 1440).map { it to stringResource(R.string.admin_log_minutes, it) },
                        gewaehlt = verwaltung.logMinutes,
                        onWahl = aktionen::chooseLog,
                    )
                    LogErrorOrEmpty(verwaltung)
                    // ── Levels and search, as in the web UI ──
                    //
                    // Filtering happens here, not on the server: the rows are already loaded, a
                    // fetch per keystroke would just be a wait.
                    val stufen = remember(verwaltung.protokoll) {
                        verwaltung.protokoll.mapNotNull { it.level?.lowercase() }.distinct().sorted()
                    }
                    if (stufen.size > 1) {
                        LogLevels(stufen, hiddenLevels, onLevel = { stufe ->
                            hiddenLevels =
                                if (stufe in hiddenLevels) hiddenLevels - stufe
                                else hiddenLevels + stufe
                        })
                    }
                    if (verwaltung.protokoll.isNotEmpty()) {
                        Suchfeld(logSearch, { logSearch = it },
                            stringResource(R.string.admin_log_search))
                    }

                    val sichtbar = remember(verwaltung.protokoll, hiddenLevels, logSearch) {
                        val suche = logSearch.trim().lowercase()
                        verwaltung.protokoll.filter { z ->
                            z.level?.lowercase() !in hiddenLevels &&
                                (suche.isEmpty() || z.message.orEmpty().lowercase().contains(suche))
                        }
                    }
                    if (verwaltung.protokoll.isNotEmpty() && sichtbar.isEmpty()) {
                        Text(stringResource(R.string.admin_log_no_match),
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                    sichtbar.forEach { zeile -> LogEntry(zeile) }
                }
            }
        }
    }
}

/** The error instead of the empty message: „keine Einträge“ would be wrong if the fetch had failed. */
@Composable
private fun LogErrorOrEmpty(verwaltung: ManagementUiState) {
    val fehler = verwaltung.abruf.errorMessage
    if (fehler != null) {
        Text(fehler.satz(), style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.error)
    } else if (verwaltung.protokoll.isEmpty() && !verwaltung.abruf.laedt) {
        Text(stringResource(R.string.admin_log_empty),
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

/** Title, loading spinner or reload, and the button to expand and collapse. */
@Composable
private fun LogHeader(laedt: Boolean, offen: Boolean, loadOnNew: () -> Unit, toggleOn: () -> Unit) {
    Row(Modifier.fillMaxWidth(), Arrangement.SpaceBetween, Alignment.CenterVertically) {
        Text(stringResource(R.string.admin_log_title),
            fontWeight = FontWeight.Bold, style = MaterialTheme.typography.titleMedium)
        Row(verticalAlignment = Alignment.CenterVertically) {
            if (laedt) {
                CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp)
            } else if (offen) {
                MitTooltip(stringResource(R.string.admin_log_reload)) {
                    IconButton(onClick = loadOnNew) {
                        Icon(Icons.Default.Refresh, stringResource(R.string.admin_log_reload),
                            Modifier.size(18.dp))
                    }
                }
            }
            MitTooltip(stringResource(if (offen) R.string.common_collapse else R.string.common_expand)) {
            IconButton(onClick = toggleOn) {
                // Describes the EFFECT of tapping, not the
                // shown symbol — that is exactly what TalkBack needs.
                Icon(
                    if (offen) Icons.Default.ExpandLess else Icons.Default.ExpandMore,
                    stringResource(
                        if (offen) R.string.common_collapse else R.string.common_expand))
            }
            }
        }
    }
}

/** One switch per level; selected means: this level's rows are shown. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun LogLevels(stufen: List<String>, hiddenLevels: Set<String>, onLevel: (String) -> Unit) {
    FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        stufen.forEach { stufe ->
            AuswahlChip(
                selected = stufe !in hiddenLevels,
                onClick = { onLevel(stufe) },
                label = { Text(stufe.uppercase(),
                               style = MaterialTheme.typography.bodySmall) })
        }
    }
}

/** One row of the log: time, level, message. */
@Composable
private fun LogEntry(zeile: LogRowView) {
    Row(horizontalArrangement = Arrangement.spacedBy(Abstaende.klein)) {
        // The time first — as in the web UI.
        // `logged_at` has been there all along and was never
        // shown; without it a log row is barely
        // usable.
        Text(fmtUhrzeit(zeile.loggedAt, appNumberLocale(), twentyFourHours()) ?: "",
            style = MaterialTheme.typography.bodySmall,
            fontFamily = FontFamily.Monospace,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.widthIn(min = 58.dp))
        Text(zeile.level.orEmpty().uppercase(),
            style = MaterialTheme.typography.bodySmall,
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
