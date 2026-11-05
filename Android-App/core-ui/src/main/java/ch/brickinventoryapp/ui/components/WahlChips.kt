package ch.brickinventoryapp.ui.components

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Check
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.SegmentedButton
import androidx.compose.material3.SegmentedButtonDefaults
import androidx.compose.material3.SingleChoiceSegmentedButtonRow
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Spacer
import androidx.compose.material.icons.automirrored.filled.Sort
import androidx.compose.material3.Badge
import androidx.compose.material3.BadgedBox
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.OutlinedIconButton
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.heading
import ch.brickinventoryapp.ressourcen.R
import ch.brickinventoryapp.ui.theme.Abstaende
import ch.brickinventoryapp.ui.theme.Formen

/**
 * Genau eine von zwei bis vier gleichrangigen Möglichkeiten (Neu | Gebraucht,
 * Fällt unter | Steigt über): Material sieht dafür die Segmentschaltfläche vor —
 * zwei Chips nebeneinander lasen sich wie zwei Filter, die man beide setzen kann.
 * Ausführlich: docs/begruendungen/core-ui/ui/components/WahlChips.kt.md#segmentwahl
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun <T> SegmentWahl(
    optionen: List<Pair<T, String>>,
    gewaehlt: T,
    onWahl: (T) -> Unit,
    modifier: Modifier = Modifier,
) {
    if (LocalDensity.current.fontScale >= GROSSE_SCHRIFT_AB) {
        WahlChips(optionen, gewaehlt, onWahl, modifier.fillMaxWidth())
        return
    }
    SingleChoiceSegmentedButtonRow(modifier.fillMaxWidth()) {
        optionen.forEachIndexed { i, (wert, text) ->
            SegmentedButton(
                selected = wert == gewaehlt,
                onClick = { onWahl(wert) },
                shape = SegmentedButtonDefaults.itemShape(index = i, count = optionen.size),
            ) {
                // Zwei Zeilen statt Auslassung: Bei grosser Schrift wurde „Gebraucht“ zu „Gebr…“.
                Text(text, maxLines = 2, overflow = TextOverflow.Ellipsis,
                    textAlign = androidx.compose.ui.text.style.TextAlign.Center)
            }
        }
    }
}

/**
 * Eine Wahl aus wenigen Möglichkeiten als Chips: Vorgelesen als Radiogruppe
 * (FilterChip meldet sich als Kontrollkästchen), umbrechend statt abgeschnitten
 * bei grosser Schrift, und die Wahl trägt Häkchen und Rand — im Dunkeln lag die
 * Füllung allein nur 1,2:1 über der Fläche.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun <T> WahlChips(
    optionen: List<Pair<T, String>>,
    gewaehlt: T,
    onWahl: (T) -> Unit,
    modifier: Modifier = Modifier,
    /** Aus, wenn die Wahl gerade nichts bewirkt; der Aufrufer sagt daneben, warum. */
    enabled: Boolean = true,
) {
    FlowRow(
        modifier.selectableGroup(),
        horizontalArrangement = Arrangement.spacedBy(Abstaende.klein),
        verticalArrangement = Arrangement.spacedBy(Abstaende.klein),
    ) {
        optionen.forEach { (wert, text) ->
            val an = wert == gewaehlt
            // Surface mit selected/onClick statt Modifier.selectable: so bleibt die Welle in der Chipform.
            Surface(
                selected = an,
                onClick = { onWahl(wert) },
                enabled = enabled,
                shape = Formen.chip,
                color = if (an) MaterialTheme.colorScheme.secondaryContainer else MaterialTheme.colorScheme.surface,
                contentColor = if (an) MaterialTheme.colorScheme.onSecondaryContainer else MaterialTheme.colorScheme.onSurfaceVariant,
                border = BorderStroke(if (an) 2.dp else 1.dp,
                    if (an) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.outline),
                modifier = Modifier.heightIn(min = 48.dp).alpha(if (enabled) 1f else 0.6f).semantics { role = Role.RadioButton },
            ) {
                Row(Modifier.padding(horizontal = 12.dp, vertical = 8.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    if (an) Icon(Icons.Default.Check, null, Modifier.size(mitSchrift(18.dp)))
                    Text(text, style = MaterialTheme.typography.labelLarge)
                }
            }
        }
    }
}

/**
 * Die Sortierung: ein Symbol mit Menü, überall dieselbe Bauform (Galerie, Merkliste,
 * Katalog). Sortieren schränkt nichts ein und steht deshalb nicht zwischen den
 * Filter-Chips; ein Punkt am Symbol sagt, dass von [vorgabe] abgewichen wird.
 */
@Composable
fun SortierMenue(
    optionen: List<Pair<String, String>>,
    gewaehlt: String,
    onWahl: (String) -> Unit,
    modifier: Modifier = Modifier,
    vorgabe: String? = null,
) {
    var offen by rememberSaveable { mutableStateOf(false) }
    val aktuell = optionen.firstOrNull { it.first == gewaehlt }?.second ?: ""
    Box(modifier) {
        BadgedBox(badge = { if (vorgabe != null && gewaehlt != vorgabe) Badge() }) {
            MitTooltip(stringResource(R.string.sort_menu_cd, aktuell)) {
                OutlinedIconButton(
                    onClick = { offen = true },
                    border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline),
                ) {
                    Icon(Icons.AutoMirrored.Filled.Sort, stringResource(R.string.sort_menu_cd, aktuell))
                }
            }
        }
        DropdownMenu(offen, { offen = false }) {
            // Eine Überschrift sagt, wonach die Einträge fragen.
            Text(stringResource(R.string.filter_section_sort), style = MaterialTheme.typography.labelMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(horizontal = Abstaende.mittel, vertical = Abstaende.klein).semantics { heading() })
            optionen.forEach { (wert, text) ->
                DropdownMenuItem(
                    text = { Text(text) },
                    onClick = { offen = false; if (wert != gewaehlt) onWahl(wert) },
                    leadingIcon = {
                        if (wert == gewaehlt) Icon(Icons.Default.Check, null, Modifier.size(mitSchrift(18.dp)))
                        else Spacer(Modifier.size(18.dp))
                    },
                    modifier = Modifier.semantics { selected = wert == gewaehlt },
                )
            }
        }
    }
}
