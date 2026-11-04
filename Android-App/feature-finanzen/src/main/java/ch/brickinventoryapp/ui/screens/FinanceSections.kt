package ch.brickinventoryapp.ui.screens

import ch.brickinventoryapp.ui.components.AuswahlChip
/**
 * Die Abschnitte der Finanz-Seite: Portfolio-Diagramm, Kennzahl-Karten,
 * Kategoriefilter und die drei Listen. Wie bei SetDetailSections.kt Erweiterungen
 * auf `LazyListScope` statt @Composable-Funktionen, weil sie Einträge in die Liste
 * eintragen.
 */

import ch.brickinventoryapp.ui.model.BewertungAnsicht
import ch.brickinventoryapp.ui.model.FigurenBewertungAnsicht
import ch.brickinventoryapp.ui.model.GewinnAnsicht
import ch.brickinventoryapp.ui.model.TeileBewertungAnsicht
import ch.brickinventoryapp.ui.theme.Formen
import androidx.compose.foundation.lazy.LazyListScope
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
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import ch.brickinventoryapp.ressourcen.R
import ch.brickinventoryapp.ui.*
import ch.brickinventoryapp.util.fmtProzent
import ch.brickinventoryapp.util.resolveThumbUrl
import androidx.compose.material.icons.filled.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Info
import ch.brickinventoryapp.ui.theme.Abstaende
import ch.brickinventoryapp.ui.theme.LocalStatusFarben

/** Gesamt-Total: Sets + manuell erfasste Teile + Minifiguren. */
/**
 * `valuation` ist hier nicht nullbar: FinanceScreen() steigt bei `null` vorher
 * aus. Die Signatur verlangt den Nicht-Null-Typ, statt im Rumpf `?.` einzustreuen
 * — das hiesse „darf fehlen“ statt „ist hier immer da“.
 */
fun LazyListScope.financeGrandTotal(valuation: BewertungAnsicht, partsValuation: TeileBewertungAnsicht?, figsValuation: FigurenBewertungAnsicht?, pnl: GewinnAnsicht?, fmtPrice: (String?) -> String) {
        // ── Gesamt-Total: Sets + manuell erfasste Teile + Minifiguren ───────────
        item {
            // Alle Summanden vom Server; die eigene Addition nur für ältere Server (finanzSummen).
            val summen = finanzSummen(valuation, partsValuation, figsValuation, pnl)
            Spacer(Modifier.height(Abstaende.winzig))
            Card(
                modifier = Modifier.fillMaxWidth(),
                shape = Formen.leiste,
                colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
                elevation = CardDefaults.cardElevation(defaultElevation = Formen.karteErhebung)
            ) {
                Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    val klein = MaterialTheme.typography.bodySmall
                    BezeichnungUndWert(stringResource(R.string.finance_total_sets), fmtPrice(summen.sets.toPlainString()),
                        stil = klein, wertGewicht = FontWeight.Normal)
                    BezeichnungUndWert(stringResource(R.string.finance_total_manual_parts), fmtPrice(summen.teile.toPlainString()),
                        stil = klein, wertGewicht = FontWeight.Normal)
                    BezeichnungUndWert(stringResource(R.string.finance_total_manual_minifigs), fmtPrice(summen.figuren.toPlainString()),
                        stil = klein, wertGewicht = FontWeight.Normal)
                    HorizontalDivider()
                    BezeichnungUndWert(stringResource(R.string.finance_grand_total), fmtPrice(summen.gesamt.toPlainString()),
                        stil = MaterialTheme.typography.bodyMedium.copy(fontWeight = FontWeight.Bold),
                        bezeichnungFarbe = MaterialTheme.colorScheme.onSurface, wertGewicht = FontWeight.Bold)
                    // Wie die Fussnote im Web: Ohne den Hinweis las sich das Total als Wert aller Positionen.
                    val ohneMarkt = finanzKopf(valuation, partsValuation, figsValuation, pnl).ohneMarkt
                    if (ohneMarkt > 0) Text(
                        pluralStringResource(R.plurals.finance_summe_ohne_markt, ohneMarkt, ohneMarkt),
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
        }
}

/** Manuell erfasste Minifiguren, einzeln aufgelistet. */
fun LazyListScope.financeFigRows(figsValuation: FigurenBewertungAnsicht?, showFigs: Boolean, serverUrl: String, imageLoader: ImageLoader, fmtPrice: (String?) -> String, fmtWert: (Double?) -> String, onManualClick: (type: String, id: String, colorId: Int, name: String?) -> Unit) {
    // ── Manuell erfasste Minifiguren — einzeln auflisten, analog zu den Sets ─
    val figsItems = figsValuation?.figs ?: emptyList()
    if (figsItems.isNotEmpty() && showFigs) {
        item {
            ch.brickinventoryapp.ui.components.Abschnittstitel(stringResource(R.string.finance_section_minifigs),
                Modifier.padding(top = Abstaende.klein, bottom = Abstaende.haar, start = Abstaende.winzig))
        }
        items(figurZeilen(figsItems), key = { it.second.schluessel }) { (fig, zeile) ->
            // Bild über image_local und den Server-Proxy, nicht roh über fig.imageUrl — sonst
            // fehlte es offline und bei Quellen, die nur der Server erreicht.
            val figImg = remember(fig.imageLocal, fig.imageUrl, serverUrl) {
                resolveThumbUrl(serverUrl, fig.imageLocal, fig.imageUrl)
            }
            ManualFinanceRow(
                imageUrl = figImg,
                imageLoader = imageLoader,
                onClick = { onManualClick("fig", fig.figNumber, ch.brickinventoryapp.ui.model.OHNE_FARBE, fig.figName) },
                title = fig.figName ?: fig.figNumber,
                blId = fig.blFigNumber ?: fig.figNumber,
                quantity = zeile.menge,
                priceStr = fmtWert(zeile.wert),
                purchaseStr = zeile.kaufGesamt?.let { fmtWert(it) },
                purchaseGesamt = zeile.menge > 1,
                condition = zeile.zustand,
                pnlProzent = zeile.pnlProzent,
                gewinnStr = zeile.gewinn?.let { gewinnText(it, fmtWert) },
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
fun LazyListScope.financePartRows(partsValuation: TeileBewertungAnsicht?, showParts: Boolean, serverUrl: String, imageLoader: ImageLoader, fmtPrice: (String?) -> String, fmtWert: (Double?) -> String, onManualClick: (type: String, id: String, colorId: Int, name: String?) -> Unit) {
    // ── Manuell erfasste Teile — einzeln auflisten, analog zu den Sets ─────
    val partsItems = partsValuation?.parts ?: emptyList()
    if (partsItems.isNotEmpty() && showParts) {
        item {
            ch.brickinventoryapp.ui.components.Abschnittstitel(stringResource(R.string.finance_section_parts),
                Modifier.padding(top = Abstaende.klein, bottom = Abstaende.haar, start = Abstaende.winzig))
        }
        // Wie bei den Sets: eine vollständige Zeile je Kaufpreis. Ein
        // Teil, das einmal neu und einmal gebraucht gekauft wurde,
        // erscheint zweimal — jede Zeile mit dem Marktpreis ihres
        // Zustands. Ohne Erfassungen bleibt es bei der einen Zeile.
        items(teilZeilen(partsItems), key = { it.second.schluessel }) { (part, zeile) ->
            val partImg = remember(part.imageLocal, part.imageUrl, serverUrl) {
                resolveThumbUrl(serverUrl, part.imageLocal, part.imageUrl)
            }
            ManualFinanceRow(
                imageUrl = partImg,
                imageLoader = imageLoader,
                onClick = { onManualClick("part", part.partNumber, part.colorId, part.partName) },
                title = part.partName ?: part.partNumber,
                blId = part.blPartNumber ?: part.partNumber,
                quantity = zeile.menge,
                priceStr = fmtWert(zeile.wert),
                purchaseStr = zeile.kaufGesamt?.let { fmtWert(it) },
                purchaseGesamt = zeile.menge > 1,
                condition = zeile.zustand,
                pnlProzent = zeile.pnlProzent,
                gewinnStr = zeile.gewinn?.let { gewinnText(it, fmtWert) },
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
fun LazyListScope.financeSetRows(valuation: BewertungAnsicht, showSets: Boolean, serverUrl: String, imageLoader: ImageLoader, fmtWert: (Double?) -> String, onSetClick: (String) -> Unit) {
    // Section header
    if (showSets) {
    item {
        ch.brickinventoryapp.ui.components.Abschnittstitel(stringResource(R.string.finance_section_sets),
            Modifier.padding(top = Abstaende.winzig, bottom = Abstaende.haar, start = Abstaende.winzig))
    }

    // ── Eine vollständige Karte je Kaufpreis ──
    //
    // Ein Set mit einem Kaufpreis für „Neu“ und einem für „Gebraucht“ erscheint
    // zweimal, jede Karte mit dem Marktpreis ihres Zustands — sonst würde das neu
    // gekaufte Exemplar mit dem Gebrauchtpreis bewertet. Gleichrangige Karten statt
    // Unterzeilen, weil jede für einen eigenen Kauf steht; Unterzeilen läsen sich wie
    // die Aufschlüsselung einer Summe. Zusammengehalten durch Bild und Setnummer,
    // unterschieden durch die Zustands-Plakette.
    items(setZeilen(valuation.sets), key = { it.second.schluessel }) { (set, zeile) ->
        val priceStr    = fmtWert(zeile.wert)
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
                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(1.dp)) {
                    Text(set.name ?: set.setNumber, fontWeight = FontWeight.SemiBold,
                        maxLines = 2, style = MaterialTheme.typography.bodyMedium)
                    Text(set.setNumber, style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.primary)
                    if (rowQty > 1)
                        Text(ch.brickinventoryapp.ui.mengeManuell(rowQty), style = MaterialTheme.typography.labelSmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant)
                    // Zustand dieser Erfassung — bei mehreren Karten
                    // desselben Sets das einzige Unterscheidungsmerkmal.
                    zeile.zustand?.let {
                        Box(Modifier.padding(top = Abstaende.haar)) {
                            ConditionBadges(listOf(it))
                        }
                    }
                }
                Spacer(Modifier.width(Abstaende.klein))
                // Kaufpreis und Marktpreis untereinander, wie in der Webapp. Bei mehreren
                // Erfassungen steht hier nichts: Die Zahlen stehen dann je Kaufpreis darunter,
                // eine Summe daneben wäre eine zweite Darstellung derselben Werte.
                Column(horizontalAlignment = Alignment.End) {
                    // Ohne Marktpreis ein Wort statt eines Strichs in der Preisfarbe: Der
                    // blaue Strich sah aus wie ein Wert.
                    when {
                        set.noPrice || set.error != null || zeile.wert == null ->
                            Text(stringResource(R.string.detail_price_none_yet), color = MaterialTheme.colorScheme.onSurfaceVariant,
                                style = MaterialTheme.typography.bodySmall)
                        else -> Text(priceStr, fontWeight = FontWeight.Bold,
                            color = MaterialTheme.colorScheme.primary,
                            style = MaterialTheme.typography.bodyMedium, maxLines = 1, softWrap = false)
                    }
                    rowPurchase?.let {
                        Text(
                            if (rowQty > 1) stringResource(R.string.finance_purchase_total, fmtWert(it))
                            else stringResource(R.string.finance_purchase_short, fmtWert(it)),
                            style = MaterialTheme.typography.labelSmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                    }
                    // Entwicklung gegen den Kaufpreis DIESER Erfassung —
                    // vom Server, hier wird nichts nachgerechnet.
                    rowPnl?.let {
                        Box(Modifier.padding(top = Abstaende.haar)) { PnlBadge(it, zeile.gewinn?.let { g -> gewinnText(g, fmtWert) }) }
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
                AuswahlChip(
                    selected = aktive.isEmpty(),
                    onClick = onAlle,
                    label = { Text(stringResource(R.string.finance_filter_all), style = MaterialTheme.typography.labelMedium) },
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
    AuswahlChip(
        selected = schluessel in aktive,
        onClick = { onUmschalten(schluessel) },
        label = { Text(stringResource(text), style = MaterialTheme.typography.labelMedium) },
    )
}

/** Die Kennzahl-Karten über der Liste. */
@OptIn(ExperimentalLayoutApi::class)
fun LazyListScope.financeSummaryCards(valuation: BewertungAnsicht, partsValuation: TeileBewertungAnsicht?, figsValuation: FigurenBewertungAnsicht?, pnl: GewinnAnsicht?, fmtPrice: (String?) -> String) {
    item {
        // Im Dunkeln primaryContainer statt primary: Das helle primary der dunklen
        // Fassungen (Stein: Hellblau) war als ganze Kachel grell.
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
                // totals.avg statt qtyAvg: Marktpreis ist avg_price, der mengengewichtete
                // Schnitt liegt systematisch darunter (gleiche Umstellung wie in der Webapp).
                val summen = finanzSummen(valuation, partsValuation, figsValuation, pnl)
                // Einstand, Marktwert und G/V aus einer Basis (finanzKopf), sonst passten die drei
                // Zahlen nicht zusammen; ältere Server ohne Basis zeigen den Gesamtwert wie bisher.
                val kopf = finanzKopf(valuation, partsValuation, figsValuation, pnl)
                // FlowRow: Bei grosser Schrift rückt die Gewinn-Plakette unter den Betrag,
                // statt ihn zu quetschen.
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
                    val pnlPct = kopf.guvProzent
                    if (pnlPct != null) {
                        // Gewinn grün, Verlust rot wie überall sonst; auf weissem Grund, weil die
                        // Statusfarben nur auf surface 4,5:1 zusagen (TextKontrastTest), nicht auf primary.
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
                // „davon Teile“ nur ohne Basis: Der Basis-Marktwert lässt Positionen ohne
                // Kaufpreis aus, ein „davon“ aus allen Teilen könnte grösser sein als er.
                if (!kopf.mitBasis && summen.teileUndFiguren.signum() > 0) {
                    Spacer(Modifier.height(Abstaende.winzig))
                    Text(
                        stringResource(R.string.finance_parts_extra, fmtPrice(summen.teileUndFiguren.toPlainString())),
                        color = auf,
                        style = MaterialTheme.typography.labelSmall
                    )
                }
                // Kaufsumme und G/V in einer Zeile, die bei Bedarf umbricht: Untereinander waren
                // es mit Betrag, Bezeichnung und Rechenhinweis vier Textebenen in einer Kachel.
                if (kopf.basisBekannt) {
                    Spacer(Modifier.height(Abstaende.winzig))
                    FlowRow(horizontalArrangement = Arrangement.spacedBy(Abstaende.mittel)) {
                        kopf.einstand?.let {
                            Text(stringResource(R.string.finance_einstand_zeile, fmtPrice(it.toPlainString())),
                                color = auf, style = MaterialTheme.typography.bodySmall)
                        }
                        val guv = kopf.guvBetrag
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
                // Die Spanne der Sets zu Tiefst- und Höchstpreis. Der Schnitt nur, wenn er
                // vom Betrag oben abweicht (Teile und Figuren dazu) — sonst stand dieselbe
                // Zahl zweimal da.
                Text(stringResource(R.string.finance_range_label), color = auf,
                    style = MaterialTheme.typography.labelMedium)
                Spacer(Modifier.height(Abstaende.winzig))
                FlowRow(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceAround,
                        verticalArrangement = Arrangement.spacedBy(Abstaende.klein)) {
                    PriceColumn(stringResource(R.string.finance_min_label), fmtPrice(valuation.totals.min), auf)
                    if (summen.teileUndFiguren.signum() > 0)
                        PriceColumn(stringResource(R.string.finance_avg_label), fmtPrice(valuation.totals.avg), auf)
                    PriceColumn(stringResource(R.string.finance_max_label), fmtPrice(valuation.totals.max), auf)
                }
            }
        }
    }
    item {
        // Wie gerechnet wurde, unter der Kachel statt in ihr: Sie trägt die Zahlen, der
        // Hinweis die Herkunft — wie die Zeile im Web (fin-basis), nur leiser.
        val kopf = finanzKopf(valuation, partsValuation, figsValuation, pnl)
        val ohneMarkt = if (kopf.ohneMarkt > 0) pluralStringResource(R.plurals.finance_basis_ohne_markt,
            kopf.ohneMarkt, kopf.ohneMarkt, fmtPrice(kopf.ohneMarktEinstand.toPlainString())) else null
        val ohneKauf = if (kopf.ohneKauf > 0) pluralStringResource(R.plurals.finance_basis_ohne_kauf,
            kopf.ohneKauf, kopf.ohneKauf, fmtPrice(kopf.ohneKaufWert.toPlainString())) else null
        // Wie das Web (finance.fremde_waehrung_n): fehlende Kaufpreise nennen statt still weglassen.
        val fremde = fremdeKaufpreise(valuation, partsValuation, figsValuation, pnl)
        val zeilen = listOfNotNull(
            if (kopf.basisZeileSichtbar) pluralStringResource(R.plurals.finance_basis_gerechnet, kopf.gesamt,
                kopf.bewertet, kopf.gesamt) + " " + listOfNotNull(ohneMarkt, ohneKauf).joinToString(" · ") else null,
            if (fremde > 0) pluralStringResource(R.plurals.finance_fremde_waehrung, fremde, fremde) else null,
        )
        if (zeilen.isNotEmpty()) Row(
            Modifier.fillMaxWidth().padding(horizontal = Abstaende.winzig),
            horizontalArrangement = Arrangement.spacedBy(Abstaende.klein),
        ) {
            Icon(Icons.Outlined.Info, null, Modifier.size(ch.brickinventoryapp.ui.components.mitSchrift(16.dp)),
                tint = MaterialTheme.colorScheme.onSurfaceVariant)
            Column(verticalArrangement = Arrangement.spacedBy(Abstaende.haar)) {
                zeilen.forEach {
                    Text(it, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
        }
    }

    // Kategorie-Filter — Galerie-Stil: Single-Select, Alle setzt zurück
}
