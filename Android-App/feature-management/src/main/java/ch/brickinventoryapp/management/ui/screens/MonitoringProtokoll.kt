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
 * Das Server-Protokoll, wie „Logs“ in der Webapp. Nicht von selbst geladen: bis zu
 * 5000 Zeilen, und wer die Überwachung öffnet, will meist die Job-Karten.
 */
// Für die FlowRow der Stufenschalter; an der Funktion, weil ein @OptIn im Rumpf vor einer
// nachgestellten Lambda nicht übersetzt.
@OptIn(ExperimentalLayoutApi::class)
@Composable
internal fun LogSection(verwaltung: ManagementUiState, aktionen: MonitoringActions) {
    var offen by rememberSaveable { mutableStateOf(false) }
    // Beides gehoert dem Menschen und uebersteht deshalb eine Drehung — die
    // Zeilen selbst kommen ohnehin vom Server nach.
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
                    // Dieselben Spannen wie die Webapp anbietet. Der Server
                    // begrenzt selbst auf 2880 Minuten.
                    SegmentChoice(
                        optionen = listOf(15, 60, 240, 1440).map { it to stringResource(R.string.admin_log_minutes, it) },
                        gewaehlt = verwaltung.logMinutes,
                        onWahl = aktionen::chooseLog,
                    )
                    LogErrorOrEmpty(verwaltung)
                    // ── Stufen und Suche, wie in der Weboberfläche ──
                    //
                    // Gefiltert wird hier, nicht auf dem Server: Die Zeilen sind schon geladen, ein
                    // Abruf je Tastendruck wäre nur Wartezeit.
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

/** Der Fehler statt der Leermeldung: „keine Einträge“ wäre falsch, wenn der Abruf scheiterte. */
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

/** Titel, Ladekringel oder Neu-laden, und der Knopf zum Auf- und Zuklappen. */
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
                // Beschreibt die WIRKUNG des Tippens, nicht das
                // gezeigte Zeichen — genau das braucht TalkBack.
                Icon(
                    if (offen) Icons.Default.ExpandLess else Icons.Default.ExpandMore,
                    stringResource(
                        if (offen) R.string.common_collapse else R.string.common_expand))
            }
            }
        }
    }
}

/** Ein Schalter je Stufe; gewählt heisst: Die Zeilen dieser Stufe stehen da. */
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

/** Eine Zeile des Protokolls: Uhrzeit, Stufe, Meldung. */
@Composable
private fun LogEntry(zeile: LogRowView) {
    Row(horizontalArrangement = Arrangement.spacedBy(Abstaende.klein)) {
        // Die Uhrzeit zuerst — wie in der Weboberflaeche.
        // `logged_at` kam seit jeher mit und wurde nie
        // gezeigt; ohne sie ist eine Protokollzeile kaum zu
        // gebrauchen.
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
