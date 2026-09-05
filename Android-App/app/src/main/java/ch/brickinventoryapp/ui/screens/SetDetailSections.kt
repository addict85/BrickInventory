package ch.brickinventoryapp.ui.screens

/**
 * Die Abschnitte der Set-Detailseite.
 *
 * ── Warum eigene Datei (Nachtrag 98) ────────────────────────────────────────
 *
 * `SetDetailScreen()` war 526 Zeilen — die längste Funktion der App. Die ganze
 * Datei enthielt genau EIN Composable, obwohl daneben `SetDetailComponents.kt`
 * mit neun kleinen liegt: Die Aufteilung war angefangen und nicht zu Ende
 * geführt.
 *
 * Die sechs Abschnitte der Seite (Bild, Kennzahl-Chips, Wert-Kacheln,
 * Stammdaten, Preis, Anleitungen) sind `item { … }`-Blöcke einer LazyColumn.
 * Deshalb sind es Erweiterungen auf `LazyListScope` und KEINE @Composable-
 * Funktionen: Sie tragen Einträge in die Liste ein, die Inhalte darin sind
 * weiterhin Composables.
 *
 * ── Wie das ohne Compiler abgesichert wurde ─────────────────────────────────
 * Jeder Rumpf ist WORTGLEICH übernommen; verändert wurde nur die Einrückung.
 * Die Parameterlisten stammen aus einer Analyse der freien Namen je Block —
 * dasselbe Vorgehen wie beim Signatur-Umbau in Nachtrag 96.
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
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import coil.ImageLoader
import coil.compose.AsyncImage
import coil.request.ImageRequest
import ch.brickinventoryapp.R
import ch.brickinventoryapp.data.model.Acquisition
import ch.brickinventoryapp.data.model.PriceHistoryResponse
import ch.brickinventoryapp.data.model.SetItem
import ch.brickinventoryapp.data.model.SetPriceResponse
import ch.brickinventoryapp.ui.MainViewModel
import ch.brickinventoryapp.ui.*  // Feature-Extensions (loadSets, setScope, …)
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

/**
 * Anleitungen — ansehen, hinzufügen und entfernen.
 *
 * ── Warum die Karte jetzt IMMER steht (Nachtrag 128) ────────────────────────
 *
 * Sie erschien nur, wenn es schon Anleitungen gab. Das war richtig, solange sie
 * nichts als eine Liste war — jetzt trägt sie den Weg, eine erste hinzuzufügen,
 * und der wäre genau dann unerreichbar, wenn man ihn braucht. Die Webapp zeigt
 * ihr Hinzufügen-Feld ebenfalls bei leerem Set.
 */
fun LazyListScope.setDetailInstructionsSection(
    set: SetItem, detailState: SetDetailUiState, authToken: String, serverUrl: String,
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
                            horizontalArrangement = Arrangement.spacedBy(8.dp),
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            CircularProgressIndicator(Modifier.size(14.dp), strokeWidth = 2.dp)
                            Text(stringResource(R.string.common_loading),
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                    } else {
                        val ctx = LocalContext.current
                        instructions.forEachIndexed { idx, instr ->
                            val openUrl = instr.localPath?.let {
                                val base = "$serverUrl$it"
                                if (authToken.isNotBlank()) "$base?token=$authToken" else base
                            } ?: instr.url

                            if (idx > 0) HorizontalDivider(
                                Modifier.padding(vertical = 4.dp),
                                color = MaterialTheme.colorScheme.outlineVariant
                            )
                            Row(
                                Modifier
                                    .fillMaxWidth()
                                    .padding(vertical = 4.dp),
                                verticalAlignment = Alignment.CenterVertically,
                                horizontalArrangement = Arrangement.spacedBy(12.dp)
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
                                IconButton(
                                    onClick = {
                                        if (instr.localPath != null) {
                                            onOpenPdf(openUrl, instr.description ?: "")
                                        } else {
                                            // Rückmeldung statt Stille (Nachtrag 49) — siehe
                                            // CatalogDetailScreen.
                                            try { ctx.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(openUrl))) }
                                            catch (_: Exception) {
                                                android.widget.Toast.makeText(ctx,
                                                    ctx.getString(R.string.common_no_app_to_open),
                                                    android.widget.Toast.LENGTH_SHORT).show()
                                            }
                                        }
                                    },
                                    modifier = Modifier.size(36.dp)
                                ) {
                                    Icon(
                                        Icons.AutoMirrored.Filled.OpenInNew, null,
                                        tint = MaterialTheme.colorScheme.onSurfaceVariant,
                                        modifier = Modifier.size(18.dp)
                                    )
                                }
                                // Entfernen nur, wo der Server eine Kennung
                                // mitgeschickt hat: Anleitungen aus der
                                // automatischen Suche haben keine Zeile in der
                                // Tabelle, und ein Knopf, der zu einem 404
                                // fuehrt, ist schlechter als keiner.
                                val id = instr.id
                                if (id != null) {
                                    IconButton(
                                        onClick = { onAnleitungLoeschen(id) },
                                        modifier = Modifier.size(36.dp)
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
                        // Der Weg, eine erste Anleitung hinzuzufuegen. Steht
                        // UNTER der Liste, weil das Ansehen der haeufigere Fall
                        // ist.
                        OutlinedButton(
                            onClick = onAnleitungWaehlen,
                            modifier = Modifier.fillMaxWidth().padding(top = 8.dp),
                            shape = Formen.knopf
                        ) {
                            Icon(Icons.Default.Add, null, Modifier.size(18.dp))
                            Spacer(Modifier.width(8.dp))
                            Text(stringResource(R.string.instr_upload))
                        }
                    }
                }
            }
        }
}

/** Marktpreis, Kaufpreis, Gewinn/Verlust und der Preisverlauf. */
/**
 * ── Warum diese Helfer als Parameter kommen (Nachtrag 104) ──────────────────
 * `fmtPrice`, `fmtDate` und `serverUrl` sind lokale Werte von
 * SetDetailScreen() — beim Herauslösen der Abschnitte verlieren sie ihren
 * Gültigkeitsbereich. Sie hier neu zu bauen hiesse, die Währung ein zweites
 * Mal aufzulösen; als Parameter bleibt es EINE Stelle.
 */
fun LazyListScope.setDetailPriceSection(set: SetItem, detailState: SetDetailUiState, price: SetPriceResponse?, history: PriceHistoryResponse?, pnlPct: String?, currency: String, isBrick: Boolean, fmtPrice: (Double?) -> String) {
    // ── Price section ──────────────────────────────────────────────────
    if (price != null && !price.noPrice || detailState.setPriceLoading) {
        item {
            SectionCard(title = stringResource(R.string.detail_section_market)) {
                if (detailState.setPriceLoading && price == null) {
                    PreisLaedtZeile()
                } else if (price != null && !price.noPrice) {
                    // ── Grosse Preiszeile: nur ohne die Wert-Kacheln ─
                    //
                    // Marcos Befund: „Der blau markierte Wert kann
                    // entfernt werden. Dieser bietet keinen Mehrwert."
                    // Im Stein-Design steht derselbe Marktpreis schon
                    // in der Kachel weiter oben und der Kaufpreis in
                    // der daneben — die Zeile wiederholte beide, und
                    // ihre Prozentangabe stammte aus dem
                    // GESAMTvergleich, während die Zeilen darunter je
                    // Zustand rechnen. Bei einem Set, das einmal neu
                    // und einmal gebraucht im Bestand liegt, standen
                    // damit drei Prozentzahlen untereinander, von denen
                    // die oberste eine andere Frage beantwortete.
                    //
                    // Im klassischen Design gibt es die Kacheln NICHT
                    // (siehe `if (isBrick)` weiter oben). Dort bleibt
                    // die Zeile, sonst verschwände der Marktpreis von
                    // der Seite.
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
                            Spacer(Modifier.height(4.dp))
                            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                PnlBadge(pct)
                                // Mengengewichtet über die Erfassungen;
                                // set.purchasePrice ist nur der
                                // gespiegelte Wert der LETZTEN
                                // Erfassung und passt bei mehreren
                                // Käufen nicht zur Prozentangabe
                                // daneben.
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
                                Spacer(Modifier.height(8.dp))
                                HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                                Spacer(Modifier.height(4.dp))
                            }
                            MarketPriceByCondition(byCond, currency)
                        }
                    }

                    // ── Verlauf: eine Linie je Zustand ───────────────
                    //
                    // Preis und Verlauf sind ZWEI Abrufe. Der Preis ist meist
                    // zuerst da; ohne den Hinweis hier springt das Diagramm
                    // spaeter kommentarlos in die schon sichtbare Karte.
                    // `priceHistoryLoading` wurde dafuer geschrieben, aber
                    // nirgends gelesen.
                    val chart = history?.chart
                    if (chart != null && chart.values.isNotEmpty()) {
                        Spacer(Modifier.height(8.dp))
                        PriceChart(chart)
                    } else if (detailState.priceHistoryLoading) {
                        Spacer(Modifier.height(8.dp))
                        PreisLaedtZeile()
                    }
                }
            }
        }
    }

}

/** Stammdaten: Nummer, Menge (änderbar), Erfassungsdatum. */
fun LazyListScope.setDetailDetailsSection(set: SetItem, setNumber: String, vm: MainViewModel, acquisitions: List<Acquisition>, currency: String, fmtDate: (String?) -> String, onNavigateToAcqMgmt: (type: String, id: String, colorId: Int, title: String) -> Unit) {
    // ── Set details section ────────────────────────────────────────────
    item {
        SectionCard(title = stringResource(R.string.detail_section_details)) {
            DetailRow2(stringResource(R.string.detail_set_number), setNumber)
            DetailRow2(stringResource(R.string.detail_added), "📅 ${fmtDate(set.addedAt)}")
            HorizontalDivider(
                Modifier.padding(vertical = 4.dp),
                color = MaterialTheme.colorScheme.outlineVariant
            )
            // Quantity stepper
            // An set.quantity gekoppelt, nicht nur an die Setnummer:
            // Der Server kann eine Verringerung deckeln (fremde
            // Exemplare lassen sich nicht wegnehmen) und meldet die
            // wirkliche Gesamtmenge zurück. Ohne die Kopplung behielte
            // der Regler seine eigene Annahme, bis man die Ansicht
            // verlässt und neu öffnet.
            var qty by remember(set.setNumber, set.quantity) { mutableIntStateOf(set.quantity) }
            Row(
                Modifier.fillMaxWidth().padding(vertical = 4.dp),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Text(
                    stringResource(R.string.detail_quantity),
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(12.dp)
                ) {
                    FilledTonalIconButton(
                        onClick = { if (qty > 1) { qty--; vm.updateQuantity(set.setNumber, qty) } },
                        modifier = Modifier.size(32.dp),
                        shape = Formen.etikett
                    ) {
                        Icon(Icons.Default.Remove, stringResource(R.string.cd_qty_decrease), Modifier.size(14.dp))
                    }
                    Text(
                        "$qty",
                        fontWeight = FontWeight.Bold,
                        fontSize = 16.sp,
                        modifier = Modifier.widthIn(min = 24.dp),
                        textAlign = TextAlign.Center
                    )
                    FilledTonalIconButton(
                        onClick = { qty++; vm.updateQuantity(set.setNumber, qty) },
                        modifier = Modifier.size(32.dp),
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
                Modifier.fillMaxWidth().padding(horizontal = 16.dp).padding(bottom = 12.dp),
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
                    // Mengengewichtet, wie in der Webapp (Nachtrag 76)
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
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            contentPadding = PaddingValues(horizontal = 16.dp),
            modifier = Modifier.padding(bottom = 12.dp)
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
                .padding(horizontal = 16.dp, vertical = 12.dp),
            shape = Formen.chip,
            elevation = CardDefaults.cardElevation(defaultElevation = Formen.karteErhebungHoch),
            colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface)
        ) {
            if (imageUrl != null) {
                AsyncImage(
                    model = coil.request.ImageRequest.Builder(LocalContext.current)
                        .data(imageUrl)
                        .setParameter("retry", detailRetry.intValue)
                        .crossfade(true)
                        .build(),
                    imageLoader = imageLoader,
                    contentDescription = set.name,
                    onState = { st ->
                        if (st is coil.compose.AsyncImagePainter.State.Error && detailRetry.intValue == 0) {
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
                        .clickable { onZoom() },
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
