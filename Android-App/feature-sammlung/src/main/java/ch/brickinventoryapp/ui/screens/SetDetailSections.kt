package ch.brickinventoryapp.ui.screens

import ch.brickinventoryapp.ui.components.AuswahlChip
/**
 * Die Abschnitte der Set-Detailseite. Erweiterungen auf LazyListScope und keine
 * Composables, weil sie Einträge in die LazyColumn der Seite eintragen; die
 * Inhalte darin sind Composables.
 */

import ch.brickinventoryapp.ui.model.KaufAnsicht
import ch.brickinventoryapp.ui.model.PreisverlaufAnsicht
import ch.brickinventoryapp.ui.model.SetAnsicht
import ch.brickinventoryapp.ui.model.SetPreisAnsicht
import ch.brickinventoryapp.ui.theme.Formen
import android.net.Uri
import android.widget.Toast
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import coil3.ImageLoader
import coil3.request.ImageRequest
import coil3.request.crossfade
import ch.brickinventoryapp.util.NumericInput
import ch.brickinventoryapp.ressourcen.R
import ch.brickinventoryapp.ui.viewmodel.SetDetailViewModel
import ch.brickinventoryapp.ui.*
import ch.brickinventoryapp.ui.SetDetailUiState
import kotlinx.coroutines.CoroutineScope
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.PictureAsPdf
import androidx.compose.material.icons.filled.Remove
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.ViewModule
import androidx.compose.material.icons.automirrored.filled.OpenInNew
import androidx.compose.runtime.mutableIntStateOf
import kotlinx.coroutines.launch
import ch.brickinventoryapp.ui.theme.Petrol
import androidx.compose.material.icons.filled.*
import ch.brickinventoryapp.ui.theme.Abstaende

/**
 * Anleitungen — ansehen, hinzufügen und entfernen. Die Karte steht auch ohne
 * Anleitung, weil sie den Weg trägt, eine erste hinzuzufügen.
 */
fun LazyListScope.setDetailInstructionsSection(
    set: SetAnsicht, detailState: SetDetailUiState, serverUrl: String,
    onOpenPdf: (url: String, title: String) -> Unit,
    onAnleitungWaehlen: () -> Unit,
    onAnleitungLoeschen: (Int) -> Unit,
) {
        // ── Instructions section ───────────────────────────────────────────
        val instructions = set.instructions
        run {
            item {
                SectionCard(
                    title = if (instructions.isNotEmpty())
                        stringResource(R.string.detail_instructions_with_count, instructions.size) else stringResource(R.string.detail_instructions)
                ) {
                    if (detailState.setDetailLoading && instructions.isEmpty()) {
                        Row(
                            horizontalArrangement = Arrangement.spacedBy(Abstaende.klein),
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            CircularProgressIndicator(Modifier.size(14.dp), strokeWidth = 2.dp)
                            Text(stringResource(R.string.common_loading),
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                    } else {
                        val ctx = LocalContext.current
                        // Siehe CatalogDetailScreen: Lint meldet
                        // LocalContextGetResourceValueCall als ERROR, weil ein
                        // gegriffener Context nach einem Wechsel der
                        // Konfiguration veraltete Werte liefern kann.
                        val keineAppText = stringResource(R.string.common_no_app_to_open)
                        instructions.forEachIndexed { idx, instr ->
                            // Kein `?token=` an der Adresse: Der Sitzungstoken läge sonst im
                            // Backstack, als Text unter der Anleitung und im Zugriffsprotokoll. Der
                            // In-App-Betrachter lädt über den geteilten Client, der den
                            // Authorization-Kopf setzt (di/ServerClient.kt).
                            val eigene = instr.localPath?.let { ch.brickinventoryapp.util.eigeneAdresse(serverUrl, it) }
                            val openUrl = eigene ?: instr.url

                            if (idx > 0) HorizontalDivider(
                                Modifier.padding(vertical = Abstaende.winzig),
                                color = MaterialTheme.colorScheme.outlineVariant
                            )
                            // Die ganze Zeile öffnet die Anleitung — sie sah aus wie ein Verweis.
                            // Das Symbol rechts ist nur ein Hinweis, kein zweites Ziel für dieselbe
                            // Handlung. Der Papierkorb liegt neben, nicht in der antippbaren Zeile,
                            // damit ein Fehlgriff nicht löscht.
                            val oeffneAnleitung: () -> Unit = {
                                if (eigene != null) {
                                    onOpenPdf(eigene, instr.description ?: "")
                                } else if (!ch.brickinventoryapp.util.oeffneExtern(ctx, instr.url)) {
                                    // Rückmeldung statt Stille, siehe CatalogDetailScreen.
                                    android.widget.Toast.makeText(ctx,
                                        keineAppText,
                                        android.widget.Toast.LENGTH_SHORT).show()
                                }
                            }
                            Row(
                                Modifier.fillMaxWidth(),
                                verticalAlignment = Alignment.CenterVertically,
                                horizontalArrangement = Arrangement.spacedBy(Abstaende.mittel)
                            ) {
                                Row(
                                    Modifier
                                        .weight(1f)
                                        // clickable VOR padding: So gehoert der
                                        // Innenabstand zur Antippflaeche, und der
                                        // Druckkreis deckt die ganze Zeilenhoehe.
                                        // Umgekehrt blieben oben und unten je ein
                                        // paar totes Pixel.
                                        .clickable(role = Role.Button, onClick = oeffneAnleitung)
                                        .padding(vertical = Abstaende.winzig),
                                    verticalAlignment = Alignment.CenterVertically,
                                    horizontalArrangement = Arrangement.spacedBy(Abstaende.mittel)
                                ) {
                                    Surface(
                                        shape = Formen.kachel,
                                        color = MaterialTheme.colorScheme.errorContainer.copy(alpha = 0.5f),
                                        modifier = Modifier.size(38.dp)
                                    ) {
                                        Box(Modifier.fillMaxSize(), Alignment.Center) {
                                            Icon(
                                                Icons.Default.PictureAsPdf, null,
                                                tint = MaterialTheme.colorScheme.error,
                                                modifier = Modifier.size(20.dp)
                                            )
                                        }
                                    }
                                    Column(Modifier.weight(1f)) {
                                        Text(
                                            instr.description ?: stringResource(R.string.detail_instruction_default),
                                            style = MaterialTheme.typography.bodyMedium,
                                            fontWeight = FontWeight.Medium,
                                            maxLines = 2,
                                            overflow = TextOverflow.Ellipsis
                                        )
                                        Text(
                                            openUrl,
                                            style = MaterialTheme.typography.labelSmall,
                                            color = MaterialTheme.colorScheme.primary,
                                            maxLines = 1,
                                            overflow = TextOverflow.Ellipsis
                                        )
                                    }
                                    // Dieselbe Flaeche wie der frühere Knopf, damit
                                    // die Zeilen so breit bleiben wie bisher.
                                    Box(Modifier.size(36.dp), Alignment.Center) {
                                        Icon(
                                            Icons.AutoMirrored.Filled.OpenInNew, null,
                                            tint = MaterialTheme.colorScheme.onSurfaceVariant,
                                            modifier = Modifier.size(18.dp)
                                        )
                                    }
                                }
                                // Entfernen nur bei selbst hochgeladenen Anleitungen (`isManual`):
                                // Beide Quellen bringen eine `id`, und weil ihre Zähler unabhängig
                                // laufen, könnte ein Klick sonst die gleichnamige eigene Anleitung
                                // treffen.
                                val id = instr.id
                                if (id != null && instr.isManual) {
                                    IconButton(
                                        onClick = { onAnleitungLoeschen(id) },
                                    ) {
                                        Icon(
                                            Icons.Default.Delete,
                                            stringResource(R.string.instr_delete),
                                            tint = MaterialTheme.colorScheme.error,
                                            modifier = Modifier.size(18.dp)
                                        )
                                    }
                                }
                            }
                        }
                        // Der Weg, eine erste Anleitung hinzuzufügen — unter der Liste, weil das
                        // Ansehen häufiger ist; volle Breite wie die übrigen Aktionen der Karte.
                        OutlinedButton(
                            onClick = onAnleitungWaehlen,
                            modifier = Modifier.fillMaxWidth().padding(top = Abstaende.klein),
                            shape = Formen.knopf
                        ) {
                            Icon(Icons.Default.Add, null, Modifier.size(18.dp))
                            Spacer(Modifier.width(Abstaende.klein))
                            Text(stringResource(R.string.instr_upload))
                        }
                    }
                }
            }
        }
}

/**
 * Marktpreis je Zustand und Verlauf. Die grosse Preiszeile steht nicht mehr hier: Markt-,
 * Kaufpreis und G&V stehen in jedem Design in den Wert-Kacheln oben, eine Zeile hier
 * wiederholte sie mit einer Prozentangabe aus dem Gesamtvergleich über den Zeilen je Zustand.
 */
fun LazyListScope.setDetailPriceSection(detailState: SetDetailUiState, price: SetPreisAnsicht?, history: PreisverlaufAnsicht?, currency: String) {
    if (price != null && !price.noPrice || detailState.setPriceLoading) {
        item {
            SectionCard(title = stringResource(R.string.detail_section_market)) {
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
        }
    }
}

/** Stammdaten: Nummer, Menge (änderbar), Erfassungsdatum. */
fun LazyListScope.setDetailDetailsSection(set: SetAnsicht, setNumber: String, vm: SetDetailViewModel, acquisitions: List<KaufAnsicht>, currency: String, fmtDate: (String?) -> String, onNavigateToAcqMgmt: (type: String, id: String, colorId: Int, title: String) -> Unit) {
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
            val lagerZustand by vm.lagerState.collectAsStateWithLifecycle()
            LaunchedEffect(setNumber, set.owners) {
                vm.loadLagerortVorrat(set.owners.map { it.id })
            }
            // Bei grosser Schrift steht das Feld unter der Bezeichnung in voller Breite:
            // 180 dp neben „Lagerort“ reichten bei 200 % nicht einmal für den Platzhalter.
            val lagerBezeichnung: @Composable () -> Unit = {
                Text(stringResource(R.string.detail_storage),
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    style = MaterialTheme.typography.bodyMedium)
            }
            if (ch.brickinventoryapp.ui.components.grosseSchrift()) {
                Column(Modifier.fillMaxWidth().padding(vertical = Abstaende.haar),
                       verticalArrangement = Arrangement.spacedBy(Abstaende.winzig)) {
                    lagerBezeichnung()
                    LagerortFeld(
                        wert = set.storage ?: "",
                        vorrat = lagerZustand.vorrat.map { it.name },
                        onWert = { vm.setzeSetLagerort(setNumber, it) },
                        modifier = Modifier.fillMaxWidth(),
                    )
                }
            } else Row(Modifier.fillMaxWidth().padding(vertical = Abstaende.haar),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically) {
                lagerBezeichnung()
                LagerortFeld(
                    wert = set.storage ?: "",
                    vorrat = lagerZustand.vorrat.map { it.name },
                    onWert = { vm.setzeSetLagerort(setNumber, it) },
                    modifier = Modifier.padding(start = Abstaende.gross).widthIn(max = 180.dp),
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
                    FilledTonalIconButton(
                        onClick = { if (qty > 1) { qty--; vm.aendereMengeUm(set.setNumber, -1) } },
                        shape = Formen.etikett
                    ) {
                        Icon(Icons.Default.Remove, stringResource(R.string.cd_qty_decrease),
                            Modifier.size(ch.brickinventoryapp.ui.components.mitSchrift(18.dp)))
                    }
                    Text(
                        "$qty",
                        fontWeight = FontWeight.Bold,
                        style = MaterialTheme.typography.bodyLarge,
                        modifier = Modifier.widthIn(min = 24.dp),
                        textAlign = TextAlign.Center
                    )
                    FilledTonalIconButton(
                        onClick = { qty++; vm.aendereMengeUm(set.setNumber, 1) },
                        shape = Formen.etikett
                    ) {
                        Icon(Icons.Default.Add, stringResource(R.string.cd_qty_increase),
                            Modifier.size(ch.brickinventoryapp.ui.components.mitSchrift(18.dp)))
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
                    onNavigateToAcqMgmt("set", capturedSetNumber, 0, capturedSetTitle)
                }
            )
        }
    }

}

/** Wert-Kacheln über den Angaben — in jedem Design (WertKacheln, core-ui). */
fun LazyListScope.setDetailValueTiles(set: SetAnsicht, price: SetPreisAnsicht?, pnlPct: Double?, fmtPrice: (Double?) -> String) {
    item(key = "wertkacheln") {
        WertKacheln(
            // avg_price zuerst: Marktpreis ist der einfache Schnitt, nicht der mengengewichtete.
            markt = fmtPrice(price?.takeUnless { it.noPrice }?.let { it.avgPrice ?: it.qtyAvgPrice }),
            kauf = fmtPrice(set.anzeigeKaufpreis),
            pnl = pnlPct,
            modifier = Modifier.padding(horizontal = Abstaende.gross).padding(bottom = Abstaende.mittel),
        )
    }
}

/** Kennzahl-Chips: Jahr, Teile, Minifiguren, Thema. */
fun LazyListScope.setDetailStatChips(set: SetAnsicht) {
    // ── Quick-stat chips ───────────────────────────────────────────────
    item {
        val labelYear     = stringResource(R.string.detail_year)
        val labelPieces   = stringResource(R.string.detail_pieces)
        val labelMinifigs = stringResource(R.string.detail_minifigs)
        val labelTheme    = stringResource(R.string.detail_theme)
        val chips = buildList {
            set.year?.let     { add(labelYear     to "$it")  }
            set.pieces?.let   { add(labelPieces   to ch.brickinventoryapp.util.fmtInt(it)) }
            set.minifigs?.let { add(labelMinifigs to "$it")  }
            set.theme?.let    { add(labelTheme    to it)     }
        }
        if (chips.isNotEmpty()) KennzahlenReihe(Modifier.padding(horizontal = Abstaende.gross).padding(bottom = Abstaende.mittel)) {
            chips.forEach { (label, value) -> StatChipV2(label = label, value = value) }
        }
    }

}

/** Das grosse Set-Bild samt Nachladeversuch und Zoom-Auslöser. */
fun LazyListScope.setDetailHeroImage(
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
            ch.brickinventoryapp.ui.components.GemeinsamesBild(set.setNumber) { bild ->
                ch.brickinventoryapp.ui.components.ProduktBild(
                    model = imageUrl?.let {
                        coil3.request.ImageRequest.Builder(LocalContext.current)
                            .data(it)
                            .memoryCacheKeyExtra("retry", detailRetry.intValue.toString())
                            .crossfade(true)
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
                        .clickable(enabled = imageUrl != null, role = Role.Button) { onZoom() },
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
fun LazyListScope.setDetailAlarmSection(
    setNumber: String,
    alarme: List<ch.brickinventoryapp.ui.model.PreisalarmAnsicht>,
    currency: String,
    onSetze: (setNumber: String, richtung: String, roh: String, zustand: String) -> Unit,
    /** Aus, wo die Liste selbst schon einen Rand hat (Merkposten-Detail). */
    aussenAbstand: Boolean = true,
) {
    item {
        // Fuer WELCHEN Zustand der Alarm gilt. Neu und gebraucht liegen oft
        // um ein Vielfaches auseinander; wer ein gebrauchtes Exemplar sucht,
        // hatte bisher keine Moeglichkeit, darauf zu warten.
        var zustand by rememberSaveable {
            mutableStateOf(ch.brickinventoryapp.ui.ALARM_ZUSTAND_VORGABE)
        }
        val alarm = alarme.firstOrNull { it.condition == zustand }
        SectionCard(title = stringResource(R.string.detail_alert), aussenAbstand = aussenAbstand) {
            // Der Zustandswechsel LAEDT nur — er speichert nicht. Ein Wechsel
            // ist die Frage „was steht fuer gebraucht?", keine Eingabe. Wuerde
            // hier gespeichert, legte schon das Umschalten einen Alarm im
            // neuen Zustand an. Dass `alarm` oben am Zustand haengt, erledigt
            // das Laden von selbst: Die Liste traegt beide.
            ch.brickinventoryapp.ui.components.SegmentWahl(
                optionen = listOf("N" to stringResource(R.string.condition_new), "U" to stringResource(R.string.condition_used)),
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
                mutableStateOf(alarm?.let { if (it.schwelle > 0) it.schwelle.toString() else "" } ?: "")
            }

            // Segmente statt eines Auswahlfelds: genau zwei Möglichkeiten, beide ohne
            // Aufklappen lesbar. Die Richtung geht nur mit, wenn eine Schwelle dasteht — sonst
            // liefe der Aufruf auf ein Löschen hinaus.
            ch.brickinventoryapp.ui.components.SegmentWahl(
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
                            ch.brickinventoryapp.util.fmtMoney(alarm.schwelle, currency),
                            stringResource(if (alarm.ausgeloest) R.string.detail_alert_fired else R.string.detail_alert_armed),
                        )
                    )
                },
                keyboardOptions = NumericInput.preisTastatur(),
                modifier = Modifier.fillMaxWidth(),
            )
        }
    }
}

// Kaufen und Preisvergleich stehen nicht am Set-Detail: Es zeigt ein Set, das man
// besitzt; beide Knöpfe gibt es im Katalog- und im Merkposten-Detail. Die Felder
// bleiben im Modell, weil der Server sie schickt und die Merkliste sie liest.
