package ch.brickinventoryapp.management.ui.screens

import ch.brickinventoryapp.ui.titel
import ch.brickinventoryapp.model.ui.theme.Design
import ch.brickinventoryapp.model.domain.Zustand
import ch.brickinventoryapp.ui.components.nebenKnopfFarben
import ch.brickinventoryapp.ui.components.nebenKnopfRand
import ch.brickinventoryapp.ui.theme.Formen
import ch.brickinventoryapp.ui.theme.AppKarte
import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import ch.brickinventoryapp.ui.components.Prompt
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.foundation.selection.toggleable
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import ch.brickinventoryapp.data.VorwaermNetwork
import ch.brickinventoryapp.model.domain.CacheMetricsView
import androidx.compose.ui.res.stringResource
import ch.brickinventoryapp.resources.R
import ch.brickinventoryapp.management.ui.viewmodel.MonitoringUiState
import ch.brickinventoryapp.ui.util.NumericInput
import ch.brickinventoryapp.ui.theme.Abstaende
import ch.brickinventoryapp.ui.components.SectionTitle
import ch.brickinventoryapp.ui.components.MitTooltip
import ch.brickinventoryapp.ui.components.SelectionField
import ch.brickinventoryapp.ui.components.withFont
import ch.brickinventoryapp.shared.ui.ConditionToggle

/** Was der Cache-Abschnitt auslöst; MonitoringRoute verdrahtet die ViewModels. */
class CacheEvents(
    val defaultState: (Zustand) -> Unit,
    val clearStore: () -> Unit,
    val netz: (VorwaermNetwork, Boolean) -> Unit,
    val design: (Design) -> Unit,
    val cacheDuration: (Int) -> Unit,
    val cacheLeeren: (Boolean) -> Unit,
    val limits: (rebrickable: Int, bricklink: Int, brickset: Int) -> Unit,
)

@Composable
internal fun CacheAndLimitsSection(
    monState: MonitoringUiState,
    /** Die Netzerlaubnisse fürs Vorwärmen (WLAN, mobil, Roaming), Geräte-Einstellungen. */
    networks: Map<VorwaermNetwork, Boolean>,
    /** Das wirksame Design, wenn der Server noch keine Vorgabe nannte. */
    effectiveDesign: Design,
    storeBytes: Long,
    events: CacheEvents,
) {
    // Derselbe Abstand und Rand wie zwischen den übrigen Karten der Seite.
    Column(verticalArrangement = Arrangement.spacedBy(Abstaende.mittel)) {
        CacheCard(monState, networks, storeBytes, events)
        RenderingCard(monState.defaultDesign ?: effectiveDesign, events.design)
        QuotaSection(monState, events)
    }
}

/** Preis-Cache: Zahlen, Vorgaben, Vorschau-Ablage, Netze, Dauer und Leeren. */
@Composable
private fun CacheCard(
    monState: MonitoringUiState,
    networks: Map<VorwaermNetwork, Boolean>,
    storeBytes: Long,
    events: CacheEvents,
) {
    var showClearQuestion by rememberSaveable { mutableStateOf(false) }
    var clearEverything by rememberSaveable { mutableStateOf(false) }
    val cacheStats = monState.cacheStats
    val cacheTtl   = monState.cacheTtl
    val defaultCondition = monState.defaultState

    // Bedienzustand: was gerade bearbeitet und halb eingetippt ist. Bleibt hier
    // und speicherbar — das ueberlebt auch den Prozesstod, ein ViewModel nicht.
    var editingTtl by rememberSaveable { mutableStateOf(false) }
    var ttlInput   by rememberSaveable { mutableStateOf("24") }
    LaunchedEffect(cacheTtl, editingTtl) {
        if (!editingTtl) ttlInput = cacheTtl
    }

    // ── Price Cache ───────────────────────────────────────────────────────────
    AppKarte {
        Column(Modifier.padding(Abstaende.gross), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            SectionTitle(stringResource(R.string.monitoring_price_cache))

            cacheStats?.let { cs -> CacheNumbers(cs) }

            // Default condition (Neu/Gebraucht)
            DefaultStateRow(defaultCondition, events.defaultState)

            // Die vier Blöcke stehen untereinander in der Column: In einer Row teilten sie
            // sich die Breite, die FlowRows brachen jeden Chip um, und es entstanden grosse
            // leere Abstände.

            // ── Vorschau-Ablage ──
            //
            // Sie liegt unter filesDir und wird von Android nicht geräumt; deshalb muss man
            // sie hier sehen und leeren können. `remember`, nicht `rememberSaveable`: Die Zahl
            // ist eine Messung der Platte und stünde nach einem Prozesstod falsch da
            // (ScreenStateTest, Sorte „gemessen“).
            PreviewStoreRow(storeBytes, events.clearStore)

            // ── In welchen Netzen darf vorgewärmt werden ──
            //
            // Drei unabhängige Schalter, je einer für eine Lage; die Begründung steht an den
            // Schlüsseln in DevicesStore (VORWAERMEN_*).
            VorwaermNetworkChoice(networks, events.netz)

            // Cache TTL
            CacheDurationRow(
                dauer = cacheTtl,
                bearbeiten = editingTtl,
                editOn = { editingTtl = it },
                eingabe = ttlInput,
                onInput = { ttlInput = it },
                onSpeichern = {
                    events.cacheDuration(ttlInput.toIntOrNull() ?: 24)
                    editingTtl = false
                },
            )

            // ── Leeren ──
            //
            // Mit Rückfrage: Jeder Neuaufbau kostet Anfragen aus dem gemeinsamen
            // Tageskontingent; ein Fehlgriff nimmt allen anderen Kontingent weg.
            CacheClearButtons(
                onPrices = { clearEverything = false; showClearQuestion = true },
                onEverything = { clearEverything = true; showClearQuestion = true },
            )
        }
    }

    if (showClearQuestion) {
        CacheClearQuestion(
            alles = clearEverything,
            onSchliessen = { showClearQuestion = false },
            clearOn = {
                showClearQuestion = false
                events.cacheLeeren(clearEverything)
            },
        )
    }
}

/**
 * Das Design, das für alle gilt, die keines gewählt haben — eine eigene Karte: Im
 * Preisspeicher stand es zwischen Netzen und Cache-Dauer, wo es niemand sucht.
 * loadSettings() danach zieht das wirksame Design neu.
 */
@Composable
private fun RenderingCard(gewaehlt: Design, onWahl: (Design) -> Unit) {
    AppKarte {
        Column(Modifier.padding(Abstaende.gross), verticalArrangement = Arrangement.spacedBy(Abstaende.mittel)) {
            SectionTitle(stringResource(R.string.monitoring_darstellung_vorgabe))
            // Eine Wahl aus sechs: ein Feld mit Menü wie in den Einstellungen.
            SelectionField(
                beschriftung = stringResource(R.string.monitoring_theme),
                modifier = Modifier.fillMaxWidth(),
                optionen = Design.entries.map { it to stringResource(it.titel()) },
                gewaehlt = gewaehlt,
                onWahl = onWahl,
            )
        }
    }
}

/** Wie viel im Cache liegt: Preise, davon veraltet, Teilelisten, Katalog. */
@Composable
private fun CacheNumbers(cs: CacheMetricsView) {
    Row(Modifier.fillMaxWidth(), Arrangement.SpaceAround) {
        CacheStatCell(stringResource(R.string.monitoring_cache_prices), "${cs.prices}")
        CacheStatCell(stringResource(R.string.monitoring_cache_stale), "${cs.priceStale}")
        CacheStatCell(stringResource(R.string.monitoring_cache_subsets), "${cs.subsets}")
        CacheStatCell(stringResource(R.string.monitoring_cache_catalog), "${cs.catalog}")
    }
}

/** Der Zustand, mit dem neue Erfassungen beginnen (Neu oder Gebraucht). */
@Composable
private fun DefaultStateRow(defaultCondition: Zustand, onSelect: (Zustand) -> Unit) {
    // Beschriftung über der Wahl: Neben ihr blieb der Wahl so wenig Breite, dass
    // „Gebraucht“ im Wort umbrach.
    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(Abstaende.klein)) {
        Text(stringResource(R.string.monitoring_default_condition),
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant)
        ConditionToggle(selected = defaultCondition, onSelect = onSelect)
    }
}

/** Belegung der Vorschau-Ablage in MB und der Knopf, sie zu leeren. */
@Composable
private fun PreviewStoreRow(storeBytes: Long, clearOn: () -> Unit) {
    Row(
        Modifier.fillMaxWidth(),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Abstaende.klein),
    ) {
        Text(
            stringResource(R.string.monitoring_vorschau_ablage,
                storeBytes / (1024 * 1024)),
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.weight(1f),
        )
        TextButton(onClick = clearOn) { Text(stringResource(R.string.monitoring_vorschau_leeren), style = MaterialTheme.typography.labelMedium) }
    }
}

/**
 * Je Netzlage ein Schalter, ob dort vorgewärmt werden darf, und der Hinweis zum gemessenen
 * WLAN. Schalter statt Chips: Drei ungewählte Chips sahen aus wie drei Knöpfe, ob ein
 * Netz erlaubt ist, sah man nicht.
 */
@Composable
private fun VorwaermNetworkChoice(networks: Map<VorwaermNetwork, Boolean>, onNetwork: (VorwaermNetwork, Boolean) -> Unit) {
    Text(stringResource(R.string.monitoring_vorwaermen_netz),
        style = MaterialTheme.typography.bodyMedium,
        color = MaterialTheme.colorScheme.onSurfaceVariant)
    for ((netz, text) in listOf(
        VorwaermNetwork.WLAN to R.string.monitoring_vorwaermen_wlan,
        VorwaermNetwork.MOBILE to R.string.monitoring_vorwaermen_mobil,
        VorwaermNetwork.ROAMING to R.string.monitoring_vorwaermen_roaming,
    )) {
        val erlaubt = networks[netz] == true
        Row(
            Modifier.fillMaxWidth().heightIn(min = 48.dp)
                .toggleable(value = erlaubt, role = Role.Switch, onValueChange = { onNetwork(netz, it) }),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(stringResource(text), style = MaterialTheme.typography.bodyMedium, modifier = Modifier.weight(1f))
            Switch(checked = erlaubt, onCheckedChange = null)
        }
    }
    // Ein gemessenes WLAN — der Hotspot eines anderen Telefons —
    // zaehlt als Mobilfunk. Das steht hier, weil es sonst wie ein
    // kaputter Schalter aussieht: „Ich bin doch im WLAN."
    Text(stringResource(R.string.monitoring_vorwaermen_hinweis),
        style = MaterialTheme.typography.bodySmall,
        color = MaterialTheme.colorScheme.onSurfaceVariant)
}

/** Die beiden Leeren-Knöpfe; sie öffnen nur die Rückfrage. */
@Composable
private fun CacheClearButtons(onPrices: () -> Unit, onEverything: () -> Unit) {
    Row(
        Modifier.fillMaxWidth().padding(top = Abstaende.tiny),
        horizontalArrangement = Arrangement.spacedBy(Abstaende.klein),
    ) {
        OutlinedButton(
            onClick = onPrices,
            contentPadding = PaddingValues(horizontal = Abstaende.mittel, vertical = 6.dp),
            colors = nebenKnopfFarben(),
            border = nebenKnopfRand(),
        ) { Text(stringResource(R.string.monitoring_cache_clear_prices), style = MaterialTheme.typography.labelMedium) }
        OutlinedButton(
            onClick = onEverything,
            contentPadding = PaddingValues(horizontal = Abstaende.mittel, vertical = 6.dp),
            colors = nebenKnopfFarben(),
            border = nebenKnopfRand(),
        ) { Text(stringResource(R.string.monitoring_cache_clear_all), style = MaterialTheme.typography.labelMedium) }
    }
}

/** Cache-Dauer in Stunden: angezeigt oder, nach „Bearbeiten“, als Eingabefeld. */
@Composable
private fun CacheDurationRow(
    dauer: String,
    bearbeiten: Boolean,
    editOn: (Boolean) -> Unit,
    eingabe: String,
    onInput: (String) -> Unit,
    onSpeichern: () -> Unit,
) {
    Row(
        Modifier.fillMaxWidth(),
        Arrangement.SpaceBetween,
        Alignment.CenterVertically
    ) {
        Text(stringResource(R.string.monitoring_cache_duration),
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant)
        if (bearbeiten) {
            Row(
                horizontalArrangement = Arrangement.spacedBy(6.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                OutlinedTextField(
                    value = eingabe,
                    onValueChange = { onInput(NumericInput.quantity(it)) },
                    suffix = { Text(stringResource(R.string.common_hours_short)) },
                    modifier = Modifier.width(90.dp),
                    singleLine = true,
                    shape = Formen.kachel,
                    keyboardOptions = NumericInput.ganzzahlTastatur()
                )
                FilledTonalButton(
                    onClick = onSpeichern,
                    contentPadding = PaddingValues(horizontal = 10.dp, vertical = 6.dp)
                ) { Text(stringResource(R.string.common_ok), style = MaterialTheme.typography.labelMedium) }
                MitTooltip(stringResource(R.string.common_cancel)) {
                    IconButton(onClick = { editOn(false) }) {
                        Icon(Icons.Default.Close, stringResource(R.string.common_cancel))
                    }
                }
            }
        } else {
            Row(
                horizontalArrangement = Arrangement.spacedBy(Abstaende.klein),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Text(stringResource(R.string.monitoring_cache_ttl_hours, dauer), fontWeight = FontWeight.SemiBold, style = MaterialTheme.typography.bodyMedium)
                MitTooltip(stringResource(R.string.cd_edit_cache_ttl)) {
                    FilledTonalIconButton(
                        onClick = { editOn(true) },
                    ) { Icon(Icons.Default.Edit, stringResource(R.string.cd_edit_cache_ttl), Modifier.size(withFont(14.dp))) }
                }
            }
        }
    }
}

/** Rückfrage vor dem Leeren: Jeder Neuaufbau kostet Anfragen aus dem gemeinsamen Tageskontingent. */
@Composable
private fun CacheClearQuestion(alles: Boolean, onSchliessen: () -> Unit, clearOn: () -> Unit) {
    // Die gemeinsame Rückfrage: Sie nennt ihren Titel als Überschrift und Fenstername.
    Prompt(
        titel = stringResource(if (alles) R.string.monitoring_cache_clear_all else R.string.monitoring_cache_clear_prices),
        text = stringResource(R.string.monitoring_cache_clear_hint),
        bestaetigen = stringResource(R.string.monitoring_cache_clear_confirm),
        onBestaetigen = clearOn,
        onAbbrechen = onSchliessen,
        symbol = Icons.Default.Delete,
    )
}

@Composable
private fun CacheStatCell(label: String, value: String) {
    Column(horizontalAlignment = Alignment.CenterHorizontally) {
        Text(value, fontWeight = FontWeight.Bold, style = MaterialTheme.typography.titleMedium)
        Text(label, style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}
