package ch.brickinventoryapp.verwaltung.ui.screens

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
import ch.brickinventoryapp.model.fach.ProtokollZeileAnsicht
import androidx.compose.ui.res.stringResource
import ch.brickinventoryapp.ressourcen.R
import ch.brickinventoryapp.model.util.fmtUhrzeit
import ch.brickinventoryapp.ui.util.appNumberLocale
import ch.brickinventoryapp.ui.util.vierundzwanzigStunden
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import ch.brickinventoryapp.verwaltung.ui.viewmodel.MonitoringAktionen
import ch.brickinventoryapp.verwaltung.ui.VerwaltungUiState
import ch.brickinventoryapp.model.ui.fehlerMeldung
import ch.brickinventoryapp.model.ui.laedt
import ch.brickinventoryapp.ui.satz
import ch.brickinventoryapp.ui.theme.Abstaende
import ch.brickinventoryapp.ui.components.MitTooltip
import ch.brickinventoryapp.ui.components.SegmentWahl
import ch.brickinventoryapp.ui.components.Suchfeld

/**
 * Das Server-Protokoll, wie „Logs“ in der Webapp. Nicht von selbst geladen: bis zu
 * 5000 Zeilen, und wer die Überwachung öffnet, will meist die Job-Karten.
 */
// Für die FlowRow der Stufenschalter; an der Funktion, weil ein @OptIn im Rumpf vor einer
// nachgestellten Lambda nicht übersetzt.
@OptIn(ExperimentalLayoutApi::class)
@Composable
internal fun ProtokollSection(verwaltung: VerwaltungUiState, aktionen: MonitoringAktionen) {
    var offen by rememberSaveable { mutableStateOf(false) }
    // Beides gehoert dem Menschen und uebersteht deshalb eine Drehung — die
    // Zeilen selbst kommen ohnehin vom Server nach.
    var versteckteStufen by rememberSaveable { mutableStateOf(setOf<String>()) }
    var protokollSuche by rememberSaveable { mutableStateOf("") }

    AppKarte {
        Column(Modifier.padding(Abstaende.gross), verticalArrangement = Arrangement.spacedBy(Abstaende.klein)) {
            ProtokollKopf(verwaltung.abruf.laedt, offen,
                onNeuLaden = { aktionen.waehleProtokoll(verwaltung.protokollMinuten) },
                onUmschalten = {
                    offen = !offen
                    if (offen && verwaltung.protokoll.isEmpty()) aktionen.waehleProtokoll(verwaltung.protokollMinuten)
                })

            AnimatedVisibility(offen) {
                Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    // Dieselben Spannen wie die Webapp anbietet. Der Server
                    // begrenzt selbst auf 2880 Minuten.
                    SegmentWahl(
                        optionen = listOf(15, 60, 240, 1440).map { it to stringResource(R.string.admin_log_minutes, it) },
                        gewaehlt = verwaltung.protokollMinuten,
                        onWahl = aktionen::waehleProtokoll,
                    )
                    ProtokollFehlerOderLeer(verwaltung)
                    // ── Stufen und Suche, wie in der Weboberfläche ──
                    //
                    // Gefiltert wird hier, nicht auf dem Server: Die Zeilen sind schon geladen, ein
                    // Abruf je Tastendruck wäre nur Wartezeit.
                    val stufen = remember(verwaltung.protokoll) {
                        verwaltung.protokoll.mapNotNull { it.level?.lowercase() }.distinct().sorted()
                    }
                    if (stufen.size > 1) {
                        ProtokollStufen(stufen, versteckteStufen, onStufe = { stufe ->
                            versteckteStufen =
                                if (stufe in versteckteStufen) versteckteStufen - stufe
                                else versteckteStufen + stufe
                        })
                    }
                    if (verwaltung.protokoll.isNotEmpty()) {
                        Suchfeld(protokollSuche, { protokollSuche = it },
                            stringResource(R.string.admin_log_search))
                    }

                    val sichtbar = remember(verwaltung.protokoll, versteckteStufen, protokollSuche) {
                        val suche = protokollSuche.trim().lowercase()
                        verwaltung.protokoll.filter { z ->
                            z.level?.lowercase() !in versteckteStufen &&
                                (suche.isEmpty() || z.message.orEmpty().lowercase().contains(suche))
                        }
                    }
                    if (verwaltung.protokoll.isNotEmpty() && sichtbar.isEmpty()) {
                        Text(stringResource(R.string.admin_log_no_match),
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                    sichtbar.forEach { zeile -> ProtokollEintrag(zeile) }
                }
            }
        }
    }
}

/** Der Fehler statt der Leermeldung: „keine Einträge“ wäre falsch, wenn der Abruf scheiterte. */
@Composable
private fun ProtokollFehlerOderLeer(verwaltung: VerwaltungUiState) {
    val fehler = verwaltung.abruf.fehlerMeldung
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
private fun ProtokollKopf(laedt: Boolean, offen: Boolean, onNeuLaden: () -> Unit, onUmschalten: () -> Unit) {
    Row(Modifier.fillMaxWidth(), Arrangement.SpaceBetween, Alignment.CenterVertically) {
        Text(stringResource(R.string.admin_log_title),
            fontWeight = FontWeight.Bold, style = MaterialTheme.typography.titleMedium)
        Row(verticalAlignment = Alignment.CenterVertically) {
            if (laedt) {
                CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp)
            } else if (offen) {
                MitTooltip(stringResource(R.string.admin_log_reload)) {
                    IconButton(onClick = onNeuLaden) {
                        Icon(Icons.Default.Refresh, stringResource(R.string.admin_log_reload),
                            Modifier.size(18.dp))
                    }
                }
            }
            MitTooltip(stringResource(if (offen) R.string.common_collapse else R.string.common_expand)) {
            IconButton(onClick = onUmschalten) {
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
private fun ProtokollStufen(stufen: List<String>, versteckteStufen: Set<String>, onStufe: (String) -> Unit) {
    FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        stufen.forEach { stufe ->
            AuswahlChip(
                selected = stufe !in versteckteStufen,
                onClick = { onStufe(stufe) },
                label = { Text(stufe.uppercase(),
                               style = MaterialTheme.typography.bodySmall) })
        }
    }
}

/** Eine Zeile des Protokolls: Uhrzeit, Stufe, Meldung. */
@Composable
private fun ProtokollEintrag(zeile: ProtokollZeileAnsicht) {
    Row(horizontalArrangement = Arrangement.spacedBy(Abstaende.klein)) {
        // Die Uhrzeit zuerst — wie in der Weboberflaeche.
        // `logged_at` kam seit jeher mit und wurde nie
        // gezeigt; ohne sie ist eine Protokollzeile kaum zu
        // gebrauchen.
        Text(fmtUhrzeit(zeile.loggedAt, appNumberLocale(), vierundzwanzigStunden()) ?: "",
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
