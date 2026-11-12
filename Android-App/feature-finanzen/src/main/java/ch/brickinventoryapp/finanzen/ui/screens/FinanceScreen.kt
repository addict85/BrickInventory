package ch.brickinventoryapp.finanzen.ui.screens

import ch.brickinventoryapp.sitzung.*
import ch.brickinventoryapp.model.fach.Waehrung
import ch.brickinventoryapp.model.fach.Postenart
import ch.brickinventoryapp.model.fach.Zustand
import ch.brickinventoryapp.finanzen.ui.viewmodel.FinanzAktionen
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
import ch.brickinventoryapp.ressourcen.R
import ch.brickinventoryapp.finanzen.ui.viewmodel.FinanzViewModel
import ch.brickinventoryapp.finanzen.ui.*
import ch.brickinventoryapp.model.ui.*
import ch.brickinventoryapp.ui.*
import ch.brickinventoryapp.zustand.ui.*
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import coil3.ImageLoader
import androidx.compose.ui.res.stringResource
import ch.brickinventoryapp.ui.theme.Abstaende
import ch.brickinventoryapp.ui.components.LeerSymbol
import ch.brickinventoryapp.ui.components.Ladezustand
import ch.brickinventoryapp.ui.components.vorgelesenAls
import ch.brickinventoryapp.model.data.ScopeFilter
import ch.brickinventoryapp.ui.components.grosseSchrift
import ch.brickinventoryapp.ui.components.mitSchrift
import ch.brickinventoryapp.ui.components.stueckzahl
import ch.brickinventoryapp.gemeinsam.ui.mengeManuell
import ch.brickinventoryapp.ui.util.fmtMoney
import ch.brickinventoryapp.ui.util.fmtMoneyOrDash
import ch.brickinventoryapp.ui.util.zahlenLocale
import ch.brickinventoryapp.ui.components.BezeichnungUndWert
import ch.brickinventoryapp.gemeinsam.ui.ConditionBadges
import ch.brickinventoryapp.gemeinsam.ui.FinanzBild
import ch.brickinventoryapp.gemeinsam.ui.PnlBadge
import ch.brickinventoryapp.gemeinsam.ui.ScopeFilterChip
import ch.brickinventoryapp.gemeinsam.ui.lokaleAchse
import ch.brickinventoryapp.gemeinsam.ui.lokaleWerte

/** Was der Finanzen-Reiter zeigt; die Route sammelt es aus den Flüssen. */
internal data class FinanzZustand(
    val state: AppUiState,
    val blick: BlickfeldUiState,
    val financeState: FinanceUiState,
)

/** Der Finanzen-Reiter am Navigationsziel: reicht Zustand und Aktionen an [FinanceScreen]. */
@Composable
fun FinanceRoute(
    vm: FinanzViewModel,
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
    val isLoading = financeState.valuationLoading
    val serverUrl = state.serverUrl
    val priceCondition = state.priceCondition
    val historyLoading = financeState.historyLoading
    val historyPeriod = financeState.historyPeriod
    val historyPeriodChangePct = financeState.historyPeriodChangePct
    // Achsen in der Sprache der Anzeige: Die Konfiguration ist der Schlüssel, damit ein
    // Sprachwechsel neu formatiert, ohne neu zu laden.
    val konfig = androidx.compose.ui.platform.LocalConfiguration.current
    val zahlen = remember(konfig) {
        zahlenLocale(konfig.locales[0], java.util.Locale.getDefault())
    }
    val historyPoints = remember(financeState.historyPoints, financeState.historyTage, zahlen) {
        lokaleAchse(financeState.historyPoints, financeState.historyTage, zahlen)
    }
    // Bei grosser Schrift kurz („1,7k“): Ausgeschrieben nahm die Achse ein Drittel der Breite.
    val kompakt = grosseSchrift()
    val historyYAxis = remember(financeState.historyYAxis, financeState.historyWaehrung, valuation?.currency, zahlen, kompakt) {
        val w = financeState.historyWaehrung ?: valuation?.currency
        if (w == null) financeState.historyYAxis else lokaleWerte(financeState.historyYAxis, w, zahlen, kompakt)
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
    fun fmtWert(v: Double?): String = v?.let { fmtMoney(it, currencyCode) } ?: "—"

    // Ohne Bewertung: laden, gescheitert (mit Grund und neuem Versuch) oder
    // wirklich keine Preise — vorher sah ein Fehler aus wie „keine Preisdaten“.
    if (valuation == null) {
        Ladezustand(
            anzeige = ladeanzeige(hatInhalt = false, laedt = isLoading, fehler = financeState.valuationFehler, gefiltert = false),
            fehler = financeState.valuationFehler,
            onErneut = onRefresh,
            fehlerKlasse = financeState.valuationFehlerKlasse,
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
                LeerSymbol(Icons.Default.Savings, 48.dp)
                Text(stringResource(R.string.finance_no_data), fontWeight = FontWeight.SemiBold)
                Button(onClick = onRefresh) {
                    Icon(Icons.Default.Refresh, null, Modifier.size(mitSchrift(16.dp)))
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
        val rand = PaddingValues(horizontal = Abstaende.gross, vertical = Abstaende.mittel)
        val abstand = Arrangement.spacedBy(10.dp)
        // Überblick: Kontofilter, Kopfkachel, dann der Verlauf — der Marktwert ist die erste
        // Frage, die Kurve erklärt ihn. Die Summe steht nach den Zeilen.
        val ueberblick: androidx.compose.foundation.lazy.LazyListScope.() -> Unit = {
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
                val mitWert = finanzKopf(valuation, partsValuation, figsValuation, pnl).wert.signum() > 0
                PortfolioChart(
                    points = historyPoints, yAxis = historyYAxis,
                    currency = currencyCode, isLoading = historyLoading,
                    selectedPeriod = historyPeriod, periodChangePct = historyPeriodChangePct.takeIf { mitWert },
                    onPeriodChange = onPeriodChange
                )
            }
        }
        // Die Zeilen: Filter, Sets, Teile, Minifiguren.
        val zeilen: androidx.compose.foundation.lazy.LazyListScope.() -> Unit = {
            financeCategoryFilter(
                aktive = kategorien,
                onUmschalten = { aktionen.finanzKategorieUmschalten(it) },
                onAlle = { aktionen.finanzKategorienZuruecksetzen() },
            )
            financeSetRows(valuation, showSets, serverUrl, imageLoader, ::fmtWert, onSetClick)
            financePartRows(partsValuation, showParts, serverUrl, imageLoader, ::fmtPrice, ::fmtWert, onManualClick)
            financeFigRows(figsValuation, showFigs, serverUrl, imageLoader, ::fmtPrice, ::fmtWert, onManualClick)
        }
        // Ab Tabletbreite zwei Spalten wie die Set-Detailseite: links der Überblick, rechts
        // die Zeilen. Einspaltig lagen Betrag und Bezeichnung einer Zeile eine Armlänge auseinander.
        // Die Summe schliesst die Zeilen rechts ab: Links unter dem Überblick stand sie
        // neben einer halb leeren rechten Spalte.
        if (zweiSpaltig(maxWidth.value)) {
            Row(Modifier.fillMaxSize()) {
                LazyColumn(Modifier.weight(1f).fillMaxHeight(), contentPadding = rand, verticalArrangement = abstand) {
                    ueberblick()
                }
                LazyColumn(Modifier.weight(1f).fillMaxHeight(), state = listState, contentPadding = rand,
                    verticalArrangement = abstand) {
                    zeilen()
                    financeGrandTotal(valuation, partsValuation, figsValuation, pnl, ::fmtPrice)
                }
            }
        } else {
            LazyColumn(state = listState, contentPadding = rand, verticalArrangement = abstand) {
                ueberblick()
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
     * (public/js/finance.js, pmRow, `detail.purchase_price`), damit die Zeilen
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
    gewinnStr: String? = null,
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
                    color = MaterialTheme.colorScheme.primary)
                if (quantity > 1)
                    Text(mengeManuell(quantity),
                        Modifier.vorgelesenAls(stueckzahl(quantity)),
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant)
                // Bei mehreren Zeilen desselben Eintrags ist die Plakette das
                // einzige Unterscheidungsmerkmal.
                condition?.let {
                    Box(Modifier.padding(top = Abstaende.haar)) { ConditionBadges(listOf(it)) }
                }
            }
            Spacer(Modifier.width(Abstaende.klein))
            Column(horizontalAlignment = Alignment.End) {
                Text(priceStr, fontWeight = FontWeight.Bold,
                    color = MaterialTheme.colorScheme.primary,
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
                    Box(Modifier.padding(top = Abstaende.haar)) { PnlBadge(it, gewinnStr) }
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
internal fun gewinnText(betrag: Double, fmtWert: (Double?) -> String): String =
    if (betrag >= 0.005) "+" + fmtWert(betrag) else fmtWert(betrag)

@Composable
internal fun SubtotalRow(label: String, value: String) {
    BezeichnungUndWert(label, value, Modifier.padding(horizontal = Abstaende.winzig, vertical = Abstaende.winzig),
        stil = MaterialTheme.typography.labelMedium.copy(fontWeight = FontWeight.SemiBold))
}

@Composable
internal fun PriceColumn(label: String, value: String, farbe: androidx.compose.ui.graphics.Color = MaterialTheme.colorScheme.onPrimary) {
    Column(horizontalAlignment = Alignment.CenterHorizontally) {
        Text(label, style = MaterialTheme.typography.bodySmall, color = farbe)
        Text(value, fontWeight = FontWeight.SemiBold, style = MaterialTheme.typography.bodyMedium, color = farbe)
    }
}
