package ch.brickinventoryapp.ui.screens

/**
 * Die Abschnitte der Finanz-Seite: Portfolio-Diagramm, Kennzahl-Karten,
 * Kategoriefilter und die drei Listen. Wie bei SetDetailSections.kt Erweiterungen
 * auf `LazyListScope` statt @Composable-Funktionen, weil sie Einträge in die Liste
 * eintragen.
 */

import ch.brickinventoryapp.ui.theme.Formen
import androidx.compose.foundation.lazy.LazyListScope
import ch.brickinventoryapp.data.model.FigsValuationResponse
import ch.brickinventoryapp.data.model.PartsValuationResponse
import ch.brickinventoryapp.data.model.PnlResponse
import ch.brickinventoryapp.data.model.ValuationResponse
import coil3.ImageLoader
import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import ch.brickinventoryapp.R
import ch.brickinventoryapp.ui.*
import ch.brickinventoryapp.util.fmtProzent
import ch.brickinventoryapp.util.resolveThumbUrl
import coil3.compose.AsyncImage
import androidx.compose.material.icons.filled.*
import ch.brickinventoryapp.ui.theme.Abstaende

/** Gesamt-Total: Sets + manuell erfasste Teile + Minifiguren. */
/**
 * `valuation` ist hier nicht nullbar: FinanceScreen() steigt bei `null` vorher
 * aus. Die Signatur verlangt den Nicht-Null-Typ, statt im Rumpf `?.` einzustreuen
 * — das hiesse „darf fehlen“ statt „ist hier immer da“.
 */
fun LazyListScope.financeGrandTotal(valuation: ValuationResponse, partsValuation: PartsValuationResponse?, figsValuation: FigsValuationResponse?, pnl: PnlResponse?, fmtPrice: (String?) -> String) {
        // ── Gesamt-Total: Sets + manuell erfasste Teile + Minifiguren ───────────
        item {
            // totals.avg statt qtyAvg: Marktpreis ist avg_price, der mengengewichtete Schnitt
            // liegt systematisch darunter (wie in der Webapp). Alle drei Summanden kommen vom
            // Server, damit die Summe mit der Kopfkachel übereinstimmt, die total_value liest.
            val setsTotal  = valuation.totals.avg.toDoubleOrNull() ?: 0.0
            val partsTotal = partsValuation?.totalValue?.toDoubleOrNull() ?: 0.0
            val figsTotal  = figsValuation?.totalValue?.toDoubleOrNull() ?: 0.0
            // Gesamtwert vom Server. Der Rückfall auf die eigene Addition bleibt für ältere
            // Serverstände.
            val grandTotal = pnl?.totals?.grandTotal?.toDoubleOrNull()
                ?: (setsTotal + partsTotal + figsTotal)
            Spacer(Modifier.height(Abstaende.winzig))
            Card(
                modifier = Modifier.fillMaxWidth(),
                shape = Formen.leiste,
                colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
                elevation = CardDefaults.cardElevation(defaultElevation = Formen.karteErhebung)
            ) {
                Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    Row(Modifier.fillMaxWidth(), Arrangement.SpaceBetween) {
                        Text(stringResource(R.string.finance_total_sets), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        Text(fmtPrice(setsTotal.toString()), style = MaterialTheme.typography.bodySmall)
                    }
                    Row(Modifier.fillMaxWidth(), Arrangement.SpaceBetween) {
                        Text(stringResource(R.string.finance_total_manual_parts), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        Text(fmtPrice(partsTotal.toString()), style = MaterialTheme.typography.bodySmall)
                    }
                    Row(Modifier.fillMaxWidth(), Arrangement.SpaceBetween) {
                        Text(stringResource(R.string.finance_total_manual_minifigs), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        Text(fmtPrice(figsTotal.toString()), style = MaterialTheme.typography.bodySmall)
                    }
                    HorizontalDivider()
                    Row(Modifier.fillMaxWidth(), Arrangement.SpaceBetween) {
                        Text(stringResource(R.string.finance_grand_total), fontWeight = FontWeight.Bold, style = MaterialTheme.typography.bodyMedium)
                        Text(fmtPrice(grandTotal.toString()), fontWeight = FontWeight.Bold, style = MaterialTheme.typography.bodyMedium)
                    }
                }
            }
        }
}

/** Manuell erfasste Minifiguren, einzeln aufgelistet. */
fun LazyListScope.financeFigRows(figsValuation: FigsValuationResponse?, showFigs: Boolean, serverUrl: String, imageLoader: ImageLoader, fmtPrice: (String?) -> String, onManualClick: (type: String, id: String, colorId: Int, name: String?) -> Unit) {
    // ── Manuell erfasste Minifiguren — einzeln auflisten, analog zu den Sets ─
    val figsItems = figsValuation?.figs ?: emptyList()
    if (figsItems.isNotEmpty() && showFigs) {
        item {
            Text(stringResource(R.string.finance_section_minifigs).uppercase(),
                style = MaterialTheme.typography.labelSmall,
                fontWeight = FontWeight.Bold,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                letterSpacing = 0.8.sp,
                modifier = Modifier.padding(top = Abstaende.klein, bottom = Abstaende.haar, start = Abstaende.winzig))
        }
        val figRows = figsItems.flatMap { f ->
            if (f.acquisitions.size > 1) f.acquisitions.map { f to it }
            else listOf(f to f.acquisitions.firstOrNull())
        }
        items(figRows, key = { (f, acq) -> "fig_${f.id}#${acq?.id ?: 0}" }) { (fig, acq) ->
            // Bild über image_local und den Server-Proxy, nicht roh über fig.imageUrl — sonst
            // fehlte es offline und bei Quellen, die nur der Server erreicht.
            val figImg = remember(fig.imageLocal, fig.imageUrl, serverUrl) {
                resolveThumbUrl(serverUrl, fig.imageLocal, fig.imageUrl)
            }
            ManualFinanceRow(
                imageUrl = figImg,
                imageLoader = imageLoader,
                onClick = { onManualClick("fig", fig.figNumber, 0, fig.figName) },
                title = fig.figName ?: fig.figNumber,
                blId = fig.blFigNumber ?: fig.figNumber,
                quantity = acq?.quantity ?: fig.quantity,
                priceStr = fmtPrice(acq?.totalAvg ?: fig.displayValue),
                purchaseStr = (acq?.purchasePrice ?: fig.purchasePrice)?.let { fmtPrice(it.toString()) },
                condition = acq?.condition,
                pnlPct = acq?.pnlPct ?: fig.pnlPct
            )
        }
        item {
            // Ebenfalls die Serverzahl — siehe Begründung bei den Teilen.
            SubtotalRow(stringResource(R.string.finance_subtotal_minifigs),
                fmtPrice(figsValuation?.totalValue))
        }
    }

}

/** Manuell erfasste Teile, einzeln aufgelistet. */
fun LazyListScope.financePartRows(partsValuation: PartsValuationResponse?, showParts: Boolean, serverUrl: String, imageLoader: ImageLoader, fmtPrice: (String?) -> String, onManualClick: (type: String, id: String, colorId: Int, name: String?) -> Unit) {
    // ── Manuell erfasste Teile — einzeln auflisten, analog zu den Sets ─────
    val partsItems = partsValuation?.parts ?: emptyList()
    if (partsItems.isNotEmpty() && showParts) {
        item {
            Text(stringResource(R.string.finance_section_parts).uppercase(),
                style = MaterialTheme.typography.labelSmall,
                fontWeight = FontWeight.Bold,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                letterSpacing = 0.8.sp,
                modifier = Modifier.padding(top = Abstaende.klein, bottom = Abstaende.haar, start = Abstaende.winzig))
        }
        // Wie bei den Sets: eine vollständige Zeile je Kaufpreis. Ein
        // Teil, das einmal neu und einmal gebraucht gekauft wurde,
        // erscheint zweimal — jede Zeile mit dem Marktpreis ihres
        // Zustands. Ohne Erfassungen bleibt es bei der einen Zeile.
        val partRows = partsItems.flatMap { p ->
            if (p.acquisitions.size > 1) p.acquisitions.map { p to it }
            else listOf(p to p.acquisitions.firstOrNull())
        }
        items(partRows, key = { (p, acq) -> "part_${p.id}#${acq?.id ?: 0}" }) { (part, acq) ->
            val partImg = remember(part.imageLocal, part.imageUrl, serverUrl) {
                resolveThumbUrl(serverUrl, part.imageLocal, part.imageUrl)
            }
            ManualFinanceRow(
                imageUrl = partImg,
                imageLoader = imageLoader,
                onClick = { onManualClick("part", part.partNumber, part.colorId, part.partName) },
                title = part.partName ?: part.partNumber,
                blId = part.blPartNumber ?: part.partNumber,
                quantity = acq?.quantity ?: part.quantity,
                priceStr = fmtPrice(acq?.totalAvg ?: part.displayValue),
                purchaseStr = (acq?.purchasePrice ?: part.purchasePrice)?.let { fmtPrice(it.toString()) },
                condition = acq?.condition,
                pnlPct = acq?.pnlPct ?: part.pnlPct
            )
        }
        item {
            // Die Summe kommt vom Server (total_value), nicht aus den Zeilen: display_value
            // ist auf zwei Stellen gerundet, total_value auf vier. Über viele Positionen liefe
            // die eigene Summe gegen die Kopfkachel.
            SubtotalRow(stringResource(R.string.finance_subtotal_parts),
                fmtPrice(partsValuation?.totalValue))
        }
    }

}

/** Eine vollständige Karte JE KAUFPREIS — siehe die Begründung im Rumpf. */
fun LazyListScope.financeSetRows(valuation: ValuationResponse, showSets: Boolean, serverUrl: String, imageLoader: ImageLoader, fmtPrice: (String?) -> String, onSetClick: (String) -> Unit) {
    // Section header
    if (showSets) {
    item {
        Text(stringResource(R.string.finance_section_sets).uppercase(),
            style = MaterialTheme.typography.labelSmall,
            fontWeight = FontWeight.Bold,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            letterSpacing = 0.8.sp,
            modifier = Modifier.padding(top = Abstaende.winzig, bottom = Abstaende.haar, start = Abstaende.winzig))
    }

    // ── Eine vollständige Karte je Kaufpreis ──
    //
    // Ein Set mit einem Kaufpreis für „Neu“ und einem für „Gebraucht“ erscheint
    // zweimal, jede Karte mit dem Marktpreis ihres Zustands — sonst würde das neu
    // gekaufte Exemplar mit dem Gebrauchtpreis bewertet. Gleichrangige Karten statt
    // Unterzeilen, weil jede für einen eigenen Kauf steht; Unterzeilen läsen sich wie
    // die Aufschlüsselung einer Summe. Zusammengehalten durch Bild und Setnummer,
    // unterschieden durch die Zustands-Plakette.
    val setRows = valuation.sets.flatMap { s ->
        if (s.acquisitions.size > 1) s.acquisitions.map { s to it }
        else listOf(s to s.acquisitions.firstOrNull())
    }
    items(setRows, key = { (s, acq) -> "${s.setNumber}#${acq?.id ?: 0}" }) { (set, acq) ->
        // total_avg statt total_qty_avg — siehe oben.
        val priceStr = (acq?.totalAvg ?: set.totalAvg ?: set.totalQtyAvg)
            ?.let { fmtPrice(it) } ?: "—"
        val rowQty      = acq?.quantity ?: set.quantity
        val rowPurchase = acq?.purchasePrice ?: set.purchasePrice
        val rowPnl      = acq?.pnlPct
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
                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(1.dp)) {
                    Text(set.name ?: set.setNumber, fontWeight = FontWeight.SemiBold,
                        maxLines = 2, style = MaterialTheme.typography.bodyMedium)
                    Text(set.setNumber, style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.primary)
                    if (rowQty > 1)
                        Text("×$rowQty", style = MaterialTheme.typography.labelSmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant)
                    // Zustand dieser Erfassung — bei mehreren Karten
                    // desselben Sets das einzige Unterscheidungsmerkmal.
                    acq?.let {
                        Box(Modifier.padding(top = Abstaende.haar)) {
                            ConditionBadges(listOf(it.condition))
                        }
                    }
                }
                Spacer(Modifier.width(Abstaende.klein))
                // Kaufpreis und Marktpreis untereinander, wie in der Webapp. Bei mehreren
                // Erfassungen steht hier nichts: Die Zahlen stehen dann je Kaufpreis darunter,
                // eine Summe daneben wäre eine zweite Darstellung derselben Werte.
                Column(horizontalAlignment = Alignment.End) {
                    when {
                        set.noPrice || set.error != null ->
                            Text("—", color = MaterialTheme.colorScheme.onSurfaceVariant,
                                style = MaterialTheme.typography.bodyMedium)
                        else -> Text(priceStr, fontWeight = FontWeight.Bold,
                            color = MaterialTheme.colorScheme.primary,
                            style = MaterialTheme.typography.bodyMedium)
                    }
                    rowPurchase?.let {
                        Text(
                            stringResource(R.string.finance_purchase_short, fmtPrice(it.toString())),
                            style = MaterialTheme.typography.labelSmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                    }
                    // Entwicklung gegen den Kaufpreis DIESER Erfassung —
                    // vom Server, hier wird nichts nachgerechnet.
                    rowPnl?.toDoubleOrNull()?.let {
                        Box(Modifier.padding(top = Abstaende.haar)) { PnlBadge(it) }
                    }
                }
            }
        }
    }
    } // showSets

}

/**
 * Die Filterleiste des Reiters — additiv. „Alle“ ist kein vierter Zustand, sondern
 * die leere Auswahl: gewählt, wenn nichts eingeschränkt ist; ein Klick räumt die
 * Auswahl weg. Die drei übrigen schalten ihre Zeilenart einzeln zu und ab. Die
 * Menge liegt im FinanceUiState; warum, steht dort.
 */
fun LazyListScope.financeCategoryFilter(
    aktive: Set<String>,
    onUmschalten: (String) -> Unit,
    onAlle: () -> Unit,
) {
    item {
        LazyRow(
            contentPadding = PaddingValues(horizontal = 0.dp),
            horizontalArrangement = Arrangement.spacedBy(6.dp),
            modifier = Modifier.padding(bottom = 6.dp)
        ) {
            item {
                FilterChip(
                    selected = aktive.isEmpty(),
                    onClick = onAlle,
                    label = { Text(stringResource(R.string.finance_filter_all), style = MaterialTheme.typography.labelMedium) },
                    shape = Formen.chip
                )
            }
            item { KategorieChip("sets",  R.string.finance_filter_sets,     aktive, onUmschalten) }
            item { KategorieChip("parts", R.string.finance_filter_parts,    aktive, onUmschalten) }
            item { KategorieChip("figs",  R.string.finance_filter_minifigs, aktive, onUmschalten) }
        }
    }
}

/** Ein Chip der Filterleiste — drei Aufrufer, ein Aussehen. */
@Composable
private fun KategorieChip(
    schluessel: String,
    @androidx.annotation.StringRes text: Int,
    aktive: Set<String>,
    onUmschalten: (String) -> Unit,
) {
    FilterChip(
        selected = schluessel in aktive,
        onClick = { onUmschalten(schluessel) },
        label = { Text(stringResource(text), style = MaterialTheme.typography.labelMedium) },
        shape = Formen.chip
    )
}

/** Die Kennzahl-Karten über der Liste. */
fun LazyListScope.financeSummaryCards(valuation: ValuationResponse, partsValuation: PartsValuationResponse?, figsValuation: FigsValuationResponse?, pnl: PnlResponse?, fmtPrice: (String?) -> String) {
    item {
        Card(
            modifier = Modifier.fillMaxWidth(),
            shape = Formen.chip,
            colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.primary),
            elevation = CardDefaults.cardElevation(defaultElevation = Formen.karteErhebungHoch)
        ) {
            Column(Modifier.padding(20.dp)) {
                Text(
                    stringResource(R.string.finance_market_avg),
                    color = MaterialTheme.colorScheme.onPrimary.copy(alpha = 0.75f),
                    style = MaterialTheme.typography.labelMedium
                )
                Spacer(Modifier.height(6.dp))
                val partsExtra = partsValuation?.totalValue?.toDoubleOrNull() ?: 0.0
                val figsExtra  = figsValuation?.totalValue?.toDoubleOrNull() ?: 0.0
                // totals.avg statt qtyAvg: Marktpreis ist avg_price, der mengengewichtete
                // Schnitt liegt systematisch darunter (gleiche Umstellung wie in der Webapp).
                val setsTotal  = valuation.totals.avg.toDoubleOrNull() ?: 0.0
                // Gesamtwert vom Server, wie oben.
                val grandTotal = pnl?.totals?.grandTotal?.toDoubleOrNull()
                    ?: (setsTotal + partsExtra + figsExtra)
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    Text(
                        if (grandTotal > 0) fmtPrice(grandTotal.toString())
                        else if (valuation.sets.any { it.error != null }) stringResource(R.string.finance_price_error)
                        else if (valuation.sets.isEmpty()) stringResource(R.string.finance_no_sets)
                        else stringResource(R.string.finance_load_prompt),
                        color = MaterialTheme.colorScheme.onPrimary,
                        fontWeight = FontWeight.ExtraBold,
                        style = MaterialTheme.typography.headlineMedium
                    )
                    val pnlPct = pnl?.totals?.pnlPct?.toDoubleOrNull()
                    if (pnlPct != null) {
                        Surface(
                            shape = Formen.chip,
                            color = MaterialTheme.colorScheme.onPrimary.copy(alpha = 0.18f)
                        ) {
                            Text(
                                stringResource(R.string.finance_total_pnl, fmtProzent(pnlPct)),
                                color = MaterialTheme.colorScheme.onPrimary,
                                fontWeight = FontWeight.Bold,
                                style = MaterialTheme.typography.bodyMedium,
                                modifier = Modifier.padding(horizontal = 10.dp, vertical = 3.dp)
                            )
                        }
                    }
                }
                if (partsExtra > 0 || figsExtra > 0) {
                    Spacer(Modifier.height(Abstaende.winzig))
                    Text(
                        stringResource(R.string.finance_parts_extra, fmtPrice((partsExtra + figsExtra).toString())),
                        color = MaterialTheme.colorScheme.onPrimary.copy(alpha = 0.75f),
                        style = MaterialTheme.typography.labelSmall
                    )
                }
                Spacer(Modifier.height(Abstaende.gross))
                HorizontalDivider(color = MaterialTheme.colorScheme.onPrimary.copy(alpha = 0.2f))
                Spacer(Modifier.height(Abstaende.mittel))
                Row(Modifier.fillMaxWidth(), Arrangement.SpaceAround) {
                    PriceColumn("Min", fmtPrice(valuation.totals.min))
                    PriceColumn(stringResource(R.string.finance_avg_label), fmtPrice(valuation.totals.avg))
                    PriceColumn("Max", fmtPrice(valuation.totals.max))
                }
            }
        }
    }

    // Kategorie-Filter — Galerie-Stil: Single-Select, Alle setzt zurück
}
