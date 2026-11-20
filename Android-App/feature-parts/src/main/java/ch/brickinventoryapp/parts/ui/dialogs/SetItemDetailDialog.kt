package ch.brickinventoryapp.parts.ui.dialogs

import ch.brickinventoryapp.ui.satz
import ch.brickinventoryapp.model.ui.laedt
import ch.brickinventoryapp.model.ui.Laden
import ch.brickinventoryapp.state.ui.LagerUiState
import ch.brickinventoryapp.parts.ui.SetItemUiState
import ch.brickinventoryapp.parts.ui.viewmodel.SetItemAktionen
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.*
import androidx.compose.runtime.*

// rememberSaveable liegt im UNTERPAKET runtime.saveable — der Sammelimport
// darueber deckt es nicht ab (Kotlin-Sternimporte gelten nicht fuer
// Unterpakete). Genau daran ist Lauf 81 gescheitert.
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import coil3.ImageLoader
import ch.brickinventoryapp.resources.R
import ch.brickinventoryapp.ui.components.ZoomableImageDialog
import ch.brickinventoryapp.shared.ui.TabellenZeile
import ch.brickinventoryapp.model.util.resolveFullUrlViaProxy
import ch.brickinventoryapp.ui.util.rememberTileImageWithFallback
import ch.brickinventoryapp.ui.theme.Abstaende
import ch.brickinventoryapp.ui.components.DetailTopAppBar
import ch.brickinventoryapp.ui.components.BackButton
import ch.brickinventoryapp.ui.components.farbTranslator
import ch.brickinventoryapp.ui.components.categoryTranslator
import ch.brickinventoryapp.shared.ui.mengeAusSet
import ch.brickinventoryapp.shared.ui.LocationField
import ch.brickinventoryapp.parts.ui.screens.PartDetailHeader

/**
 * Detail für ein Teil / eine Figur aus einem Set, auf dem Telefon als Blatt von unten:
 * Bild mit Zoom und die Sets, die es verwenden, mit Link zum Set-Detail. Ein Blatt
 * statt eines Dialogs, weil Lagerort und Liste Platz brauchen und das Wischen nach
 * unten schliesst wie überall.
 */
@Composable
internal fun SetItemDetailDialog(
    zustand: SetItemUiState,
    lagerZustand: LagerUiState,
    aktionen: SetItemAktionen,
    imageLoader: ImageLoader,
    serverUrl: String,
    onOpenSet: (String) -> Unit,
) {
    SetItemDetail(zustand, lagerZustand, aktionen, imageLoader, serverUrl, onOpenSet, alsDialog = true)
}

/**
 * Dasselbe Detail als rechte Hälfte neben der Liste (Tablet, Listen-Detail wie in
 * der Merkliste): Titel mit Schliessen-Knopf, darunter der Inhalt, rollbar.
 */
@Composable
internal fun SetItemDetailArea(
    zustand: SetItemUiState,
    lagerZustand: LagerUiState,
    aktionen: SetItemAktionen,
    imageLoader: ImageLoader,
    serverUrl: String,
    onOpenSet: (String) -> Unit,
) {
    SetItemDetail(zustand, lagerZustand, aktionen, imageLoader, serverUrl, onOpenSet, alsDialog = false)
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun SetItemDetail(
    zustand: SetItemUiState,
    lagerZustand: LagerUiState,
    aktionen: SetItemAktionen,
    imageLoader: ImageLoader,
    serverUrl: String,
    onOpenSet: (String) -> Unit,
    alsDialog: Boolean,
) {
    val farbe = farbTranslator()
    // Die Auswahlliste gehört dem Besitzer des Teils; sie kommt mit dem Kopf (PartsViewModel).
    if (!zustand.offen) return

    // rememberSaveable, nicht remember: Der geöffnete Zoom ist eine Entscheidung des
    // Nutzers und muss eine Drehung überstehen — wie an den übrigen Zoom-Stellen.
    var showZoom by rememberSaveable { mutableStateOf(false) }
    // stringResource() geht nur ausserhalb des LazyColumn-Rumpfs — dort ist
    // kein Composable-Kontext fuer jedes Element noetig, und einmal lesen
    // reicht.
    val openLabel = stringResource(R.string.setitem_open_set)
    val kopf = zustand.kopf
    // Volle Aufloesung UEBER den Server-Proxy — bei Teilen und Figuren ist das
    // ausdruecklich so entschieden (siehe resolveFullUrlViaProxy), damit kein
    // Geraet am Server vorbei direkt mit dem CDN spricht. Genau dieselbe Wahl
    // trifft der Dialog fuer manuell erfasste Teile.
    val bild = kopf?.let { resolveFullUrlViaProxy(serverUrl, it.imageLocal, it.imageUrl) }

    val titel: @Composable () -> Unit = {
            Column {
                Text(kopf?.name ?: zustand.nummer, fontWeight = FontWeight.SemiBold)
                Text(
                    zustand.nummer + (kopf?.colorName?.let { " · " + farbe(it) } ?: ""),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
    }
    val inhalt: @Composable () -> Unit = {
            Column(Modifier.fillMaxWidth()) {
                when {
                    zustand.abruf.laedt -> Box(Modifier.fillMaxWidth().padding(Abstaende.veryLarge), Alignment.Center) {
                        CircularProgressIndicator(Modifier.size(28.dp))
                    }
                    zustand.abruf is Laden.Fehler -> Text(
                        zustand.abruf.meldung.satz(),
                        color = MaterialTheme.colorScheme.error,
                    )
                    else -> {
                        // Derselbe Kopf wie beim selbst erfassten Teil; nur die Abschnitte darunter
                        // hängen an der Herkunft.
                        val kategorie = categoryTranslator()
                        val chips = buildList {
                            add(stringResource(R.string.setitem_total_qty) to mengeAusSet(kopf?.totalQuantity ?: 0))
                            kopf?.colorName?.let { add(stringResource(R.string.setitem_color) to farbe(it)) }
                            kopf?.categoryName?.let { add(stringResource(R.string.setitem_category) to kategorie(it)) }
                            if (kopf?.isSpare == true) add(stringResource(R.string.parts_spare_tag) to "✓")
                        }
                        PartDetailHeader(bild, imageLoader, kopf?.name, chips, onZoom = { showZoom = true })
                        Spacer(Modifier.height(Abstaende.klein))
                        // Nur für Teile (kopf.colorId ist bei Figuren null): Eine Minifigur
                        // steckt in ihrem Set, dessen Ort im Set-Detail steht — ein zweiter
                        // Ort könnte auseinanderlaufen. Bearbeitbar wie in der Webapp; das
                        // Feld schreibt auf alle Zeilen dieses Teil-Farb-Paares.
                        val headerColor = kopf?.colorId
                        if (kopf != null && headerColor != null) {
                            Row(Modifier.fillMaxWidth().padding(vertical = Abstaende.hairline),
                                horizontalArrangement = Arrangement.SpaceBetween,
                                verticalAlignment = Alignment.CenterVertically) {
                                Text(stringResource(R.string.detail_storage),
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                    style = MaterialTheme.typography.bodyMedium)
                                LocationField(
                                    wert = kopf.storage ?: "",
                                    stock = lagerZustand.stock.map { it.name },
                                    onValue = { aktionen.setPartLocation(kopf.nummer, headerColor, it) },
                                    modifier = Modifier.padding(start = Abstaende.gross)
                                        .weight(1f).widthIn(max = 320.dp),
                                )
                            }
                        }
                        Spacer(Modifier.height(Abstaende.mittel))
                        Text(
                            stringResource(R.string.setitem_used_in),
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            style = MaterialTheme.typography.bodyMedium,
                        )
                        if (zustand.sets.isEmpty()) {
                            Text(
                                stringResource(R.string.setitem_used_in_none),
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                                style = MaterialTheme.typography.bodySmall,
                            )
                        } else {
                            // LazyColumn mit Hoehenbegrenzung: Ein Teil kann in
                            // Dutzenden Sets stecken, und ein Dialog, der ueber
                            // den Bildschirmrand hinauswaechst, laesst sich
                            // nicht mehr schliessen.
                            LazyColumn(Modifier.fillMaxWidth().heightIn(max = 220.dp)) {
                                items(zustand.sets, key = { it.setNumber + "-" + it.ownerUserId }) { s ->
                                    // ── Bild, Nummer, Bezeichnung, Menge ──
                                    //
                                    // Erst das kleine Bild, dann Nummer, dann Name — wie im Reiter
                                    // Finanzen. Dafür gibt es TabellenZeile; eine eigene Zeile
                                    // hätte festen Eckenradius und keinen Rückfall auf die volle
                                    // Auflösung ohne Vorschaubild.
                                    val (bildUrl, onBildFehler) =
                                        rememberTileImageWithFallback(serverUrl, s.imageLocal, s.imageUrl)
                                    TabellenZeile(
                                        bildUrl = bildUrl,
                                        nummer = s.setNumber,
                                        name = s.setName,
                                        menge = s.quantity,
                                        imageLoader = imageLoader,
                                        onBildFehler = onBildFehler,
                                        // onClickLabel sagt der Sprachausgabe, was das Antippen tut
                                        // — ohne liest sie nur die Setnummer vor. In der Webapp
                                        // steht derselbe Text als title-Attribut.
                                        onClickLabel = openLabel,
                                        onClick = {
                                            // Erst schliessen, dann oeffnen:
                                            // Sonst laege der Dialog ueber dem
                                            // Set-Detail.
                                            aktionen.closeSetItem()
                                            onOpenSet(s.setNumber)
                                        },
                                    )
                                }
                            }
                        }
                    }
                }
            }
    }

    // Schliessen links wie in jedem Detailkopf (DetailTopAppBar), im Blatt wie neben der Liste.
    val schliessen = { aktionen.closeSetItem() }
    if (alsDialog) {
        ModalBottomSheet(onDismissRequest = schliessen) {
            Column(
                Modifier.padding(start = Abstaende.gross, end = Abstaende.veryLarge, bottom = Abstaende.veryLarge)
                    .verticalScroll(rememberScrollState()),
                verticalArrangement = Arrangement.spacedBy(Abstaende.mittel),
            ) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    BackButton(schliessen, schliessen = true)
                    Box(Modifier.weight(1f)) {
                        ProvideTextStyle(MaterialTheme.typography.titleLarge) { titel() }
                    }
                }
                inhalt()
            }
        }
    } else {
        Column(Modifier.fillMaxSize()) {
            DetailTopAppBar(
                titel = kopf?.name ?: zustand.nummer,
                subtitle = zustand.nummer + (kopf?.colorName?.let { " · " + farbe(it) } ?: ""),
                onZurueck = schliessen,
                schliessen = true,
            )
            Column(
                Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(Abstaende.gross),
                verticalArrangement = Arrangement.spacedBy(Abstaende.mittel),
            ) { inhalt() }
        }
    }

    if (showZoom && bild != null) {
        ZoomableImageDialog(
            imageUrl = bild,
            contentDescription = kopf.name,
            imageLoader = imageLoader,
            onDismiss = { showZoom = false },
        )
    }
}
