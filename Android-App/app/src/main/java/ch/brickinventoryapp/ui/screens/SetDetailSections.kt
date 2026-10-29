package ch.brickinventoryapp.ui.screens

/**
 * Die Abschnitte der Set-Detailseite. Erweiterungen auf LazyListScope und keine
 * Composables, weil sie Einträge in die LazyColumn der Seite eintragen; die
 * Inhalte darin sind Composables.
 */

import ch.brickinventoryapp.ui.theme.Formen
import android.content.Intent
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
import coil3.compose.AsyncImage
import coil3.request.ImageRequest
import coil3.request.crossfade
import ch.brickinventoryapp.util.NumericInput
import ch.brickinventoryapp.R
import ch.brickinventoryapp.data.model.Acquisition
import ch.brickinventoryapp.data.model.PriceHistoryResponse
import ch.brickinventoryapp.data.model.SetItem
import ch.brickinventoryapp.data.model.SetPriceResponse
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
import ch.brickinventoryapp.ui.theme.BrickStatTile
import ch.brickinventoryapp.ui.theme.Petrol
import ch.brickinventoryapp.ui.theme.SlateBlue
import androidx.compose.material.icons.filled.*
import androidx.core.net.toUri
import ch.brickinventoryapp.ui.theme.Abstaende

/**
 * Anleitungen — ansehen, hinzufügen und entfernen. Die Karte steht auch ohne
 * Anleitung, weil sie den Weg trägt, eine erste hinzuzufügen.
 */
fun LazyListScope.setDetailInstructionsSection(
    set: SetItem, detailState: SetDetailUiState, serverUrl: String,
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
                            val openUrl = instr.localPath?.let { "$serverUrl$it" } ?: instr.url

                            if (idx > 0) HorizontalDivider(
                                Modifier.padding(vertical = Abstaende.winzig),
                                color = MaterialTheme.colorScheme.outlineVariant
                            )
                            // Die ganze Zeile öffnet die Anleitung — sie sah aus wie ein Verweis.
                            // Das Symbol rechts ist nur ein Hinweis, kein zweites Ziel für dieselbe
                            // Handlung. Der Papierkorb liegt neben, nicht in der antippbaren Zeile,
                            // damit ein Fehlgriff nicht löscht.
                            val oeffneAnleitung: () -> Unit = {
                                if (instr.localPath != null) {
                                    onOpenPdf(openUrl, instr.description ?: "")
                                } else {
                                    // Rückmeldung statt Stille, siehe CatalogDetailScreen.
                                    try { ctx.startActivity(Intent(Intent.ACTION_VIEW, openUrl.toUri())) }
                                    catch (_: Exception) {
                                        android.widget.Toast.makeText(ctx,
                                            keineAppText,
                                            android.widget.Toast.LENGTH_SHORT).show()
                                    }
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

/** Marktpreis, Kaufpreis, Gewinn/Verlust und der Preisverlauf. */
/**
 * `fmtPrice`, `fmtDate` und `serverUrl` kommen als Parameter aus
 * SetDetailScreen(), damit die Währung an einer Stelle aufgelöst wird.
 */
fun LazyListScope.setDetailPriceSection(set: SetItem, detailState: SetDetailUiState, price: SetPriceResponse?, history: PriceHistoryResponse?, pnlPct: String?, currency: String, isBrick: Boolean, fmtPrice: (Double?) -> String) {
    // ── Price section ──────────────────────────────────────────────────
    if (price != null && !price.noPrice || detailState.setPriceLoading) {
        item {
            SectionCard(title = stringResource(R.string.detail_section_market)) {
                if (detailState.setPriceLoading && price == null) {
                    PreisLaedtZeile()
                } else if (price != null && !price.noPrice) {
                    // Die grosse Preiszeile nur ohne die Wert-Kacheln: Im Stein-Design stehen
                    // Markt- und Kaufpreis schon in den Kacheln oben, und ihre Prozentangabe
                    // (Gesamtvergleich) stünde über den Zeilen je Zustand. Im klassischen Design
                    // gibt es die Kacheln nicht, dort bleibt sie.
                    val zeigeGrossePreiszeile = !isBrick
                    if (zeigeGrossePreiszeile) {
                        Text(
                            fmtPrice(price.avgPrice ?: price.qtyAvgPrice),
                            style = MaterialTheme.typography.headlineSmall,
                            fontWeight = FontWeight.Bold,
                            color = MaterialTheme.colorScheme.primary
                        )
                        val pct = pnlPct?.toDoubleOrNull()
                        if (pct != null) {
                            Spacer(Modifier.height(Abstaende.winzig))
                            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Abstaende.klein)) {
                                PnlBadge(pct)
                                // Mengengewichtet über die Erfassungen — dieselbe Grösse, gegen die
                                // die Prozentangabe daneben rechnet.
                                val shownPurchase = set.anzeigeKaufpreis
                                if (shownPurchase != null) {
                                    Text(
                                        stringResource(R.string.finance_purchase_short, fmtPrice(shownPurchase)),
                                        style = MaterialTheme.typography.labelMedium,
                                        color = MaterialTheme.colorScheme.onSurfaceVariant
                                    )
                                }
                            }
                        }
                    }

                    // ── Marktpreis je Zustand ────────────────────────
                    // Wer ein Exemplar neu und eines gebraucht besitzt,
                    // braucht beide Zahlen — der Server liefert je
                    // Zustand eine Zeile, aber nur dort, wo auch ein
                    // Kaufpreis erfasst ist.
                    history?.byCondition?.let { byCond ->
                        if (byCond.present().isNotEmpty()) {
                            // Trennlinie nur, wenn oben etwas steht,
                            // von dem zu trennen wäre.
                            if (zeigeGrossePreiszeile) {
                                Spacer(Modifier.height(Abstaende.klein))
                                HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                                Spacer(Modifier.height(Abstaende.winzig))
                            }
                            MarketPriceByCondition(byCond, currency)
                        }
                    }

                    // ── Verlauf: eine Linie je Zustand ──
                    //
                    // Preis und Verlauf sind zwei Abrufe; der Hinweis verhindert, dass das Diagramm
                    // später kommentarlos in die Karte springt.
                    val chart = history?.chart
                    if (chart != null && chart.values.isNotEmpty()) {
                        Spacer(Modifier.height(Abstaende.klein))
                        PriceChart(chart)
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
fun LazyListScope.setDetailDetailsSection(set: SetItem, setNumber: String, vm: SetDetailViewModel, acquisitions: List<Acquisition>, currency: String, fmtDate: (String?) -> String, onNavigateToAcqMgmt: (type: String, id: String, colorId: Int, title: String) -> Unit) {
    // ── Set details section ────────────────────────────────────────────
    item {
        SectionCard(title = stringResource(R.string.detail_section_details)) {
            DetailRow2(stringResource(R.string.detail_set_number), setNumber)
            DetailRow2(stringResource(R.string.detail_added), fmtDate(set.addedAt))
            // ── Lagerort ──
            //
            // Auswahlfeld mit der Möglichkeit, neue Orte zu erfassen. Die Liste gehört dem
            // Besitzer des Sets, nicht dem Betrachter (siehe loadLagerortVorrat()).
            val lagerZustand by vm.lagerState.collectAsStateWithLifecycle()
            LaunchedEffect(setNumber, set.owners) {
                vm.loadLagerortVorrat(set.owners.map { it.id })
            }
            Row(Modifier.fillMaxWidth().padding(vertical = Abstaende.haar),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically) {
                Text(stringResource(R.string.detail_storage),
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    style = MaterialTheme.typography.bodyMedium)
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
                        Icon(Icons.Default.Remove, stringResource(R.string.cd_qty_decrease), Modifier.size(14.dp))
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
                        Icon(Icons.Default.Add, stringResource(R.string.cd_qty_increase), Modifier.size(14.dp))
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

/** Die prominenten Wert-Kacheln des Stein-Designs. */
fun LazyListScope.setDetailValueTiles(set: SetItem, price: SetPriceResponse?, isBrick: Boolean, fmtPrice: (Double?) -> String) {
    // ── Stein-Design: prominente Wert-Kacheln (wie im Mockup) ──────────
    if (isBrick) {
        item {
            Row(
                Modifier.fillMaxWidth().padding(horizontal = Abstaende.gross).padding(bottom = Abstaende.mittel),
                horizontalArrangement = Arrangement.spacedBy(10.dp)
            ) {
                BrickStatTile(
                    label = stringResource(R.string.detail_section_market),
                    // avg_price zuerst: Marktpreis ist seit der Preisumstellung der
                    // einfache Schnitt, nicht der mengengewichtete (der liegt darunter).
                    value = fmtPrice(price?.avgPrice ?: price?.qtyAvgPrice),
                    container = Petrol,
                    onContainer = Color.White,
                    modifier = Modifier.weight(1f)
                )
                BrickStatTile(
                    label = stringResource(R.string.detail_purchase_price),
                    // Mengengewichtet, wie in der Webapp.
                    value = fmtPrice(set.anzeigeKaufpreis),
                    container = SlateBlue,
                    onContainer = Color.White,
                    modifier = Modifier.weight(1f)
                )
            }
        }
    }

}

/** Kennzahl-Chips: Jahr, Teile, Minifiguren, Thema. */
fun LazyListScope.setDetailStatChips(set: SetItem) {
    // ── Quick-stat chips ───────────────────────────────────────────────
    item {
        val labelYear     = stringResource(R.string.detail_year)
        val labelPieces   = stringResource(R.string.detail_pieces)
        val labelMinifigs = stringResource(R.string.detail_minifigs)
        val labelTheme    = stringResource(R.string.detail_theme)
        LazyRow(
            horizontalArrangement = Arrangement.spacedBy(Abstaende.klein),
            contentPadding = PaddingValues(horizontal = Abstaende.gross),
            modifier = Modifier.padding(bottom = Abstaende.mittel)
        ) {
            val chips = buildList {
                set.year?.let     { add(labelYear     to "$it")  }
                set.pieces?.let   { add(labelPieces   to ch.brickinventoryapp.util.fmtInt(it)) }
                set.minifigs?.let { add(labelMinifigs to "$it")  }
                set.theme?.let    { add(labelTheme    to it)     }
            }
            items(chips) { (label, value) ->
                StatChipV2(label = label, value = value)
            }
        }
    }

}

/** Das grosse Set-Bild samt Nachladeversuch und Zoom-Auslöser. */
fun LazyListScope.setDetailHeroImage(
    set: SetItem,
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
            if (imageUrl != null) {
                AsyncImage(
                    model = coil3.request.ImageRequest.Builder(LocalContext.current)
                        .data(imageUrl)
                        .memoryCacheKeyExtra("retry", detailRetry.intValue.toString())
                        .crossfade(true)
                        .build(),
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
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(200.dp)
                        .clip(Formen.chip)
                        .clickable(role = Role.Button) { onZoom() },
                    contentScale = ContentScale.Fit
                )
            } else {
                Box(
                    Modifier
                        .fillMaxWidth()
                        .height(160.dp)
                        .background(
                            Brush.linearGradient(
                                listOf(
                                    MaterialTheme.colorScheme.primaryContainer,
                                    MaterialTheme.colorScheme.secondaryContainer
                                )
                            )
                        ),
                    Alignment.Center
                ) {
                    Icon(
                        Icons.Default.ViewModule, null,
                        modifier = Modifier.size(64.dp),
                        tint = MaterialTheme.colorScheme.onPrimaryContainer.copy(alpha = 0.4f)
                    )
                }
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
    alarme: List<ch.brickinventoryapp.data.model.Preisalarm>,
    currency: String,
    onSetze: (setNumber: String, richtung: String, roh: String, zustand: String) -> Unit,
) {
    item {
        // Fuer WELCHEN Zustand der Alarm gilt. Neu und gebraucht liegen oft
        // um ein Vielfaches auseinander; wer ein gebrauchtes Exemplar sucht,
        // hatte bisher keine Moeglichkeit, darauf zu warten.
        var zustand by rememberSaveable {
            mutableStateOf(ch.brickinventoryapp.ui.ALARM_ZUSTAND_VORGABE)
        }
        val alarm = alarme.firstOrNull { it.condition == zustand }
        SectionCard(title = stringResource(R.string.detail_alert)) {
            // Der Zustandswechsel LAEDT nur — er speichert nicht. Ein Wechsel
            // ist die Frage „was steht fuer gebraucht?", keine Eingabe. Wuerde
            // hier gespeichert, legte schon das Umschalten einen Alarm im
            // neuen Zustand an. Dass `alarm` oben am Zustand haengt, erledigt
            // das Laden von selbst: Die Liste traegt beide.
            Row(verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(Abstaende.klein)) {
                FilterChip(
                    selected = zustand == "N",
                    onClick = { zustand = "N" },
                    label = { Text(stringResource(R.string.condition_new), style = MaterialTheme.typography.labelMedium) },
                )
                FilterChip(
                    selected = zustand == "U",
                    onClick = { zustand = "U" },
                    label = { Text(stringResource(R.string.condition_used), style = MaterialTheme.typography.labelMedium) },
                )
            }
            // Schluessel ist der Alarm selbst: Kommt einer vom Server (geladen
            // oder gerade gespeichert), soll das Feld ihn zeigen statt den
            // alten Text zu behalten.
            var richtung by rememberSaveable(alarm?.richtung) {
                mutableStateOf(alarm?.richtung ?: "unter")
            }
            var schwelle by rememberSaveable(alarm?.schwelle) {
                mutableStateOf(alarm?.let { if (it.schwelle > 0) it.schwelle.toString() else "" } ?: "")
            }

            Row(verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(Abstaende.klein)) {
                // Zwei Chips statt eines Auswahlfelds: genau zwei Möglichkeiten, beide ohne
                // Aufklappen lesbar. Die Richtung geht nur mit, wenn eine Schwelle dasteht — sonst
                // liefe der Aufruf auf ein Löschen hinaus.
                FilterChip(
                    selected = richtung == "unter",
                    onClick = { richtung = "unter"
                        if (schwelle.isNotBlank()) onSetze(setNumber, "unter", schwelle, zustand) },
                    label = { Text(stringResource(R.string.detail_alert_below), style = MaterialTheme.typography.labelMedium) },
                )
                FilterChip(
                    selected = richtung == "ueber",
                    onClick = { richtung = "ueber"
                        if (schwelle.isNotBlank()) onSetze(setNumber, "ueber", schwelle, zustand) },
                    label = { Text(stringResource(R.string.detail_alert_above), style = MaterialTheme.typography.labelMedium) },
                )
                OutlinedTextField(
                    value = schwelle,
                    // Der getippte Text geht unverändert an setzePreisalarm(); die Umrechnung steht
                    // an einer Stelle (Alarmeingabe.zahl). Der Filter lässt nur Ziffern und ein
                    // Trennzeichen herein, denn ein unlesbarer Wert hiesse hier Löschen.
                    onValueChange = { roh ->
                        val g = NumericInput.price(roh)
                        schwelle = g; onSetze(setNumber, richtung, g, zustand)
                    },
                    singleLine = true,
                    placeholder = { Text(currency, style = MaterialTheme.typography.bodySmall) },
                    keyboardOptions = NumericInput.preisTastatur(),
                    modifier = Modifier.weight(1f),
                )
            }
            // Der Merker sagt, ob schon gemeldet wurde. Ihn zu zeigen ist der
            // Unterschied zwischen „der Alarm steht" und „der Alarm hat
            // gefeuert" — sonst fragt man sich, warum keine Mail mehr kommt.
            if (alarm != null) {
                Text(
                    stringResource(
                        if (alarm.ausgeloest) R.string.detail_alert_fired
                        else R.string.detail_alert_armed
                    ),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
    }
}

// Kaufen und Preisvergleich stehen nicht am Set-Detail: Es zeigt ein Set, das man
// besitzt; beide Knöpfe gibt es im Katalog- und im Merkposten-Detail. Die Felder
// bleiben im Modell, weil der Server sie schickt und die Merkliste sie liest.
