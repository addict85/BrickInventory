package ch.brickinventoryapp.verwaltung.ui.screens

import ch.brickinventoryapp.ui.titel
import ch.brickinventoryapp.model.ui.theme.Design
import ch.brickinventoryapp.model.fach.Zustand
import ch.brickinventoryapp.ui.components.nebenKnopfFarben
import ch.brickinventoryapp.ui.components.nebenKnopfRand
import ch.brickinventoryapp.ui.theme.Formen
import ch.brickinventoryapp.ui.theme.AppKarte
import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import ch.brickinventoryapp.ui.components.Rueckfrage
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.foundation.selection.toggleable
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import ch.brickinventoryapp.data.VorwaermNetz
import ch.brickinventoryapp.model.ui.model.CacheKennzahlenAnsicht
import androidx.compose.ui.res.stringResource
import ch.brickinventoryapp.ressourcen.R
import ch.brickinventoryapp.verwaltung.ui.viewmodel.MonitoringUiState
import ch.brickinventoryapp.ui.util.NumericInput
import ch.brickinventoryapp.ui.theme.Abstaende
import ch.brickinventoryapp.ui.components.Abschnittstitel
import ch.brickinventoryapp.ui.components.MitTooltip
import ch.brickinventoryapp.ui.components.WahlChips
import ch.brickinventoryapp.ui.components.mitSchrift
import ch.brickinventoryapp.gemeinsam.ui.ConditionToggle

/** Was der Cache-Abschnitt auslöst; MonitoringRoute verdrahtet die ViewModels. */
class CacheEreignisse(
    val vorgabeZustand: (Zustand) -> Unit,
    val ablageLeeren: () -> Unit,
    val netz: (VorwaermNetz, Boolean) -> Unit,
    val design: (Design) -> Unit,
    val cacheDauer: (Int) -> Unit,
    val cacheLeeren: (Boolean) -> Unit,
    val grenzwerte: (rebrickable: Int, bricklink: Int, brickset: Int) -> Unit,
)

@Composable
internal fun CacheAndLimitsSection(
    monState: MonitoringUiState,
    /** Die Netzerlaubnisse fürs Vorwärmen (WLAN, mobil, Roaming), Geräte-Einstellungen. */
    netze: Map<VorwaermNetz, Boolean>,
    /** Das wirksame Design, wenn der Server noch keine Vorgabe nannte. */
    wirksamesDesign: Design,
    ablageBytes: Long,
    ereignisse: CacheEreignisse,
) {
    // Derselbe Abstand und Rand wie zwischen den übrigen Karten der Seite.
    Column(verticalArrangement = Arrangement.spacedBy(Abstaende.mittel)) {
        CacheKarte(monState, netze, ablageBytes, ereignisse)
        DarstellungKarte(monState.vorgabeDesign ?: wirksamesDesign, ereignisse.design)
        KontingentAbschnitt(monState, ereignisse)
    }
}

/** Preis-Cache: Zahlen, Vorgaben, Vorschau-Ablage, Netze, Dauer und Leeren. */
@Composable
private fun CacheKarte(
    monState: MonitoringUiState,
    netze: Map<VorwaermNetz, Boolean>,
    ablageBytes: Long,
    ereignisse: CacheEreignisse,
) {
    var zeigeLeerenFrage by rememberSaveable { mutableStateOf(false) }
    var leerenAlles by rememberSaveable { mutableStateOf(false) }
    val cacheStats = monState.cacheStats
    val cacheTtl   = monState.cacheTtl
    val defaultCondition = monState.vorgabeZustand

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
            Abschnittstitel(stringResource(R.string.monitoring_price_cache))

            cacheStats?.let { cs -> CacheZahlen(cs) }

            // Default condition (Neu/Gebraucht)
            VorgabeZustandZeile(defaultCondition, ereignisse.vorgabeZustand)

            // Die vier Blöcke stehen untereinander in der Column: In einer Row teilten sie
            // sich die Breite, die FlowRows brachen jeden Chip um, und es entstanden grosse
            // leere Abstände.

            // ── Vorschau-Ablage ──
            //
            // Sie liegt unter filesDir und wird von Android nicht geräumt; deshalb muss man
            // sie hier sehen und leeren können. `remember`, nicht `rememberSaveable`: Die Zahl
            // ist eine Messung der Platte und stünde nach einem Prozesstod falsch da
            // (BildschirmZustandTest, Sorte „gemessen“).
            VorschauAblageZeile(ablageBytes, ereignisse.ablageLeeren)

            // ── In welchen Netzen darf vorgewärmt werden ──
            //
            // Drei unabhängige Schalter, je einer für eine Lage; die Begründung steht an den
            // Schlüsseln in GeraeteAblage (VORWAERMEN_*).
            VorwaermNetzWahl(netze, ereignisse.netz)

            // Cache TTL
            CacheDauerZeile(
                dauer = cacheTtl,
                bearbeiten = editingTtl,
                onBearbeiten = { editingTtl = it },
                eingabe = ttlInput,
                onEingabe = { ttlInput = it },
                onSpeichern = {
                    ereignisse.cacheDauer(ttlInput.toIntOrNull() ?: 24)
                    editingTtl = false
                },
            )

            // ── Leeren ──
            //
            // Mit Rückfrage: Jeder Neuaufbau kostet Anfragen aus dem gemeinsamen
            // Tageskontingent; ein Fehlgriff nimmt allen anderen Kontingent weg.
            CacheLeerenKnoepfe(
                onPreise = { leerenAlles = false; zeigeLeerenFrage = true },
                onAlles = { leerenAlles = true; zeigeLeerenFrage = true },
            )
        }
    }

    if (zeigeLeerenFrage) {
        CacheLeerenFrage(
            alles = leerenAlles,
            onSchliessen = { zeigeLeerenFrage = false },
            onLeeren = {
                zeigeLeerenFrage = false
                ereignisse.cacheLeeren(leerenAlles)
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
private fun DarstellungKarte(gewaehlt: Design, onWahl: (Design) -> Unit) {
    AppKarte {
        Column(Modifier.padding(Abstaende.gross), verticalArrangement = Arrangement.spacedBy(Abstaende.mittel)) {
            Abschnittstitel(stringResource(R.string.monitoring_darstellung_vorgabe))
            Text(stringResource(R.string.monitoring_theme),
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant)
            // Eine Wahl aus mehreren: dieselben Radio-Chips wie in den Einstellungen.
            WahlChips(
                optionen = Design.entries.map { it to stringResource(it.titel()) },
                gewaehlt = gewaehlt,
                onWahl = onWahl,
            )
        }
    }
}

/** Wie viel im Cache liegt: Preise, davon veraltet, Teilelisten, Katalog. */
@Composable
private fun CacheZahlen(cs: CacheKennzahlenAnsicht) {
    Row(Modifier.fillMaxWidth(), Arrangement.SpaceAround) {
        CacheStatCell(stringResource(R.string.monitoring_cache_prices), "${cs.prices}")
        CacheStatCell(stringResource(R.string.monitoring_cache_stale), "${cs.priceStale}")
        CacheStatCell(stringResource(R.string.monitoring_cache_subsets), "${cs.subsets}")
        CacheStatCell(stringResource(R.string.monitoring_cache_catalog), "${cs.catalog}")
    }
}

/** Der Zustand, mit dem neue Erfassungen beginnen (Neu oder Gebraucht). */
@Composable
private fun VorgabeZustandZeile(defaultCondition: Zustand, onSelect: (Zustand) -> Unit) {
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
private fun VorschauAblageZeile(ablageBytes: Long, onLeeren: () -> Unit) {
    Row(
        Modifier.fillMaxWidth(),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Abstaende.klein),
    ) {
        Text(
            stringResource(R.string.monitoring_vorschau_ablage,
                ablageBytes / (1024 * 1024)),
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.weight(1f),
        )
        TextButton(onClick = onLeeren) { Text(stringResource(R.string.monitoring_vorschau_leeren), style = MaterialTheme.typography.labelMedium) }
    }
}

/**
 * Je Netzlage ein Schalter, ob dort vorgewärmt werden darf, und der Hinweis zum gemessenen
 * WLAN. Schalter statt Chips: Drei ungewählte Chips sahen aus wie drei Knöpfe, ob ein
 * Netz erlaubt ist, sah man nicht.
 */
@Composable
private fun VorwaermNetzWahl(netze: Map<VorwaermNetz, Boolean>, onNetz: (VorwaermNetz, Boolean) -> Unit) {
    Text(stringResource(R.string.monitoring_vorwaermen_netz),
        style = MaterialTheme.typography.bodyMedium,
        color = MaterialTheme.colorScheme.onSurfaceVariant)
    for ((netz, text) in listOf(
        VorwaermNetz.WLAN to R.string.monitoring_vorwaermen_wlan,
        VorwaermNetz.MOBIL to R.string.monitoring_vorwaermen_mobil,
        VorwaermNetz.ROAMING to R.string.monitoring_vorwaermen_roaming,
    )) {
        val erlaubt = netze[netz] == true
        Row(
            Modifier.fillMaxWidth().heightIn(min = 48.dp)
                .toggleable(value = erlaubt, role = Role.Switch, onValueChange = { onNetz(netz, it) }),
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
private fun CacheLeerenKnoepfe(onPreise: () -> Unit, onAlles: () -> Unit) {
    Row(
        Modifier.fillMaxWidth().padding(top = Abstaende.winzig),
        horizontalArrangement = Arrangement.spacedBy(Abstaende.klein),
    ) {
        OutlinedButton(
            onClick = onPreise,
            contentPadding = PaddingValues(horizontal = Abstaende.mittel, vertical = 6.dp),
            colors = nebenKnopfFarben(),
            border = nebenKnopfRand(),
        ) { Text(stringResource(R.string.monitoring_cache_clear_prices), style = MaterialTheme.typography.labelMedium) }
        OutlinedButton(
            onClick = onAlles,
            contentPadding = PaddingValues(horizontal = Abstaende.mittel, vertical = 6.dp),
            colors = nebenKnopfFarben(),
            border = nebenKnopfRand(),
        ) { Text(stringResource(R.string.monitoring_cache_clear_all), style = MaterialTheme.typography.labelMedium) }
    }
}

/** Cache-Dauer in Stunden: angezeigt oder, nach „Bearbeiten“, als Eingabefeld. */
@Composable
private fun CacheDauerZeile(
    dauer: String,
    bearbeiten: Boolean,
    onBearbeiten: (Boolean) -> Unit,
    eingabe: String,
    onEingabe: (String) -> Unit,
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
                    onValueChange = { onEingabe(NumericInput.quantity(it)) },
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
                    IconButton(onClick = { onBearbeiten(false) }) {
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
                        onClick = { onBearbeiten(true) },
                    ) { Icon(Icons.Default.Edit, stringResource(R.string.cd_edit_cache_ttl), Modifier.size(mitSchrift(14.dp))) }
                }
            }
        }
    }
}

/** Rückfrage vor dem Leeren: Jeder Neuaufbau kostet Anfragen aus dem gemeinsamen Tageskontingent. */
@Composable
private fun CacheLeerenFrage(alles: Boolean, onSchliessen: () -> Unit, onLeeren: () -> Unit) {
    // Die gemeinsame Rückfrage: Sie nennt ihren Titel als Überschrift und Fenstername.
    Rueckfrage(
        titel = stringResource(if (alles) R.string.monitoring_cache_clear_all else R.string.monitoring_cache_clear_prices),
        text = stringResource(R.string.monitoring_cache_clear_hint),
        bestaetigen = stringResource(R.string.monitoring_cache_clear_confirm),
        onBestaetigen = onLeeren,
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
