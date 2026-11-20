package ch.brickinventoryapp.finances.ui.screens

import ch.brickinventoryapp.model.domain.Geld
import ch.brickinventoryapp.model.ui.Laden
import ch.brickinventoryapp.model.ui.laedt
import ch.brickinventoryapp.ui.satz
import ch.brickinventoryapp.session.AppUiState
import ch.brickinventoryapp.model.domain.Waehrung
import ch.brickinventoryapp.model.domain.Postenart
import ch.brickinventoryapp.model.domain.Zustand
import ch.brickinventoryapp.finances.ui.viewmodel.FinanzAktionen
import ch.brickinventoryapp.ui.theme.Formen
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import ch.brickinventoryapp.resources.R
import ch.brickinventoryapp.finances.ui.viewmodel.FinanceViewModel
import ch.brickinventoryapp.finances.ui.FinanceUiState
import ch.brickinventoryapp.finances.ui.financeHeader
import ch.brickinventoryapp.ui.loadingIndicator
import ch.brickinventoryapp.ui.twoSpaltig
import ch.brickinventoryapp.state.ui.ScopeUiState
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import coil3.ImageLoader
import androidx.compose.ui.res.stringResource
import ch.brickinventoryapp.ui.theme.Abstaende
import ch.brickinventoryapp.ui.components.EmptySymbol
import ch.brickinventoryapp.ui.components.LoadState
import ch.brickinventoryapp.ui.components.readAloudAs
import ch.brickinventoryapp.model.data.ScopeFilter
import ch.brickinventoryapp.ui.components.largeFont
import ch.brickinventoryapp.ui.components.withFont
import ch.brickinventoryapp.ui.components.stueckzahl
import ch.brickinventoryapp.shared.ui.mengeManuell
import ch.brickinventoryapp.ui.util.fmtMoneyOrDash
import ch.brickinventoryapp.model.util.numbersLocale
import ch.brickinventoryapp.ui.components.LabelAndValue
import ch.brickinventoryapp.shared.ui.ConditionBadges
import ch.brickinventoryapp.shared.ui.FinanzBild
import ch.brickinventoryapp.shared.ui.PnlBadge
import ch.brickinventoryapp.shared.ui.ScopeFilterChip
import ch.brickinventoryapp.shared.ui.localAxis
import ch.brickinventoryapp.shared.ui.localValues

/** Was der Finanzen-Reiter zeigt; die Route sammelt es aus den Flüssen. */
internal data class FinanzZustand(
    val state: AppUiState,
    val blick: ScopeUiState,
    val financeState: FinanceUiState,
)

/** Der Finanzen-Reiter am Navigationsziel: reicht Zustand und Aktionen an [FinanceScreen]. */
@Composable
fun FinanceRoute(
    vm: FinanceViewModel,
    imageLoader: ImageLoader,
    onSetClick: (String) -> Unit = {},
    onManualClick: (type: Postenart, id: String, colorId: Int, name: String?) -> Unit = { _, _, _, _ -> },
    listState: LazyListState = rememberLazyListState(),
) {
    val state by vm.state.collectAsStateWithLifecycle()
    val blick by vm.blickfeld.collectAsStateWithLifecycle()
    val financeState by vm.financeState.collectAsStateWithLifecycle()
    FinanceScreen(FinanzZustand(state, blick, financeState), vm, imageLoader, onSetClick, onManualClick, listState)
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun FinanceScreen(
    zustand: FinanzZustand,
    aktionen: FinanzAktionen,
    imageLoader: ImageLoader,
    /** Klick auf ein Set — nur der Graph kennt den NavController. */
    onSetClick: (String) -> Unit = {},
    /** Klick auf einen manuell erfassten Eintrag, ebenso. */
    onManualClick: (type: Postenart, id: String, colorId: Int, name: String?) -> Unit = { _, _, _, _ -> },
    /** Scroll-Zustand von aussen: Das Ziel wird beim Öffnen eines Details verworfen. */
    listState: LazyListState = rememberLazyListState(),
) {
    val state = zustand.state
    val blick = zustand.blick
    val financeState = zustand.financeState

    val valuation = financeState.valuation
    val isLoading = financeState.bewertung.laedt
    val valuationError = financeState.bewertung as? Laden.Fehler
    val serverUrl = state.serverUrl
    val priceCondition = state.priceCondition
    val historyLoading = financeState.verlauf.laedt
    val historyPeriod = financeState.historyPeriod
    val historyPeriodChangePct = financeState.historyPeriodChangePct
    // Achsen in der Sprache der Anzeige: Die Konfiguration ist der Schlüssel, damit ein
    // Sprachwechsel neu formatiert, ohne neu zu laden.
    val konfig = androidx.compose.ui.platform.LocalConfiguration.current
    val zahlen = remember(konfig) {
        numbersLocale(konfig.locales[0], java.util.Locale.getDefault())
    }
    val historyPoints = remember(financeState.historyPoints, financeState.historyDays, zahlen) {
        localAxis(financeState.historyPoints, financeState.historyDays, zahlen)
    }
    // Bei grosser Schrift kurz („1,7k“): Ausgeschrieben nahm die Achse ein Drittel der Breite.
    val compact = largeFont()
    val historyYAxis = remember(financeState.historyYAxis, financeState.historyCurrency, valuation?.currency, zahlen, compact) {
        val w = financeState.historyCurrency ?: valuation?.currency
        if (w == null) financeState.historyYAxis else localValues(financeState.historyYAxis, w, zahlen, compact)
    }
    val partsValuation = financeState.partsValuation
    val figsValuation = financeState.figsValuation
    val pnl = financeState.pnl
    val householdMembers = blick.householdMembers
    val scopeMode = blick.scopeModes[ScopeFilter.View.FINANCE]
        ?: ScopeFilter.ALL

    val onScopeChange: (String) -> Unit = { aktionen.setScope(ScopeFilter.View.FINANCE, it) }
    val onPeriodChange: (String) -> Unit = { aktionen.loadPortfolioHistory(it) }
    val onRefresh: () -> Unit = { aktionen.loadValuation(); aktionen.loadPortfolioHistory(financeState.historyPeriod) }

    val currencyCode = valuation?.currency ?: Waehrung.EUR
    // Gemeinsame Fassung (util/NumberFormatUtils.kt): Die Stellung von Symbol und
    // Betrag entscheidet die Sprache, wie in der Webapp.
    fun fmtPrice(v: String?): String = fmtMoneyOrDash(v, currencyCode)
    fun fmtValue(v: Geld?): String = fmtMoneyOrDash(v, currencyCode)

    // Ohne Bewertung: laden, gescheitert (mit Grund und neuem Versuch) oder
    // wirklich keine Preise — vorher sah ein Fehler aus wie „keine Preisdaten“.
    if (valuation == null) {
        val errorText = valuationError?.meldung?.satz()
        LoadState(
            anzeige = loadingIndicator(hatContent = false, laedt = isLoading, fehler = errorText, gefiltert = false),
            fehler = errorText,
            onErneut = onRefresh,
            errorClass = valuationError?.art,
            laedt = {
                Box(Modifier.fillMaxSize(), Alignment.Center) {
                    Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(Abstaende.mittel)) {
                        CircularProgressIndicator()
                        Text(stringResource(R.string.finance_loading), style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                }
            },
            leer = {
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

    // Der Kategoriefilter kommt aus dem Zustand des Reiters, nicht aus einem
    // `remember` — sonst stünde er nach jedem Ausflug in ein Detail wieder auf „alle“
    // (siehe FinanceUiState.kategorien). Leere Menge heisst: keine Einschränkung.
    val kategorien = financeState.kategorien
    val showSets  = financeState.zeigt("sets")
    val showParts = financeState.zeigt("parts")
    val showFigs  = financeState.zeigt("figs")

    PullToRefreshBox(isRefreshing = isLoading, onRefresh = onRefresh) {
      BoxWithConstraints(Modifier.fillMaxSize()) {
        val edge = PaddingValues(horizontal = Abstaende.gross, vertical = Abstaende.mittel)
        val abstand = Arrangement.spacedBy(10.dp)
        // Überblick: Kontofilter, Kopfkachel, dann der Verlauf — der Marktwert ist die erste
        // Frage, die Kurve erklärt ihn. Die Summe steht nach den Zeilen.
        val overview: androidx.compose.foundation.lazy.LazyListScope.() -> Unit = {
            // Kontofilter — erscheint nur bei einem Hauptkonto mit Unterkonten. Er gilt für
            // ALLE Zahlen dieses Reiters: Kurve, Kacheln, Sets, Teile und Minifiguren.
            if (householdMembers.size > 1) {
                item {
                    // Rechtsbündig, nur in diesem Reiter: Galerie, Teile und Minifiguren bleiben
                    // linksbündig, weil dort Suchfeld und Filterleiste daneben stehen.
                    Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
                        ScopeFilterChip(members = householdMembers, current = scopeMode, onSelect = onScopeChange)
                    }
                }
            }
            financeSummaryCards(valuation, partsValuation, figsValuation, pnl, ::fmtPrice)
            item {
                // Ohne Marktwert keine Entwicklung, wie im Web: Der Verlauf trüge dann nur
                // Kaufpreise, und „+0.0 %“ neben „—“ behauptete Stillstand.
                val withValue = financeHeader(valuation, partsValuation, figsValuation, pnl).wert.signum() > 0
                PortfolioChart(
                    points = historyPoints, yAxis = historyYAxis,
                    currency = currencyCode, isLoading = historyLoading,
                    selectedPeriod = historyPeriod, periodChangePct = historyPeriodChangePct.takeIf { withValue },
                    onPeriodChange = onPeriodChange
                )
            }
        }
        // Die Zeilen: Filter, Sets, Teile, Minifiguren.
        val zeilen: androidx.compose.foundation.lazy.LazyListScope.() -> Unit = {
            financeCategoryFilter(
                aktive = kategorien,
                toggleOn = { aktionen.toggleFinanceCategory(it) },
                onAll = { aktionen.resetFinanceCategories() },
            )
            financeSetRows(valuation, showSets, serverUrl, imageLoader, ::fmtValue, onSetClick)
            financePartRows(partsValuation, showParts, serverUrl, imageLoader, ::fmtPrice, ::fmtValue, onManualClick)
            financeFigRows(figsValuation, showFigs, serverUrl, imageLoader, ::fmtPrice, ::fmtValue, onManualClick)
        }
        // Ab Tabletbreite zwei Spalten wie die Set-Detailseite: links der Überblick, rechts
        // die Zeilen. Einspaltig lagen Betrag und Bezeichnung einer Zeile eine Armlänge auseinander.
        // Die Summe schliesst die Zeilen rechts ab: Links unter dem Überblick stand sie
        // neben einer halb leeren rechten Spalte.
        if (twoSpaltig(maxWidth.value)) {
            Row(Modifier.fillMaxSize()) {
                LazyColumn(Modifier.weight(1f).fillMaxHeight(), contentPadding = edge, verticalArrangement = abstand) {
                    overview()
                }
                LazyColumn(Modifier.weight(1f).fillMaxHeight(), state = listState, contentPadding = edge,
                    verticalArrangement = abstand) {
                    zeilen()
                    financeGrandTotal(valuation, partsValuation, figsValuation, pnl, ::fmtPrice)
                }
            }
        } else {
            LazyColumn(state = listState, contentPadding = edge, verticalArrangement = abstand) {
                overview()
                zeilen()
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
    /** Öffnet den Detail-Dialog — analog zur Set-Zeile, die auf den Screen führt. */
    onClick: (() -> Unit)? = null,
    title: String,
    blId: String,
    quantity: Int,
    priceStr: String,
    /**
     * Kaufpreis dieser Erfassung, schon formatiert; null = keiner hinterlegt. Wie in
     * der Set-Zeile (FinanceSections.kt) und in beiden Tabellen der Webapp
     * (public/js/finanzen.js, pmRow, `detail.purchase_price`), damit die Zeilen
     * gleich viel sagen.
     */
    purchaseStr: String? = null,
    /** [purchaseStr] gilt für alle Stück der Zeile, wie der Marktwert daneben. */
    purchaseGesamt: Boolean = false,
    /** Zustand dieser Erfassung; null = Eintrag ohne Erfassungen. */
    condition: Zustand? = null,
    /** Entwicklung gegen den Kaufpreis dieser Erfassung (vom Server, pnl_prozent). */
    pnlProzent: Double? = null,
    /** Dieselbe Entwicklung in Geld, schon formatiert mit Vorzeichen. */
    gainStr: String? = null,
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
        Row(Modifier.padding(Abstaende.mittel), verticalAlignment = Alignment.CenterVertically) {
            FinanzBild(imageUrl, imageLoader, title)
            Spacer(Modifier.width(Abstaende.mittel))
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(1.dp)) {
                Text(title, fontWeight = FontWeight.SemiBold,
                    maxLines = 2, style = MaterialTheme.typography.bodyMedium)
                Text(blId, style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant)
                if (quantity > 1)
                    Text(mengeManuell(quantity),
                        Modifier.readAloudAs(stueckzahl(quantity)),
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant)
                // Bei mehreren Zeilen desselben Eintrags ist die Plakette das
                // einzige Unterscheidungsmerkmal.
                condition?.let {
                    Box(Modifier.padding(top = Abstaende.hairline)) { ConditionBadges(listOf(it)) }
                }
            }
            Spacer(Modifier.width(Abstaende.klein))
            Column(horizontalAlignment = Alignment.End) {
                // Ein Betrag, keine Handlung: Primärblau steht nur auf Links und Knöpfen.
                Text(priceStr, fontWeight = FontWeight.Bold,
                    color = MaterialTheme.colorScheme.onSurface,
                    style = MaterialTheme.typography.bodyMedium, maxLines = 1, softWrap = false)
                // Dieselbe Stelle und dieselbe Beschriftung wie in der
                // Set-Zeile (FinanceSections.kt) — beide Tabellen sollen
                // gleich aussehen, und in der Webapp tun sie es.
                purchaseStr?.let {
                    Text(
                        if (purchaseGesamt) stringResource(R.string.finance_purchase_total, it)
                        else stringResource(R.string.finance_purchase_short, it),
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }
                // Entwicklung wie bei den Sets — gegen den Kaufpreis dieser
                // Erfassung, gerechnet auf dem Server.
                pnlProzent?.let {
                    Box(Modifier.padding(top = Abstaende.hairline)) { PnlBadge(it, gainStr) }
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

/** Gewinn als Betrag mit Vorzeichen, wie die Prozentzahl daneben (fmtProzent). */
internal fun gainText(betrag: Geld, fmtValue: (Geld?) -> String): String =
    if (betrag.onRappen().signum() > 0) "+" + fmtValue(betrag) else fmtValue(betrag)

@Composable
internal fun SubtotalRow(label: String, value: String) {
    LabelAndValue(label, value, Modifier.padding(horizontal = Abstaende.tiny, vertical = Abstaende.tiny),
        stil = MaterialTheme.typography.labelMedium.copy(fontWeight = FontWeight.SemiBold))
}

@Composable
internal fun PriceColumn(label: String, value: String, farbe: androidx.compose.ui.graphics.Color = MaterialTheme.colorScheme.onPrimary) {
    Column(horizontalAlignment = Alignment.CenterHorizontally) {
        Text(label, style = MaterialTheme.typography.bodySmall, color = farbe)
        Text(value, fontWeight = FontWeight.SemiBold, style = MaterialTheme.typography.bodyMedium, color = farbe)
    }
}
