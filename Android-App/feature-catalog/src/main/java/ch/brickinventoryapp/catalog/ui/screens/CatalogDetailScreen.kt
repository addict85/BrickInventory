package ch.brickinventoryapp.catalog.ui.screens

import androidx.compose.foundation.ScrollState
import ch.brickinventoryapp.model.domain.Alarmrichtung
import ch.brickinventoryapp.catalog.ui.Merkwunsch
import ch.brickinventoryapp.model.domain.Erfassungswunsch
import ch.brickinventoryapp.model.domain.Zustand
import androidx.compose.material.icons.filled.Bookmark
import ch.brickinventoryapp.ui.util.fmtMoney
import ch.brickinventoryapp.ui.components.AddDialog
import ch.brickinventoryapp.model.domain.WantedItemView
import ch.brickinventoryapp.ui.components.nebenKnopfFarben
import ch.brickinventoryapp.ui.components.nebenKnopfRand
import androidx.compose.ui.draw.clip
import ch.brickinventoryapp.model.domain.CatalogDetailView
import ch.brickinventoryapp.model.domain.MemberView
import ch.brickinventoryapp.ui.theme.Formen
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.OpenInNew
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.BookmarkAdd
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.ShoppingCart
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import ch.brickinventoryapp.resources.R
import ch.brickinventoryapp.ui.util.NumericInput
import ch.brickinventoryapp.data.util.BrickLinkUrls
import androidx.compose.foundation.clickable
import androidx.compose.ui.semantics.Role
import androidx.compose.runtime.getValue
import androidx.compose.runtime.setValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import ch.brickinventoryapp.ui.twoSpaltig
import ch.brickinventoryapp.ui.components.ZoomableImageDialog
import ch.brickinventoryapp.model.util.resolveFullUrl
import coil3.ImageLoader
import kotlinx.coroutines.launch
import coil3.request.ImageRequest
import coil3.request.crossfade
import ch.brickinventoryapp.ui.theme.Abstaende
import ch.brickinventoryapp.ui.components.DetailTopAppBar
import ch.brickinventoryapp.ui.components.ErrorHint
import ch.brickinventoryapp.ui.components.LoadCircle
import ch.brickinventoryapp.ui.components.StateHint
import ch.brickinventoryapp.model.ui.Laden
import ch.brickinventoryapp.model.ui.dataOrNull
import ch.brickinventoryapp.ui.satz
import ch.brickinventoryapp.ui.components.ProduktBild
import ch.brickinventoryapp.ui.components.announce
import ch.brickinventoryapp.shared.ui.entryInvalid
import ch.brickinventoryapp.ui.components.SegmentChoice
import ch.brickinventoryapp.ui.components.movementReduced
import ch.brickinventoryapp.ui.components.withFont
import ch.brickinventoryapp.ui.theme.Lesebreite
import ch.brickinventoryapp.ui.util.fmtInt
import ch.brickinventoryapp.network.util.externeAddress
import ch.brickinventoryapp.ui.util.openExtern
import ch.brickinventoryapp.ui.components.CatalogDetailRow
import ch.brickinventoryapp.shared.ui.LagerortErfassung
import ch.brickinventoryapp.shared.ui.OwnerPicker
import ch.brickinventoryapp.shared.ui.Zustandszeile

/**
 * Catalog detail: image, metadata (year, theme, parts, minifigures) and
 * "Add to gallery" button with a quantity/price/condition dialog.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun CatalogDetailScreen(
    setNumber: String,
    /** An error stands with "Try again" instead of the spinner. */
    geladen: Laden<CatalogDetailView>,
    imageLoader: ImageLoader,
    serverUrl: String,
    defaultCondition: Zustand = Zustand.NEU,
    /** Household members — the account picker hides itself without them. */
    householdMembers: List<MemberView> = emptyList(),
    /** Stock of storage locations for the entry dialog. */
    lagerorte: List<String> = emptyList(),
    /** The preselected storage location (star in settings). Empty means: no default. */
    locationDefault: String = "",
    onLoad: (String) -> Unit,
    onAddToGallery: (Erfassungswunsch) -> Unit,
    /** Add to watchlist; the target account as in the entry dialog and the web app (cat-m-owner). */
    onWish: (Merkwunsch) -> Unit,
    onOpenInGallery: (String) -> Unit,
    onBack: () -> Unit,
    /** The watchlist item for this set, if it's already on the watchlist. */
    gemerkt: WantedItemView? = null,
    /** Open the watchlist item — set number and condition. */
    onOpenWantedItem: (String, Zustand) -> Unit = { _, _ -> },
) {
    val detail = geladen.dataOrNull()
    LaunchedEffect(setNumber) { onLoad(setNumber) }
    var showAddDialog by rememberSaveable { mutableStateOf(false) }
    var showWishDialog by rememberSaveable { mutableStateOf(false) }
    // Screen-filling zoom as in the set detail — here too, on user request.
    var showImageZoom by rememberSaveable { mutableStateOf(false) }
    val ctx = LocalContext.current
    // `stringResource` instead of `ctx.getString` in the callback: a context grabbed from
    // LocalContext.current can deliver stale values after a config change (language, dark mode,
    // rotation) (Lint: LocalContextGetResourceValueCall). In
    // the composition, Compose re-evaluates it on a change.
    val noAppText = stringResource(R.string.common_no_app_to_open)
    // Snackbar in its own scaffold instead of Toast: stays readable until TalkBack is done.
    val meldungen = remember { SnackbarHostState() }
    val bereich = rememberCoroutineScope()

    val rollen = rememberScrollState()

    Scaffold(
        snackbarHost = { SnackbarHost(meldungen) },
        // The name sits in the bar as in the set detail (DetailTopAppBar), not only in the content.
        topBar = { DetailTopAppBar(titel = detail?.name ?: setNumber, onZurueck = onBack) }
    ) { padding ->
        when {
            geladen is Laden.Fehler -> StateHint(Modifier.padding(padding)) {
                ErrorHint(geladen.meldung.satz(), { onLoad(setNumber) }, geladen.art)
            }
            detail == null -> LoadCircle(Modifier.padding(padding))
            else -> CatalogDetailContent(
                detail, serverUrl, imageLoader, gemerkt, rollen, Modifier.padding(padding),
                onZoom = { showImageZoom = true },
                rememberOn = { if (gemerkt != null) onOpenWantedItem(gemerkt.setNumber, gemerkt.condition) else showWishDialog = true },
                captureOn = { showAddDialog = true },
                onOpenInGallery = onOpenInGallery,
                onBrickLink = { url ->
                    // Don't swallow silently: with no browser present, otherwise nothing would happen.
                    if (!openExtern(ctx, externeAddress(url))) {
                        bereich.launch { meldungen.showSnackbar(noAppText) }
                    }
                },
            )
        }
    }

    CatalogDetailDialogs(
        detail = detail, merken = showWishDialog, aufnehmen = showAddDialog, zoom = showImageZoom,
        defaultCondition = defaultCondition, householdMembers = householdMembers,
        lagerorte = lagerorte, locationDefault = locationDefault, serverUrl = serverUrl, imageLoader = imageLoader,
        onWish = onWish, onAddToGallery = onAddToGallery,
        onSchliessen = { showWishDialog = false; showAddDialog = false; showImageZoom = false },
    )
}

/** Image and details; two columns from "expanded" on. */
@Composable
private fun CatalogDetailContent(
    detail: CatalogDetailView,
    serverUrl: String,
    imageLoader: ImageLoader,
    gemerkt: WantedItemView?,
    rollen: ScrollState,
    modifier: Modifier,
    onZoom: () -> Unit,
    rememberOn: () -> Unit,
    captureOn: () -> Unit,
    onOpenInGallery: (String) -> Unit,
    onBrickLink: (String) -> Unit,
) {
    val ctx = LocalContext.current
    BoxWithConstraints(modifier.fillMaxSize()) {
        // Via the server proxy — full resolution; the downloaded file takes
        // priority, the same server check as in the catalog list.
        val fullUrl = remember(detail.setNumber, serverUrl) {
            resolveFullUrl(serverUrl, detail.imageLocal, detail.imageUrl)
        }
        // Tapping opens the zoom as in the set detail. White image background, muted
        // in the dark — like the set detail, instead of a glaring surface.
        val bild: @Composable (Modifier) -> Unit = { m ->
            ProduktBild(
                model = fullUrl?.let { ImageRequest.Builder(ctx).data(it).crossfade(!movementReduced()).build() },
                imageLoader = imageLoader,
                contentDescription = detail.name,
                modifier = m.clip(Formen.karte)
                    .clickable(enabled = fullUrl != null, onClickLabel = stringResource(R.string.cd_bild_vergroessern), role = Role.Button) { onZoom() },
                contentScale = androidx.compose.ui.layout.ContentScale.Fit,
                fallbackSize = 64.dp,
                bildgrund = true,
                innerGap = Abstaende.mittel,
            )
        }
        val angaben: @Composable ColumnScope.() -> Unit = {
            CatalogDetails(
                detail = detail,
                gemerkt = gemerkt,
                rememberOn = rememberOn,
                captureOn = captureOn,
                onOpenInGallery = onOpenInGallery,
                onBrickLink = onBrickLink,
            )
        }
        // Two columns from "expanded" on, like the set detail: image left, details and
        // actions right. Single-column, the table and buttons ran across the whole
        // tablet width, "Year" stood an arm's length from "2022".
        if (twoSpaltig(maxWidth.value)) {
            Row(Modifier.fillMaxSize().padding(horizontal = Abstaende.gross),
                horizontalArrangement = Arrangement.spacedBy(Abstaende.veryLarge)) {
                Box(Modifier.weight(1f).fillMaxHeight().padding(vertical = Abstaende.gross),
                    contentAlignment = Alignment.TopCenter) {
                    bild(Modifier.widthIn(max = IMAGE_AT_MOST).fillMaxWidth().aspectRatio(IMAGE_RATIO))
                }
                Column(
                    Modifier.weight(1f).fillMaxHeight().verticalScroll(rollen).padding(vertical = Abstaende.gross),
                    verticalArrangement = Arrangement.spacedBy(Abstaende.mittel),
                ) { angaben() }
            }
        } else Column(
            Modifier.fillMaxSize().verticalScroll(rollen).padding(Abstaende.gross),
            verticalArrangement = Arrangement.spacedBy(Abstaende.mittel),
        ) {
            bild(Modifier.fillMaxWidth().height(220.dp))
            angaben()
        }
    }
}

/** Watchlist, add and zoom of the catalog detail; [onSchliessen] closes whatever is open. */
@Composable
private fun CatalogDetailDialogs(
    detail: CatalogDetailView?,
    merken: Boolean,
    aufnehmen: Boolean,
    zoom: Boolean,
    defaultCondition: Zustand,
    householdMembers: List<MemberView>,
    lagerorte: List<String>,
    locationDefault: String,
    serverUrl: String,
    imageLoader: ImageLoader,
    onWish: (Merkwunsch) -> Unit,
    onAddToGallery: (Erfassungswunsch) -> Unit,
    onSchliessen: () -> Unit,
) {
    if (merken && detail != null) {
        MerkpostenDialog(
            setName = detail.name ?: detail.setNumber,
            defaultCondition = defaultCondition,
            householdMembers = householdMembers,
            onDismiss = onSchliessen,
            onWish = { zustand, richtung, schwelle, konto ->
                onWish(Merkwunsch(detail.setNumber, zustand, richtung, schwelle, konto))
                onSchliessen()
            },
        )
    }

    if (aufnehmen && detail != null) {
        CatalogAddDialog(
            setName = detail.name ?: detail.setNumber,
            defaultCondition = defaultCondition,
            householdMembers = householdMembers,
            lagerorte = lagerorte,
            locationDefault = locationDefault,
            onDismiss = onSchliessen,
            onAdd = { wish ->
                onSchliessen()
                onAddToGallery(wish.copy(setNumber = detail.setNumber))
            }
        )
    }

    if (zoom) {
        // The same address as the preview image above: resolveFullUrl() already
        // delivers the full resolution (no thumb) — a second call with
        // different values would only drift apart.
        val zoomUrl = resolveFullUrl(serverUrl, detail?.imageLocal, detail?.imageUrl)
        if (zoomUrl != null) {
            ZoomableImageDialog(
                imageUrl = zoomUrl,
                contentDescription = detail?.name,
                imageLoader = imageLoader,
                onDismiss = onSchliessen
            )
        }
    }
}

/** Aspect ratio of set images; on the tablet the image has its own column this way. */
private const val IMAGE_RATIO = 4f / 3f

/** Larger than the source, a set image only gets blurry; next to it there's room for the details. */
private val IMAGE_AT_MOST = 480.dp

/** The set's details as a table, with ownership and the watchlist item, when they exist. */
@Composable
private fun CatalogTable(detail: CatalogDetailView, gemerkt: WantedItemView?) {
    Card(shape = Formen.karte, colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.4f))) {
        Column(Modifier.padding(Abstaende.edge), verticalArrangement = Arrangement.spacedBy(Abstaende.klein)) {
            CatalogDetailRow(stringResource(R.string.catalog_detail_year),   detail.year?.toString() ?: "—")
            CatalogDetailRow(stringResource(R.string.catalog_detail_theme),  detail.themeName ?: "—")
            CatalogDetailRow(stringResource(R.string.catalog_detail_parts),  detail.numParts?.takeIf { it > 0 }?.let { fmtInt(it) } ?: "—")
            CatalogDetailRow(stringResource(R.string.catalog_detail_minifigs), if (detail.minifigs > 0) detail.minifigs.toString() else "—")
            if (detail.owned) {
                CatalogDetailRow(stringResource(R.string.catalog_owned), "✓ ×${detail.ownedQuantity}")
            }
            // If the set is already on the watchlist, the table says so — with condition and alert.
            if (gemerkt != null) CatalogDetailRow(stringResource(R.string.catalog_auf_merkliste), wantedItemText(gemerkt))
        }
    }
}

/**
 * Number, details and actions; the name sits in the bar. The app's own actions
 * first (add, watchlist), the path outward as a text button with an arrow below:
 * it used to sit above them and looked like the main action.
 */
@Composable
private fun ColumnScope.CatalogDetails(
    detail: CatalogDetailView,
    gemerkt: WantedItemView?,
    rememberOn: () -> Unit,
    captureOn: () -> Unit,
    onOpenInGallery: (String) -> Unit,
    onBrickLink: (String) -> Unit,
) {
    // Not tappable, hence not in the color of links and buttons.
    Text(detail.setNumber, color = MaterialTheme.colorScheme.onSurfaceVariant,
        fontWeight = FontWeight.SemiBold, style = MaterialTheme.typography.bodyMedium)

    CatalogTable(detail, gemerkt)

    // Stacked at full width as in the watchlist-item detail: side by side,
    // "Add to collection" was already truncated at normal font size. Adding is the
    // more frequent action and sits on top, filled, watchlisting below, outlined.
    // At most control width: on the tablet the buttons otherwise ran across the whole column.
    val button = Modifier.widthIn(max = Lesebreite.controls).fillMaxWidth()
    Button(onClick = captureOn, modifier = button) {
        Icon(Icons.Default.Add, null, Modifier.size(withFont(18.dp)))
        Spacer(Modifier.width(Abstaende.klein))
        Text(stringResource(if (detail.owned) R.string.catalog_add_again else R.string.catalog_add_to_gallery),
            textAlign = TextAlign.Center)
    }
    // Watchlisted: go to the watchlist item instead of watchlisting a second time.
    OutlinedButton(onClick = rememberOn, modifier = button, colors = nebenKnopfFarben(), border = nebenKnopfRand()) {
        Icon(if (gemerkt != null) Icons.Default.Bookmark else Icons.Default.BookmarkAdd, null, Modifier.size(withFont(18.dp)))
        Spacer(Modifier.width(Abstaende.klein))
        Text(stringResource(if (gemerkt != null) R.string.catalog_merkposten_oeffnen else R.string.wanted_add_submit),
            textAlign = TextAlign.Center)
    }
    if (detail.owned) {
        OutlinedButton(onClick = { onOpenInGallery(detail.setNumber) }, modifier = button, colors = nebenKnopfFarben(), border = nebenKnopfRand()) {
            Icon(Icons.Default.Check, null, Modifier.size(withFont(18.dp)))
            Spacer(Modifier.width(Abstaende.klein))
            Text(stringResource(R.string.catalog_open_in_gallery))
        }
    }

    // The buy URL comes ready-made from the server — for gear and books the parameters and
    // number would differ from sets; the fallback stays for older servers. For
    // collectible minifigures the server delivers a search URL and exact = false.
    val bl = detail.bricklink
    val blUrl = bl?.url ?: BrickLinkUrls.searchFor(detail.setNumber)
    val blLabel = if (bl != null && !bl.exact) R.string.catalog_search_bricklink else R.string.catalog_buy_bricklink
    // As wide as the buttons above: centered on its own it stood off their axis on the tablet.
    TextButton(onClick = { onBrickLink(blUrl) }, modifier = button) {
        Icon(Icons.Default.ShoppingCart, null, Modifier.size(withFont(18.dp)))
        Spacer(Modifier.width(Abstaende.klein))
        Text(stringResource(blLabel))
        Spacer(Modifier.width(Abstaende.tiny))
        Icon(Icons.AutoMirrored.Filled.OpenInNew, null, Modifier.size(withFont(16.dp)))
    }
}

/** "New, alert below CHF 349.00" — condition and alert of a watchlist item in one line. */
@Composable
private fun wantedItemText(m: WantedItemView): String {
    val zustand = stringResource(if (m.condition == Zustand.GEBRAUCHT) R.string.condition_used else R.string.condition_new)
    val alarm = m.alarm?.let { a ->
        stringResource(if (a.richtung == Alarmrichtung.UEBER) R.string.wanted_alert_above else R.string.wanted_alert_below,
            fmtMoney(a.schwelle, m.waehrung))
    }
    return listOfNotNull(zustand, alarm).joinToString(", ")
}

/** Ask quantity/price/condition — like AddSetDialog, but without a set-number field. */
@Composable
private fun CatalogAddDialog(
    setName: String,
    defaultCondition: Zustand,
    householdMembers: List<MemberView>,
    /** Stock of storage locations — empty means: there are none yet, then it's typed in. */
    lagerorte: List<String>,
    /** The preselected storage location (star in settings). Empty means: no default. */
    locationDefault: String = "",
    onDismiss: () -> Unit,
    /** Without a set number: the detail the dialog belongs to sets it. */
    onAdd: (Erfassungswunsch) -> Unit
) {
    var quantity      by rememberSaveable { mutableStateOf("1") }
    var purchasePrice by rememberSaveable { mutableStateOf("") }
    var condition     by rememberSaveable { mutableStateOf(defaultCondition) }
    // Key is the default: it comes over the network and can arrive after
    // opening. An own input stays as is, because the default
    // doesn't change after that.
    var lagerort      by rememberSaveable(locationDefault) { mutableStateOf(locationDefault) }
    // Pre-filled with one's own account, exactly as in the gallery dialog.
    val eigenes = householdMembers.firstOrNull { it.isSelf }?.id
    var owner         by remember(householdMembers) { mutableStateOf(eigenes) }

    // The shared frame (AddDialog): title as heading and window name, scrollable
    // and full-screen at large font sizes; both were missing before.
    AddDialog(
        titel = stringResource(R.string.catalog_add_to_gallery),
        bestaetigen = stringResource(R.string.catalog_add_confirm),
        onBestaetigen = { onAdd(Erfassungswunsch(
            setNumber = "",
            menge = quantity.toIntOrNull() ?: 1,
            kaufpreis = NumericInput.readMoney(purchasePrice),
            zustand = condition,
            // Without a household, send nothing at all — the server then stays
            // on one's own account (same rule as in the gallery dialog).
            besitzer = if (householdMembers.size > 1) owner else null,
            lagerort = lagerort.trim().takeIf { it.isNotEmpty() },
        )) },
        onAbbrechen = onDismiss,
        confirmAn = !entryInvalid(quantity, purchasePrice),
        geaendert = quantity != "1" || purchasePrice.isNotEmpty() || condition != defaultCondition ||
            lagerort != locationDefault || owner != eigenes,
    ) {
        Text(setName, fontWeight = FontWeight.SemiBold)
        // Hides itself with fewer than two members.
        OwnerPicker(householdMembers, owner, { owner = it })
        // Quantity and price as in the gallery's entry dialog: filtered and with the matching keyboard.
        OutlinedTextField(
            shape = Formen.feld,
            value = quantity,
            onValueChange = { quantity = NumericInput.quantity(it) },
            label = { Text(stringResource(R.string.common_quantity)) },
            isError = NumericInput.quantityInvalid(quantity),
            supportingText = { if (NumericInput.quantityInvalid(quantity)) Text(stringResource(R.string.erfassen_menge_ungueltig), Modifier.announce()) },
            singleLine = true, modifier = Modifier.fillMaxWidth(),
            keyboardOptions = NumericInput.ganzzahlTastatur()
        )
        OutlinedTextField(
            shape = Formen.feld,
            value = purchasePrice,
            onValueChange = { purchasePrice = NumericInput.price(it) },
            label = { Text(stringResource(R.string.gallery_purchase_price)) },
            isError = NumericInput.priceInvalid(purchasePrice),
            supportingText = { if (NumericInput.priceInvalid(purchasePrice)) Text(stringResource(R.string.erfassen_preis_ungueltig), Modifier.announce()) },
            singleLine = true, modifier = Modifier.fillMaxWidth(),
            keyboardOptions = NumericInput.priceKeyboard()
        )
        Zustandszeile(zustand = condition, onZustand = { condition = it })
        LagerortErfassung(lagerort, lagerorte, { lagerort = it })
    }
}

/**
 * Condition and price alert for a watchlist item. No quantity and no purchase price:
 * a watchlist item has neither, those are only asked when taking it over. The
 * alert is optional and sits under its own heading — whoever just wants to watchlist
 * it leaves the field empty.
 */
@Composable
private fun MerkpostenDialog(
    setName: String,
    defaultCondition: Zustand,
    /** Household accounts — without sub-accounts, the picker hides itself. */
    householdMembers: List<MemberView>,
    onDismiss: () -> Unit,
    onWish: (Zustand, Alarmrichtung, String, Int?) -> Unit,
) {
    var zustand  by rememberSaveable { mutableStateOf(defaultCondition) }
    var richtung by rememberSaveable { mutableStateOf(Alarmrichtung.UNTER) }
    var schwelle by rememberSaveable { mutableStateOf("") }
    // Pre-filled with one's own account, exactly as in the entry dialog next to it.
    var konto    by remember(householdMembers) {
        mutableStateOf(householdMembers.firstOrNull { it.isSelf }?.id)
    }

    // The same frame as "Watchlist set" in the watchlist and every entry.
    AddDialog(
        titel = stringResource(R.string.wanted_add_submit),
        bestaetigen = stringResource(R.string.wanted_add_submit),
        onBestaetigen = { onWish(zustand, richtung, schwelle,
            // Without a household, send nothing at all — then the server stays
            // on one's own account (same rule as in the entry dialog).
            if (householdMembers.size > 1) konto else null) },
        onAbbrechen = onDismiss,
        geaendert = schwelle.isNotEmpty() || zustand != defaultCondition || richtung != Alarmrichtung.UNTER,
    ) {
                Text(setName, style = MaterialTheme.typography.bodyMedium)
                // Target account as when entering; hides itself with fewer than
                // two members.
                OwnerPicker(householdMembers, konto, { konto = it })
                Zustandszeile(zustand = zustand, onZustand = { zustand = it })
                HorizontalDivider()
                Text(stringResource(R.string.detail_alert),
                     style = MaterialTheme.typography.labelLarge)
                SegmentChoice(
                    optionen = listOf(Alarmrichtung.UNTER to stringResource(R.string.detail_alert_chip_below),
                                      Alarmrichtung.UEBER to stringResource(R.string.detail_alert_chip_above)),
                    gewaehlt = richtung,
                    onWahl = { richtung = it },
                )
                // A threshold is a price — the same input rule and
                // the same keyboard as everywhere (util/NumericInput.kt).
                OutlinedTextField(
                    shape = Formen.feld,
                    value = schwelle,
                    onValueChange = { schwelle = NumericInput.price(it) },
                    label = { Text(stringResource(R.string.wanted_threshold)) },
                    singleLine = true,
                    keyboardOptions = NumericInput.priceKeyboard(),
                    modifier = Modifier.fillMaxWidth(),
                )
    }
}
