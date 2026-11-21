package ch.brickinventoryapp.finances.ui.screens

import ch.brickinventoryapp.model.domain.Geld
import ch.brickinventoryapp.finances.ui.FinanceRow
import ch.brickinventoryapp.model.domain.ValuationSetView
import ch.brickinventoryapp.model.domain.Postenart
import ch.brickinventoryapp.ui.components.AuswahlChip

/**
 * The sections of the finances page: portfolio chart, key-figure cards,
 * category filter and the three lists. As with SetDetailSections.kt, extensions
 * on `LazyListScope` instead of @Composable functions, because they enter items into the list.
 */

import ch.brickinventoryapp.model.domain.BewertungAnsicht
import ch.brickinventoryapp.model.domain.FigurenBewertungAnsicht
import ch.brickinventoryapp.model.domain.GewinnAnsicht
import ch.brickinventoryapp.model.domain.TeileBewertungAnsicht
import ch.brickinventoryapp.ui.theme.Formen
import androidx.compose.foundation.lazy.LazyListScope
import coil3.ImageLoader
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import ch.brickinventoryapp.resources.R
import ch.brickinventoryapp.finances.ui.minifigRows
import ch.brickinventoryapp.finances.ui.financeHeader
import ch.brickinventoryapp.finances.ui.finanzSummen
import ch.brickinventoryapp.finances.ui.foreignPurchasePrices
import ch.brickinventoryapp.finances.ui.setRows
import ch.brickinventoryapp.finances.ui.partRows
import ch.brickinventoryapp.ui.util.fmtProzent
import ch.brickinventoryapp.model.util.resolveThumbUrl
import androidx.compose.material.icons.filled.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Info
import ch.brickinventoryapp.ui.theme.Abstaende
import ch.brickinventoryapp.ui.theme.LocalStatusFarben
import ch.brickinventoryapp.ui.components.readAloudAs
import ch.brickinventoryapp.ui.components.SectionTitle
import ch.brickinventoryapp.ui.components.withFont
import ch.brickinventoryapp.ui.components.stueckzahl
import ch.brickinventoryapp.shared.ui.mengeManuell
import ch.brickinventoryapp.model.domain.OHNE_FARBE
import ch.brickinventoryapp.ui.components.LabelAndValue
import ch.brickinventoryapp.shared.ui.ConditionBadges
import ch.brickinventoryapp.shared.ui.FinanzBild
import ch.brickinventoryapp.shared.ui.PnlBadge

/**
 * Grand total: sets + manually entered parts + minifigures. `valuation` is not nullable here: FinanceScreen() bails out beforehand on `null`.
 * The signature demands the non-null type instead of sprinkling `?.` through the body
 * — that would mean "may be missing" instead of "is always there here".
 */
internal fun LazyListScope.financeGrandTotal(valuation: BewertungAnsicht, partsValuation: TeileBewertungAnsicht?, figsValuation: FigurenBewertungAnsicht?, pnl: GewinnAnsicht?, fmtPrice: (String?) -> String) {
        // ── Gesamt-Total: Sets + manuell erfasste Teile + Minifiguren ───────────
        item {
            // All summands from the server; the app's own addition only for older servers (finanzSummen).
            val sums = finanzSummen(valuation, partsValuation, figsValuation, pnl)
            Spacer(Modifier.height(Abstaende.tiny))
            Card(
                modifier = Modifier.fillMaxWidth(),
                shape = Formen.leiste,
                colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
                elevation = CardDefaults.cardElevation(defaultElevation = Formen.karteErhebung)
            ) {
                Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    val klein = MaterialTheme.typography.bodySmall
                    LabelAndValue(stringResource(R.string.finance_total_sets), fmtPrice(sums.sets.toPlainString()),
                        stil = klein, valueWeight = FontWeight.Normal)
                    LabelAndValue(stringResource(R.string.finance_total_manual_parts), fmtPrice(sums.teile.toPlainString()),
                        stil = klein, valueWeight = FontWeight.Normal)
                    LabelAndValue(stringResource(R.string.finance_total_manual_minifigs), fmtPrice(sums.figuren.toPlainString()),
                        stil = klein, valueWeight = FontWeight.Normal)
                    HorizontalDivider()
                    LabelAndValue(stringResource(R.string.finance_grand_total), fmtPrice(sums.gesamt.toPlainString()),
                        stil = MaterialTheme.typography.bodyMedium.copy(fontWeight = FontWeight.Bold),
                        labelColor = MaterialTheme.colorScheme.onSurface, valueWeight = FontWeight.Bold)
                    // As with the footnote on the web: without the note, the total read as the value of all positions.
                    val withoutMarket = financeHeader(valuation, partsValuation, figsValuation, pnl).withoutMarket
                    if (withoutMarket > 0) Text(
                        pluralStringResource(R.plurals.finance_summe_ohne_markt, withoutMarket, withoutMarket),
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
        }
}

/** Manuell erfasste Minifiguren, einzeln aufgelistet. */
internal fun LazyListScope.financeFigRows(figsValuation: FigurenBewertungAnsicht?, showFigs: Boolean, serverUrl: String, imageLoader: ImageLoader, fmtPrice: (String?) -> String, fmtValue: (Geld?) -> String, onManualClick: (type: Postenart, id: String, colorId: Int, name: String?) -> Unit) {
    // ── Manually entered minifigures — list individually, like the sets ─
    val figsItems = figsValuation?.figs ?: emptyList()
    if (figsItems.isNotEmpty() && showFigs) {
        item {
            SectionTitle(stringResource(R.string.finance_section_minifigs),
                Modifier.padding(top = Abstaende.klein, bottom = Abstaende.hairline, start = Abstaende.tiny))
        }
        items(minifigRows(figsItems), key = { it.second.schluessel }) { (fig, zeile) ->
            // Image via image_local and the server proxy, not raw via fig.imageUrl — otherwise
            // it would be missing offline and for sources only the server can reach.
            val figImg = remember(fig.imageLocal, fig.imageUrl, serverUrl) {
                resolveThumbUrl(serverUrl, fig.imageLocal, fig.imageUrl)
            }
            ManualFinanceRow(
                imageUrl = figImg,
                imageLoader = imageLoader,
                onClick = { onManualClick(Postenart.FIG, fig.figNumber, OHNE_FARBE, fig.figName) },
                title = fig.figName ?: fig.figNumber,
                blId = fig.blFigNumber ?: fig.figNumber,
                quantity = zeile.menge,
                priceStr = fmtValue(zeile.wert),
                purchaseStr = zeile.kaufGesamt?.let { fmtValue(it) },
                purchaseGesamt = zeile.menge > 1,
                condition = zeile.zustand,
                pnlProzent = zeile.pnlProzent,
                gainStr = zeile.gewinn?.let { gainText(it, fmtValue) },
            )
        }
        item {
            // Also the server's count — see the reasoning for the parts.
            SubtotalRow(stringResource(R.string.finance_subtotal_minifigs),
                fmtPrice(figsValuation?.totalValue))
        }
    }
}

/** Manuell erfasste Teile, einzeln aufgelistet. */
internal fun LazyListScope.financePartRows(partsValuation: TeileBewertungAnsicht?, showParts: Boolean, serverUrl: String, imageLoader: ImageLoader, fmtPrice: (String?) -> String, fmtValue: (Geld?) -> String, onManualClick: (type: Postenart, id: String, colorId: Int, name: String?) -> Unit) {
    // ── Manually entered parts — list individually, like the sets ─────
    val partsItems = partsValuation?.parts ?: emptyList()
    if (partsItems.isNotEmpty() && showParts) {
        item {
            SectionTitle(stringResource(R.string.finance_section_parts),
                Modifier.padding(top = Abstaende.klein, bottom = Abstaende.hairline, start = Abstaende.tiny))
        }
        // As with the sets: one complete row per purchase price. A
        // part that was bought once new and once used
        // appears twice — each row with the market price of its own
        // condition. Without entries it stays at the one row.
        items(partRows(partsItems), key = { it.second.schluessel }) { (part, zeile) ->
            val partImg = remember(part.imageLocal, part.imageUrl, serverUrl) {
                resolveThumbUrl(serverUrl, part.imageLocal, part.imageUrl)
            }
            ManualFinanceRow(
                imageUrl = partImg,
                imageLoader = imageLoader,
                onClick = { onManualClick(Postenart.PART, part.partNumber, part.colorId, part.partName) },
                title = part.partName ?: part.partNumber,
                blId = part.blPartNumber ?: part.partNumber,
                quantity = zeile.menge,
                priceStr = fmtValue(zeile.wert),
                purchaseStr = zeile.kaufGesamt?.let { fmtValue(it) },
                purchaseGesamt = zeile.menge > 1,
                condition = zeile.zustand,
                pnlProzent = zeile.pnlProzent,
                gainStr = zeile.gewinn?.let { gainText(it, fmtValue) },
            )
        }
        item {
            // The total comes from the server (total_value), not from the rows: display_value
            // is rounded to two places, total_value to four. Over many positions, the app's own
            // sum would drift against the header tile.
            SubtotalRow(stringResource(R.string.finance_subtotal_parts),
                fmtPrice(partsValuation?.totalValue))
        }
    }
}

/** Name, number, quantity and condition of a finances set row. */
@Composable
private fun RowScope.FinanceSetDetails(set: ValuationSetView, zeile: FinanceRow) {
    val rowQty = zeile.menge
    Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(1.dp)) {
        Text(set.name ?: set.setNumber, fontWeight = FontWeight.SemiBold,
            maxLines = 2, style = MaterialTheme.typography.bodyMedium)
        Text(set.setNumber, style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant)
        if (rowQty > 1)
            Text(mengeManuell(rowQty),
                Modifier.readAloudAs(stueckzahl(rowQty)),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant)
        // State of this entry — with several cards
        // of the same set, the only distinguishing feature.
        zeile.zustand?.let {
            Box(Modifier.padding(top = Abstaende.hairline)) {
                ConditionBadges(listOf(it))
            }
        }
    }
}

/** One complete card PER PURCHASE PRICE — see the reasoning in the body. */
internal fun LazyListScope.financeSetRows(valuation: BewertungAnsicht, showSets: Boolean, serverUrl: String, imageLoader: ImageLoader, fmtValue: (Geld?) -> String, onSetClick: (String) -> Unit) {
    // Section header
    if (showSets) {
    item {
        SectionTitle(stringResource(R.string.finance_section_sets),
            Modifier.padding(top = Abstaende.tiny, bottom = Abstaende.hairline, start = Abstaende.tiny))
    }

    // A set with one purchase price for „Neu“ and one for „Gebraucht“ appears twice, each
    // card with the market price of its own condition — otherwise the newly bought copy would be
    // valued at the used price.
    items(setRows(valuation.sets), key = { it.second.schluessel }) { (set, zeile) ->
        val priceStr    = fmtValue(zeile.wert)
        val rowQty      = zeile.menge
        val rowPurchase = zeile.kaufGesamt
        val rowPnl      = zeile.pnlProzent
        val imageUrl = resolveThumbUrl(serverUrl, set.imageLocal, set.imageUrl)
        Card(
            onClick = { onSetClick(set.setNumber) },
            modifier = Modifier.fillMaxWidth(),
            shape = Formen.leiste,
            colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
            elevation = CardDefaults.cardElevation(defaultElevation = Formen.karteErhebung)
        ) {
            Row(Modifier.padding(Abstaende.mittel), verticalAlignment = Alignment.CenterVertically) {
                FinanzBild(imageUrl, imageLoader, set.name)
                Spacer(Modifier.width(Abstaende.mittel))
                FinanceSetDetails(set, zeile)
                Spacer(Modifier.width(Abstaende.klein))
                // Purchase price and market price stacked, as in the web app. With several
                // entries nothing stands here: the numbers then stand per purchase price below,
                // a sum next to it would be a second rendering of the same values.
                Column(horizontalAlignment = Alignment.End) {
                    // Without a market price, a word instead of a dash in the price color: the
                    // blue dash looked like a value.
                    when {
                        set.noPrice || set.error != null || zeile.wert == null ->
                            Text(stringResource(R.string.detail_price_none_yet), color = MaterialTheme.colorScheme.onSurfaceVariant,
                                style = MaterialTheme.typography.bodySmall)
                        else -> Text(priceStr, fontWeight = FontWeight.Bold,
                            color = MaterialTheme.colorScheme.onSurface,
                            style = MaterialTheme.typography.bodyMedium, maxLines = 1, softWrap = false)
                    }
                    rowPurchase?.let {
                        Text(
                            if (rowQty > 1) stringResource(R.string.finance_purchase_total, fmtValue(it))
                            else stringResource(R.string.finance_purchase_short, fmtValue(it)),
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                    }
                    // Trend against the purchase price of THIS entry —
                    // from the server, nothing is recalculated here.
                    rowPnl?.let {
                        Box(Modifier.padding(top = Abstaende.hairline)) { PnlBadge(it, zeile.gewinn?.let { g -> gainText(g, fmtValue) }) }
                    }
                }
            }
        }
    }
    } // showSets
}

/**
 * The tab's filter bar — additive. „Alle“ is not a fourth state, but
 * the empty selection: selected when nothing is restricted; a click clears the
 * selection. The remaining three toggle their row kind individually. The
 * set lives in FinanceUiState; why, is stated there.
 */
internal fun LazyListScope.financeCategoryFilter(
    aktive: Set<String>,
    toggleOn: (String) -> Unit,
    onAll: () -> Unit,
) {
    item {
        // Labelled and directly above the rows: under the chart it was unclear whether the
        // chips also filtered the curve. They only select the positions beneath them.
        SectionTitle(stringResource(R.string.finance_positionen),
            Modifier.padding(top = Abstaende.klein))
    }
    item {
        LazyRow(
            contentPadding = PaddingValues(horizontal = 0.dp),
            horizontalArrangement = Arrangement.spacedBy(6.dp),
            modifier = Modifier.padding(bottom = 6.dp)
        ) {
            item {
                AuswahlChip(
                    selected = aktive.isEmpty(),
                    onClick = onAll,
                    label = { Text(stringResource(R.string.finance_filter_all), style = MaterialTheme.typography.labelMedium) },
                )
            }
            item { CategoryChip("sets",  R.string.finance_filter_sets,     aktive, toggleOn) }
            item { CategoryChip("parts", R.string.finance_filter_parts,    aktive, toggleOn) }
            item { CategoryChip("figs",  R.string.finance_filter_minifigs, aktive, toggleOn) }
        }
    }
}

/** A chip of the filter bar — three callers, one look. */
@Composable
private fun CategoryChip(
    schluessel: String,
    @androidx.annotation.StringRes text: Int,
    aktive: Set<String>,
    toggleOn: (String) -> Unit,
) {
    AuswahlChip(
        selected = schluessel in aktive,
        onClick = { toggleOn(schluessel) },
        label = { Text(stringResource(text), style = MaterialTheme.typography.labelMedium) },
    )
}

/** The key-figure cards above the list. */
@OptIn(ExperimentalLayoutApi::class)
internal fun LazyListScope.financeSummaryCards(valuation: BewertungAnsicht, partsValuation: TeileBewertungAnsicht?, figsValuation: FigurenBewertungAnsicht?, pnl: GewinnAnsicht?, fmtPrice: (String?) -> String) {
    item {
        // In the dark theme primaryContainer instead of primary: the bright primary of the dark
        // versions (Stein: light blue) was glaring as a whole tile.
        val dunkel = MaterialTheme.colorScheme.surface.luminance() < 0.5f
        val flaeche = if (dunkel) MaterialTheme.colorScheme.primaryContainer else MaterialTheme.colorScheme.primary
        val auf = if (dunkel) MaterialTheme.colorScheme.onPrimaryContainer else MaterialTheme.colorScheme.onPrimary
        Card(
            modifier = Modifier.fillMaxWidth(),
            shape = Formen.chip,
            colors = CardDefaults.cardColors(containerColor = flaeche, contentColor = auf),
            elevation = CardDefaults.cardElevation(defaultElevation = Formen.karteErhebungHoch)
        ) {
            Column(Modifier.padding(20.dp)) {
                Text(
                    stringResource(R.string.finance_market_avg),
                    color = auf,
                    style = MaterialTheme.typography.labelMedium
                )
                Spacer(Modifier.height(6.dp))
                // totals.avg instead of qtyAvg: the market price is avg_price, the quantity-weighted
                // average lies systematically below it (the same change as in the web app).
                val sums = finanzSummen(valuation, partsValuation, figsValuation, pnl)
                // Cost basis, market value and P&L from one basis (financeHeader), otherwise the three
                // numbers would not add up; older servers without a basis show the total value as before.
                val kopf = financeHeader(valuation, partsValuation, figsValuation, pnl)
                // FlowRow: at large font the profit badge moves under the amount,
                // instead of squeezing it.
                FlowRow(horizontalArrangement = Arrangement.spacedBy(10.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    Text(
                        if (kopf.wert.signum() > 0) fmtPrice(kopf.wert.toPlainString())
                        else if (valuation.sets.any { it.error != null }) stringResource(R.string.finance_price_error)
                        else if (valuation.sets.isEmpty()) stringResource(R.string.finance_no_sets)
                        else stringResource(R.string.finance_load_prompt),
                        color = auf,
                        fontWeight = FontWeight.ExtraBold,
                        style = MaterialTheme.typography.headlineMedium,
                        modifier = Modifier.align(Alignment.CenterVertically)
                    )
                    val pnlPct = kopf.guvPercent
                    if (pnlPct != null) {
                        // Profit green, loss red as everywhere else; on a white background, because the
                        // status colors only meet 4.5:1 on surface, not on primary.
                        val status = LocalStatusFarben.current
                        Surface(
                            shape = Formen.chip,
                            color = MaterialTheme.colorScheme.surface,
                            contentColor = if (pnlPct < 0) status.fehler else status.erfolg,
                            modifier = Modifier.align(Alignment.CenterVertically),
                        ) {
                            Text(
                                stringResource(R.string.finance_total_pnl, fmtProzent(pnlPct)),
                                fontWeight = FontWeight.Bold,
                                style = MaterialTheme.typography.bodyMedium,
                                modifier = Modifier.padding(horizontal = 10.dp, vertical = 3.dp)
                            )
                        }
                    }
                }
                // „davon Teile“ only without a basis: the basis market value leaves out positions without
                // a purchase price, a „davon“ built from all parts could be larger than it.
                if (!kopf.withBase && sums.partsAndMinifigs.signum() > 0) {
                    Spacer(Modifier.height(Abstaende.tiny))
                    Text(
                        stringResource(R.string.finance_parts_extra, fmtPrice(sums.partsAndMinifigs.toPlainString())),
                        color = auf,
                        style = MaterialTheme.typography.bodySmall
                    )
                }
                // Purchase sum and P&L in one row that wraps when needed: stacked, that was
                // four text levels in one tile, with amount, label and calculation note.
                if (kopf.baseKnown) {
                    Spacer(Modifier.height(Abstaende.tiny))
                    FlowRow(horizontalArrangement = Arrangement.spacedBy(Abstaende.mittel)) {
                        kopf.cost?.let {
                            Text(stringResource(R.string.finance_einstand_zeile, fmtPrice(it.toPlainString())),
                                color = auf, style = MaterialTheme.typography.bodySmall)
                        }
                        val guv = kopf.guvAmount
                        Text(
                            stringResource(R.string.finance_guv_zeile,
                                if (guv == null) stringResource(R.string.finance_pnl_needs_prices)
                                else (if (guv.signum() > 0) "+" else "") + fmtPrice(guv.toPlainString())),
                            color = auf, style = MaterialTheme.typography.bodySmall,
                        )
                    }
                }
                Spacer(Modifier.height(Abstaende.gross))
                HorizontalDivider(color = auf.copy(alpha = 0.2f))
                Spacer(Modifier.height(Abstaende.mittel))
                // The sets' range to the lowest and highest price. The average only when it
                // deviates from the amount above (plus parts and figures) — otherwise the same
                // number stood there twice.
                Text(stringResource(R.string.finance_range_label), color = auf,
                    style = MaterialTheme.typography.labelMedium)
                Spacer(Modifier.height(Abstaende.tiny))
                FlowRow(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceAround,
                        verticalArrangement = Arrangement.spacedBy(Abstaende.klein)) {
                    PriceColumn(stringResource(R.string.finance_min_label), fmtPrice(valuation.totals.min), auf)
                    if (sums.partsAndMinifigs.signum() > 0)
                        PriceColumn(stringResource(R.string.finance_avg_label), fmtPrice(valuation.totals.avg), auf)
                    PriceColumn(stringResource(R.string.finance_max_label), fmtPrice(valuation.totals.max), auf)
                }
            }
        }
    }
    item {
        // How it was computed, under the tile instead of inside it: it carries the numbers, the
        // note the origin — like the row on the web (fin-basis), just quieter.
        val kopf = financeHeader(valuation, partsValuation, figsValuation, pnl)
        val withoutMarket = if (kopf.withoutMarket > 0) pluralStringResource(R.plurals.finance_basis_ohne_markt,
            kopf.withoutMarket, kopf.withoutMarket, fmtPrice(kopf.withoutMarketCost.toPlainString())) else null
        val withoutPurchase = if (kopf.withoutPurchase > 0) pluralStringResource(R.plurals.finance_basis_ohne_kauf,
            kopf.withoutPurchase, kopf.withoutPurchase, fmtPrice(kopf.withoutPurchaseValue.toPlainString())) else null
        // As on the web (finance.fremde_waehrung_n): name missing purchase prices instead of silently leaving them out.
        val fremde = foreignPurchasePrices(valuation, partsValuation, figsValuation, pnl)
        val zeilen = listOfNotNull(
            if (kopf.baseRowVisible) pluralStringResource(R.plurals.finance_basis_gerechnet, kopf.gesamt,
                kopf.valued, kopf.gesamt) + " " + listOfNotNull(withoutMarket, withoutPurchase).joinToString(" · ") else null,
            if (fremde > 0) pluralStringResource(R.plurals.finance_fremde_waehrung, fremde, fremde) else null,
        )
        if (zeilen.isNotEmpty()) Row(
            Modifier.fillMaxWidth().padding(horizontal = Abstaende.tiny),
            horizontalArrangement = Arrangement.spacedBy(Abstaende.klein),
        ) {
            Icon(Icons.Outlined.Info, null, Modifier.size(withFont(16.dp)),
                tint = MaterialTheme.colorScheme.onSurfaceVariant)
            Column(verticalArrangement = Arrangement.spacedBy(Abstaende.hairline)) {
                zeilen.forEach {
                    Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
        }
    }

    // Category filter — gallery style: single-select, "All" resets
}
