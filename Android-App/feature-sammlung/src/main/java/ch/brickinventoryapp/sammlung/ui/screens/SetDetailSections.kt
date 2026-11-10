package ch.brickinventoryapp.sammlung.ui.screens

import ch.brickinventoryapp.model.fach.Waehrung
import ch.brickinventoryapp.model.fach.Postenart
import ch.brickinventoryapp.model.fach.Zustand

/**
 * Die Abschnitte der Set-Detailseite. Erweiterungen auf LazyListScope und keine
 * Composables, weil sie Einträge in die LazyColumn der Seite eintragen; die
 * Inhalte darin sind Composables.
 */

import ch.brickinventoryapp.model.ui.model.KaufAnsicht
import ch.brickinventoryapp.model.ui.model.PreisverlaufAnsicht
import ch.brickinventoryapp.model.ui.model.SetAnsicht
import ch.brickinventoryapp.model.ui.model.SetPreisAnsicht
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
import ch.brickinventoryapp.ressourcen.R
import ch.brickinventoryapp.sammlung.ui.viewmodel.SetDetailAktionen
import ch.brickinventoryapp.model.ui.*
import ch.brickinventoryapp.sammlung.ui.*
import ch.brickinventoryapp.ui.*
import ch.brickinventoryapp.zustand.ui.*
import ch.brickinventoryapp.sammlung.ui.SetDetailUiState
import kotlinx.coroutines.CoroutineScope
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Remove
import androidx.compose.material.icons.filled.Add
import androidx.compose.runtime.mutableIntStateOf
import kotlinx.coroutines.launch
import androidx.compose.material.icons.filled.*
import ch.brickinventoryapp.ui.theme.Abstaende
import ch.brickinventoryapp.sammlung.ui.ALARM_ZUSTAND_VORGABE
import ch.brickinventoryapp.ui.components.GemeinsamesBild
import ch.brickinventoryapp.ui.components.MitTooltip
import ch.brickinventoryapp.ui.components.ProduktBild
import ch.brickinventoryapp.ui.components.SegmentWahl
import ch.brickinventoryapp.ui.components.bewegungReduziert
import ch.brickinventoryapp.ui.components.grosseSchrift
import ch.brickinventoryapp.ui.components.mitSchrift
import ch.brickinventoryapp.model.ui.model.PreisalarmAnsicht
import ch.brickinventoryapp.ui.util.fmtEingabe
import ch.brickinventoryapp.ui.util.fmtInt
import ch.brickinventoryapp.ui.util.fmtMoney
import ch.brickinventoryapp.gemeinsam.ui.AcquisitionSummarySection
import ch.brickinventoryapp.gemeinsam.ui.DetailRow2
import ch.brickinventoryapp.gemeinsam.ui.KennzahlenReihe
import ch.brickinventoryapp.gemeinsam.ui.LagerortFeld
import ch.brickinventoryapp.gemeinsam.ui.MarketPriceByCondition
import ch.brickinventoryapp.gemeinsam.ui.PreisLaedtZeile
import ch.brickinventoryapp.gemeinsam.ui.PriceChart
import ch.brickinventoryapp.gemeinsam.ui.SectionCard
import ch.brickinventoryapp.gemeinsam.ui.StatChipV2
import ch.brickinventoryapp.gemeinsam.ui.WertKacheln

/**
 * Marktpreis je Zustand und Verlauf. Die grosse Preiszeile steht nicht mehr hier: Markt-,
 * Kaufpreis und G&V stehen in jedem Design in den Wert-Kacheln oben, eine Zeile hier
 * wiederholte sie mit einer Prozentangabe aus dem Gesamtvergleich über den Zeilen je Zustand.
 */
internal fun LazyListScope.setDetailPriceSection(detailState: SetDetailUiState, price: SetPreisAnsicht?, history: PreisverlaufAnsicht?, currency: Waehrung) {
    if (price != null && !price.noPrice || detailState.setPriceLoading) {
        item {
            // „Preisverlauf“, sobald ein Verlauf da ist: Direkt über der Karte steht schon
            // die Kachel „Marktpreis“, zweimal derselbe Titel las sich wie ein Doppel.
            val verlauf = history?.chart?.values?.isNotEmpty() == true || detailState.priceHistoryLoading
            SectionCard(title = stringResource(if (verlauf) R.string.detail_section_price_history else R.string.detail_section_market)) {
                PreisKarteInhalt(detailState, price, history, currency)
            }
        }
    }
}

@Composable
private fun PreisKarteInhalt(detailState: SetDetailUiState, price: SetPreisAnsicht?, history: PreisverlaufAnsicht?, currency: Waehrung) {
    if (detailState.setPriceLoading && price == null) {
        PreisLaedtZeile()
    } else if (price != null && !price.noPrice) {
        // Je Zustand eine Zeile, aber nur bei mehr als einem: Mit einem einzigen
        // Zustand stünden Preis und G&V der Wert-Kacheln oben gleich noch einmal da.
        history?.byCondition?.let { byCond ->
            if (byCond.present().size > 1) MarketPriceByCondition(byCond, currency)
        }
        // Preis und Verlauf sind zwei Abrufe; der Hinweis verhindert, dass das
        // Diagramm später kommentarlos in die Karte springt.
        val chart = history?.chart
        if (chart != null && chart.values.isNotEmpty()) {
            Spacer(Modifier.height(Abstaende.klein))
            PriceChart(chart, currency)
        } else if (detailState.priceHistoryLoading) {
            Spacer(Modifier.height(Abstaende.klein))
            PreisLaedtZeile()
        }
    }
}

/** Stammdaten: Nummer, Menge (änderbar), Erfassungsdatum. */
internal fun LazyListScope.setDetailDetailsSection(set: SetAnsicht, setNumber: String, lagerZustand: LagerUiState, aktionen: SetDetailAktionen, acquisitions: List<KaufAnsicht>, currency: Waehrung, fmtDate: (String?) -> String, onNavigateToAcqMgmt: (type: Postenart, id: String, colorId: Int, title: String) -> Unit) {
    // ── Set details section ────────────────────────────────────────────
    item {
        SectionCard(title = stringResource(R.string.detail_section_details)) {
            DetailRow2(stringResource(R.string.detail_set_number), setNumber)
            // Ohne Datum keine Zeile: „Hinzugefügt —“ sagt nichts.
            if (!set.addedAt.isNullOrBlank()) DetailRow2(stringResource(R.string.detail_added), fmtDate(set.addedAt))
            // ── Lagerort ──
            //
            // Auswahlfeld mit der Möglichkeit, neue Orte zu erfassen. Die Liste gehört dem
            // Besitzer des Sets, nicht dem Betrachter (siehe loadLagerortVorrat()).
            LaunchedEffect(setNumber, set.owners) {
                aktionen.loadLagerortVorrat(set.owners.map { it.id })
            }
            // Bei grosser Schrift steht das Feld unter der Bezeichnung in voller Breite:
            // 180 dp neben „Lagerort“ reichten bei 200 % nicht einmal für den Platzhalter.
            val lagerBezeichnung: @Composable () -> Unit = {
                Text(stringResource(R.string.detail_storage),
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    style = MaterialTheme.typography.bodyMedium)
            }
            if (grosseSchrift()) {
                Column(Modifier.fillMaxWidth().padding(vertical = Abstaende.haar),
                       verticalArrangement = Arrangement.spacedBy(Abstaende.winzig)) {
                    lagerBezeichnung()
                    LagerortFeld(
                        wert = set.storage ?: "",
                        vorrat = lagerZustand.vorrat.map { it.name },
                        onWert = { aktionen.setzeSetLagerort(setNumber, it) },
                        modifier = Modifier.fillMaxWidth(),
                    )
                }
            } else Row(Modifier.fillMaxWidth()
                    .padding(vertical = Abstaende.haar),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically) {
                lagerBezeichnung()
                LagerortFeld(
                    wert = set.storage ?: "",
                    vorrat = lagerZustand.vorrat.map { it.name },
                    onWert = { aktionen.setzeSetLagerort(setNumber, it) },
                    // Der ganze Rest der Zeile: Mit fester Breite war „No storage location“
                    // abgeschnitten, und auf dem Tablet stand das Feld halb so breit wie die Karte.
                    modifier = Modifier.padding(start = Abstaende.gross).weight(1f),
                )
            }
            HorizontalDivider(
                Modifier.padding(vertical = Abstaende.winzig),
                color = MaterialTheme.colorScheme.outlineVariant
            )
            // Mengenregler, an set.quantity gekoppelt: Der Server kann eine Verringerung
            // deckeln und meldet die wirkliche Menge zurück; ohne die Kopplung behielte der
            // Regler seine Annahme.
            var qty by remember(set.setNumber, set.quantity) { mutableIntStateOf(set.quantity) }
            // Ein leiser Takt je Schritt: Die Zahl ändert sich, ohne dass man hinsehen muss.
            val haptik = androidx.compose.ui.platform.LocalHapticFeedback.current
            val takt = { haptik.performHapticFeedback(androidx.compose.ui.hapticfeedback.HapticFeedbackType.SegmentTick) }
            Row(
                Modifier.fillMaxWidth().padding(vertical = Abstaende.winzig),
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
                        FilledTonalIconButton(
                            onClick = { if (qty > 1) { qty--; takt(); aktionen.aendereMengeUm(set.setNumber, -1) } },
                            shape = Formen.etikett
                        ) {
                            Icon(Icons.Default.Remove, stringResource(R.string.cd_qty_decrease),
                                Modifier.size(mitSchrift(18.dp)))
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
                        FilledTonalIconButton(
                            onClick = { qty++; takt(); aktionen.aendereMengeUm(set.setNumber, 1) },
                            shape = Formen.etikett
                        ) {
                            Icon(Icons.Default.Add, stringResource(R.string.cd_qty_increase),
                                Modifier.size(mitSchrift(18.dp)))
                        }
                    }
                }
            }

            // Kaufpreis — kompakte Zusammenfassung + Button zum Verwalten
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

/** Wert-Kacheln über den Angaben — in jedem Design (WertKacheln, core-ui). */
internal fun LazyListScope.setDetailValueTiles(set: SetAnsicht, price: SetPreisAnsicht?, pnlPct: Double?, fmtPrice: (Double?) -> String) {
    item(key = "wertkacheln") {
        // avg_price zuerst: Marktpreis ist der einfache Schnitt, nicht der mengengewichtete.
        val marktpreis = price?.takeUnless { it.noPrice }?.let { it.avgPrice ?: it.qtyAvgPrice }
        val kaufpreis = set.anzeigeKaufpreis
        val differenz = if (marktpreis != null && kaufpreis != null) marktpreis - kaufpreis else null
        WertKacheln(
            markt = fmtPrice(marktpreis),
            kauf = fmtPrice(kaufpreis),
            pnl = pnlPct,
            pnlBetrag = differenz?.let { (if (it > 0) "+" else "") + fmtPrice(it) },
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
        if (chips.isNotEmpty()) KennzahlenReihe(Modifier.padding(horizontal = Abstaende.gross).padding(bottom = Abstaende.mittel)) {
            chips.forEach { (label, value) -> StatChipV2(label = label, value = value) }
        }
    }
}

/** Das grosse Set-Bild samt Nachladeversuch und Zoom-Auslöser. */
internal fun LazyListScope.setDetailHeroImage(
    set: SetAnsicht,
    imageUrl: String?,
    imageLoader: ImageLoader,
    /**
     * Nachladeversuch. Als MutableState und nicht als Int: Der Fehlerzweig
     * SETZT ihn (`detailRetry.intValue = 1`), um Coil zu einem zweiten Anlauf zu
     * bewegen — ein einfacher Int wäre hier nur eine Kopie.
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
            GemeinsamesBild(set.setNumber) { bild ->
                ProduktBild(
                    model = imageUrl?.let {
                        coil3.request.ImageRequest.Builder(LocalContext.current)
                            .data(it)
                            .memoryCacheKeyExtra("retry", detailRetry.intValue.toString())
                            .crossfade(!bewegungReduziert())
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
                    ersatzGroesse = 64.dp,
                    // Weisser Grund über die ganze Kartenbreite: Das Bild stand sonst schmaler
                    // als seine Karte, mit harten Kanten links und rechts.
                    bildgrund = true,
                    innenAbstand = Abstaende.mittel,
                )
            }
        }
    }
}

/**
 * Preisalarm — „sag Bescheid, wenn das Set unter X fällt“. Eigene Karte, weil der
 * Alarm zum Konto gehört, nicht zum Set, und beim Verschieben nicht mitwandert.
 * Gespeichert wird beim Tippen nach einer Ruhezeit (Alarmeingabe.RUHE_MS, im
 * ViewModel, damit sie das Verlassen überlebt): Am Telefon kommt der Fokuswechsel
 * oft nie.
 */
internal fun LazyListScope.setDetailAlarmSection(
    setNumber: String,
    alarme: List<PreisalarmAnsicht>,
    currency: Waehrung,
    onSetze: (setNumber: String, richtung: String, roh: String, zustand: Zustand) -> Unit,
    /** Aus, wo die Liste selbst schon einen Rand hat (Merkposten-Detail). */
    aussenAbstand: Boolean = true,
) {
    item {
        // Fuer WELCHEN Zustand der Alarm gilt. Neu und gebraucht liegen oft
        // um ein Vielfaches auseinander; wer ein gebrauchtes Exemplar sucht,
        // hatte bisher keine Moeglichkeit, darauf zu warten.
        var zustand by rememberSaveable {
            mutableStateOf(ALARM_ZUSTAND_VORGABE)
        }
        val alarm = alarme.firstOrNull { it.condition == zustand }
        SectionCard(title = stringResource(R.string.detail_alert), aussenAbstand = aussenAbstand) {
            // Der Zustandswechsel LAEDT nur — er speichert nicht. Ein Wechsel
            // ist die Frage „was steht fuer gebraucht?", keine Eingabe. Wuerde
            // hier gespeichert, legte schon das Umschalten einen Alarm im
            // neuen Zustand an. Dass `alarm` oben am Zustand haengt, erledigt
            // das Laden von selbst: Die Liste traegt beide.
            SegmentWahl(
                optionen = listOf(Zustand.NEU to stringResource(R.string.condition_new), Zustand.GEBRAUCHT to stringResource(R.string.condition_used)),
                gewaehlt = zustand,
                onWahl = { zustand = it },
            )
            Spacer(Modifier.height(Abstaende.klein))
            // Schluessel ist der Alarm selbst: Kommt einer vom Server (geladen
            // oder gerade gespeichert), soll das Feld ihn zeigen statt den
            // alten Text zu behalten.
            var richtung by rememberSaveable(alarm?.richtung) {
                mutableStateOf(alarm?.richtung ?: "unter")
            }
            var schwelle by rememberSaveable(alarm?.schwelle) {
                mutableStateOf(alarm?.let { if (it.schwelle > 0) fmtEingabe(it.schwelle) else "" } ?: "")
            }

            // Segmente statt eines Auswahlfelds: genau zwei Möglichkeiten, beide ohne
            // Aufklappen lesbar. Die Richtung geht nur mit, wenn eine Schwelle dasteht — sonst
            // liefe der Aufruf auf ein Löschen hinaus.
            SegmentWahl(
                optionen = listOf("unter" to stringResource(R.string.detail_alert_chip_below),
                                  "ueber" to stringResource(R.string.detail_alert_chip_above)),
                gewaehlt = richtung,
                onWahl = { neu -> richtung = neu
                    if (schwelle.isNotBlank()) onSetze(setNumber, neu, schwelle, zustand) },
            )
            // Unter den Chips in voller Breite: neben ihnen blieb bei grosser Schrift kein Platz.
            // Gespeichert wird nach der Ruhezeit im ViewModel (ein Aufruf, nicht je Taste); die
            // Zeile darunter bestätigt, was der Server angenommen hat.
            OutlinedTextField(
                value = schwelle,
                onValueChange = { roh ->
                    val g = NumericInput.price(roh)
                    schwelle = g; onSetze(setNumber, richtung, g, zustand)
                },
                singleLine = true,
                label = { Text(stringResource(R.string.detail_alert_threshold, currency)) },
                supportingText = {
                    Text(
                        if (alarm == null) stringResource(R.string.detail_alert_hint)
                        // Der Merker sagt, ob schon gemeldet wurde — sonst fragt man sich, warum keine Mail mehr kommt.
                        else stringResource(
                            R.string.detail_alert_saved,
                            stringResource(if (alarm.richtung == "ueber") R.string.detail_alert_above else R.string.detail_alert_below),
                            fmtMoney(alarm.schwelle, currency),
                            stringResource(if (alarm.ausgeloest) R.string.detail_alert_fired else R.string.detail_alert_armed),
                        )
                    )
                },
                keyboardOptions = NumericInput.preisTastatur(),
                shape = Formen.feld,
                modifier = Modifier.fillMaxWidth(),
            )
        }
    }
}

// Kaufen und Preisvergleich stehen nicht am Set-Detail: Es zeigt ein Set, das man
// besitzt; beide Knöpfe gibt es im Katalog- und im Merkposten-Detail. Die Felder
// bleiben im Modell, weil der Server sie schickt und die Merkliste sie liest.
