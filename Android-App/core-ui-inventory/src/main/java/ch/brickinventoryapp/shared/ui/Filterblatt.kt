package ch.brickinventoryapp.shared.ui

import ch.brickinventoryapp.ui.components.ChoiceChip
import androidx.compose.ui.semantics.heading
import androidx.compose.foundation.selection.selectableGroup
import ch.brickinventoryapp.model.domain.accountOptions
import ch.brickinventoryapp.model.domain.LocationView
import ch.brickinventoryapp.model.domain.MemberView
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.FilterAlt
import androidx.compose.material.icons.filled.Close
import androidx.compose.material3.InputChip
import androidx.compose.material3.InputChipDefaults
import androidx.compose.foundation.layout.size
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.material3.Badge
import androidx.compose.material3.BadgedBox
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilledIconButton
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.material3.OutlinedIconButton
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
import androidx.compose.ui.unit.dp
import ch.brickinventoryapp.resources.R
import ch.brickinventoryapp.model.data.ScopeFilter
import ch.brickinventoryapp.ui.theme.Abstaende
import ch.brickinventoryapp.ui.components.MitTooltip
import ch.brickinventoryapp.ui.components.ScanButton
import ch.brickinventoryapp.ui.components.largeFont
import ch.brickinventoryapp.ui.components.ViewToggle
import ch.brickinventoryapp.ui.components.Suchfeld
import ch.brickinventoryapp.model.ui.ListView

/**
 * Search, and next to it a „Filter“ button — the header above gallery, parts and
 * minifigs. On the phone, five rows of filters used to stack above the
 * grid; now they live in the sheet, and the number on the button says whether and how
 * many of them currently apply.
 */
@Composable
fun SearchWithFilter(
    wert: String,
    onValue: (String) -> Unit,
    platzhalter: String,
    activeFilter: Int,
    onFilter: () -> Unit,
    /** Scanning as an icon next to the filter; null = no scanner on this screen. */
    scanOn: (() -> Unit)? = null,
    /** The sort menu (SortierMenu) between filter and scan; null = no sorting. */
    sorting: (@Composable () -> Unit)? = null,
    /**
     * Capture with its description; it only sits here with large text, otherwise
     * it floats as an AddFab. Null = this screen captures nothing.
     */
    erfassen: Pair<String, () -> Unit>? = null,
    /** The active filters; they sit as chips under the search field and can be removed individually. */
    aktive: List<ActiveFilter> = emptyList(),
) {
    Column(Modifier.fillMaxWidth()) {
        SearchAndButtons(wert, onValue, platzhalter, activeFilter, onFilter, scanOn, sorting, erfassen)
        ActiveFilterSeries(aktive)
    }
}

@Composable
private fun SearchAndButtons(
    wert: String,
    onValue: (String) -> Unit,
    platzhalter: String,
    activeFilter: Int,
    onFilter: () -> Unit,
    scanOn: (() -> Unit)?,
    sorting: (@Composable () -> Unit)?,
    erfassen: Pair<String, () -> Unit>?,
) {
    // As wide as the grid below it (Lesebreite.kt): if the bar ended at 840 dp,
    // it stood on the tablet right in the middle over the tiles.
    Box(Modifier.fillMaxWidth()) {
        // Filter, sort and scan all the same: three icons with a tooltip and a name for
        // TalkBack. On the tablet, „Filter“ was labeled next to two bare icons.
        // The number on the icon also says how many filters are active.
        val gross = largeFont()
        // With large text, capture sits in this row instead of floating: over a
        // list that shows only two entries, the floating button covered its text.
        val addHere = erfassen.takeIf { gross }
        val buttons: @Composable () -> Unit = {
            val folgt = scanOn != null || sorting != null || addHere != null
            FilterButton(activeFilter, onFilter, Modifier.padding(end = if (folgt) Abstaende.tiny else 14.dp))
            if (sorting != null) Box(Modifier.padding(end = if (scanOn != null || addHere != null) Abstaende.tiny else 14.dp)) { sorting() }
            if (scanOn != null) ScanButton(scanOn,
                Modifier.padding(end = if (addHere != null) Abstaende.tiny else 14.dp))
            if (addHere != null) MitTooltip(addHere.first, Modifier.padding(end = 14.dp)) {
                FilledIconButton(onClick = addHere.second) { Icon(Icons.Default.Add, contentDescription = addHere.first) }
            }
        }
        // With large text, the buttons go below the field: next to it, only „Suche…"
        // was left of the placeholder. A filter button alone stays next to it; on its own row
        // it stood lost above the grid (parts, figures).
        val untereinander = gross && (scanOn != null || sorting != null || addHere != null)
        if (untereinander) Column {
            Suchfeld(wert = wert, onValue = onValue, platzhalter = platzhalter, modifier = Modifier.fillMaxWidth())
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End,
                verticalAlignment = Alignment.CenterVertically) { buttons() }
        } else Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            // Across the full width, the buttons at the grid's right edge: limited to 720 dp,
            // the row ended on the tablet right in the middle over the tiles, empty to its right.
            Suchfeld(wert = wert, onValue = onValue, platzhalter = platzhalter, modifier = Modifier.weight(1f))
            buttons()
        }
    }
}

/** An active filter: what it shows and how it's removed. */
data class ActiveFilter(val text: String, val entfernen: () -> Unit)

/**
 * The active filters under the search field, each a chip with an X. The number on the filter button
 * only said „2“; which two, you only saw inside the sheet, and removing meant going in.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun ActiveFilterSeries(filter: List<ActiveFilter>) {
    if (filter.isEmpty()) return
    FlowRow(
        Modifier.fillMaxWidth().padding(horizontal = Abstaende.gross).padding(bottom = Abstaende.tiny),
        horizontalArrangement = Arrangement.spacedBy(Abstaende.klein),
        verticalArrangement = Arrangement.spacedBy(Abstaende.tiny),
    ) {
        for (f in filter) {
            val name = stringResource(R.string.filter_entfernen, f.text)
            InputChip(
                selected = false,
                onClick = f.entfernen,
                label = { Text(f.text, maxLines = 2) },
                trailingIcon = { Icon(Icons.Default.Close, null, Modifier.size(InputChipDefaults.IconSize)) },
                modifier = Modifier.semantics { contentDescription = name },
            )
        }
    }
}

/** The account filter as a chip, when active; the name as in the sheet. */
@Composable
fun accountFilter(members: List<MemberView>, wert: String, removeOn: () -> Unit): ActiveFilter? {
    if (wert == ScopeFilter.ALL) return null
    val text = accountOptions(
        members,
        labelAll = stringResource(R.string.household_scope_all),
        labelOwn = stringResource(R.string.household_scope_own),
    ).firstOrNull { it.first == wert }?.second ?: return null
    return ActiveFilter(text, removeOn)
}

/** The storage-location filter as a chip, when active. */
fun storageFilter(orte: List<LocationView>, wert: String, removeOn: () -> Unit): ActiveFilter? =
    wert.takeIf { w -> w.isNotBlank() && orte.any { it.ort == w } }?.let { ActiveFilter(it, removeOn) }

@Composable
private fun FilterButton(aktiv: Int, onClick: () -> Unit, modifier: Modifier = Modifier) {
    val zustand = if (aktiv > 0) pluralStringResource(R.plurals.filter_active, aktiv, aktiv) else ""
    // outline instead of the default outlineVariant (1.1–1.2:1): the border is the button's boundary.
    val edge = androidx.compose.foundation.BorderStroke(1.dp, MaterialTheme.colorScheme.outline)
    BadgedBox(
        badge = { if (aktiv > 0) Badge { Text(aktiv.toString()) } },
        modifier = modifier,
    ) {
        MitTooltip(stringResource(R.string.filter_button)) {
            OutlinedIconButton(
                onClick = onClick,
                modifier = Modifier.semantics { if (aktiv > 0) stateDescription = zustand },
                border = edge,
            ) {
                Icon(Icons.Default.FilterAlt, stringResource(R.string.filter_button))
            }
        }
    }
}

/**
 * The sheet itself: title, „Reset“ and the sections below it. It
 * scrolls, because themes and colors can run long.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun FilterSheetFrame(
    onSchliessen: () -> Unit,
    resetOn: (() -> Unit)?,
    inhalt: @Composable ColumnScope.() -> Unit,
) {
    // Fully open right away: half-open, with large text, showed only the title and the first section,
    // and whoever looked for „Reset" had to drag it open first.
    ModalBottomSheet(onDismissRequest = onSchliessen,
        sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)) {
        Column(
            Modifier.fillMaxWidth().verticalScroll(rememberScrollState())
                .padding(horizontal = Abstaende.gross).padding(bottom = Abstaende.veryLarge),
            verticalArrangement = Arrangement.spacedBy(Abstaende.gross),
        ) {
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                Text(stringResource(R.string.filter_title), Modifier.weight(1f).semantics { heading() },
                    fontWeight = FontWeight.Bold, style = MaterialTheme.typography.titleMedium)
                if (resetOn != null) {
                    TextButton(onClick = resetOn) { Text(stringResource(R.string.filter_reset)) }
                }
            }
            inhalt()
        }
    }
}

/**
 * A section of the sheet: heading and a wrapping row of chips. Each section
 * is a single choice; TalkBack jumps from section to section by heading.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun FilterSection(titel: String, chips: @Composable () -> Unit) {
    Column(verticalArrangement = Arrangement.spacedBy(Abstaende.klein)) {
        Text(titel, Modifier.semantics { heading() }, style = MaterialTheme.typography.labelLarge, fontWeight = FontWeight.SemiBold)
        FlowRow(
            Modifier.selectableGroup(),
            horizontalArrangement = Arrangement.spacedBy(Abstaende.klein),
            verticalArrangement = Arrangement.spacedBy(Abstaende.tiny),
        ) { chips() }
    }
}

/**
 * A chip of the sheet, read out as a radio button. Long names wrap instead of
 * being truncated; only with normal text size is the chip width-constrained.
 */
@Composable
fun FilterChoice(text: String, gewaehlt: Boolean, onClick: () -> Unit) {
    ChoiceChip(text, gewaehlt, onClick, if (largeFont()) Modifier else Modifier.widthIn(max = 220.dp))
}

/** Account filter as a section — only when there is something to choose in the household. */
@Composable
fun AccountFilterSection(members: List<MemberView>, current: String, onSelect: (String) -> Unit) {
    val optionen = accountOptions(
        members,
        labelAll = stringResource(R.string.household_scope_all),
        labelOwn = stringResource(R.string.household_scope_own),
    )
    if (optionen.isEmpty()) return
    val wert = ScopeFilter.sanitize(current, optionen)
    FilterSection(stringResource(R.string.household_scope_label)) {
        optionen.forEach { (v, text) -> FilterChoice(text, v == wert) { if (v != wert) onSelect(v) } }
    }
}

/**
 * Storage-location filter as a section — only when a location is captured anywhere. The number counts
 * what the filter filters ([afterShare]), with a unit: „Keller (42)“ for three sets read
 * like an error.
 */
@Composable
fun LocationFilterSection(orte: List<LocationView>, current: String, onSelect: (String) -> Unit,
                            afterShare: Boolean = false) {
    if (orte.isEmpty()) return
    val wert = if (orte.any { it.ort == current }) current else ""
    FilterSection(stringResource(R.string.detail_storage)) {
        FilterChoice(stringResource(R.string.filter_storage_all), wert.isBlank()) { if (wert.isNotBlank()) onSelect("") }
        orte.forEach { o ->
            val zahl = if (afterShare) o.teile else o.sets
            val text = pluralStringResource(if (afterShare) R.plurals.filter_lagerort_teile else R.plurals.filter_lagerort_sets,
                zahl, o.ort, zahl)
            FilterChoice(text, o.ort == wert) { if (o.ort != wert) onSelect(o.ort) }
        }
    }
}

/** Cards or table — not a filter choice, but the same spot as the filters. */
@Composable
fun ViewSection(aktuell: ListView, onSwitch: (ListView) -> Unit) {
    FilterSection(stringResource(R.string.filter_section_view)) { ViewToggle(aktuell, onSwitch) }
}
