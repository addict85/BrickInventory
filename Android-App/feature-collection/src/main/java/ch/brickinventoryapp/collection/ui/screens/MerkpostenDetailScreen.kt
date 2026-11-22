package ch.brickinventoryapp.collection.ui.screens

import ch.brickinventoryapp.model.domain.Geld
import ch.brickinventoryapp.model.ui.laedt
import ch.brickinventoryapp.model.domain.Zustand
import ch.brickinventoryapp.ui.theme.centeredUntil
import ch.brickinventoryapp.ui.components.nebenKnopfFarben
import ch.brickinventoryapp.ui.components.nebenKnopfRand
import androidx.compose.ui.draw.clip
import androidx.compose.foundation.clickable
import androidx.compose.ui.semantics.Role
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import ch.brickinventoryapp.resources.R
import ch.brickinventoryapp.collection.ui.viewmodel.MerklisteAktionen
import ch.brickinventoryapp.ui.components.ZoomableImageDialog
import ch.brickinventoryapp.ui.theme.Abstaende
import ch.brickinventoryapp.model.util.resolveFullUrl
import kotlinx.coroutines.launch
import ch.brickinventoryapp.ui.components.SectionTitle
import ch.brickinventoryapp.ui.components.DetailTopAppBar
import ch.brickinventoryapp.ui.components.MitTooltip
import ch.brickinventoryapp.ui.components.ProduktBild
import ch.brickinventoryapp.ui.components.withFont
import ch.brickinventoryapp.ui.theme.AppKarte
import ch.brickinventoryapp.ui.theme.Lesebreite
import ch.brickinventoryapp.ui.util.fmtInt
import ch.brickinventoryapp.ui.util.fmtMoney
import ch.brickinventoryapp.ui.util.fmtTag
import ch.brickinventoryapp.network.util.externeAddress
import ch.brickinventoryapp.ui.util.openExtern
import ch.brickinventoryapp.ui.components.CatalogDetailRow
import ch.brickinventoryapp.shared.ui.OwnerPicker
import ch.brickinventoryapp.shared.ui.PriceLoadsRow
import ch.brickinventoryapp.shared.ui.PriceChart

/**
 * A watchlist item's detail — the same rows in the same order as the
 * set detail, minus what a watchlist item doesn't have (purchase price, quantity, storage location, manuals;
 * "added" here means "on the list since"). Market price and history are drawn by the same
 * PriceChart().
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun MerkpostenDetailScreen(
    ansicht: MerklisteZustand,
    aktionen: MerklisteAktionen,
    setNumber: String,
    condition: Zustand,
    imageLoader: coil3.ImageLoader,
    onBack: () -> Unit,
    /** From one item's alert to all of them (Settings → Preisalarme). */
    onOpenPriceAlerts: (() -> Unit)? = null,
) {
    val appState = ansicht.appState
    val blick = ansicht.blick
    // The STOCK of storage locations for the take-over dialog.
    val lagerZustand = ansicht.lagerZustand
    val liste    = ansicht.liste
    val detail   = ansicht.detail
    val ctx = LocalContext.current
    // stringResource instead of ctx.getString in the callback: a context grabbed from
    // LocalContext delivers stale values after a config change (Lint
    // LocalContextGetResourceValueCall).
    val noAppText = stringResource(R.string.common_no_app_to_open)
    // Snackbar in its own scaffold instead of Toast: stays readable until TalkBack is done.
    val meldungen = remember { SnackbarHostState() }
    val bereich = rememberCoroutineScope()
    // The same dialog as in the list, not a second one: quantity, purchase price
    // and condition must be the same mask here.
    var openTakeover by rememberSaveable { mutableStateOf(false) }
    // Zoom as in the set and catalog detail and in the web app. rememberSaveable: whoever
    // rotates the phone while zoomed should stay in it.
    var openZoom by rememberSaveable { mutableStateOf(false) }

    val merkposten = liste.merkposten.firstOrNull {
        it.setNumber == setNumber && it.condition == condition
    }

    // The watchlist item is gone (deleted or taken over) — then this
    // screen should be gone too, instead of showing a corpse.
    LaunchedEffect(merkposten == null, liste.abruf.laedt) {
        if (merkposten == null && !liste.abruf.laedt && liste.merkposten.isNotEmpty()) onBack()
    }

    val noPrice = stringResource(R.string.detail_price_none_yet)
    fun preis(v: Geld?) = if (v == null) noPrice else fmtMoney(v, appState.currency)

    Scaffold(
        snackbarHost = { SnackbarHost(meldungen) },
        topBar = {
            // The same header as the set, catalog and parts detail (DetailTopAppBar).
            DetailTopAppBar(titel = merkposten?.name ?: setNumber, onZurueck = onBack,
                // Without a confirmation as in the web app: a watchlist item isn't owned and is quickly
                // re-added. `let`, because the watchlist item up here is still nullable.
                actions = {
                    merkposten?.let { w ->
                        MitTooltip(stringResource(R.string.common_delete)) {
                            IconButton(onClick = {
                                aktionen.deleteWantedItem(w.setNumber, w.condition, w.userId)
                            }) {
                                Icon(Icons.Default.Delete, stringResource(R.string.common_delete))
                            }
                        }
                    }
                },
            )
        },
    ) { padding ->
        if (merkposten == null) {
            Box(Modifier.fillMaxSize().padding(padding), Alignment.Center) { CircularProgressIndicator() }
            return@Scaffold
        }
        // Determine the address ONCE: the preview image and zoom would otherwise possibly
        // show two different images — and `resolveFullUrl` already
        // delivers the full resolution anyway (no thumb).
        val bildUrl = resolveFullUrl(appState.serverUrl,
            detail.katalog?.imageLocal ?: merkposten.imageLocal, merkposten.imageUrl)

        LazyColumn(
            Modifier.fillMaxSize().padding(padding),
            contentPadding = PaddingValues(Abstaende.gross),
            verticalArrangement = Arrangement.spacedBy(Abstaende.mittel),
        ) {
            item {
                ProduktBild(
                    model = bildUrl,
                    contentDescription = merkposten.name,
                    imageLoader = imageLoader,
                    // Tapping opens the zoom — the same behavior as in the
                    // set and catalog detail.
                    modifier = Modifier.fillMaxWidth().height(Abstaende.huge * 5)
                        .clip(MaterialTheme.shapes.medium)
                        .clickable(enabled = bildUrl != null, onClickLabel = stringResource(R.string.cd_bild_vergroessern), role = Role.Button) { openZoom = true },
                    fallbackSize = Abstaende.huge * 2,
                    bildgrund = true,
                    innerGap = Abstaende.mittel,
                )
            }

            // The cards limit the width (as in the set detail), not every element within them.
            item {
                AppKarte(Modifier.centeredUntil(Lesebreite.formular)) {
                    // With spacing between the rows as in the catalog detail: stacked tightly,
                    // the card read as one block.
                    Column(Modifier.padding(Abstaende.mittel), verticalArrangement = Arrangement.spacedBy(Abstaende.klein)) {
                        // Only rows with a value: four dashes in a row only said
                        // that the catalog doesn't know the set.
                        CatalogDetailRow(stringResource(R.string.detail_set_number), merkposten.setNumber)
                        merkposten.year?.let { CatalogDetailRow(stringResource(R.string.detail_year), it.toString()) }
                        detail.katalog?.themeName?.let { CatalogDetailRow(stringResource(R.string.detail_theme), it) }
                        (detail.katalog?.numParts ?: merkposten.numParts)?.let {
                            CatalogDetailRow(stringResource(R.string.detail_pieces), fmtInt(it))
                        }
                        detail.katalog?.minifigs?.let {
                            CatalogDetailRow(stringResource(R.string.detail_minifigs), fmtInt(it))
                        }
                        CatalogDetailRow(stringResource(R.string.common_condition),
                            stringResource(if (merkposten.condition == Zustand.GEBRAUCHT) R.string.condition_used
                                           else R.string.condition_new))
                        CatalogDetailRow(stringResource(R.string.wanted_since),
                            fmtTag(merkposten.createdAt) ?: "—")

                        // ── The owner, changeable ──
                        //
                        // The same picker as in the entry masks; on a single account
                        // it hides itself.
                        if (blick.householdMembers.size > 1) {
                            Spacer(Modifier.height(Abstaende.klein))
                            OwnerPicker(
                                members = blick.householdMembers,
                                selected = merkposten.userId,
                                onSelect = { aktionen.moveWantedItem(
                                    merkposten.setNumber, merkposten.condition, merkposten.userId, it) },
                            )
                        }
                    }
                }
            }

            // ── The price alert, editable ──
            //
            // The same section as in the set detail: the same entry in price_alerts under the same
            // key, and /sets/:sn/alert requires no ownership.
            setDetailAlarmSection(merkposten.setNumber, detail.preisalarme, appState.currency, aktionen::setPriceAlert,
                outerGap = false, onAllAlerts = onOpenPriceAlerts)

            item {
                AppKarte(Modifier.centeredUntil(Lesebreite.formular)) {
                    Column(Modifier.padding(Abstaende.mittel)) {
                        SectionTitle(stringResource(R.string.detail_section_market))
                        Spacer(Modifier.height(Abstaende.klein))
                        // From the PRICE response, not from the history: that
                        // fetches fresh, the history only reads the cache.
                        CatalogDetailRow(stringResource(R.string.condition_new),
                            preis(detail.preise?.current?.new?.avgPrice))
                        CatalogDetailRow(stringResource(R.string.condition_used),
                            preis(detail.preise?.current?.used?.avgPrice))

                        val chart = detail.history?.chart
                        if (chart != null && chart.values.isNotEmpty()) {
                            Spacer(Modifier.height(Abstaende.klein))
                            PriceChart(chart, appState.currency)
                        } else if (detail.abruf.laedt) {
                            Spacer(Modifier.height(Abstaende.klein))
                            PriceLoadsRow()
                        }
                    }
                }
            }

            item {
                Column(verticalArrangement = Arrangement.spacedBy(Abstaende.klein)) {
                    // BrickLink and price comparison side by side, with spacing below them the
                    // take-over: on top the paths outward, below the controls that change
                    // something. If one address drops out, the other takes the whole row.
                    val adressen = listOfNotNull(
                        detail.katalog?.bricklink?.url?.takeIf { it.isNotBlank() }
                            ?.let { R.string.catalog_buy_bricklink to it },
                        // The catalog delivers the same address, only with the name
                        // in it ("LEGO 75192 Millennium Falcon" instead of just the
                        // number). If it doesn't come back — 404 for a set that
                        // rb_sets doesn't know — the watchlist item's own is ready.
                        (detail.katalog?.preisvergleichUrl ?: merkposten.preisvergleichUrl)
                            ?.takeIf { it.isNotBlank() }
                            ?.let { R.string.detail_compare to it },
                    )
                    val breite = Modifier.fillMaxWidth()
                    if (adressen.isNotEmpty()) {
                        Row(
                            breite,
                            horizontalArrangement = Arrangement.spacedBy(Abstaende.klein),
                        ) {
                            for ((beschriftung, url) in adressen) {
                                OutlinedButton(
                                    onClick = {
                                        if (!openExtern(ctx, externeAddress(url))) {
                                            bereich.launch { meldungen.showSnackbar(noAppText) }
                                        }
                                    },
                                    modifier = Modifier.weight(1f),
                                    contentPadding = PaddingValues(
                                        horizontal = Abstaende.klein, vertical = Abstaende.klein),
                                    colors = nebenKnopfFarben(),
                                    border = nebenKnopfRand(),
                                ) {
                                    // One step smaller, for the same reason as in the
                                    // catalog detail: two buttons share the
                                    // width that one alone used to have.
                                    Text(stringResource(beschriftung), maxLines = 1,
                                        overflow = TextOverflow.Ellipsis,
                                        style = MaterialTheme.typography.labelMedium)
                                }
                            }
                        }
                        Spacer(Modifier.height(Abstaende.klein))
                    }

                    Button(
                        onClick = { openTakeover = true },
                        modifier = breite,
                    ) {
                        Icon(Icons.Default.Add, null, Modifier.size(withFont(18.dp)))
                        Spacer(Modifier.width(Abstaende.tiny))
                        Text(stringResource(R.string.wanted_take))
                    }
                }
            }
        }
    }

    // Outside the scaffold, so the dialogs sit above everything — and with
    // `let`, because `merkposten` is nullable again here: whoever deletes the
    // last entry elsewhere while the dialog is open shouldn't get a crash,
    // just nothing.
    if (openZoom) merkposten?.let { w ->
        // The same address as the image above, recalculated here because `merkposten`
        // is nullable again outside the scaffold body. Drawn by
        // ui/components/ZoomableImageDialog.kt as in the set and catalog detail.
        val zoomUrl = resolveFullUrl(appState.serverUrl,
            detail.katalog?.imageLocal ?: w.imageLocal, w.imageUrl)
        if (zoomUrl != null) {
            ZoomableImageDialog(
                imageUrl = zoomUrl,
                contentDescription = w.name,
                imageLoader = imageLoader,
                onDismiss = { openZoom = false },
            )
        }
    }

    if (openTakeover) merkposten?.let { w ->
        UebernahmeDialog(
            merkposten = w,
            lagerorte = lagerZustand.eigene.map { it.name },
            locationDefault = lagerZustand.vorgabe?.name ?: "",
            onDismiss = { openTakeover = false },
            onUebernehmen = { anzahl, priceRaw, stateChoice, ort ->
                aktionen.adoptWantedItem(w.setNumber, w.condition, w.userId,
                                   anzahl, priceRaw, stateChoice, ort)
                openTakeover = false
            },
        )
    }
}
