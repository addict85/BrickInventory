package ch.brickinventoryapp.ui.screens

import ch.brickinventoryapp.ui.theme.Formen
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowDropDown
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import ch.brickinventoryapp.R
import ch.brickinventoryapp.data.ScopeFilter
import ch.brickinventoryapp.data.model.HouseholdMember

/**
 * Kontofilter einer Ansicht — Alle Konten, Eigene, dann jedes Unterkonto
 * namentlich.
 *
 * ── Wann er erscheint ───────────────────────────────────────────────────────
 * Nur bei einem Hauptkonto MIT Unterkonten. Für alle anderen ist der Filter
 * wirkungslos, und eine Auswahl mit genau einer möglichen Antwort ist keine
 * Wahl, sondern eine Frage, die sich nicht stellt.
 *
 * ── Gefiltert wird auf dem Server ───────────────────────────────────────────
 * Der Wert reist als `accounts=` mit. Hier auszusieben wäre keine Alternative:
 * Eine Kachelwand liesse sich filtern, die Gesamtzahl darunter und die
 * Bewertung im Finanzreiter nicht.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ScopeFilterChip(
    members: List<HouseholdMember>,
    current: String,
    onSelect: (String) -> Unit,
    modifier: Modifier = Modifier,
) {
    val options = ScopeFilter.options(
        members,
        labelAll  = stringResource(R.string.household_scope_all),
        labelOwn  = stringResource(R.string.household_scope_own),
    )
    if (options.isEmpty()) return

    // Zeigt die gespeicherte Wahl auf ein inzwischen entkoppeltes Konto,
    // steht hier sonst eine leere Beschriftung über einer gefilterten Liste.
    val value = ScopeFilter.sanitize(current, options)
    val label = options.firstOrNull { it.first == value }?.second ?: options.first().second
    var open by remember { mutableStateOf(false) }

    Box(modifier) {
        AssistChip(
            onClick = { open = true },
            label = {
                Text(label, maxLines = 1, overflow = TextOverflow.Ellipsis,
                    fontSize = 13.sp, fontWeight = FontWeight.Medium)
            },
            trailingIcon = {
                Icon(Icons.Default.ArrowDropDown,
                    stringResource(R.string.household_scope_label), Modifier.size(18.dp))
            },
            shape = Formen.kachel,
        )
        DropdownMenu(expanded = open, onDismissRequest = { open = false }) {
            options.forEach { (v, text) ->
                DropdownMenuItem(
                    text = { Text(text, fontWeight = if (v == value) FontWeight.Bold else FontWeight.Normal) },
                    onClick = { open = false; if (v != value) onSelect(v) }
                )
            }
        }
    }
}

/**
 * Besitzer-Plaketten — nur im Haushalt.
 *
 * Der Server hängt `owners` nur an, wenn mehrere Konten im Blickfeld sind. Im
 * Einzelkonto stünde an jeder Kachel „gehört mir", und das ist Rauschen. Im
 * Haushalt ist es dagegen die wichtigste Angabe der Kachel: Ohne sie
 * verschiebt man das falsche Exemplar.
 *
 * Mehrere Namen heissen, dass dasselbe Set in mehreren Konten liegt — die
 * Kachel zeigt es bewusst nur EINMAL, mit der Summe der Mengen.
 */
// ExperimentalLayoutApi gilt für FlowRow — die Annotation gehört an die
// FUNKTION. Ein @OptIn mitten im Rumpf ist keine gültige Anweisung; zusammen
// mit der Klammerung `(FlowRow(...)) { … }` las Kotlin das als „rufe das
// Ergebnis auf" und meldete „Unresolved reference 'invoke'".
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun OwnerBadges(owners: List<HouseholdMember>, modifier: Modifier = Modifier) {
    if (owners.isEmpty()) return
    // FlowRow statt Row (Nachtrag 33, Marcos Screenshot): Zwei Besitzer mit
    // langen Namen sind zusammen breiter als die Kachel — in der Row schoben
    // sich die Etiketten übereinander. FlowRow bricht in die nächste Zeile um,
    // damit ALLE Etiketten lesbar bleiben.
    FlowRow(
        modifier,
        horizontalArrangement = Arrangement.spacedBy(3.dp),
        verticalArrangement = Arrangement.spacedBy(2.dp),
    ) {
        owners.forEach { o ->
            Surface(
                shape = Formen.etikett,
                color = MaterialTheme.colorScheme.secondaryContainer,
            ) {
                Text(
                    o.username,
                    color = MaterialTheme.colorScheme.onSecondaryContainer,
                    fontSize = 10.sp, fontWeight = FontWeight.SemiBold,
                    maxLines = 1, overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.padding(horizontal = 6.dp, vertical = 2.dp)
                )
            }
        }
    }
}

/**
 * Kontoauswahl beim Erfassen — „Für Konto".
 *
 * Ohne Haushalt gar nicht sichtbar; der Server bleibt dann beim eigenen Konto.
 * Ausgewählt wird eine Konto-ID, die als `owner_user_id` mitgeschickt wird —
 * ob sie erlaubt ist, prüft der Server (canWriteFor), nicht die App.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun OwnerPicker(
    members: List<HouseholdMember>,
    selected: Int?,
    onSelect: (Int) -> Unit,
    modifier: Modifier = Modifier,
) {
    if (members.size < 2) return
    var open by remember { mutableStateOf(false) }
    val current = members.firstOrNull { it.id == selected } ?: members.first()

    Box(modifier) {
        OutlinedButton(onClick = { open = true }, shape = Formen.kachel) {
            Text(stringResource(R.string.household_for_account) + ": " + current.username,
                fontSize = 13.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Icon(Icons.Default.ArrowDropDown, null, Modifier.size(18.dp))
        }
        DropdownMenu(expanded = open, onDismissRequest = { open = false }) {
            members.forEach { m ->
                DropdownMenuItem(
                    text = {
                        Row(verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                            Text(m.username,
                                fontWeight = if (m.id == current.id) FontWeight.Bold else FontWeight.Normal)
                            if (m.isSelf) Text(stringResource(R.string.household_self),
                                fontSize = 11.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                    },
                    onClick = { open = false; onSelect(m.id) }
                )
            }
        }
    }
}
