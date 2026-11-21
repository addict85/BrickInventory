package ch.brickinventoryapp.management.ui.screens

import ch.brickinventoryapp.model.domain.QuotaView
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
import ch.brickinventoryapp.model.domain.QuotasView
import androidx.compose.ui.res.stringResource
import ch.brickinventoryapp.resources.R
import ch.brickinventoryapp.management.ui.viewmodel.MonitoringUiState
import ch.brickinventoryapp.ui.util.NumericInput
import ch.brickinventoryapp.ui.theme.Abstaende
import ch.brickinventoryapp.ui.components.SectionTitle
import ch.brickinventoryapp.ui.components.MitTooltip
import ch.brickinventoryapp.ui.components.withFont

/** The daily quotas with the editing state of their limits. */
@Composable
internal fun QuotaSection(monState: MonitoringUiState, events: CacheEvents) {
    val cacheStats = monState.cacheStats
    val apiLimits  = monState.apiLimits
    // Half-typed limits belong to the person and stay saveable.
    var editingLimits by rememberSaveable { mutableStateOf(false) }
    var rbInput    by rememberSaveable { mutableStateOf("0") }
    var blInput    by rememberSaveable { mutableStateOf("0") }
    var bsInput    by rememberSaveable { mutableStateOf("0") }

    // Pre-fill the input fields with the loaded values — but only as long as
    // editing is NOT happening. Saving reloads the limits itself; without
    // that condition, this answer would overwrite the user's half-typed
    // number again. Previously the pre-fill lived in the one-time load and
    // could not do that — now it is tied to the state and could.
    LaunchedEffect(apiLimits, editingLimits) {
        val al = apiLimits
        if (al != null && !editingLimits) {
            rbInput = al.rebrickable.toString()
            blInput = al.bricklink.toString()
            bsInput = al.brickset.toString()
        }
    }

    // ── API Rate Limits ───────────────────────────────────────────────────────
    QuotaCard(
        quotas = cacheStats?.rateLimits,
        bearbeiten = editingLimits,
        toggleOnEdit = { editingLimits = !editingLimits },
        inputs = Triple(bsInput, blInput, rbInput),
        onBrickset = { bsInput = it },
        onBricklink = { blInput = it },
        onRebrickable = { rbInput = it },
        onSpeichern = {
            // Reloading the limits lives in the ViewModel.
            events.limits(rbInput.toIntOrNull() ?: 0, blInput.toIntOrNull() ?: 0, bsInput.toIntOrNull() ?: 0)
            editingLimits = false
        },
    )
}

/**
 * The daily quotas of the three services; in edit mode with input fields for
 * the limits. [inputs] in the order Brickset, BrickLink, Rebrickable.
 */
@Composable
private fun QuotaCard(
    quotas: QuotasView?,
    bearbeiten: Boolean,
    toggleOnEdit: () -> Unit,
    inputs: Triple<String, String, String>,
    onBrickset: (String) -> Unit,
    onBricklink: (String) -> Unit,
    onRebrickable: (String) -> Unit,
    onSpeichern: () -> Unit,
) {
    val (bsInput, blInput, rbInput) = inputs
    AppKarte {
        Column(Modifier.padding(Abstaende.gross), verticalArrangement = Arrangement.spacedBy(Abstaende.klein)) {
            Row(Modifier.fillMaxWidth(), Arrangement.SpaceBetween, Alignment.CenterVertically) {
                SectionTitle(stringResource(R.string.monitoring_api_calls))
                MitTooltip(stringResource(R.string.cd_edit_limits)) {
                    FilledTonalIconButton(
                        onClick = toggleOnEdit,
                    ) { Icon(if (bearbeiten) Icons.Default.Close else Icons.Default.Edit, stringResource(R.string.cd_edit_limits), Modifier.size(withFont(14.dp))) }
                }
            }

            quotas?.let { rl ->
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
                    Icon(Icons.Default.Save, null, Modifier.size(withFont(16.dp)))
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
    rl: QuotaView,
    editValue: String?,
    onEdit: (String) -> Unit
) {
    val pct = if (rl.limit > 0) (rl.count.toFloat() / rl.limit).coerceIn(0f, 1f) else 0f
    val color = when {
        pct > 0.9f -> MaterialTheme.colorScheme.error
        pct > 0.7f -> LocalStatusFarben.current.warnung
        else       -> MaterialTheme.colorScheme.primary
    }
    // ── The symbol, not just the color ──
    //
    // Yellow against red collapses for red-green color blindness; but the color should
    // say at a glance "it's getting tight here". A symbol in front of it carries that without color.
    // One threshold is enough — the number next to it says how tight.
    val eng = pct > 0.7f
    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(3.dp)) {
        Row(Modifier.fillMaxWidth(), Arrangement.SpaceBetween, Alignment.CenterVertically) {
            Text(label, style = MaterialTheme.typography.bodyMedium)
            if (editValue != null) {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Abstaende.tiny)) {
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
                    horizontalArrangement = Arrangement.spacedBy(Abstaende.tiny)) {
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
