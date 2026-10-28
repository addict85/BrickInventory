package ch.brickinventoryapp.ui.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.FilterList
import androidx.compose.material3.Badge
import androidx.compose.material3.BadgedBox
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import ch.brickinventoryapp.R
import ch.brickinventoryapp.data.ScopeFilter
import ch.brickinventoryapp.data.model.HouseholdMember
import ch.brickinventoryapp.data.model.Lagerort
import ch.brickinventoryapp.ui.theme.Abstaende
import ch.brickinventoryapp.ui.theme.Formen

/**
 * Suche und daneben ein Knopf „Filter“ — der Kopf über Galerie, Teilen und
 * Minifiguren. Am Telefon stapelten sich dort fünf Zeilen Filter über dem
 * Raster; jetzt liegen sie im Blatt, und die Zahl am Knopf sagt, ob und wie
 * viele davon gerade wirken.
 */
@Composable
fun SucheMitFilter(
    wert: String,
    onWert: (String) -> Unit,
    platzhalter: String,
    aktiveFilter: Int,
    onFilter: () -> Unit,
) {
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        Suchfeld(wert = wert, onWert = onWert, platzhalter = platzhalter, modifier = Modifier.weight(1f))
        FilterKnopf(aktiveFilter, onFilter, Modifier.padding(end = 14.dp))
    }
}

@Composable
private fun FilterKnopf(aktiv: Int, onClick: () -> Unit, modifier: Modifier = Modifier) {
    val zustand = if (aktiv > 0) pluralStringResource(R.plurals.filter_active, aktiv, aktiv) else ""
    BadgedBox(
        badge = { if (aktiv > 0) Badge { Text(aktiv.toString()) } },
        modifier = modifier,
    ) {
        OutlinedButton(
            onClick = onClick,
            shape = Formen.knopf,
            modifier = Modifier.semantics { if (aktiv > 0) stateDescription = zustand },
        ) {
            Icon(Icons.Default.FilterList, null, Modifier.size(18.dp))
            Spacer(Modifier.width(Abstaende.winzig))
            Text(stringResource(R.string.filter_button))
        }
    }
}

/**
 * Das Blatt selbst: Titel, „Zurücksetzen“ und darunter die Abschnitte. Es
 * rollt, weil Themen und Farben lang werden können.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun FilterBlattRahmen(
    onSchliessen: () -> Unit,
    onZuruecksetzen: (() -> Unit)?,
    inhalt: @Composable ColumnScope.() -> Unit,
) {
    ModalBottomSheet(onDismissRequest = onSchliessen) {
        Column(
            Modifier.fillMaxWidth().verticalScroll(rememberScrollState())
                .padding(horizontal = Abstaende.gross).padding(bottom = Abstaende.sehrGross),
            verticalArrangement = Arrangement.spacedBy(Abstaende.gross),
        ) {
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                Text(stringResource(R.string.filter_title), Modifier.weight(1f),
                    fontWeight = FontWeight.Bold, style = MaterialTheme.typography.titleMedium)
                if (onZuruecksetzen != null) {
                    TextButton(onClick = onZuruecksetzen) { Text(stringResource(R.string.filter_reset)) }
                }
            }
            inhalt()
        }
    }
}

/** Ein Abschnitt des Blatts: Überschrift und eine umbrechende Reihe Chips. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun FilterAbschnitt(titel: String, chips: @Composable () -> Unit) {
    Column(verticalArrangement = Arrangement.spacedBy(Abstaende.klein)) {
        Text(titel, style = MaterialTheme.typography.labelLarge, fontWeight = FontWeight.SemiBold)
        FlowRow(
            horizontalArrangement = Arrangement.spacedBy(Abstaende.klein),
            verticalArrangement = Arrangement.spacedBy(Abstaende.winzig),
        ) { chips() }
    }
}

/** Ein Chip des Blatts; lange Namen (Themen, Konten) brechen nicht die Reihe. */
@Composable
fun FilterWahl(text: String, gewaehlt: Boolean, onClick: () -> Unit) {
    FilterChip(
        selected = gewaehlt,
        onClick = onClick,
        label = { Text(text, maxLines = 1, overflow = TextOverflow.Ellipsis) },
        modifier = Modifier.widthIn(max = 220.dp),
        shape = Formen.chip,
    )
}

/** Kontofilter als Abschnitt — nur, wenn es im Haushalt etwas zu wählen gibt. */
@Composable
fun KontoFilterAbschnitt(members: List<HouseholdMember>, current: String, onSelect: (String) -> Unit) {
    val optionen = ScopeFilter.options(
        members,
        labelAll = stringResource(R.string.household_scope_all),
        labelOwn = stringResource(R.string.household_scope_own),
    )
    if (optionen.isEmpty()) return
    val wert = ScopeFilter.sanitize(current, optionen)
    FilterAbschnitt(stringResource(R.string.household_scope_label)) {
        optionen.forEach { (v, text) -> FilterWahl(text, v == wert) { if (v != wert) onSelect(v) } }
    }
}

/** Lagerortfilter als Abschnitt — nur, wenn irgendwo ein Ort erfasst ist. */
@Composable
fun LagerortFilterAbschnitt(orte: List<Lagerort>, current: String, onSelect: (String) -> Unit) {
    if (orte.isEmpty()) return
    val wert = if (orte.any { it.ort == current }) current else ""
    FilterAbschnitt(stringResource(R.string.detail_storage)) {
        FilterWahl(stringResource(R.string.filter_storage_all), wert.isBlank()) { if (wert.isNotBlank()) onSelect("") }
        orte.forEach { o ->
            FilterWahl("${o.ort}  (${o.sets + o.teile})", o.ort == wert) { if (o.ort != wert) onSelect(o.ort) }
        }
    }
}

/** Karten oder Tabelle — keine Filterwahl, aber derselbe Ort wie die Filter. */
@Composable
fun AnsichtAbschnitt(aktuell: String, onWechsel: (String) -> Unit) {
    FilterAbschnitt(stringResource(R.string.filter_section_view)) { AnsichtUmschalter(aktuell, onWechsel) }
}
