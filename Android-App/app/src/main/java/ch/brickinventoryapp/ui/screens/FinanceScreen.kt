package ch.brickinventoryapp.ui.screens

import ch.brickinventoryapp.ui.theme.Formen
import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import ch.brickinventoryapp.R
import ch.brickinventoryapp.ui.MainViewModel
import ch.brickinventoryapp.ui.*  // Feature-Extensions (loadSets, setScope, …)
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import coil.compose.AsyncImage
import coil.ImageLoader
import androidx.compose.ui.res.stringResource

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun FinanceScreen(
    vm: MainViewModel,
    imageLoader: ImageLoader,
    /** Klick auf ein Set — nur der Graph kennt den NavController. */
    onSetClick: (String) -> Unit = {},
    /** Klick auf einen manuell erfassten Eintrag, ebenso. */
    onManualClick: (type: String, id: String, colorId: Int) -> Unit = { _, _, _ -> },
    /** Scroll-Zustand von aussen, siehe Nachtrag 92. */
    listState: LazyListState = rememberLazyListState(),
) {
    // Zustand und Aktionen vom ViewModel statt über einundzwanzig Parameter —
    // die Begründung steht bei PartsScreen (Nachtrag 96). Die Namen bleiben
    // absichtlich dieselben, damit der Rumpf darunter unverändert bleibt.
    val state by vm.state.collectAsStateWithLifecycle()
    val financeState by vm.financeState.collectAsStateWithLifecycle()

    val valuation = financeState.valuation
    val isLoading = financeState.valuationLoading
    val serverUrl = state.serverUrl
    val priceCondition = state.priceCondition
    val historyLoading = financeState.historyLoading
    val historyPeriod = financeState.historyPeriod
    val historyPeriodChangePct = financeState.historyPeriodChangePct
    val historyPoints = financeState.historyPoints
    val historyYAxis = financeState.historyYAxis
    val partsValuation = financeState.partsValuation
    val figsValuation = financeState.figsValuation
    val pnl = financeState.pnl
    val householdMembers = state.householdMembers
    val scopeMode = state.scopeModes[ch.brickinventoryapp.data.ScopeFilter.View.FINANCE.key]
        ?: ch.brickinventoryapp.data.ScopeFilter.ALL

    val onScopeChange: (String) -> Unit = { vm.setScope(ch.brickinventoryapp.data.ScopeFilter.View.FINANCE, it) }
    val onPeriodChange: (String) -> Unit = { vm.loadPortfolioHistory(it) }
    val onRefresh: () -> Unit = { vm.loadValuation(); vm.loadPortfolioHistory(financeState.historyPeriod) }

    val currencyCode = valuation?.currency ?: "EUR"
    // Gemeinsame Fassung (util/NumberFormatUtils.kt). Hier stand als einzige
    // Stelle der App das Symbol VOR dem Betrag, überall sonst der Code
    // dahinter — und in der Webapp entschied das die Sprache.
    fun fmtPrice(v: String?): String = ch.brickinventoryapp.util.fmtMoneyOrDash(v, currencyCode)

    if (isLoading && valuation == null) {
        Box(Modifier.fillMaxSize(), Alignment.Center) {
            Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(12.dp)) {
                CircularProgressIndicator()
                Text(stringResource(R.string.finance_loading), style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
        return
    }
    if (valuation == null) {
        Box(Modifier.fillMaxSize(), Alignment.Center) {
            Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(16.dp)) {
                Text("💰", fontSize = 48.sp)
                Text(stringResource(R.string.finance_no_data), fontWeight = FontWeight.SemiBold)
                Button(onClick = onRefresh, shape = Formen.knopf) {
                    Icon(Icons.Default.Refresh, null, Modifier.size(16.dp))
                    Spacer(Modifier.width(6.dp))
                    Text(stringResource(R.string.finance_load_prices))
                }
            }
        }
        return
    }

    // "alle", "sets", "parts", "figs" — Galerie-Stil: Single-Select, Alle = kein Filter
    // Als State-Objekt statt per `by`: financeCategoryFilter() SETZT den Wert,
    // und dafür muss es dasselbe Objekt sein, keine Kopie (Nachtrag 98).
    val activeCategory = remember { mutableStateOf("alle") }

    val showSets  = activeCategory.value == "alle" || activeCategory.value == "sets"
    val showParts = activeCategory.value == "alle" || activeCategory.value == "parts"
    val showFigs  = activeCategory.value == "alle" || activeCategory.value == "figs"

    PullToRefreshBox(isRefreshing = isLoading, onRefresh = onRefresh) {
        LazyColumn(
            state = listState,
            contentPadding = PaddingValues(horizontal = 16.dp, vertical = 12.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp)
        ) {
            // Kontofilter — erscheint nur bei einem Hauptkonto mit Unterkonten.
            // Er gilt für ALLE Zahlen dieses Reiters: Kurve, Kacheln, Sets,
            // Teile und Minifiguren entstehen aus derselben ID-Liste.
            if (householdMembers.size > 1) {
                item {
                    // Rechtsbündig (Nachtrag 77, Marcos Wunsch für DIESEN Reiter).
                    //
                    // Der Chip füllt die Zeile nicht aus, also entscheidet die
                    // Ausrichtung des umgebenden Row, wo er landet — als blosser
                    // Listeneintrag klebte er links. `Arrangement.End` schiebt
                    // ihn ans rechte Ende; fillMaxWidth ist dafür nötig, sonst
                    // ist die Row nur so breit wie der Chip und die Ausrichtung
                    // hätte keinen Spielraum.
                    //
                    // Bewusst NUR hier: Galerie, Teile und Minifiguren behalten
                    // ihre linksbündige Anordnung, weil dort Suchfeld und
                    // Filterleiste daneben stehen.
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.End
                    ) {
                        ScopeFilterChip(
                            members = householdMembers,
                            current = scopeMode,
                            onSelect = onScopeChange,
                        )
                    }
                }
            }

            // Portfolio chart
            item {
                PortfolioChart(
                    points = historyPoints, yAxis = historyYAxis,
                    currency = currencyCode, isLoading = historyLoading,
                    selectedPeriod = historyPeriod, periodChangePct = historyPeriodChangePct,
                    onPeriodChange = onPeriodChange
                )
            }

            // Totals hero card
            financeSummaryCards(valuation, partsValuation, figsValuation, pnl, ::fmtPrice)
            financeCategoryFilter(activeCategory)
            financeSetRows(valuation, showSets, serverUrl, imageLoader, ::fmtPrice, onSetClick)
            financePartRows(partsValuation, showParts, serverUrl, imageLoader, ::fmtPrice, onManualClick)
            financeFigRows(figsValuation, showFigs, serverUrl, imageLoader, ::fmtPrice, onManualClick)
            financeGrandTotal(valuation, partsValuation, figsValuation, pnl, ::fmtPrice)
        }
    }
}

/**
 * Das Vorschaubild einer Finanzzeile — 52 dp, Rueckfall auf das Logo.
 *
 * Stand zweimal wortgleich da: in der Set-Zeile (FinanceSections.kt) und in der
 * Zeile fuer manuelle Eintraege darunter. Beide Zeilen sind untereinander in
 * DERSELBEN Tabelle zu sehen — ein Bild, das dort verschieden gross oder
 * verschieden beschnitten waere, faellt sofort auf.
 */
@Composable
fun FinanzBild(imageUrl: String?, imageLoader: ImageLoader, beschreibung: String?) {
    Surface(
        shape = Formen.kachel,
        color = MaterialTheme.colorScheme.surfaceVariant,
        modifier = Modifier.size(52.dp)
    ) {
        if (imageUrl != null) {
            AsyncImage(
                model = imageUrl, imageLoader = imageLoader,
                contentDescription = beschreibung,
                modifier = Modifier.fillMaxSize().clip(Formen.kachel),
                contentScale = ContentScale.Fit
            )
        } else {
            Box(Modifier.fillMaxSize(), Alignment.Center) {
                Image(painterResource(R.drawable.ic_logo), null, Modifier.size(36.dp))
            }
        }
    }
}

@Composable
fun ManualFinanceRow(
    imageUrl: String?,
    imageLoader: ImageLoader,
    /** Öffnet den Detail-Dialog — analog zur Set-Zeile, die auf den Screen führt. */
    onClick: (() -> Unit)? = null,
    title: String,
    blId: String,
    quantity: Int,
    priceStr: String,
    /**
     * Kaufpreis dieser Erfassung, schon formatiert; null = keiner hinterlegt.
     *
     * ── Warum das Feld dazukam (Nachtrag 133) ───────────────────────────────
     *
     * Diese Zeile und die Set-Zeile in FinanceSections.kt waren bis auf zwei
     * Stellen zeichengleich — aufgefallen beim Messen gleicher Achtzeiler, nicht
     * beim Lesen. Der Unterschied WAR der Fund: Die Set-Zeile zeigt unter dem
     * Marktpreis „Kauf: X", diese Zeile zeigte ihn nicht.
     *
     * Die Webapp zeigt ihn in BEIDEN Tabellen (public/js/04-finance.js, pmRow,
     * Spalte `detail.purchase_price`) — die Spalte steht dort sogar VOR dem
     * Marktpreis. Die App hatte die Zahl die ganze Zeit im Speicher:
     * PartValuationItem, FigValuationItem und ValuationAcquisition tragen alle
     * `purchase_price`. Sie kam nur nie auf den Bildschirm.
     */
    purchaseStr: String? = null,
    /** Zustand dieser Erfassung; null = Eintrag ohne Erfassungen. */
    condition: String? = null,
    /** Entwicklung gegen den Kaufpreis dieser Erfassung (vom Server). */
    pnlPct: String? = null
) {
    // Zwei Karten statt einer mit `enabled`: Material3 hat für die anklickbare
    // Karte eine eigene Überladung, und eine Card mit onClick = {} sähe zwar
    // gleich aus, gäbe aber Ripple und Rollenbeschreibung auch dort, wo es
    // nichts zu klicken gibt.
    val cardModifier = Modifier.fillMaxWidth()
    val cardShape = Formen.leiste
    val cardColors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface)
    val cardElevation = CardDefaults.cardElevation(defaultElevation = Formen.karteErhebung)
    val content: @Composable ColumnScope.() -> Unit = {
        Row(Modifier.padding(12.dp), verticalAlignment = Alignment.CenterVertically) {
            FinanzBild(imageUrl, imageLoader, title)
            Spacer(Modifier.width(12.dp))
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(1.dp)) {
                Text(title, fontWeight = FontWeight.SemiBold,
                    maxLines = 2, style = MaterialTheme.typography.bodyMedium)
                Text(blId, style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.primary)
                if (quantity > 1)
                    Text("×$quantity", style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant)
                // Bei mehreren Zeilen desselben Eintrags ist die Plakette das
                // einzige Unterscheidungsmerkmal.
                condition?.let {
                    Box(Modifier.padding(top = 2.dp)) { ConditionBadges(listOf(it)) }
                }
            }
            Spacer(Modifier.width(8.dp))
            Column(horizontalAlignment = Alignment.End) {
                Text(priceStr, fontWeight = FontWeight.Bold,
                    color = MaterialTheme.colorScheme.primary,
                    style = MaterialTheme.typography.bodyMedium)
                // Dieselbe Stelle und dieselbe Beschriftung wie in der
                // Set-Zeile (FinanceSections.kt) — beide Tabellen sollen
                // gleich aussehen, und in der Webapp tun sie es.
                purchaseStr?.let {
                    Text(
                        stringResource(R.string.finance_purchase_short, it),
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }
                // Entwicklung wie bei den Sets — gegen den Kaufpreis dieser
                // Erfassung, gerechnet auf dem Server.
                pnlPct?.toDoubleOrNull()?.let {
                    Box(Modifier.padding(top = 2.dp)) { PnlBadge(it) }
                }
            }
        }
    }

    if (onClick != null) {
        Card(onClick = onClick, modifier = cardModifier, shape = cardShape,
             colors = cardColors, elevation = cardElevation, content = content)
    } else {
        Card(modifier = cardModifier, shape = cardShape,
             colors = cardColors, elevation = cardElevation, content = content)
    }
}

@Composable
fun SubtotalRow(label: String, value: String) {
    Row(
        Modifier.fillMaxWidth().padding(horizontal = 4.dp, vertical = 4.dp),
        horizontalArrangement = Arrangement.SpaceBetween
    ) {
        Text(label, style = MaterialTheme.typography.labelMedium, fontWeight = FontWeight.SemiBold,
            color = MaterialTheme.colorScheme.onSurfaceVariant)
        Text(value, style = MaterialTheme.typography.labelMedium, fontWeight = FontWeight.SemiBold)
    }
}

@Composable
fun PriceColumn(label: String, value: String) {
    Column(horizontalAlignment = Alignment.CenterHorizontally) {
        Text(label, style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.onPrimary.copy(alpha = 0.7f))
        Text(value, fontWeight = FontWeight.SemiBold, fontSize = 13.sp,
            color = MaterialTheme.colorScheme.onPrimary)
    }
}
