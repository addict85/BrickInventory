package ch.brickinventoryapp.finances.ui.screens

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import ch.brickinventoryapp.finances.ui.FinanceUiState
import ch.brickinventoryapp.finances.ui.financeHeader
import ch.brickinventoryapp.finances.ui.viewmodel.FinanceActions
import ch.brickinventoryapp.finances.ui.viewmodel.FinanceViewModel
import ch.brickinventoryapp.model.data.ScopeFilter
import ch.brickinventoryapp.model.domain.Condition
import ch.brickinventoryapp.model.domain.CurrencyCode
import ch.brickinventoryapp.model.domain.ItemKind
import ch.brickinventoryapp.model.domain.Money
import ch.brickinventoryapp.model.ui.Load
import ch.brickinventoryapp.model.ui.loading
import ch.brickinventoryapp.model.util.numbersLocale
import ch.brickinventoryapp.resources.R
import ch.brickinventoryapp.session.AppUiState
import ch.brickinventoryapp.shared.ui.ConditionBadges
import ch.brickinventoryapp.shared.ui.FinanceImage
import ch.brickinventoryapp.shared.ui.PnlBadge
import ch.brickinventoryapp.shared.ui.ScopeFilterChip
import ch.brickinventoryapp.shared.ui.localAxis
import ch.brickinventoryapp.shared.ui.localValues
import ch.brickinventoryapp.shared.ui.quantityManual
import ch.brickinventoryapp.state.ui.ScopeUiState
import ch.brickinventoryapp.ui.components.CrossLink
import ch.brickinventoryapp.ui.components.EmptySymbol
import ch.brickinventoryapp.ui.components.LabelAndValue
import ch.brickinventoryapp.ui.components.LoadState
import ch.brickinventoryapp.ui.components.largeFont
import ch.brickinventoryapp.ui.components.quantity
import ch.brickinventoryapp.ui.components.readAloudAs
import ch.brickinventoryapp.ui.components.withFont
import ch.brickinventoryapp.ui.loadingIndicator
import ch.brickinventoryapp.ui.sentence
import ch.brickinventoryapp.ui.theme.Shapes
import ch.brickinventoryapp.ui.theme.Spacing
import ch.brickinventoryapp.ui.twoColumn
import ch.brickinventoryapp.ui.util.fmtMoneyOrDash
import coil3.ImageLoader

/** What the finances tab shows; the route collects it from the flows. */
internal data class FinanceState(
    val state: AppUiState,
    val glance: ScopeUiState,
    val financeState: FinanceUiState,
)

/** The finances tab at the navigation destination: passes state and actions to [FinanceScreen]. */
@Composable
fun FinanceRoute(
    vm: FinanceViewModel,
    imageLoader: ImageLoader,
    onSetClick: (String) -> Unit = {},
    onManualClick: (type: ItemKind, id: String, colorId: Int, name: String?) -> Unit = { _, _, _, _ -> },
    listState: LazyListState = rememberLazyListState(),
    onOpenVouchers: (() -> Unit)? = null,
) {
    val state by vm.state.collectAsStateWithLifecycle()
    val glance by vm.viewport.collectAsStateWithLifecycle()
    val financeState by vm.financeState.collectAsStateWithLifecycle()
    FinanceScreen(FinanceState(state, glance, financeState), vm, imageLoader, onSetClick, onManualClick, listState, onOpenVouchers)
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun FinanceScreen(
    condition: FinanceState,
    actions: FinanceActions,
    imageLoader: ImageLoader,
    /** Click on a set — only the graph knows the NavController. */
    onSetClick: (String) -> Unit = {},
    /** Click on a manually entered item, likewise. */
    onManualClick: (type: ItemKind, id: String, colorId: Int, name: String?) -> Unit = { _, _, _, _ -> },
    /** Scroll state from outside: the target is discarded when a detail is opened. */
    listState: LazyListState = rememberLazyListState(),
    /** Vouchers are money too, but live under „Mehr“: the overview points there. */
    onOpenVouchers: (() -> Unit)? = null,
) {
    val state = condition.state
    val glance = condition.glance
    val financeState = condition.financeState

    val valuation = financeState.valuation
    val isLoading = financeState.valuationLoad.loading
    val valuationError = financeState.valuationLoad as? Load.Failure
    val serverUrl = state.serverUrl
    val priceCondition = state.priceCondition
    val historyLoading = financeState.history.loading
    val historyPeriod = financeState.historyPeriod
    val historyPeriodChangePct = financeState.historyPeriodChangePct
    // Axes in the display's language: the configuration is the key, so that a
    // language change reformats without reloading.
    val config = androidx.compose.ui.platform.LocalConfiguration.current
    val numbers = remember(config) {
        numbersLocale(config.locales[0], java.util.Locale.getDefault())
    }
    val historyPoints = remember(financeState.historyPoints, financeState.historyDays, numbers) {
        localAxis(financeState.historyPoints, financeState.historyDays, numbers)
    }
    // Short at large font („1.7k“): written out, the axis took up a third of the width.
    val compact = largeFont()
    val historyYAxis = remember(financeState.historyYAxis, financeState.historyCurrency, valuation?.currency, numbers, compact) {
        val w = financeState.historyCurrency ?: valuation?.currency
        if (w == null) financeState.historyYAxis else localValues(financeState.historyYAxis, w, numbers, compact)
    }
    val partsValuation = financeState.partsValuation
    val figsValuation = financeState.figsValuation
    val pnl = financeState.pnl
    val householdMembers = glance.householdMembers
    val scopeMode = glance.scopeModes[ScopeFilter.View.FINANCE]
        ?: ScopeFilter.ALL

    val onScopeChange: (String) -> Unit = { actions.setScope(ScopeFilter.View.FINANCE, it) }
    val onPeriodChange: (String) -> Unit = { actions.loadPortfolioHistory(it) }
    val onRefresh: () -> Unit = { actions.loadValuation(); actions.loadPortfolioHistory(financeState.historyPeriod) }

    val currencyCode = valuation?.currency ?: CurrencyCode.EUR
    // Shared version (util/NumberFormatUtils.kt): the position of symbol and
    // amount is decided by the language, as in the web app.
    fun fmtPrice(v: String?): String = fmtMoneyOrDash(v, currencyCode)
    fun fmtValue(v: Money?): String = fmtMoneyOrDash(v, currencyCode)

    // Without a valuation: loading, failed (with a reason and a retry) or
    // genuinely no prices — before, an error looked like „keine Preisdaten“.
    if (valuation == null) {
        val errorText = valuationError?.message?.sentence()
        LoadState(
            display = loadingIndicator(hasContent = false, loading = isLoading, error = errorText, filtered = false),
            error = errorText,
            onAgain = onRefresh,
            errorClass = valuationError?.kind,
            loading = {
                Box(Modifier.fillMaxSize(), Alignment.Center) {
                    Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(Spacing.medium)) {
                        CircularProgressIndicator()
                        Text(stringResource(R.string.finance_loading), style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                }
            },
            empty = {
                EmptySymbol(Icons.Default.Savings, 48.dp)
                Text(stringResource(R.string.finance_no_data), fontWeight = FontWeight.SemiBold)
                Button(onClick = onRefresh) {
                    Icon(Icons.Default.Refresh, null, Modifier.size(withFont(16.dp)))
                    Spacer(Modifier.width(6.dp))
                    Text(stringResource(R.string.finance_load_prices))
                }
            },
        ) {}
        return
    }

    // The category filter comes from the tab's state, not from a
    // `remember` — otherwise it would reset to „alle“ after every excursion into a detail
    // (see FinanceUiState.kategorien). An empty set means: no restriction.
    val categories = financeState.categories
    val showSets  = financeState.shows("sets")
    val showParts = financeState.shows("parts")
    val showFigs  = financeState.shows("figs")

    PullToRefreshBox(isRefreshing = isLoading, onRefresh = onRefresh) {
      BoxWithConstraints(Modifier.fillMaxSize()) {
        val edge = PaddingValues(horizontal = Spacing.large, vertical = Spacing.medium)
        val spacing = Arrangement.spacedBy(10.dp)
        // Overview: account filter, header tile, then the history — the market value is the first
        // question, the curve explains it. The sum stands after the rows.
        val overview: androidx.compose.foundation.lazy.LazyListScope.() -> Unit = {
            // Account filter — appears only for a main account with sub-accounts. It applies to
            // ALL numbers of this tab: curve, tiles, sets, parts and minifigures.
            if (householdMembers.size > 1) {
                item {
                    // Right-aligned, only in this tab: gallery, parts and minifigures stay
                    // left-aligned, because a search field and a filter bar sit next to them there.
                    Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
                        ScopeFilterChip(members = householdMembers, current = scopeMode, onSelect = onScopeChange)
                    }
                }
            }
            financeSummaryCards(valuation, partsValuation, figsValuation, pnl, ::fmtPrice)
            item {
                // Without a market value there is no trend, as on the web: the history would then carry only
                // purchase prices, and „+0.0 %“ next to „—“ would claim no movement.
                val withValue = financeHeader(valuation, partsValuation, figsValuation, pnl).value.signum() > 0
                PortfolioChart(
                    points = historyPoints, yAxis = historyYAxis,
                    currency = currencyCode, isLoading = historyLoading,
                    selectedPeriod = historyPeriod, periodChangePct = historyPeriodChangePct.takeIf { withValue },
                    onPeriodChange = onPeriodChange
                )
            }
            if (onOpenVouchers != null) item {
                CrossLink(stringResource(R.string.vouchers_title), onOpenVouchers)
            }
        }
        // Die Zeilen: Filter, Sets, Teile, Minifiguren.
        val rows: androidx.compose.foundation.lazy.LazyListScope.() -> Unit = {
            financeCategoryFilter(
                active = categories,
                toggleOn = { actions.toggleFinanceCategory(it) },
                onAll = { actions.resetFinanceCategories() },
            )
            financeSetRows(valuation, showSets, serverUrl, imageLoader, ::fmtValue, onSetClick)
            financePartRows(partsValuation, showParts, serverUrl, imageLoader, ::fmtPrice, ::fmtValue, onManualClick)
            financeFigRows(figsValuation, showFigs, serverUrl, imageLoader, ::fmtPrice, ::fmtValue, onManualClick)
        }
        // From tablet width on, two columns like the set detail page: the overview on the left, the
        // rows on the right. Single-column, the amount and label of a row sat an arm's length apart.
        // The sum closes off the rows on the right: on the left, under the overview, it stood
        // next to a half-empty right column.
        if (twoColumn(maxWidth.value)) {
            Row(Modifier.fillMaxSize()) {
                LazyColumn(Modifier.weight(1f).fillMaxHeight(), contentPadding = edge, verticalArrangement = spacing) {
                    overview()
                }
                LazyColumn(Modifier.weight(1f).fillMaxHeight(), state = listState, contentPadding = edge,
                    verticalArrangement = spacing) {
                    rows()
                    financeGrandTotal(valuation, partsValuation, figsValuation, pnl, ::fmtPrice)
                }
            }
        } else {
            LazyColumn(state = listState, contentPadding = edge, verticalArrangement = spacing) {
                overview()
                rows()
                financeGrandTotal(valuation, partsValuation, figsValuation, pnl, ::fmtPrice)
            }
        }
      }
    }
}

@Composable
internal fun ManualFinanceRow(
    imageUrl: String?,
    imageLoader: ImageLoader,
    /** Opens the detail dialog — analogous to the set row, which leads to the screen. */
    onClick: (() -> Unit)? = null,
    title: String,
    blId: String,
    quantity: Int,
    priceStr: String,
    /**
     * Purchase price of this entry, already formatted; null = none on record. As in
     * the set row (FinanceSections.kt) and in both tables of the web app
     * (public/js/finanzen.js, pmRow, `detail.purchase_price`), so that the rows
     * say the same amount of information.
     */
    purchaseStr: String? = null,
    /** [purchaseStr] applies to all copies of the row, like the market value next to it. */
    purchaseSum: Boolean = false,
    /** State of this entry; null = item without entries. */
    condition: Condition? = null,
    /** Trend against the purchase price of this entry (from the server, pnl_prozent). */
    pnlPercent: Double? = null,
    /** The same trend in money, already formatted with a sign. */
    gainStr: String? = null,
) {
    // Two cards instead of one with `enabled`: Material3 has its own overload
    // for the clickable card, and a Card with onClick = {} would look the
    // same but would also give ripple and a role description where there
    // is nothing to click.
    val cardModifier = Modifier.fillMaxWidth()
    val cardShape = Shapes.bar
    val cardColors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface)
    val cardElevation = CardDefaults.cardElevation(defaultElevation = Shapes.cardElevation)
    val content: @Composable ColumnScope.() -> Unit = {
        Row(Modifier.padding(Spacing.medium), verticalAlignment = Alignment.CenterVertically) {
            FinanceImage(imageUrl, imageLoader, title)
            Spacer(Modifier.width(Spacing.medium))
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(1.dp)) {
                Text(title, fontWeight = FontWeight.SemiBold,
                    maxLines = 2, style = MaterialTheme.typography.bodyMedium)
                Text(blId, style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant)
                if (quantity > 1)
                    Text(quantityManual(quantity),
                        Modifier.readAloudAs(quantity(quantity)),
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant)
                // With several rows of the same item, the badge is the
                // only distinguishing feature.
                condition?.let {
                    Box(Modifier.padding(top = Spacing.hairline)) { ConditionBadges(listOf(it)) }
                }
            }
            Spacer(Modifier.width(Spacing.small))
            Column(horizontalAlignment = Alignment.End) {
                // An amount, not an action: primary blue appears only on links and buttons.
                Text(priceStr, fontWeight = FontWeight.Bold,
                    color = MaterialTheme.colorScheme.onSurface,
                    style = MaterialTheme.typography.bodyMedium, maxLines = 1, softWrap = false)
                // The same spot and the same label as in the
                // set row (FinanceSections.kt) — both tables should
                // look the same, and in the web app they do.
                purchaseStr?.let {
                    Text(
                        if (purchaseSum) stringResource(R.string.finance_purchase_total, it)
                        else stringResource(R.string.finance_purchase_short, it),
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }
                // Trend as with the sets — against the purchase price of this
                // entry, computed on the server.
                pnlPercent?.let {
                    Box(Modifier.padding(top = Spacing.hairline)) { PnlBadge(it, gainStr) }
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

/** Profit as a signed amount, like the percentage next to it (fmtPercent). */
internal fun gainText(amount: Money, fmtValue: (Money?) -> String): String =
    if (amount.onRappen().signum() > 0) "+" + fmtValue(amount) else fmtValue(amount)

@Composable
internal fun SubtotalRow(label: String, value: String) {
    LabelAndValue(label, value, Modifier.padding(horizontal = Spacing.tiny, vertical = Spacing.tiny),
        style = MaterialTheme.typography.labelMedium.copy(fontWeight = FontWeight.SemiBold))
}

@Composable
internal fun PriceColumn(label: String, value: String, color: androidx.compose.ui.graphics.Color = MaterialTheme.colorScheme.onPrimary) {
    Column(horizontalAlignment = Alignment.CenterHorizontally) {
        Text(label, style = MaterialTheme.typography.bodySmall, color = color)
        Text(value, fontWeight = FontWeight.SemiBold, style = MaterialTheme.typography.bodyMedium, color = color)
    }
}
