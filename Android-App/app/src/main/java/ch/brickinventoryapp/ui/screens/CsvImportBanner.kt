package ch.brickinventoryapp.ui.screens

import androidx.compose.foundation.clickable
import androidx.compose.ui.semantics.Role
import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import ch.brickinventoryapp.R
import ch.brickinventoryapp.ui.theme.Abstaende
import ch.brickinventoryapp.ui.theme.Schrift
import androidx.compose.material.icons.filled.UploadFile
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material.icons.filled.Error
import ch.brickinventoryapp.ui.theme.LocalStatusFarben

@Composable
fun CsvImportBanner(
    done: Int, total: Int, current: String?,
    ok: Int, warn: Int, err: Int, running: Boolean,
    /**
     * Abbrechen — nur waehrend der Import laeuft sichtbar.
     *
     * Die Webapp hat den Knopf seit jeher (02-gallery.js, btn-cancel-import).
     * Die App zeigte denselben Balken und keinen Weg heraus: Ein versehentlich
     * gestarteter Import ueber hunderte Sets holt zu jedem die Stammdaten und
     * musste ausgesessen werden.
     */
    onAbbrechen: () -> Unit,
) {
    var expanded by rememberSaveable { mutableStateOf(false) }
    val pct = if (total > 0) done.toFloat() / total else 0f
    val bg  = if (running) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.secondaryContainer

    Column {
        Surface(
            color = bg,
            modifier = Modifier.fillMaxWidth().clickable(role = Role.Button) { expanded = !expanded }
        ) {
            Column(Modifier.padding(horizontal = Abstaende.gross, vertical = Abstaende.klein)) {
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(Abstaende.klein)
                ) {
                    Icon(Icons.Default.UploadFile, null, Modifier.size(16.dp),
                        tint = if (running) MaterialTheme.colorScheme.onPrimary
                               else MaterialTheme.colorScheme.onSecondaryContainer)
                    LinearProgressIndicator(
                        progress = { pct },
                        modifier = Modifier.weight(1f).height(6.dp).clip(MaterialTheme.shapes.small),
                        color = if (running) MaterialTheme.colorScheme.onPrimary
                                else MaterialTheme.colorScheme.primary,
                        trackColor = MaterialTheme.colorScheme.onPrimary.copy(alpha = 0.25f)
                    )
                    Text(
                        if (running) "$done/$total" else stringResource(R.string.csv_ok_count, ok),
                        style = MaterialTheme.typography.labelSmall,
                        color = if (running) MaterialTheme.colorScheme.onPrimary
                                else MaterialTheme.colorScheme.onSecondaryContainer,
                        fontWeight = FontWeight.Bold
                    )
                    // In der KOPFzeile, nicht im aufgeklappten Teil: Wer
                    // abbrechen will, soll nicht erst herausfinden muessen,
                    // dass der Balken sich aufklappen laesst. In der Webapp
                    // steht der Knopf ebenfalls dauerhaft da.
                    //
                    // Kein Bestaetigungsdialog: Abbrechen nimmt nichts zurueck,
                    // es hoert nur auf. Schon angelegte Sets bleiben.
                    if (running) {
                        IconButton(onClick = onAbbrechen, modifier = Modifier.size(24.dp)) {
                            Icon(Icons.Default.Close, stringResource(R.string.csv_cancel),
                                Modifier.size(16.dp),
                                tint = MaterialTheme.colorScheme.onPrimary)
                        }
                    }
                    Text(
                        if (expanded) "▴" else "▾",
                        color = if (running) MaterialTheme.colorScheme.onPrimary
                                else MaterialTheme.colorScheme.onSecondaryContainer
                    )
                }
                if (running && current != null) {
                    Text(
                        current,
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onPrimary.copy(alpha = 0.8f),
                        modifier = Modifier.padding(top = Abstaende.haar)
                    )
                }
            }
        }
        if (expanded) {
            Surface(
                color = MaterialTheme.colorScheme.surfaceVariant,
                modifier = Modifier.fillMaxWidth()
            ) {
                Row(
                    Modifier.padding(horizontal = Abstaende.gross, vertical = 10.dp),
                    horizontalArrangement = Arrangement.spacedBy(Abstaende.gross)
                ) {
                    val farben = LocalStatusFarben.current
                    listOf(
                        Triple(ok, Icons.Default.CheckCircle to farben.erfolg, stringResource(R.string.csv_stat_success)),
                        Triple(warn, Icons.Default.Warning to farben.warnung, stringResource(R.string.csv_stat_warnings)),
                        Triple(err, Icons.Default.Error to farben.fehler, stringResource(R.string.csv_stat_errors))
                    ).forEach { (v, symbol, l) ->
                        Column(horizontalAlignment = Alignment.CenterHorizontally) {
                            Row(verticalAlignment = Alignment.CenterVertically,
                                horizontalArrangement = Arrangement.spacedBy(Abstaende.winzig)) {
                                Icon(symbol.first, null, Modifier.size(16.dp), tint = symbol.second)
                                Text("$v", fontWeight = FontWeight.Bold, fontSize = Schrift.normal)
                            }
                            Text(l, style = MaterialTheme.typography.labelSmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                    }
                    if (!running) {
                        Spacer(Modifier.weight(1f))
                        Text(
                            stringResource(R.string.csv_import_done),
                            style = MaterialTheme.typography.labelSmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            modifier = Modifier.align(Alignment.CenterVertically)
                        )
                    }
                }
            }
        }
    }
}
