package ch.brickinventoryapp.collection.ui.screens

import java.time.Instant
import ch.brickinventoryapp.model.domain.Geld
import ch.brickinventoryapp.ui.satz
import ch.brickinventoryapp.model.ui.laedt
import ch.brickinventoryapp.model.ui.Laden
import ch.brickinventoryapp.model.domain.Alarmrichtung
import ch.brickinventoryapp.model.domain.Waehrung
import ch.brickinventoryapp.model.domain.Postenart
import ch.brickinventoryapp.model.domain.Zustand

/**
 * The set detail page's sections. Extensions on LazyListScope, not
 * Composables, because they enter items into the page's LazyColumn; the
 * content inside them are Composables.
 */

import ch.brickinventoryapp.model.domain.KaufAnsicht
import ch.brickinventoryapp.model.domain.PriceHistoryView
import ch.brickinventoryapp.model.domain.SetAnsicht
import ch.brickinventoryapp.model.domain.SetPriceView
import ch.brickinventoryapp.ui.theme.Formen
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.runtime.saveable.rememberSaveable
import coil3.ImageLoader
import coil3.request.ImageRequest
import coil3.request.crossfade
import ch.brickinventoryapp.ui.util.NumericInput
import ch.brickinventoryapp.resources.R
import ch.brickinventoryapp.collection.ui.viewmodel.SetDetailAktionen
import ch.brickinventoryapp.state.ui.LagerUiState
import ch.brickinventoryapp.collection.ui.SetDetailUiState
import kotlinx.coroutines.CoroutineScope
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Remove
import androidx.compose.material.icons.filled.Add
import androidx.compose.runtime.mutableIntStateOf
import kotlinx.coroutines.launch
import androidx.compose.material.icons.filled.*
import ch.brickinventoryapp.ui.theme.Abstaende
import ch.brickinventoryapp.collection.ui.ALARM_STATE_DEFAULT
import ch.brickinventoryapp.ui.components.CrossLink
import ch.brickinventoryapp.ui.components.ErrorHint
import ch.brickinventoryapp.ui.components.SharedImage
import ch.brickinventoryapp.ui.components.QuantitiesButton
import ch.brickinventoryapp.ui.components.MitTooltip
import ch.brickinventoryapp.ui.components.ProduktBild
import ch.brickinventoryapp.ui.components.SegmentChoice
import ch.brickinventoryapp.ui.components.movementReduced
import ch.brickinventoryapp.ui.components.largeFont
import ch.brickinventoryapp.ui.components.withFont
import ch.brickinventoryapp.model.domain.PriceAlertView
import ch.brickinventoryapp.ui.util.fmtEingabe
import ch.brickinventoryapp.ui.util.fmtInt
import ch.brickinventoryapp.ui.util.fmtMoney
import ch.brickinventoryapp.shared.ui.AcquisitionSummarySection
import ch.brickinventoryapp.shared.ui.DetailRow2
import ch.brickinventoryapp.shared.ui.MetricsSeries
import ch.brickinventoryapp.shared.ui.LocationField
import ch.brickinventoryapp.shared.ui.MarketPriceByCondition
import ch.brickinventoryapp.shared.ui.PriceLoadsRow
import ch.brickinventoryapp.shared.ui.PriceChart
import ch.brickinventoryapp.shared.ui.SectionCard
import ch.brickinventoryapp.shared.ui.StatChipV2
import ch.brickinventoryapp.shared.ui.WertKacheln

/**
 * Market price per condition and history. The big price row no longer lives here: market,
 * purchase price and P&L sit in the value tiles above in every design, a row here
 * would repeat them with a percentage from the overall comparison above the per-condition rows.
 */
internal fun LazyListScope.setDetailPriceSection(
    detailState: SetDetailUiState, price: SetPriceView?, history: PriceHistoryView?, currency: Waehrung, onErneut: () -> Unit,
) {
    if (price != null && !price.noPrice || detailState.priceFetch !is Laden.Daten) {
        item {
            // "Price history" as soon as a history exists: right above the card already sits
            // the "Market price" tile, the same title twice read like a duplicate.
            val verlauf = history?.chart?.values?.isNotEmpty() == true || detailState.historyFetch.laedt
            SectionCard(title = stringResource(if (verlauf) R.string.detail_section_price_history else R.string.detail_section_market)) {
                PriceCardContent(detailState, price, history, currency, onErneut)
            }
        }
    }
}

@Composable
private fun PriceCardContent(
    detailState: SetDetailUiState, price: SetPriceView?, history: PriceHistoryView?, currency: Waehrung, onErneut: () -> Unit,
) {
    val priceError = detailState.priceFetch as? Laden.Fehler
    if (detailState.priceFetch.laedt && price == null) {
        PriceLoadsRow()
    } else if (price == null && priceError != null) {
        ErrorHint(priceError.meldung.satz(), onErneut, priceError.art)
    } else if (price != null && !price.noPrice) {
        // One row per condition, but only with more than one: with a single
        // condition, price and P&L would stand there again, same as the value tiles above.
        history?.byCondition?.let { byCond ->
            if (byCond.present().size > 1) MarketPriceByCondition(byCond, currency)
        }
        // Price and history are two fetches; the hint prevents the
        // chart from later jumping into the card with no explanation.
        val chart = history?.chart
        if (chart != null && chart.values.isNotEmpty()) {
            Spacer(Modifier.height(Abstaende.klein))
            PriceChart(chart, currency)
        } else if (detailState.historyFetch.laedt) {
            Spacer(Modifier.height(Abstaende.klein))
            PriceLoadsRow()
        } else if (detailState.historyFetch is Laden.Fehler) {
            Spacer(Modifier.height(Abstaende.klein))
            ErrorHint(detailState.historyFetch.meldung.satz(), onErneut, detailState.historyFetch.art)
        }
    }
}

/** Core data: number, quantity (changeable), entry date. */
internal fun LazyListScope.setDetailDetailsSection(set: SetAnsicht, setNumber: String, lagerZustand: LagerUiState, aktionen: SetDetailAktionen, acquisitions: List<KaufAnsicht>, currency: Waehrung, fmtDate: (Instant?) -> String, onNavigateToAcqMgmt: (type: Postenart, id: String, colorId: Int, title: String) -> Unit) {
    // ── Set details section ────────────────────────────────────────────
    item {
        SectionCard(title = stringResource(R.string.detail_section_details)) {
            DetailRow2(stringResource(R.string.detail_set_number), setNumber)
            // Without a date, no row: "Added —" says nothing.
            if (set.addedAt != null) DetailRow2(stringResource(R.string.detail_added), fmtDate(set.addedAt))
            // ── Storage location ──
            //
            // A picker field with the option to add new locations. The list belongs to the
            // set's owner; SetDetailViewModel fetches it with the detail.
            // At large font size, the field sits below the label at full width:
            // 180 dp next to "Storage location" wasn't even enough for the placeholder at 200%.
            val storageLabel: @Composable () -> Unit = {
                Text(stringResource(R.string.detail_storage),
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    style = MaterialTheme.typography.bodyMedium)
            }
            if (largeFont()) {
                Column(Modifier.fillMaxWidth().padding(vertical = Abstaende.hairline),
                       verticalArrangement = Arrangement.spacedBy(Abstaende.tiny)) {
                    storageLabel()
                    LocationField(
                        wert = set.storage ?: "",
                        stock = lagerZustand.stock.map { it.name },
                        onValue = { aktionen.setSetLocation(setNumber, it) },
                        modifier = Modifier.fillMaxWidth(),
                    )
                }
            } else Row(Modifier.fillMaxWidth()
                    .padding(vertical = Abstaende.hairline),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically) {
                storageLabel()
                LocationField(
                    wert = set.storage ?: "",
                    stock = lagerZustand.stock.map { it.name },
                    onValue = { aktionen.setSetLocation(setNumber, it) },
                    // The rest of the row: at a fixed width, "No storage location" was
                    // cut off, and on the tablet the field stood half as wide as the card.
                    modifier = Modifier.padding(start = Abstaende.gross).weight(1f),
                )
            }
            HorizontalDivider(
                Modifier.padding(vertical = Abstaende.tiny),
                color = MaterialTheme.colorScheme.outlineVariant
            )
            // Quantity stepper, tied to set.quantity: the server can cap a decrease
            // and reports back the real quantity; without the link, the stepper would keep
            // its own assumption.
            var qty by remember(set.setNumber, set.quantity) { mutableIntStateOf(set.quantity) }
            // A quiet tick per step: the number changes without needing to look.
            val haptics = androidx.compose.ui.platform.LocalHapticFeedback.current
            val takt = { haptics.performHapticFeedback(androidx.compose.ui.hapticfeedback.HapticFeedbackType.SegmentTick) }
            Row(
                Modifier.fillMaxWidth().padding(vertical = Abstaende.tiny),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Text(
                    stringResource(R.string.common_quantity),
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(Abstaende.mittel)
                ) {
                    MitTooltip(stringResource(R.string.cd_qty_decrease)) {
                        QuantitiesButton(onClick = { if (qty > 1) { qty--; takt(); aktionen.changeQuantityUm(set.setNumber, -1) } }) {
                            Icon(Icons.Default.Remove, stringResource(R.string.cd_qty_decrease),
                                Modifier.size(withFont(18.dp)))
                        }
                    }
                    Text(
                        "$qty",
                        fontWeight = FontWeight.Bold,
                        style = MaterialTheme.typography.bodyLarge,
                        modifier = Modifier.widthIn(min = 24.dp),
                        textAlign = TextAlign.Center
                    )
                    MitTooltip(stringResource(R.string.cd_qty_increase)) {
                        QuantitiesButton(onClick = { qty++; takt(); aktionen.changeQuantityUm(set.setNumber, 1) }) {
                            Icon(Icons.Default.Add, stringResource(R.string.cd_qty_increase),
                                Modifier.size(withFont(18.dp)))
                        }
                    }
                }
            }

            // Purchase price — compact summary + button to manage
            val capturedSetNumber = set.setNumber
            val capturedSetTitle  = set.name ?: set.setNumber
            AcquisitionSummarySection(
                acquisitions = acquisitions,
                currency = currency,
                onEditPrices = {
                    onNavigateToAcqMgmt(Postenart.SET, capturedSetNumber, 0, capturedSetTitle)
                }
            )
        }
    }
}

/** Value tiles above the details — in every design (WertKacheln, core-ui). */
internal fun LazyListScope.setDetailValueTiles(set: SetAnsicht, price: SetPriceView?, pnlPct: Double?, fmtPrice: (Geld?) -> String) {
    item(key = "wertkacheln") {
        // avg_price first: the market price is the plain average, not the quantity-weighted one.
        val marktpreis = price?.takeUnless { it.noPrice }?.let { it.avgPrice ?: it.qtyAvgPrice }
        val kaufpreis = set.displayPurchasePrice
        val difference = if (marktpreis != null && kaufpreis != null) marktpreis - kaufpreis else null
        WertKacheln(
            // The same words as finances and watchlist instead of a dash that looked like a value.
            markt = marktpreis?.let(fmtPrice) ?: stringResource(R.string.detail_price_none_yet),
            kauf = kaufpreis?.let(fmtPrice) ?: stringResource(R.string.detail_purchase_none),
            pnl = pnlPct,
            pnlBetrag = difference?.let { (if (it.positive) "+" else "") + fmtPrice(it) },
            modifier = Modifier.padding(horizontal = Abstaende.gross).padding(bottom = Abstaende.mittel),
        )
    }
}

/** Kennzahl-Chips: Jahr, Teile, Minifiguren, Thema. */
internal fun LazyListScope.setDetailStatChips(set: SetAnsicht) {
    // ── Quick-stat chips ───────────────────────────────────────────────
    item {
        val labelYear     = stringResource(R.string.detail_year)
        val labelPieces   = stringResource(R.string.detail_pieces)
        val labelMinifigs = stringResource(R.string.detail_minifigs)
        val labelTheme    = stringResource(R.string.detail_theme)
        val chips = buildList {
            set.year?.let     { add(labelYear     to "$it")  }
            set.pieces?.let   { add(labelPieces   to fmtInt(it)) }
            set.minifigs?.let { add(labelMinifigs to "$it")  }
            set.theme?.let    { add(labelTheme    to it)     }
        }
        if (chips.isNotEmpty()) MetricsSeries(Modifier.padding(horizontal = Abstaende.gross).padding(bottom = Abstaende.mittel)) {
            chips.forEach { (label, value) -> StatChipV2(label = label, value = value) }
        }
    }
}

/** The large set image with retry attempt and zoom trigger. */
internal fun LazyListScope.setDetailHeroImage(
    set: SetAnsicht,
    imageUrl: String?,
    imageLoader: ImageLoader,
    /**
     * Retry attempt. As a MutableState and not an Int: the error branch
     * SETS it (`detailRetry.intValue = 1`) to make Coil try a second
     * time — a plain Int would only be a copy here.
     */
    detailRetry: androidx.compose.runtime.MutableIntState,
    detailScope: CoroutineScope,
    onZoom: () -> Unit,
) {
    // ── Hero image card ────────────────────────────────────────────────
    item {
        Card(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = Abstaende.gross, vertical = Abstaende.mittel),
            shape = Formen.chip,
            elevation = CardDefaults.cardElevation(defaultElevation = Formen.karteErhebungHoch),
            colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface)
        ) {
            SharedImage(set.setNumber) { bild ->
                ProduktBild(
                    model = imageUrl?.let {
                        coil3.request.ImageRequest.Builder(LocalContext.current)
                            .data(it)
                            .memoryCacheKeyExtra("retry", detailRetry.intValue.toString())
                            .crossfade(!movementReduced())
                            .build()
                    },
                    imageLoader = imageLoader,
                    contentDescription = set.name,
                    onState = { st ->
                        if (st is coil3.compose.AsyncImagePainter.State.Error && detailRetry.intValue == 0) {
                            detailScope.launch {
                                kotlinx.coroutines.delay(1000)
                                detailRetry.intValue = 1
                            }
                        }
                    },
                    modifier = bild
                        .fillMaxWidth()
                        .height(200.dp)
                        .clip(Formen.chip)
                        .clickable(enabled = imageUrl != null, onClickLabel = stringResource(R.string.cd_bild_vergroessern), role = Role.Button) { onZoom() },
                    contentScale = ContentScale.Fit,
                    fallbackSize = 64.dp,
                    // White background across the whole card width: the image otherwise stood narrower
                    // than its card, with hard edges on the left and right.
                    bildgrund = true,
                    innerGap = Abstaende.mittel,
                )
            }
        }
    }
}

/**
 * Price alert — "let me know when this set falls below X". Its own card, because the
 * alert belongs to the account, not the set, and doesn't move with it on a move.
 * Saved on typing after a quiet period (Alarmeingabe.RUHE_MS, in the
 * ViewModel so it survives leaving): on the phone the focus change
 * often never happens.
 */
internal fun LazyListScope.setDetailAlarmSection(
    setNumber: String,
    alerts: List<PriceAlertView>,
    currency: Waehrung,
    onSet: (setNumber: String, richtung: Alarmrichtung, roh: String, zustand: Zustand) -> Unit,
    /** Off, where the list itself already has a margin (watchlist-item detail). */
    outerGap: Boolean = true,
    /** The overview of all alerts; null hides the link. */
    onAllAlerts: (() -> Unit)? = null,
) {
    item {
        // For WHICH condition the alert applies. New and used often sit
        // far apart; whoever is looking for a used copy had no way
        // to wait for it until now.
        var zustand by rememberSaveable {
            mutableStateOf(ALARM_STATE_DEFAULT)
        }
        val alarm = alerts.firstOrNull { it.condition == zustand }
        SectionCard(title = stringResource(R.string.detail_alert), outerGap = outerGap) {
            // The condition switch only LOADS — it doesn't save. A switch
            // is the question "what's set for used?", not an input. If
            // it saved here, switching alone would already create an alert in the
            // new condition. That `alarm` hangs on the condition above
            // takes care of this on its own via loading: the list carries both.
            SegmentChoice(
                optionen = listOf(Zustand.NEU to stringResource(R.string.condition_new), Zustand.GEBRAUCHT to stringResource(R.string.condition_used)),
                gewaehlt = zustand,
                onWahl = { zustand = it },
            )
            Spacer(Modifier.height(Abstaende.klein))
            // Key is the alert itself: if one comes from the server (loaded
            // or just saved), the field should show it instead of keeping
            // the old text.
            var richtung by rememberSaveable(alarm?.richtung) {
                mutableStateOf(alarm?.richtung ?: Alarmrichtung.UNTER)
            }
            var schwelle by rememberSaveable(alarm?.schwelle) {
                mutableStateOf(alarm?.let { if (it.schwelle.positive) fmtEingabe(it.schwelle) else "" } ?: "")
            }

            // Segments instead of a picker field: exactly two options, both readable
            // without expanding. The direction only goes along if a threshold is given — otherwise
            // the call would amount to a delete.
            SegmentChoice(
                optionen = listOf(Alarmrichtung.UNTER to stringResource(R.string.detail_alert_chip_below),
                                  Alarmrichtung.UEBER to stringResource(R.string.detail_alert_chip_above)),
                gewaehlt = richtung,
                onWahl = { neu -> richtung = neu
                    if (schwelle.isNotBlank()) onSet(setNumber, neu, schwelle, zustand) },
            )
            // Below the chips at full width: next to them there was no room left at large font size.
            // Saved after the quiet period in the ViewModel (one call, not per keystroke); the
            // row below confirms what the server accepted.
            OutlinedTextField(
                value = schwelle,
                onValueChange = { roh ->
                    val g = NumericInput.price(roh)
                    schwelle = g; onSet(setNumber, richtung, g, zustand)
                },
                singleLine = true,
                label = { Text(stringResource(R.string.detail_alert_threshold, currency)) },
                supportingText = {
                    Text(
                        if (alarm == null) stringResource(R.string.detail_alert_hint)
                        // The marker says whether it's already been reported — otherwise you'd wonder why no more mail arrives.
                        else stringResource(
                            R.string.detail_alert_saved,
                            stringResource(if (alarm.richtung == Alarmrichtung.UEBER) R.string.detail_alert_above else R.string.detail_alert_below),
                            fmtMoney(alarm.schwelle, currency),
                            stringResource(if (alarm.ausgeloest) R.string.detail_alert_fired else R.string.detail_alert_armed),
                        )
                    )
                },
                keyboardOptions = NumericInput.priceKeyboard(),
                shape = Formen.feld,
                modifier = Modifier.fillMaxWidth(),
            )
            if (onAllAlerts != null) CrossLink(stringResource(R.string.wanted_all_alerts), onAllAlerts)
        }
    }
}

// Buy and price comparison don't sit on the set detail: it shows a set you
// own; both buttons live in the catalog and watchlist-item detail. The fields
// stay in the model because the server sends them and the watchlist reads them.
