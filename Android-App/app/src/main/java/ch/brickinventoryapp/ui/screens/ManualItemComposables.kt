package ch.brickinventoryapp.ui.screens

import ch.brickinventoryapp.ui.theme.Formen
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.runtime.DisposableEffect
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import ch.brickinventoryapp.R
import ch.brickinventoryapp.data.model.Acquisition
import ch.brickinventoryapp.util.fmtMoney
import ch.brickinventoryapp.ui.theme.LocalIsBrickTheme
import ch.brickinventoryapp.ui.theme.BrickSage
import ch.brickinventoryapp.ui.theme.BrickSageText
import ch.brickinventoryapp.util.NumericInput

/**
 * Gemeinsame Composables für manuell erfasste Teile UND Minifiguren.
 * Beide Typen haben identische Acquisition-Logik — kein Code-Duplikat.
 */

// ── Compact read-only acquisition summary (wie im Set-Detail) ─────────────────

@Composable
fun AcquisitionSummarySection(
    acquisitions: List<Acquisition>,
    currency: String,
    onEditPrices: () -> Unit
) {
    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Row(
            Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.Top
        ) {
            Text(
                stringResource(R.string.detail_purchase_price),
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(top = 2.dp)
            )
            Column(horizontalAlignment = Alignment.End) {
                if (acquisitions.isEmpty()) {
                    Text("—", style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant)
                } else {
                    acquisitions.forEach { acq ->
                        Row(
                            horizontalArrangement = Arrangement.spacedBy(6.dp),
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Text("×${acq.quantity}",
                                style = MaterialTheme.typography.labelSmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant)
                            ConditionBadge(acq.condition)
                            if (acq.effectivePrice != null) {
                                Text(fmtMoney(acq.effectivePrice ?: 0.0, currency),
                                    fontWeight = FontWeight.SemiBold, fontSize = 13.sp)
                            }
                        }
                    }
                }
                Spacer(Modifier.height(4.dp))
                OutlinedButton(onClick = onEditPrices,
                    contentPadding = PaddingValues(horizontal = 10.dp, vertical = 2.dp),
                    modifier = Modifier.height(28.dp)) {
                    Text("✏️ ${stringResource(R.string.detail_edit_prices)}", fontSize = 12.sp)
                }
            }
        }
        HorizontalDivider()
    }
}

// ── Condition badge (shared by sets, parts, figs) ────────────────────────────

/**
 * Eine Plakette JE erfasstem Zustand.
 *
 * `condition` ist ein Aggregat und kennt nur einen Wert („gebraucht, sobald
 * eine Erfassung gebraucht ist"). Wer ein Exemplar neu und eines gebraucht
 * gekauft hat, sah damit nur „Gebraucht" — obwohl die Neu-Erfassung mit ihrem
 * eigenen Preis in die Bewertung eingeht.
 *
 * Welche Plaketten es gibt, entscheidet der Server (`conditions`); hier wird
 * nichts abgeleitet. Ältere Antworten ohne das Feld fallen auf `condition`
 * zurück — dann sieht es aus wie bisher.
 */
@Composable
fun ConditionBadges(conditions: List<String>, fallback: String? = null) {
    val list = if (conditions.isNotEmpty()) conditions else listOf(fallback ?: "N")
    Row(horizontalArrangement = Arrangement.spacedBy(3.dp)) {
        list.forEach { ConditionBadge(it) }
    }
}

@Composable
fun ConditionBadge(condition: String) {
    val isUsed = condition == "U"
    val isBrick = LocalIsBrickTheme.current
    val bgColor = when {
        isUsed  -> MaterialTheme.colorScheme.secondaryContainer
        isBrick -> BrickSage
        else    -> MaterialTheme.colorScheme.primaryContainer
    }
    val fgColor = when {
        isUsed  -> MaterialTheme.colorScheme.onSecondaryContainer
        isBrick -> BrickSageText
        else    -> MaterialTheme.colorScheme.onPrimaryContainer
    }
    Surface(
        shape = Formen.etikett,
        color = bgColor
    ) {
        Text(
            if (isUsed) stringResource(R.string.condition_used) else stringResource(R.string.condition_new),
            Modifier.padding(horizontal = 6.dp, vertical = 1.dp),
            style = MaterialTheme.typography.labelSmall,
            fontWeight = FontWeight.SemiBold,
            color = fgColor
        )
    }
}

/**
 * Ersatzteil-Plakette — dieselbe Form wie [ConditionBadge] daneben.
 *
 * Sets enthalten ein Tuetchen Ersatzteile; Rebrickable kennzeichnet sie. Der
 * Text dafuer lag in beiden Sprachen bereit und in der App gab es sogar einen
 * Helfer, der das Kennzeichen deutete — gezeichnet hat die Plakette nie
 * jemand. Der Grund stand im Feld selbst: `is_spare` kam in vier
 * verschiedenen Schreibweisen an. Seit der Server sie an einer Stelle liest
 * (istErsatzteil() in utils/validate.ts), ist es ein Wahrheitswert.
 *
 * Zurueckhaltender als die Zustands-Plakette: Ein Ersatzteil ist eine
 * Nebeninformation, kein Zustand — deshalb der ruhige Flaechenton statt der
 * Signalfarbe.
 */
@Composable
fun ErsatzteilPlakette(modifier: Modifier = Modifier) {
    Surface(shape = Formen.etikett, color = MaterialTheme.colorScheme.surfaceVariant, modifier = modifier) {
        Text(
            stringResource(R.string.parts_spare_tag),
            Modifier.padding(horizontal = 6.dp, vertical = 1.dp),
            style = MaterialTheme.typography.labelSmall,
            fontWeight = FontWeight.SemiBold,
            color = MaterialTheme.colorScheme.onSurfaceVariant
        )
    }
}

// Der frühere ManualItemDetailDialog steht hier nicht mehr: Die Detailansicht
// manueller Teile und Minifiguren ist seit hardened-99 ein ganzer Screen
// (ui/screens/ManualItemDetailScreen.kt), wie bei den Sets. Übrig bleiben hier
// die Bausteine, die BEIDE Seiten benutzen — AcquisitionSummarySection,
// ConditionBadge(s) und der Kaufpreis-Editor.
