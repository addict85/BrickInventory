package ch.brickinventoryapp.ui.screens

/**
 * Die Abschnitte der Finanz-Seite.
 *
 * ── Warum eigene Datei (Nachtrag 98) ────────────────────────────────────────
 *
 * `FinanceScreen()` war 482 Zeilen. Nach dem Signatur-Umbau aus Nachtrag 96
 * war die Signatur schlank, der Rumpf aber unverändert: Portfolio-Diagramm,
 * Kennzahl-Karten, Kategoriefilter und drei Listen (Sets, Teile, Minifiguren)
 * in einer Funktion.
 *
 * Wie bei SetDetailSections.kt sind es Erweiterungen auf `LazyListScope` und
 * keine @Composable-Funktionen: Sie tragen Einträge in die Liste ein.
 *
 * Jeder Rumpf ist WORTGLEICH übernommen; verändert wurde nur die Einrückung.
 * Die Parameterlisten stammen aus einer Analyse der freien Namen je Block.
 */

import ch.brickinventoryapp.ui.theme.Formen
import androidx.compose.foundation.lazy.LazyListScope
import ch.brickinventoryapp.data.model.FigsValuationResponse
import ch.brickinventoryapp.data.model.PartsValuationResponse
import ch.brickinventoryapp.data.model.PnlResponse
import ch.brickinventoryapp.data.model.ValuationResponse
import coil.ImageLoader
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
import ch.brickinventoryapp.util.resolveThumbUrl
import coil.compose.AsyncImage
import androidx.compose.material.icons.filled.*

/** Gesamt-Total: Sets + manuell erfasste Teile + Minifiguren. */
/**
 * `valuation` ist hier NICHT nullbar (Nachtrag 104).
 *
 * FinanceScreen() steigt oben mit `if (valuation == null) { … return }` aus.
 * Alles darunter lief im Original unter einem Smart-Cast auf den
 * Nicht-Null-Typ — beim Herauslösen ging der verloren, und der Rumpf griff
 * plötzlich auf einen nullbaren Wert zu.
 *
 * Statt im Rumpf überall `?.` einzustreuen (was eine andere Bedeutung hätte:
 * „darf fehlen" statt „ist an dieser Stelle immer da") verlangt die Signatur
 * den Nicht-Null-Typ. Der Aufrufer erfüllt das durch seinen frühen Ausstieg.
 */
fun LazyListScope.financeGrandTotal(valuation: ValuationResponse, partsValuation: PartsValuationResponse?, figsValuation: FigsValuationResponse?, pnl: PnlResponse?, fmtPrice: (String?) -> String) {
        // ── Gesamt-Total: Sets + manuell erfasste Teile + Minifiguren ───────────
        item {
            // totals.avg statt qtyAvg: Marktpreis ist avg_price, der mengengewichtete
            // Schnitt liegt systematisch darunter (gleiche Umstellung wie in der Webapp).
            //
            // Alle drei Summanden kommen vom Server. Vorher addierte diese
            // Stelle die gerundeten Zeilenwerte selbst und wich damit von
            // der Kopfkachel weiter oben ab, die schon total_value las —
            // zwei Gesamtsummen in derselben Ansicht.
            val setsTotal  = valuation.totals.avg.toDoubleOrNull() ?: 0.0
            val partsTotal = partsValuation?.totalValue?.toDoubleOrNull() ?: 0.0
            val figsTotal  = figsValuation?.totalValue?.toDoubleOrNull() ?: 0.0
            // Gesamtwert vom Server (Nachtrag 145). Der Rückfall auf die
            // eigene Addition bleibt für ältere Serverstände.
            val grandTotal = pnl?.totals?.grandTotal?.toDoubleOrNull()
                ?: (setsTotal + partsTotal + figsTotal)
            Spacer(Modifier.height(4.dp))
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
fun LazyListScope.financeFigRows(figsValuation: FigsValuationResponse?, showFigs: Boolean, serverUrl: String, imageLoader: ImageLoader, fmtPrice: (String?) -> String, onManualClick: (type: String, id: String, colorId: Int) -> Unit) {
    // ── Manuell erfasste Minifiguren — einzeln auflisten, analog zu den Sets ─
    val figsItems = figsValuation?.figs ?: emptyList()
    if (figsItems.isNotEmpty() && showFigs) {
        item {
            Text(stringResource(R.string.finance_section_minifigs).uppercase(),
                style = MaterialTheme.typography.labelSmall,
                fontWeight = FontWeight.Bold,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                letterSpacing = 0.8.sp,
                modifier = Modifier.padding(top = 8.dp, bottom = 2.dp, start = 4.dp))
        }
        val figRows = figsItems.flatMap { f ->
            if (f.acquisitions.size > 1) f.acquisitions.map { f to it }
            else listOf(f to f.acquisitions.firstOrNull())
        }
        items(figRows, key = { (f, acq) -> "fig_${f.id}#${acq?.id ?: 0}" }) { (fig, acq) ->
            // Bisher wurde hier ausschliesslich fig.imageUrl roh
            // durchgereicht — weder image_local noch der
            // Server-Proxy kamen zum Zug, obwohl FigValuationItem
            // image_local längst kennt (siehe Minifiguren-Bildfix
            // in dieser Sitzung). Diese Stelle war dabei übersehen
            // worden.
            val figImg = remember(fig.imageLocal, fig.imageUrl, serverUrl) {
                resolveThumbUrl(serverUrl, fig.imageLocal, fig.imageUrl)
            }
            ManualFinanceRow(
                imageUrl = figImg,
                imageLoader = imageLoader,
                onClick = { onManualClick("fig", fig.figNumber, 0) },
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
fun LazyListScope.financePartRows(partsValuation: PartsValuationResponse?, showParts: Boolean, serverUrl: String, imageLoader: ImageLoader, fmtPrice: (String?) -> String, onManualClick: (type: String, id: String, colorId: Int) -> Unit) {
    // ── Manuell erfasste Teile — einzeln auflisten, analog zu den Sets ─────
    val partsItems = partsValuation?.parts ?: emptyList()
    if (partsItems.isNotEmpty() && showParts) {
        item {
            Text(stringResource(R.string.finance_section_parts).uppercase(),
                style = MaterialTheme.typography.labelSmall,
                fontWeight = FontWeight.Bold,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                letterSpacing = 0.8.sp,
                modifier = Modifier.padding(top = 8.dp, bottom = 2.dp, start = 4.dp))
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
                onClick = { onManualClick("part", part.partNumber, part.colorId) },
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
            // Die Summe kommt vom SERVER (total_value), nicht aus den
            // Zeilen: display_value ist auf zwei Stellen gerundet,
            // total_value auf vier. Über viele Positionen läuft die
            // eigene Summe gegen die Kopfkachel — und die liest
            // total_value bereits.
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
            modifier = Modifier.padding(top = 4.dp, bottom = 2.dp, start = 4.dp))
    }

    // ── Eine VOLLSTÄNDIGE Karte JE KAUFPREIS ────────────────────────
    //
    // Ein Set mit einem Kaufpreis für „Neu" und einem für „Gebraucht"
    // erscheint zweimal, jede Karte mit dem Marktpreis IHRES Zustands.
    // Vorher galt das ganze Set als gebraucht, sobald eine einzige
    // Erfassung gebraucht war — auch das neu gekaufte Exemplar wurde
    // dann mit dem Gebrauchtpreis bewertet.
    //
    // Die erste Fassung hängte die weiteren Erfassungen als schmale
    // Unterzeilen an EINE Karte. Das las sich wie die Aufschlüsselung
    // einer Summe darüber; die Zeilen sind aber gleichrangig — jede
    // steht für einen eigenen Kauf. Zusammengehalten werden sie durch
    // Bild und Setnummer, unterschieden durch die Zustands-Plakette.
    //
    // Sets mit genau einer (oder ohne) Erfassung ergeben eine Karte
    // wie bisher.
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
            Row(Modifier.padding(12.dp), verticalAlignment = Alignment.CenterVertically) {
                FinanzBild(imageUrl, imageLoader, set.name)
                Spacer(Modifier.width(12.dp))
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
                        Box(Modifier.padding(top = 2.dp)) {
                            ConditionBadges(listOf(it.condition))
                        }
                    }
                }
                Spacer(Modifier.width(8.dp))
                // Kaufpreis und Marktpreis untereinander — dieselbe
                // Gegenüberstellung wie in der Webapp.
                //
                // Bei MEHREREN Erfassungen steht hier nichts: Die
                // Zahlen stehen dann Zeile für Zeile darunter, je
                // Kaufpreis eine. Eine Summe daneben wäre eine zweite
                // Darstellung derselben Werte.
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
                        Box(Modifier.padding(top = 2.dp)) { PnlBadge(it) }
                    }
                }
            }
        }
    }
    } // showSets

}

/** Der Kategoriefilter (alle / Sets / Teile / Minifiguren). */
fun LazyListScope.financeCategoryFilter(activeCategory: androidx.compose.runtime.MutableState<String>) {
    item {
        LazyRow(
            contentPadding = PaddingValues(horizontal = 0.dp),
            horizontalArrangement = Arrangement.spacedBy(6.dp),
            modifier = Modifier.padding(bottom = 6.dp)
        ) {
            item {
                FilterChip(
                    selected = activeCategory.value == "alle",
                    onClick = { activeCategory.value = "alle" },
                    label = { Text(stringResource(R.string.finance_filter_all), fontSize = 12.sp) },
                    shape = Formen.chip
                )
            }
            item {
                FilterChip(
                    selected = activeCategory.value == "sets",
                    onClick = { activeCategory.value = if (activeCategory.value == "sets") "alle" else "sets" },
                    label = { Text(stringResource(R.string.finance_filter_sets), fontSize = 12.sp) },
                    shape = Formen.chip
                )
            }
            item {
                FilterChip(
                    selected = activeCategory.value == "parts",
                    onClick = { activeCategory.value = if (activeCategory.value == "parts") "alle" else "parts" },
                    label = { Text(stringResource(R.string.finance_filter_parts), fontSize = 12.sp) },
                    shape = Formen.chip
                )
            }
            item {
                FilterChip(
                    selected = activeCategory.value == "figs",
                    onClick = { activeCategory.value = if (activeCategory.value == "figs") "alle" else "figs" },
                    label = { Text(stringResource(R.string.finance_filter_minifigs), fontSize = 12.sp) },
                    shape = Formen.chip
                )
            }
        }
    }

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
                // Siehe oben (Nachtrag 145): Gesamtwert vom Server.
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
                        fontSize = 28.sp
                    )
                    val pnlPct = pnl?.totals?.pnlPct?.toDoubleOrNull()
                    if (pnlPct != null) {
                        val sign = if (pnlPct > 0) "+" else ""
                        Surface(
                            shape = Formen.chip,
                            color = MaterialTheme.colorScheme.onPrimary.copy(alpha = 0.18f)
                        ) {
                            Text(
                                stringResource(R.string.finance_total_pnl, sign, pnlPct),
                                color = MaterialTheme.colorScheme.onPrimary,
                                fontWeight = FontWeight.Bold,
                                fontSize = 13.sp,
                                modifier = Modifier.padding(horizontal = 10.dp, vertical = 3.dp)
                            )
                        }
                    }
                }
                if (partsExtra > 0 || figsExtra > 0) {
                    Spacer(Modifier.height(4.dp))
                    Text(
                        stringResource(R.string.finance_parts_extra, fmtPrice((partsExtra + figsExtra).toString())),
                        color = MaterialTheme.colorScheme.onPrimary.copy(alpha = 0.75f),
                        style = MaterialTheme.typography.labelSmall
                    )
                }
                Spacer(Modifier.height(16.dp))
                HorizontalDivider(color = MaterialTheme.colorScheme.onPrimary.copy(alpha = 0.2f))
                Spacer(Modifier.height(12.dp))
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
