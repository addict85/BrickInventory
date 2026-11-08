package ch.brickinventoryapp.verwaltung.ui.screens

import ch.brickinventoryapp.model.ui.model.KontingentAnsicht
import ch.brickinventoryapp.ui.theme.Formen
import ch.brickinventoryapp.ui.theme.AppKarte
import ch.brickinventoryapp.ui.theme.LocalStatusFarben
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
import ch.brickinventoryapp.model.ui.model.*
import androidx.compose.ui.res.stringResource
import ch.brickinventoryapp.ressourcen.R
import ch.brickinventoryapp.verwaltung.ui.viewmodel.MonitoringUiState
import ch.brickinventoryapp.model.ui.*
import ch.brickinventoryapp.ui.*
import ch.brickinventoryapp.verwaltung.ui.*
import ch.brickinventoryapp.zustand.ui.*
import ch.brickinventoryapp.ui.util.NumericInput
import ch.brickinventoryapp.ui.theme.Abstaende
import ch.brickinventoryapp.ui.components.Abschnittstitel
import ch.brickinventoryapp.ui.components.MitTooltip
import ch.brickinventoryapp.ui.components.mitSchrift

/** Die Tageskontingente mit dem Bearbeitungszustand ihrer Grenzen. */
@Composable
internal fun KontingentAbschnitt(monState: MonitoringUiState, ereignisse: CacheEreignisse) {
    val cacheStats = monState.cacheStats
    val apiLimits  = monState.apiLimits
    // Halb eingetippte Grenzen gehören dem Menschen und bleiben speicherbar.
    var editingLimits by rememberSaveable { mutableStateOf(false) }
    var rbInput    by rememberSaveable { mutableStateOf("0") }
    var blInput    by rememberSaveable { mutableStateOf("0") }
    var bsInput    by rememberSaveable { mutableStateOf("0") }

    // Die Eingabefelder mit den geladenen Werten vorbelegen — aber nur, solange
    // NICHT bearbeitet wird. Das Speichern laedt die Grenzwerte selbst neu; ohne
    // die Bedingung schriebe diese Antwort dem Benutzer die halb getippte Zahl
    // wieder um. Vorher stand die Vorbelegung im einmaligen Ladevorgang und
    // konnte das nicht — jetzt haengt sie am Zustand und koennte es.
    LaunchedEffect(apiLimits, editingLimits) {
        val al = apiLimits
        if (al != null && !editingLimits) {
            rbInput = al.rebrickable.toString()
            blInput = al.bricklink.toString()
            bsInput = al.brickset.toString()
        }
    }

    // ── API Rate Limits ───────────────────────────────────────────────────────
    KontingentKarte(
        kontingente = cacheStats?.rateLimits,
        bearbeiten = editingLimits,
        onBearbeitenUmschalten = { editingLimits = !editingLimits },
        eingaben = Triple(bsInput, blInput, rbInput),
        onBrickset = { bsInput = it },
        onBricklink = { blInput = it },
        onRebrickable = { rbInput = it },
        onSpeichern = {
            // Das Nachladen der Grenzwerte steht im ViewModel.
            ereignisse.grenzwerte(rbInput.toIntOrNull() ?: 0, blInput.toIntOrNull() ?: 0, bsInput.toIntOrNull() ?: 0)
            editingLimits = false
        },
    )
}

/**
 * Die Tageskontingente der drei Dienste; im Bearbeiten-Modus mit Eingabefeldern für
 * die Grenzen. [eingaben] in der Reihenfolge Brickset, BrickLink, Rebrickable.
 */
@Composable
private fun KontingentKarte(
    kontingente: KontingenteAnsicht?,
    bearbeiten: Boolean,
    onBearbeitenUmschalten: () -> Unit,
    eingaben: Triple<String, String, String>,
    onBrickset: (String) -> Unit,
    onBricklink: (String) -> Unit,
    onRebrickable: (String) -> Unit,
    onSpeichern: () -> Unit,
) {
    val (bsInput, blInput, rbInput) = eingaben
    AppKarte(Modifier.padding(horizontal = Abstaende.gross, vertical = 5.dp)) {
        Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(Abstaende.klein)) {
            Row(Modifier.fillMaxWidth(), Arrangement.SpaceBetween, Alignment.CenterVertically) {
                Abschnittstitel(stringResource(R.string.monitoring_api_calls))
                MitTooltip(stringResource(R.string.cd_edit_limits)) {
                    FilledTonalIconButton(
                        onClick = onBearbeitenUmschalten,
                    ) { Icon(if (bearbeiten) Icons.Default.Close else Icons.Default.Edit, stringResource(R.string.cd_edit_limits), Modifier.size(mitSchrift(14.dp))) }
                }
            }

            kontingente?.let { rl ->
                RateLimitRow("Brickset",    rl.brickset,    if (bearbeiten) bsInput else null, onBrickset)
                RateLimitRow("BrickLink",   rl.bricklink,   if (bearbeiten) blInput else null, onBricklink)
                RateLimitRow("Rebrickable", rl.rebrickable, if (bearbeiten) rbInput else null, onRebrickable)
            }

            if (bearbeiten) {
                FilledTonalButton(
                    onClick = onSpeichern,
                    modifier = Modifier.fillMaxWidth(),
                    contentPadding = PaddingValues(vertical = Abstaende.klein)
                ) {
                    Icon(Icons.Default.Save, null, Modifier.size(mitSchrift(16.dp)))
                    Spacer(Modifier.width(6.dp))
                    Text(stringResource(R.string.monitoring_limits_save), style = MaterialTheme.typography.bodyMedium)
                }
            }
        }
    }
}

@Composable
private fun RateLimitRow(
    label: String,
    rl: KontingentAnsicht,
    editValue: String?,
    onEdit: (String) -> Unit
) {
    val pct = if (rl.limit > 0) (rl.count.toFloat() / rl.limit).coerceIn(0f, 1f) else 0f
    val color = when {
        pct > 0.9f -> MaterialTheme.colorScheme.error
        pct > 0.7f -> LocalStatusFarben.current.warnung
        else       -> MaterialTheme.colorScheme.primary
    }
    // ── Das Zeichen, nicht nur die Farbe ──
    //
    // Gelb gegen Rot fällt bei Rot-Grün-Schwäche zusammen; die Farbe sollte aber auf
    // einen Blick sagen „hier wird es eng“. Ein Zeichen davor trägt das ohne Farbe.
    // Eine Schwelle reicht — wie eng, sagt die Zahl daneben.
    val eng = pct > 0.7f
    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(3.dp)) {
        Row(Modifier.fillMaxWidth(), Arrangement.SpaceBetween, Alignment.CenterVertically) {
            Text(label, style = MaterialTheme.typography.bodyMedium)
            if (editValue != null) {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Abstaende.winzig)) {
                    Text("${rl.count} /", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    OutlinedTextField(
                        value = editValue,
                        onValueChange = { onEdit(NumericInput.quantity(it)) },
                        modifier = Modifier.width(80.dp),
                        singleLine = true,
                        shape = Formen.etikett,
                        textStyle = MaterialTheme.typography.bodyMedium,
                    keyboardOptions = NumericInput.ganzzahlTastatur()
                )
                }
            } else {
                Row(verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(Abstaende.winzig)) {
                    if (eng) Icon(Icons.Default.Warning, stringResource(R.string.monitoring_kontingent_eng),
                        Modifier.size(14.dp), tint = color)
                    Text("${rl.count} / ${rl.limit}",
                        style = MaterialTheme.typography.bodySmall,
                        fontWeight = FontWeight.SemiBold,
                        color = color)
                }
            }
        }
        LinearProgressIndicator(
            progress = { pct },
            modifier = Modifier.fillMaxWidth().height(3.dp),
            color = color,
            trackColor = MaterialTheme.colorScheme.surfaceVariant
        )
    }
}
