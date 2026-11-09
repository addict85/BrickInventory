package ch.brickinventoryapp.gemeinsam.ui

import ch.brickinventoryapp.ui.components.WahlChip
import androidx.compose.ui.semantics.heading
import androidx.compose.foundation.selection.selectableGroup
import ch.brickinventoryapp.model.ui.model.kontoOptionen
import ch.brickinventoryapp.model.ui.model.LagerortAnsicht
import ch.brickinventoryapp.model.ui.model.MitgliedAnsicht
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
import ch.brickinventoryapp.ui.components.ScanKnopf
import ch.brickinventoryapp.ui.components.grosseSchrift
import ch.brickinventoryapp.ui.components.AnsichtUmschalter
import ch.brickinventoryapp.ui.components.Suchfeld

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
    /** Scannen als Symbol neben dem Filter; null = kein Scanner auf diesem Bildschirm. */
    onScannen: (() -> Unit)? = null,
    /** Das Sortiermenü (SortierMenue) zwischen Filter und Scannen; null = keine Sortierung. */
    sortierung: (@Composable () -> Unit)? = null,
    /**
     * Erfassen mit seiner Beschreibung; steht nur bei grosser Schrift hier, sonst schwebt
     * es als ErfassenFab. Null = dieser Bildschirm erfasst nichts.
     */
    erfassen: Pair<String, () -> Unit>? = null,
) {
    // So breit wie das Raster darunter (Lesebreite.kt): Endete die Leiste bei 840 dp,
    // stand sie auf dem Tablet mitten über den Kacheln.
    Box(Modifier.fillMaxWidth()) {
        // Filter, Sortieren und Scannen gleich: drei Symbole mit Tooltip und Namen für
        // TalkBack. Auf dem Tablet stand „Filter“ beschriftet neben zwei nackten Symbolen.
        // Die Zahl am Symbol sagt weiter, wie viele Filter wirken.
        val gross = grosseSchrift()
        // Bei grosser Schrift steht Erfassen in dieser Zeile statt schwebend: Über einer
        // Liste, die nur zwei Einträge zeigt, verdeckte der schwebende Knopf ihren Text.
        val erfassenHier = erfassen.takeIf { gross }
        val knoepfe: @Composable () -> Unit = {
            val folgt = onScannen != null || sortierung != null || erfassenHier != null
            FilterKnopf(aktiveFilter, onFilter, Modifier.padding(end = if (folgt) Abstaende.winzig else 14.dp))
            if (sortierung != null) Box(Modifier.padding(end = if (onScannen != null || erfassenHier != null) Abstaende.winzig else 14.dp)) { sortierung() }
            if (onScannen != null) ScanKnopf(onScannen,
                Modifier.padding(end = if (erfassenHier != null) Abstaende.winzig else 14.dp))
            if (erfassenHier != null) MitTooltip(erfassenHier.first, Modifier.padding(end = 14.dp)) {
                FilledIconButton(onClick = erfassenHier.second) { Icon(Icons.Default.Add, contentDescription = erfassenHier.first) }
            }
        }
        // Bei grosser Schrift die Knöpfe unter das Feld: Daneben blieb vom Platzhalter
        // nur „Suche…“. Ein Filterknopf allein bleibt daneben; auf eigener Zeile stand
        // er verloren über dem Raster (Teile, Figuren).
        val untereinander = gross && (onScannen != null || sortierung != null || erfassenHier != null)
        if (untereinander) Column {
            Suchfeld(wert = wert, onWert = onWert, platzhalter = platzhalter, modifier = Modifier.fillMaxWidth())
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End,
                verticalAlignment = Alignment.CenterVertically) { knoepfe() }
        } else Row(verticalAlignment = Alignment.CenterVertically) {
            // Höchstens SUCHE_MAX breit, die Knöpfe gleich daneben: Über die ganze Tabletbreite
            // war das Feld 1 800 px lang und die Knöpfe standen weit weg.
            Suchfeld(wert = wert, onWert = onWert, platzhalter = platzhalter,
                modifier = Modifier.weight(1f, fill = false).widthIn(max = SUCHE_MAX).fillMaxWidth())
            knoepfe()
        }
    }
}

/** Breiteste Suchzeile: genug für jeden Suchbegriff, ohne über das ganze Tablet zu laufen. */
private val SUCHE_MAX = 720.dp

@Composable
private fun FilterKnopf(aktiv: Int, onClick: () -> Unit, modifier: Modifier = Modifier) {
    val zustand = if (aktiv > 0) pluralStringResource(R.plurals.filter_active, aktiv, aktiv) else ""
    // outline statt der Vorgabe outlineVariant (1,1–1,2:1): Der Rand ist die Grenze des Knopfs.
    val rand = androidx.compose.foundation.BorderStroke(1.dp, MaterialTheme.colorScheme.outline)
    BadgedBox(
        badge = { if (aktiv > 0) Badge { Text(aktiv.toString()) } },
        modifier = modifier,
    ) {
        MitTooltip(stringResource(R.string.filter_button)) {
            OutlinedIconButton(
                onClick = onClick,
                modifier = Modifier.semantics { if (aktiv > 0) stateDescription = zustand },
                border = rand,
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
fun FilterBlattRahmen(
    onSchliessen: () -> Unit,
    onZuruecksetzen: (() -> Unit)?,
    inhalt: @Composable ColumnScope.() -> Unit,
) {
    // Gleich ganz offen: Halb offen stand bei grosser Schrift nur Titel und erster Abschnitt
    // da, und wer „Zurücksetzen“ suchte, musste erst ziehen.
    ModalBottomSheet(onDismissRequest = onSchliessen,
        sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)) {
        Column(
            Modifier.fillMaxWidth().verticalScroll(rememberScrollState())
                .padding(horizontal = Abstaende.gross).padding(bottom = Abstaende.sehrGross),
            verticalArrangement = Arrangement.spacedBy(Abstaende.gross),
        ) {
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                Text(stringResource(R.string.filter_title), Modifier.weight(1f).semantics { heading() },
                    fontWeight = FontWeight.Bold, style = MaterialTheme.typography.titleMedium)
                if (onZuruecksetzen != null) {
                    TextButton(onClick = onZuruecksetzen) { Text(stringResource(R.string.filter_reset)) }
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
fun FilterAbschnitt(titel: String, chips: @Composable () -> Unit) {
    Column(verticalArrangement = Arrangement.spacedBy(Abstaende.klein)) {
        Text(titel, Modifier.semantics { heading() }, style = MaterialTheme.typography.labelLarge, fontWeight = FontWeight.SemiBold)
        FlowRow(
            Modifier.selectableGroup(),
            horizontalArrangement = Arrangement.spacedBy(Abstaende.klein),
            verticalArrangement = Arrangement.spacedBy(Abstaende.winzig),
        ) { chips() }
    }
}

/**
 * Ein Chip des Blatts, vorgelesen als Optionsfeld. Lange Namen brechen um statt
 * abgeschnitten zu werden; nur bei normaler Schrift ist der Chip schmal begrenzt.
 */
@Composable
fun FilterWahl(text: String, gewaehlt: Boolean, onClick: () -> Unit) {
    WahlChip(text, gewaehlt, onClick, if (grosseSchrift()) Modifier else Modifier.widthIn(max = 220.dp))
}

/** Kontofilter als Abschnitt — nur, wenn es im Haushalt etwas zu wählen gibt. */
@Composable
fun KontoFilterAbschnitt(members: List<MitgliedAnsicht>, current: String, onSelect: (String) -> Unit) {
    val optionen = kontoOptionen(
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

/**
 * Lagerortfilter als Abschnitt — nur, wenn irgendwo ein Ort erfasst ist. Die Zahl zählt,
 * was der Filter filtert ([nachTeilen]), mit Einheit: „Keller (42)“ bei drei Sets las
 * sich wie ein Fehler.
 */
@Composable
fun LagerortFilterAbschnitt(orte: List<LagerortAnsicht>, current: String, onSelect: (String) -> Unit,
                            nachTeilen: Boolean = false) {
    if (orte.isEmpty()) return
    val wert = if (orte.any { it.ort == current }) current else ""
    FilterAbschnitt(stringResource(R.string.detail_storage)) {
        FilterWahl(stringResource(R.string.filter_storage_all), wert.isBlank()) { if (wert.isNotBlank()) onSelect("") }
        orte.forEach { o ->
            val zahl = if (nachTeilen) o.teile else o.sets
            val text = pluralStringResource(if (nachTeilen) R.plurals.filter_lagerort_teile else R.plurals.filter_lagerort_sets,
                zahl, o.ort, zahl)
            FilterWahl(text, o.ort == wert) { if (o.ort != wert) onSelect(o.ort) }
        }
    }
}

/** Karten oder Tabelle — keine Filterwahl, aber derselbe Ort wie die Filter. */
@Composable
fun AnsichtAbschnitt(aktuell: String, onWechsel: (String) -> Unit) {
    FilterAbschnitt(stringResource(R.string.filter_section_view)) { AnsichtUmschalter(aktuell, onWechsel) }
}
