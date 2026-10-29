package ch.brickinventoryapp.ui.screens

import ch.brickinventoryapp.ui.theme.Formen
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowDropDown
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
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
import ch.brickinventoryapp.data.model.Lagerort
import ch.brickinventoryapp.ui.theme.Abstaende

/**
 * Kontofilter einer Ansicht — Alle Konten, Eigene, dann jedes Unterkonto
 * namentlich. Nur bei einem Hauptkonto mit Unterkonten: Eine Auswahl mit genau
 * einer Antwort ist keine Wahl. Gefiltert wird auf dem Server (`accounts=`), weil
 * sich hier zwar die Kachelwand sieben liesse, nicht aber die Gesamtzahl und die
 * Bewertung.
 */
/**
 * Der Kontofilter, wie ihn eine Bestandsansicht zeigt: links oben, mit dem
 * üblichen Abstand, nur wenn es etwas zu wählen gibt. Eine Zeile für Teile,
 * Minifiguren und Galerie, damit ein abweichender Abstand nicht erst beim
 * Reiterwechsel auffällt.
 *
 * Der Finanz-Reiter gehört nicht hierher: Dort steht der Filter rechtsbündig und
 * als Eintrag einer LazyColumn, deren `item{}` die Bedingung umschliessen muss —
 * eine bewusste Ausnahme, dort begründet.
 */
@Composable
fun ScopeFilterZeile(
    members: List<HouseholdMember>,
    current: String,
    onSelect: (String) -> Unit,
    // ── Der Lagerortfilter steht daneben, nicht darunter ──
    //
    // Zwei frei kombinierbare Fragen an dieselbe Liste („wessen“ und „wo“) —
    // nebeneinander sieht man beide Antworten auf einen Blick, wie in der Webapp
    // (public/index.html, scope-* und storage-* in einer Zeile). Vorgaben, damit
    // Bildschirme, die nur den Kontofilter brauchen, unverändert aufrufen können.
    lagerorte: List<Lagerort> = emptyList(),
    lagerAktuell: String = "",
    onLagerSelect: (String) -> Unit = {},
) {
    // Beide koennen einzeln entfallen: der Kontofilter ohne Unterkonten, der
    // Lagerortfilter, solange nirgends ein Ort erfasst ist. Sind beide leer,
    // entsteht keine Zeile — sonst staende dort ein leerer Streifen.
    val zeigeKonten = members.size > 1
    val zeigeLager  = lagerorte.isNotEmpty()
    if (!zeigeKonten && !zeigeLager) return
    Row(
        Modifier.padding(start = 14.dp, top = Abstaende.klein),
        horizontalArrangement = Arrangement.spacedBy(Abstaende.klein),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (zeigeKonten) {
            ScopeFilterChip(members = members, current = current, onSelect = onSelect)
        }
        if (zeigeLager) {
            LagerortFilterChip(orte = lagerorte, current = lagerAktuell, onSelect = onLagerSelect)
        }
    }
}

/**
 * Lagerortfilter — dieselbe Form wie der Kontofilter daneben. Eine eigene Funktion
 * statt ScopeFilterChip mit anderen Daten: Die Einträge sind Orte statt Konten und
 * der erste heisst „Alle Lagerorte“ — eine gemeinsame Funktion bräuchte mehr
 * Bedingungen, als sie spart.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun LagerortFilterChip(
    orte: List<Lagerort>,
    current: String,
    onSelect: (String) -> Unit,
    modifier: Modifier = Modifier,
) {
    if (orte.isEmpty()) return
    val alle = stringResource(R.string.filter_storage_all)
    // Zeigt die gespeicherte Wahl auf einen inzwischen leeren Ort, steht hier
    // sonst eine leere Beschriftung ueber einer gefilterten Liste — dieselbe
    // Falle wie beim Kontofilter.
    val wert = if (orte.any { it.ort == current }) current else ""
    var open by rememberSaveable { mutableStateOf(false) }

    Box(modifier) {
        AssistChip(
            onClick = { open = true },
            label = {
                Text(if (wert.isBlank()) alle else wert,
                    maxLines = 1, overflow = TextOverflow.Ellipsis,
                    style = MaterialTheme.typography.labelMedium, fontWeight = FontWeight.Medium)
            },
            trailingIcon = {
                Icon(Icons.Default.ArrowDropDown, alle, Modifier.size(18.dp))
            },
            shape = Formen.kachel,
        )
        DropdownMenu(expanded = open, onDismissRequest = { open = false }) {
            DropdownMenuItem(
                text = { Text(alle, fontWeight = if (wert.isBlank()) FontWeight.Bold else FontWeight.Normal) },
                onClick = { open = false; if (wert.isNotBlank()) onSelect("") }
            )
            orte.forEach { o ->
                DropdownMenuItem(
                    text = {
                        Text("${o.ort}  (${o.sets + o.teile})",
                            fontWeight = if (o.ort == wert) FontWeight.Bold else FontWeight.Normal)
                    },
                    onClick = { open = false; if (o.ort != wert) onSelect(o.ort) }
                )
            }
        }
    }
}

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
    var open by rememberSaveable { mutableStateOf(false) }

    Box(modifier) {
        AssistChip(
            onClick = { open = true },
            label = {
                Text(label, maxLines = 1, overflow = TextOverflow.Ellipsis,
                    style = MaterialTheme.typography.labelMedium, fontWeight = FontWeight.Medium)
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
 * Besitzer-Plaketten — nur im Haushalt. Der Server hängt `owners` nur an, wenn
 * mehrere Konten im Blickfeld sind; im Einzelkonto wäre „gehört mir“ an jeder
 * Kachel Rauschen, im Haushalt ist es die wichtigste Angabe — ohne sie verschiebt
 * man das falsche Exemplar. Mehrere Namen: dasselbe Set in mehreren Konten,
 * bewusst eine Kachel mit der Summe der Mengen.
 */
// ExperimentalLayoutApi gilt für FlowRow — die Annotation gehört an die
// FUNKTION. Ein @OptIn mitten im Rumpf ist keine gültige Anweisung; zusammen
// mit der Klammerung `(FlowRow(...)) { … }` las Kotlin das als „rufe das
// Ergebnis auf" und meldete „Unresolved reference 'invoke'".
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun OwnerBadges(owners: List<HouseholdMember>, modifier: Modifier = Modifier) {
    if (owners.isEmpty()) return
    // FlowRow statt Row: Zwei Besitzer mit langen Namen sind breiter als die Kachel,
    // in einer Row schöben sich die Etiketten übereinander. FlowRow bricht um, damit
    // alle lesbar bleiben.
    FlowRow(
        modifier,
        horizontalArrangement = Arrangement.spacedBy(3.dp),
        verticalArrangement = Arrangement.spacedBy(Abstaende.haar),
    ) {
        owners.forEach { o ->
            Surface(
                shape = Formen.etikett,
                color = MaterialTheme.colorScheme.secondaryContainer,
            ) {
                Text(
                    o.username,
                    color = MaterialTheme.colorScheme.onSecondaryContainer,
                    style = MaterialTheme.typography.labelSmall, fontWeight = FontWeight.SemiBold,
                    maxLines = 1, overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.padding(horizontal = 6.dp, vertical = Abstaende.haar)
                )
            }
        }
    }
}

/**
 * Kontoauswahl beim Erfassen — „Für Konto“. Ohne Haushalt unsichtbar; der Server
 * bleibt dann beim eigenen Konto. Die Konto-ID geht als `owner_user_id` mit; ob
 * sie erlaubt ist, prüft der Server (canWriteFor), nicht die App.
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
    var open by rememberSaveable { mutableStateOf(false) }
    val current = members.firstOrNull { it.id == selected } ?: members.first()

    Box(modifier) {
        OutlinedButton(onClick = { open = true }, shape = Formen.kachel) {
            Text(stringResource(R.string.household_for_account) + ": " + current.username,
                style = MaterialTheme.typography.labelMedium, maxLines = 1, overflow = TextOverflow.Ellipsis)
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
                                style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                    },
                    onClick = { open = false; onSelect(m.id) }
                )
            }
        }
    }
}
