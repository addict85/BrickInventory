package ch.brickinventoryapp.management.ui.screens

import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import ch.brickinventoryapp.management.ui.viewmodel.MonitoringUiState
import ch.brickinventoryapp.model.domain.QuotaView
import ch.brickinventoryapp.model.domain.QuotasView
import ch.brickinventoryapp.resources.R
import ch.brickinventoryapp.ui.components.SectionTitle
import ch.brickinventoryapp.ui.components.WithTooltip
import ch.brickinventoryapp.ui.components.withFont
import ch.brickinventoryapp.ui.theme.AppCard
import ch.brickinventoryapp.ui.theme.LocalStatusColors
import ch.brickinventoryapp.ui.theme.Shapes
import ch.brickinventoryapp.ui.theme.Spacing
import ch.brickinventoryapp.ui.util.NumericInput

/** The daily quotas with the editing state of their limits. */
@Composable
internal fun QuotaSection(monState: MonitoringUiState, events: CacheEvents) {
    val cacheStats = monState.cacheStats
    val apiLimits  = monState.apiLimits
    // Half-typed limits belong to the person and stay saveable.
    var editingLimits by rememberSaveable { mutableStateOf(false) }
    val rbState = rememberSaveable { mutableStateOf("0") }
    val blState = rememberSaveable { mutableStateOf("0") }
    val bsState = rememberSaveable { mutableStateOf("0") }
    var rbInput by rbState
    var blInput by blState
    var bsInput by bsState

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
        edit = editingLimits,
        toggleOnEdit = { editingLimits = !editingLimits },
        inputs = LimitInputs(bsState, blState, rbState),
        onSave = {
            // Reloading the limits lives in the ViewModel.
            events.limits(rbInput.toIntOrNull() ?: 0, blInput.toIntOrNull() ?: 0, bsInput.toIntOrNull() ?: 0)
            editingLimits = false
        },
    )
}

/** The typed limits of Brickset, BrickLink and Rebrickable while editing. */
private class LimitInputs(val brickset: MutableState<String>, val bricklink: MutableState<String>, val rebrickable: MutableState<String>)

/**
 * The daily quotas of the three services; in edit mode with input fields for
 * the limits.
 */
@Composable
private fun QuotaCard(
    quotas: QuotasView?,
    edit: Boolean,
    toggleOnEdit: () -> Unit,
    inputs: LimitInputs,
    onSave: () -> Unit,
) {
    val bsInput = inputs.brickset.value
    val blInput = inputs.bricklink.value
    val rbInput = inputs.rebrickable.value
    AppCard {
        Column(Modifier.padding(Spacing.large), verticalArrangement = Arrangement.spacedBy(Spacing.small)) {
            Row(Modifier.fillMaxWidth(), Arrangement.SpaceBetween, Alignment.CenterVertically) {
                SectionTitle(stringResource(R.string.monitoring_api_calls))
                WithTooltip(stringResource(R.string.cd_edit_limits)) {
                    FilledTonalIconButton(
                        onClick = toggleOnEdit,
                    ) { Icon(if (edit) Icons.Default.Close else Icons.Default.Edit, stringResource(R.string.cd_edit_limits), Modifier.size(withFont(14.dp))) }
                }
            }

            quotas?.let { rl ->
                RateLimitRow("Brickset",    rl.brickset,    if (edit) bsInput else null) { inputs.brickset.value = it }
                RateLimitRow("BrickLink",   rl.bricklink,   if (edit) blInput else null) { inputs.bricklink.value = it }
                RateLimitRow("Rebrickable", rl.rebrickable, if (edit) rbInput else null) { inputs.rebrickable.value = it }
            }

            if (edit) {
                FilledTonalButton(
                    onClick = onSave,
                    modifier = Modifier.fillMaxWidth(),
                    contentPadding = PaddingValues(vertical = Spacing.small)
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
        pct > 0.7f -> LocalStatusColors.current.warning
        else       -> MaterialTheme.colorScheme.primary
    }
    // ── The symbol, not just the color ──
    //
    // Yellow against red collapses for red-green color blindness; but the color should
    // say at a glance "it's getting tight here". A symbol in front of it carries that without color.
    // One threshold is enough — the number next to it says how tight.
    val tight = pct > 0.7f
    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(3.dp)) {
        Row(Modifier.fillMaxWidth(), Arrangement.SpaceBetween, Alignment.CenterVertically) {
            Text(label, style = MaterialTheme.typography.bodyMedium)
            if (editValue != null) {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Spacing.tiny)) {
                    Text("${rl.count} /", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    OutlinedTextField(
                        value = editValue,
                        onValueChange = { onEdit(NumericInput.quantity(it)) },
                        modifier = Modifier.width(80.dp),
                        singleLine = true,
                        shape = Shapes.tag,
                        textStyle = MaterialTheme.typography.bodyMedium,
                    keyboardOptions = NumericInput.integerKeyboard()
                )
                }
            } else {
                Row(verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(Spacing.tiny)) {
                    if (tight) Icon(Icons.Default.Warning, stringResource(R.string.monitoring_quota_tight),
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
