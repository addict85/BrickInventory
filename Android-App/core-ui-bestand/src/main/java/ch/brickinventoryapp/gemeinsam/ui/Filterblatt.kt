package ch.brickinventoryapp.gemeinsam.ui

import ch.brickinventoryapp.ui.components.ChoiceChip
import androidx.compose.ui.semantics.heading
import androidx.compose.foundation.selection.selectableGroup
import ch.brickinventoryapp.model.fach.accountOptions
import ch.brickinventoryapp.model.fach.LocationView
import ch.brickinventoryapp.model.fach.MemberView
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
import ch.brickinventoryapp.ressourcen.R
import ch.brickinventoryapp.model.data.ScopeFilter
import ch.brickinventoryapp.ui.theme.Abstaende
import ch.brickinventoryapp.ui.components.MitTooltip
import ch.brickinventoryapp.ui.components.ScanButton
import ch.brickinventoryapp.ui.components.largeFont
import ch.brickinventoryapp.ui.components.ViewToggle
import ch.brickinventoryapp.ui.components.Suchfeld
import ch.brickinventoryapp.model.ui.ListView

/**
 * Suche und daneben ein Knopf „Filter“ — der Kopf über Galerie, Teilen und
 * Minifiguren. Am Telefon stapelten sich dort fünf Zeilen Filter über dem
 * Raster; jetzt liegen sie im Blatt, und die Zahl am Knopf sagt, ob und wie
 * viele davon gerade wirken.
 */
@Composable
fun SearchWithFilter(
    wert: String,
    onValue: (String) -> Unit,
    platzhalter: String,
    activeFilter: Int,
    onFilter: () -> Unit,
    /** Scannen als Symbol neben dem Filter; null = kein Scanner auf diesem Bildschirm. */
    scanOn: (() -> Unit)? = null,
    /** Das Sortiermenü (SortierMenu) zwischen Filter und Scannen; null = keine Sortierung. */
    sorting: (@Composable () -> Unit)? = null,
    /**
     * Erfassen mit seiner Beschreibung; steht nur bei grosser Schrift hier, sonst schwebt
     * es als AddFab. Null = dieser Bildschirm erfasst nichts.
     */
    erfassen: Pair<String, () -> Unit>? = null,
    /** Die wirkenden Filter; sie stehen als Chips unter der Suche und lassen sich einzeln entfernen. */
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
    // So breit wie das Raster darunter (Lesebreite.kt): Endete die Leiste bei 840 dp,
    // stand sie auf dem Tablet mitten über den Kacheln.
    Box(Modifier.fillMaxWidth()) {
        // Filter, Sortieren und Scannen gleich: drei Symbole mit Tooltip und Namen für
        // TalkBack. Auf dem Tablet stand „Filter“ beschriftet neben zwei nackten Symbolen.
        // Die Zahl am Symbol sagt weiter, wie viele Filter wirken.
        val gross = largeFont()
        // Bei grosser Schrift steht Erfassen in dieser Zeile statt schwebend: Über einer
        // Liste, die nur zwei Einträge zeigt, verdeckte der schwebende Knopf ihren Text.
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
        // Bei grosser Schrift die Knöpfe unter das Feld: Daneben blieb vom Platzhalter
        // nur „Suche…“. Ein Filterknopf allein bleibt daneben; auf eigener Zeile stand
        // er verloren über dem Raster (Teile, Figuren).
        val untereinander = gross && (scanOn != null || sorting != null || addHere != null)
        if (untereinander) Column {
            Suchfeld(wert = wert, onValue = onValue, platzhalter = platzhalter, modifier = Modifier.fillMaxWidth())
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End,
                verticalAlignment = Alignment.CenterVertically) { buttons() }
        } else Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            // Über die ganze Breite, die Knöpfe am rechten Rand des Rasters: Auf 720 dp begrenzt
            // endete die Zeile auf dem Tablet mitten über den Kacheln, rechts davon leer.
            Suchfeld(wert = wert, onValue = onValue, platzhalter = platzhalter, modifier = Modifier.weight(1f))
            buttons()
        }
    }
}

/** Ein wirkender Filter: was er zeigt und wie er wegfällt. */
data class ActiveFilter(val text: String, val entfernen: () -> Unit)

/**
 * Die wirkenden Filter unter der Suche, je ein Chip mit Kreuz. Die Zahl am Filterknopf
 * sagte nur „2“; welche zwei, sah man erst im Blatt, und zum Entfernen musste man hinein.
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

/** Der Kontofilter als Chip, wenn er wirkt; der Name wie im Blatt. */
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

/** Der Lagerortfilter als Chip, wenn er wirkt. */
fun storageFilter(orte: List<LocationView>, wert: String, removeOn: () -> Unit): ActiveFilter? =
    wert.takeIf { w -> w.isNotBlank() && orte.any { it.ort == w } }?.let { ActiveFilter(it, removeOn) }

@Composable
private fun FilterButton(aktiv: Int, onClick: () -> Unit, modifier: Modifier = Modifier) {
    val zustand = if (aktiv > 0) pluralStringResource(R.plurals.filter_active, aktiv, aktiv) else ""
    // outline statt der Vorgabe outlineVariant (1,1–1,2:1): Der Rand ist die Grenze des Knopfs.
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
 * Das Blatt selbst: Titel, „Zurücksetzen“ und darunter die Abschnitte. Es
 * rollt, weil Themen und Farben lang werden können.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun FilterSheetFrame(
    onSchliessen: () -> Unit,
    resetOn: (() -> Unit)?,
    inhalt: @Composable ColumnScope.() -> Unit,
) {
    // Gleich ganz offen: Halb offen stand bei grosser Schrift nur Titel und erster Abschnitt
    // da, und wer „Zurücksetzen“ suchte, musste erst ziehen.
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
 * Ein Abschnitt des Blatts: Überschrift und eine umbrechende Reihe Chips. Jeder Abschnitt
 * ist eine Einfachwahl; TalkBack springt per Überschrift von Abschnitt zu Abschnitt.
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
 * Ein Chip des Blatts, vorgelesen als Optionsfeld. Lange Namen brechen um statt
 * abgeschnitten zu werden; nur bei normaler Schrift ist der Chip schmal begrenzt.
 */
@Composable
fun FilterChoice(text: String, gewaehlt: Boolean, onClick: () -> Unit) {
    ChoiceChip(text, gewaehlt, onClick, if (largeFont()) Modifier else Modifier.widthIn(max = 220.dp))
}

/** Kontofilter als Abschnitt — nur, wenn es im Haushalt etwas zu wählen gibt. */
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
 * Lagerortfilter als Abschnitt — nur, wenn irgendwo ein Ort erfasst ist. Die Zahl zählt,
 * was der Filter filtert ([afterShare]), mit Einheit: „Keller (42)“ bei drei Sets las
 * sich wie ein Fehler.
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

/** Karten oder Tabelle — keine Filterwahl, aber derselbe Ort wie die Filter. */
@Composable
fun ViewSection(aktuell: ListView, onSwitch: (ListView) -> Unit) {
    FilterSection(stringResource(R.string.filter_section_view)) { ViewToggle(aktuell, onSwitch) }
}
