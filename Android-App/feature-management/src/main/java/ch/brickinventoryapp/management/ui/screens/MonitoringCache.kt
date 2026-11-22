package ch.brickinventoryapp.management.ui.screens

import ch.brickinventoryapp.ui.title
import ch.brickinventoryapp.model.ui.theme.Design
import ch.brickinventoryapp.model.domain.Condition
import ch.brickinventoryapp.ui.components.secondaryButtonColors
import ch.brickinventoryapp.ui.components.secondaryButtonRand
import ch.brickinventoryapp.ui.theme.Shapes
import ch.brickinventoryapp.ui.theme.AppCard
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
import ch.brickinventoryapp.data.PrewarmNetwork
import ch.brickinventoryapp.model.domain.CacheMetricsView
import androidx.compose.ui.res.stringResource
import ch.brickinventoryapp.resources.R
import ch.brickinventoryapp.management.ui.viewmodel.MonitoringUiState
import ch.brickinventoryapp.ui.util.NumericInput
import ch.brickinventoryapp.ui.theme.Spacing
import ch.brickinventoryapp.ui.components.SectionTitle
import ch.brickinventoryapp.ui.components.WithTooltip
import ch.brickinventoryapp.ui.components.SelectionField
import ch.brickinventoryapp.ui.components.withFont
import ch.brickinventoryapp.shared.ui.ConditionToggle

/** What the cache section triggers; MonitoringRoute wires up the ViewModels. */
class CacheEvents(
    val defaultState: (Condition) -> Unit,
    val clearStore: () -> Unit,
    val network: (PrewarmNetwork, Boolean) -> Unit,
    val design: (Design) -> Unit,
    val cacheDuration: (Int) -> Unit,
    val cacheClear: (Boolean) -> Unit,
    val limits: (rebrickable: Int, bricklink: Int, brickset: Int) -> Unit,
)

@Composable
internal fun CacheAndLimitsSection(
    monState: MonitoringUiState,
    /** The network permissions for pre-warming (Wi-Fi, mobile, roaming), device settings. */
    networks: Map<PrewarmNetwork, Boolean>,
    /** The effective theme when the server has not named a default yet. */
    effectiveDesign: Design,
    storeBytes: Long,
    events: CacheEvents,
) {
    // The same spacing and border as between the page's other cards.
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.medium)) {
        CacheCard(monState, networks, storeBytes, events)
        RenderingCard(monState.defaultDesign ?: effectiveDesign, events.design)
        QuotaSection(monState, events)
    }
}

/** Price cache: numbers, defaults, preview store, networks, duration and clearing. */
@Composable
private fun CacheCard(
    monState: MonitoringUiState,
    networks: Map<PrewarmNetwork, Boolean>,
    storeBytes: Long,
    events: CacheEvents,
) {
    var showClearQuestion by rememberSaveable { mutableStateOf(false) }
    var clearEverything by rememberSaveable { mutableStateOf(false) }
    val cacheStats = monState.cacheStats
    val cacheTtl   = monState.cacheTtl
    val defaultCondition = monState.defaultState

    // Editing state: what is currently being edited and half-typed. Stays here
    // and saveable — that survives a process death too, a ViewModel does not.
    var editingTtl by rememberSaveable { mutableStateOf(false) }
    var ttlInput   by rememberSaveable { mutableStateOf("24") }
    LaunchedEffect(cacheTtl, editingTtl) {
        if (!editingTtl) ttlInput = cacheTtl
    }

    // ── Price Cache ───────────────────────────────────────────────────────────
    AppCard {
        Column(Modifier.padding(Spacing.large), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            SectionTitle(stringResource(R.string.monitoring_price_cache))

            cacheStats?.let { cs -> CacheNumbers(cs) }

            // Default condition (Neu/Gebraucht)
            DefaultStateRow(defaultCondition, events.defaultState)

            // The four blocks stack in the Column: in a Row they shared
            // the width, the FlowRows wrapped every chip, and large empty
            // gaps appeared.

            // ── Preview store ──
            //
            // It lives under filesDir and is not cleared by Android; that is why one must
            // be able to see and clear it here. `remember`, not `rememberSaveable`: the number
            // is a measurement of the disk and would be wrong after a process death
            // (ScreenStateTest, kind "gemessen").
            PreviewStoreRow(storeBytes, events.clearStore)

            // ── On which networks pre-warming is allowed ──
            //
            // Three independent switches, one per situation; the reasoning stands at the
            // keys in DevicesStore (VORWAERMEN_*).
            PrewarmNetworkChoice(networks, events.network)

            // Cache TTL
            CacheDurationRow(
                duration = cacheTtl,
                edit = editingTtl,
                editOn = { editingTtl = it },
                input = ttlInput,
                onInput = { ttlInput = it },
                onSave = {
                    events.cacheDuration(ttlInput.toIntOrNull() ?: 24)
                    editingTtl = false
                },
            )

            // ── Clearing ──
            //
            // With a confirmation prompt: every rebuild costs requests from the shared
            // daily quota; a mistake takes quota away from everyone else.
            CacheClearButtons(
                onPrices = { clearEverything = false; showClearQuestion = true },
                onEverything = { clearEverything = true; showClearQuestion = true },
            )
        }
    }

    if (showClearQuestion) {
        CacheClearQuestion(
            everything = clearEverything,
            onClose = { showClearQuestion = false },
            clearOn = {
                showClearQuestion = false
                events.cacheClear(clearEverything)
            },
        )
    }
}

/**
 * The theme that applies to everyone who has not chosen one — a card of its own: in
 * the price cache it stood between networks and cache duration, where nobody looks for it.
 * loadSettings() afterward pulls the effective theme anew.
 */
@Composable
private fun RenderingCard(chosen: Design, onChoice: (Design) -> Unit) {
    AppCard {
        Column(Modifier.padding(Spacing.large), verticalArrangement = Arrangement.spacedBy(Spacing.medium)) {
            SectionTitle(stringResource(R.string.monitoring_appearance_default))
            // A choice of six: a field with a menu, as in the settings.
            SelectionField(
                label = stringResource(R.string.monitoring_theme),
                modifier = Modifier.fillMaxWidth(),
                options = Design.entries.map { it to stringResource(it.title()) },
                chosen = chosen,
                onChoice = onChoice,
            )
        }
    }
}

/** How much is in the cache: prices, how many stale, parts lists, catalog. */
@Composable
private fun CacheNumbers(cs: CacheMetricsView) {
    Row(Modifier.fillMaxWidth(), Arrangement.SpaceAround) {
        CacheStatCell(stringResource(R.string.monitoring_cache_prices), "${cs.prices}")
        CacheStatCell(stringResource(R.string.monitoring_cache_stale), "${cs.priceStale}")
        CacheStatCell(stringResource(R.string.monitoring_cache_subsets), "${cs.subsets}")
        CacheStatCell(stringResource(R.string.monitoring_cache_catalog), "${cs.catalog}")
    }
}

/** The condition new entries start with (new or used). */
@Composable
private fun DefaultStateRow(defaultCondition: Condition, onSelect: (Condition) -> Unit) {
    // Label above the choice: next to it, the choice had so little width left that
    // „Gebraucht“ wrapped mid-word.
    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(Spacing.small)) {
        Text(stringResource(R.string.monitoring_default_condition),
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant)
        ConditionToggle(selected = defaultCondition, onSelect = onSelect)
    }
}

/** The preview store's usage in MB and the button to clear it. */
@Composable
private fun PreviewStoreRow(storeBytes: Long, clearOn: () -> Unit) {
    Row(
        Modifier.fillMaxWidth(),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.small),
    ) {
        Text(
            stringResource(R.string.monitoring_preview_store,
                storeBytes / (1024 * 1024)),
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.weight(1f),
        )
        TextButton(onClick = clearOn) { Text(stringResource(R.string.monitoring_preview_clear), style = MaterialTheme.typography.labelMedium) }
    }
}

/**
 * One switch per network situation, whether pre-warming is allowed there, and the note about the measured
 * Wi-Fi. Switches instead of chips: three unselected chips looked like three buttons, and whether a
 * network was allowed could not be seen.
 */
@Composable
private fun PrewarmNetworkChoice(networks: Map<PrewarmNetwork, Boolean>, onNetwork: (PrewarmNetwork, Boolean) -> Unit) {
    Text(stringResource(R.string.monitoring_prewarm_network),
        style = MaterialTheme.typography.bodyMedium,
        color = MaterialTheme.colorScheme.onSurfaceVariant)
    for ((network, text) in listOf(
        PrewarmNetwork.WIFI to R.string.monitoring_prewarm_wifi,
        PrewarmNetwork.MOBILE to R.string.monitoring_prewarm_mobile,
        PrewarmNetwork.ROAMING to R.string.monitoring_prewarm_roaming,
    )) {
        val allowed = networks[network] == true
        Row(
            Modifier.fillMaxWidth().heightIn(min = 48.dp)
                .toggleable(value = allowed, role = Role.Switch, onValueChange = { onNetwork(network, it) }),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(stringResource(text), style = MaterialTheme.typography.bodyMedium, modifier = Modifier.weight(1f))
            Switch(checked = allowed, onCheckedChange = null)
        }
    }
    // A measured Wi-Fi — another phone's hotspot —
    // counts as mobile data. This is stated here because otherwise it
    // looks like a broken switch: "But I'm on Wi-Fi."
    Text(stringResource(R.string.monitoring_prewarm_hint),
        style = MaterialTheme.typography.bodySmall,
        color = MaterialTheme.colorScheme.onSurfaceVariant)
}

/** The two clear buttons; they only open the confirmation prompt. */
@Composable
private fun CacheClearButtons(onPrices: () -> Unit, onEverything: () -> Unit) {
    Row(
        Modifier.fillMaxWidth().padding(top = Spacing.tiny),
        horizontalArrangement = Arrangement.spacedBy(Spacing.small),
    ) {
        OutlinedButton(
            onClick = onPrices,
            contentPadding = PaddingValues(horizontal = Spacing.medium, vertical = 6.dp),
            colors = secondaryButtonColors(),
            border = secondaryButtonRand(),
        ) { Text(stringResource(R.string.monitoring_cache_clear_prices), style = MaterialTheme.typography.labelMedium) }
        OutlinedButton(
            onClick = onEverything,
            contentPadding = PaddingValues(horizontal = Spacing.medium, vertical = 6.dp),
            colors = secondaryButtonColors(),
            border = secondaryButtonRand(),
        ) { Text(stringResource(R.string.monitoring_cache_clear_all), style = MaterialTheme.typography.labelMedium) }
    }
}

/** Cache duration in hours: shown, or, after „Bearbeiten“, as an input field. */
@Composable
private fun CacheDurationRow(
    duration: String,
    edit: Boolean,
    editOn: (Boolean) -> Unit,
    input: String,
    onInput: (String) -> Unit,
    onSave: () -> Unit,
) {
    Row(
        Modifier.fillMaxWidth(),
        Arrangement.SpaceBetween,
        Alignment.CenterVertically
    ) {
        Text(stringResource(R.string.monitoring_cache_duration),
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant)
        if (edit) {
            Row(
                horizontalArrangement = Arrangement.spacedBy(6.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                OutlinedTextField(
                    value = input,
                    onValueChange = { onInput(NumericInput.quantity(it)) },
                    suffix = { Text(stringResource(R.string.common_hours_short)) },
                    modifier = Modifier.width(90.dp),
                    singleLine = true,
                    shape = Shapes.tile,
                    keyboardOptions = NumericInput.integerKeyboard()
                )
                FilledTonalButton(
                    onClick = onSave,
                    contentPadding = PaddingValues(horizontal = 10.dp, vertical = 6.dp)
                ) { Text(stringResource(R.string.common_ok), style = MaterialTheme.typography.labelMedium) }
                WithTooltip(stringResource(R.string.common_cancel)) {
                    IconButton(onClick = { editOn(false) }) {
                        Icon(Icons.Default.Close, stringResource(R.string.common_cancel))
                    }
                }
            }
        } else {
            Row(
                horizontalArrangement = Arrangement.spacedBy(Spacing.small),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Text(stringResource(R.string.monitoring_cache_ttl_hours, duration), fontWeight = FontWeight.SemiBold, style = MaterialTheme.typography.bodyMedium)
                WithTooltip(stringResource(R.string.cd_edit_cache_ttl)) {
                    FilledTonalIconButton(
                        onClick = { editOn(true) },
                    ) { Icon(Icons.Default.Edit, stringResource(R.string.cd_edit_cache_ttl), Modifier.size(withFont(14.dp))) }
                }
            }
        }
    }
}

/** Confirmation prompt before clearing: every rebuild costs requests from the shared daily quota. */
@Composable
private fun CacheClearQuestion(everything: Boolean, onClose: () -> Unit, clearOn: () -> Unit) {
    // The shared confirmation prompt: it names its title as the heading and window name.
    Prompt(
        title = stringResource(if (everything) R.string.monitoring_cache_clear_all_title else R.string.monitoring_cache_clear_prices_title),
        text = stringResource(R.string.monitoring_cache_clear_hint),
        confirm = stringResource(R.string.monitoring_cache_clear_confirm),
        onConfirm = clearOn,
        onCancel = onClose,
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
