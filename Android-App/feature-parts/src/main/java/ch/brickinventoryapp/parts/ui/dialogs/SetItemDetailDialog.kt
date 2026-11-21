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

// rememberSaveable lives in the SUBPACKAGE runtime.saveable — the wildcard import
// above it does not cover that (Kotlin star imports do not apply to
// subpackages). That is exactly what tripped up round 81.
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
 * Detail for a part / figure from a set, on the phone as a sheet from the bottom:
 * an image with zoom and the sets that use it, with a link to the set detail. A sheet
 * instead of a dialog, because storage location and list need room and swiping
 * down closes it as everywhere else.
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
 * The same detail as the right half next to the list (tablet, list-detail as in
 * the wishlist): title with a close button, the content below it, scrollable.
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
    // The selection list belongs to the part's owner; it comes with the header (PartsViewModel).
    if (!zustand.offen) return

    // rememberSaveable, not remember: the opened zoom is a decision of the
    // user and must survive a rotation — as at the other zoom spots.
    var showZoom by rememberSaveable { mutableStateOf(false) }
    // stringResource() only works outside the LazyColumn's body — there
    // no Composable context is needed for every item, and reading it once
    // is enough.
    val openLabel = stringResource(R.string.setitem_open_set)
    val kopf = zustand.kopf
    // Full resolution VIA the server proxy — for parts and figures this is
    // deliberately decided this way (see resolveFullUrlViaProxy), so that no
    // device talks directly to the CDN past the server. The dialog for manually
    // entered parts makes exactly the same choice.
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
                        // The same header as for a self-entered part; only the sections below it
                        // depend on the origin.
                        val kategorie = categoryTranslator()
                        val chips = buildList {
                            add(stringResource(R.string.setitem_total_qty) to mengeAusSet(kopf?.totalQuantity ?: 0))
                            kopf?.colorName?.let { add(stringResource(R.string.setitem_color) to farbe(it)) }
                            kopf?.categoryName?.let { add(stringResource(R.string.setitem_category) to kategorie(it)) }
                            if (kopf?.isSpare == true) add(stringResource(R.string.parts_spare_tag) to "✓")
                        }
                        PartDetailHeader(bild, imageLoader, kopf?.name, chips, onZoom = { showZoom = true })
                        Spacer(Modifier.height(Abstaende.klein))
                        // Only for parts (kopf.colorId is null for figures): a minifigure
                        // is stuck in its set, whose location stands in the set detail — a second
                        // location could drift apart. Editable as in the web app; the
                        // field writes to every row of this part-color pair.
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
                            // LazyColumn with a height limit: a part can be
                            // stuck in dozens of sets, and a dialog that grows
                            // beyond the screen edge can no longer be
                            // closed.
                            LazyColumn(Modifier.fillMaxWidth().heightIn(max = 220.dp)) {
                                items(zustand.sets, key = { it.setNumber + "-" + it.ownerUserId }) { s ->
                                    // ── Image, number, name, quantity ──
                                    //
                                    // First the small image, then number, then name — as in the
                                    // finances tab. TabellenZeile exists for that; a row of its
                                    // own would have a fixed corner radius and no fallback to the full
                                    // resolution without a thumbnail.
                                    val (bildUrl, onBildFehler) =
                                        rememberTileImageWithFallback(serverUrl, s.imageLocal, s.imageUrl)
                                    TabellenZeile(
                                        bildUrl = bildUrl,
                                        nummer = s.setNumber,
                                        name = s.setName,
                                        menge = s.quantity,
                                        imageLoader = imageLoader,
                                        onBildFehler = onBildFehler,
                                        // onClickLabel tells the screen reader what tapping does
                                        // — without it, it only reads out the set number. In the web app
                                        // the same text is the title attribute.
                                        onClickLabel = openLabel,
                                        onClick = {
                                            // Close first, then open:
                                            // otherwise the dialog would lie
                                            // over the set detail.
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

    // Close on the left as in every detail header (DetailTopAppBar), in the sheet as next to the list.
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
