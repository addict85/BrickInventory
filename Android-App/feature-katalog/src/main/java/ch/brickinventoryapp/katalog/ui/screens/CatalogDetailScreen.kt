package ch.brickinventoryapp.katalog.ui.screens

import androidx.compose.foundation.ScrollState
import ch.brickinventoryapp.model.fach.Alarmrichtung
import ch.brickinventoryapp.katalog.ui.Merkwunsch
import ch.brickinventoryapp.model.fach.Erfassungswunsch
import ch.brickinventoryapp.model.fach.Zustand
import androidx.compose.material.icons.filled.Bookmark
import ch.brickinventoryapp.ui.util.fmtMoney
import ch.brickinventoryapp.ui.components.AddDialog
import ch.brickinventoryapp.model.fach.WantedItemView
import ch.brickinventoryapp.ui.components.nebenKnopfFarben
import ch.brickinventoryapp.ui.components.nebenKnopfRand
import androidx.compose.ui.draw.clip
import ch.brickinventoryapp.model.fach.CatalogDetailView
import ch.brickinventoryapp.model.fach.MemberView
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
import ch.brickinventoryapp.ressourcen.R
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
import ch.brickinventoryapp.gemeinsam.ui.entryInvalid
import ch.brickinventoryapp.ui.components.SegmentChoice
import ch.brickinventoryapp.ui.components.movementReduced
import ch.brickinventoryapp.ui.components.withFont
import ch.brickinventoryapp.ui.theme.Lesebreite
import ch.brickinventoryapp.ui.util.fmtInt
import ch.brickinventoryapp.netz.util.externeAddress
import ch.brickinventoryapp.ui.util.openExtern
import ch.brickinventoryapp.ui.components.CatalogDetailRow
import ch.brickinventoryapp.gemeinsam.ui.LagerortErfassung
import ch.brickinventoryapp.gemeinsam.ui.OwnerPicker
import ch.brickinventoryapp.gemeinsam.ui.Zustandszeile

/**
 * Katalog-Detail: Bild, Metadaten (Jahr, Thema, Teile, Minifiguren) und
 * "In Galerie aufnehmen"-Button mit Anzahl/Preis/Zustand-Dialog.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun CatalogDetailScreen(
    setNumber: String,
    /** Ein Fehler steht mit „Erneut versuchen“ statt des Kringels. */
    geladen: Laden<CatalogDetailView>,
    imageLoader: ImageLoader,
    serverUrl: String,
    defaultCondition: Zustand = Zustand.NEU,
    /** Mitglieder des Haushalts — die Kontowahl blendet sich ohne sie selbst aus. */
    householdMembers: List<MemberView> = emptyList(),
    /** Vorrat an Lagerorten fuer den Erfassungsdialog. */
    lagerorte: List<String> = emptyList(),
    /** Der vorausgewählte Lagerort (Stern in den Einstellungen). Leer heisst: keine Vorgabe. */
    locationDefault: String = "",
    onLoad: (String) -> Unit,
    onAddToGallery: (Erfassungswunsch) -> Unit,
    /** Auf die Merkliste; das Zielkonto wie im Erfassungsdialog und in der Webapp (cat-m-owner). */
    onWish: (Merkwunsch) -> Unit,
    onOpenInGallery: (String) -> Unit,
    onBack: () -> Unit,
    /** Der Merkposten zu diesem Set, falls es schon auf der Merkliste steht. */
    gemerkt: WantedItemView? = null,
    /** Den Merkposten öffnen — Setnummer und Zustand. */
    onOpenWantedItem: (String, Zustand) -> Unit = { _, _ -> },
) {
    val detail = geladen.dataOrNull()
    LaunchedEffect(setNumber) { onLoad(setNumber) }
    var showAddDialog by rememberSaveable { mutableStateOf(false) }
    var showWishDialog by rememberSaveable { mutableStateOf(false) }
    // Bildschirmfüllender Zoom wie im Set-Detail — auf Nutzerwunsch auch hier.
    var showImageZoom by rememberSaveable { mutableStateOf(false) }
    val ctx = LocalContext.current
    // `stringResource` statt `ctx.getString` im Rückruf: Ein aus LocalContext.current
    // gegriffener Context kann nach einem Konfigurationswechsel (Sprache, Dunkelmodus,
    // Drehung) veraltete Werte liefern (Lint: LocalContextGetResourceValueCall). In
    // der Komposition wertet Compose bei einer Änderung neu aus.
    val noAppText = stringResource(R.string.common_no_app_to_open)
    // Snackbar im eigenen Gerüst statt Toast: bleibt lesbar, bis TalkBack fertig ist.
    val meldungen = remember { SnackbarHostState() }
    val bereich = rememberCoroutineScope()

    val rollen = rememberScrollState()

    Scaffold(
        snackbarHost = { SnackbarHost(meldungen) },
        // Der Name steht in der Leiste wie im Set-Detail (DetailTopAppBar), nicht erst im Inhalt.
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
                    // Nicht still schlucken: Ist kein Browser da, passierte sonst nichts.
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

/** Bild und Angaben; ab „expanded“ in zwei Spalten. */
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
        // Über den Server-Proxy — volle Auflösung; die heruntergeladene Datei geht
        // vor, derselbe Server-Check wie in der Katalog-Liste.
        val fullUrl = remember(detail.setNumber, serverUrl) {
            resolveFullUrl(serverUrl, detail.imageLocal, detail.imageUrl)
        }
        // Antippen öffnet den Zoom wie im Set-Detail. Weisser Bildgrund, im Dunkeln
        // gedämpft — wie das Set-Detail, statt einer grellen Fläche.
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
        // Ab „expanded“ zwei Spalten wie das Set-Detail: Bild links, Angaben und
        // Handlungen rechts. Einspaltig liefen Tabelle und Knöpfe über die ganze
        // Tablet-Breite, „Jahr“ stand eine Armlänge von „2022“.
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

/** Merken, Aufnehmen und Zoom des Katalog-Details; [onSchliessen] schliesst, was offen ist. */
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
        // Dieselbe Adresse wie das Vorschaubild oben: resolveFullUrl() liefert
        // bereits die volle Auflösung (kein Thumb) — ein zweiter Aufruf mit
        // anderen Werten würde nur auseinanderlaufen.
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

/** Seitenverhältnis der Setbilder; auf dem Tablet hat das Bild so seine eigene Spalte. */
private const val IMAGE_RATIO = 4f / 3f

/** Grösser als die Vorlage wird ein Setbild nur unscharf; daneben bleibt Platz für die Angaben. */
private val IMAGE_AT_MOST = 480.dp

/** Die Angaben des Sets als Tabelle, mit Besitz und Merkposten, wenn es sie gibt. */
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
            // Steht das Set schon auf der Merkliste, sagt es die Tabelle — mit Zustand und Alarm.
            if (gemerkt != null) CatalogDetailRow(stringResource(R.string.catalog_auf_merkliste), wantedItemText(gemerkt))
        }
    }
}

/**
 * Nummer, Angaben und Handlungen; der Name steht in der Leiste. Die eigenen Handlungen
 * zuerst (Aufnehmen, Merken), der Weg nach draussen als Textknopf mit Pfeil darunter:
 * Er stand über ihnen und sah aus wie die Haupthandlung.
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
    // Nicht antippbar, darum nicht in der Farbe der Links und Knöpfe.
    Text(detail.setNumber, color = MaterialTheme.colorScheme.onSurfaceVariant,
        fontWeight = FontWeight.SemiBold, style = MaterialTheme.typography.bodyMedium)

    CatalogTable(detail, gemerkt)

    // Untereinander in voller Breite wie im Merkposten-Detail: Nebeneinander war
    // „Zur Sammlung hinzufügen“ schon bei normaler Schrift gekürzt. Aufnehmen ist die
    // häufigere Handlung und steht oben und gefüllt, Merken darunter umrandet.
    // Höchstens Bedienbreite: Auf dem Tablet liefen die Knöpfe sonst über die ganze Spalte.
    val button = Modifier.widthIn(max = Lesebreite.controls).fillMaxWidth()
    Button(onClick = captureOn, modifier = button) {
        Icon(Icons.Default.Add, null, Modifier.size(withFont(18.dp)))
        Spacer(Modifier.width(Abstaende.klein))
        Text(stringResource(if (detail.owned) R.string.catalog_add_again else R.string.catalog_add_to_gallery),
            textAlign = TextAlign.Center)
    }
    // Gemerkt: zum Merkposten statt ein zweites Mal merken.
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

    // Die Kauf-URL kommt fertig vom Server — für Gear und Bücher wären Parameter und
    // Nummer anders als bei Sets; der Rückfall bleibt für ältere Server. Bei
    // Sammelminifiguren liefert der Server eine Such-URL und exact = false.
    val bl = detail.bricklink
    val blUrl = bl?.url ?: BrickLinkUrls.searchFor(detail.setNumber)
    val blLabel = if (bl != null && !bl.exact) R.string.catalog_search_bricklink else R.string.catalog_buy_bricklink
    // So breit wie die Knöpfe darüber: Mittig für sich stand er auf dem Tablet neben ihrer Achse.
    TextButton(onClick = { onBrickLink(blUrl) }, modifier = button) {
        Icon(Icons.Default.ShoppingCart, null, Modifier.size(withFont(18.dp)))
        Spacer(Modifier.width(Abstaende.klein))
        Text(stringResource(blLabel))
        Spacer(Modifier.width(Abstaende.tiny))
        Icon(Icons.AutoMirrored.Filled.OpenInNew, null, Modifier.size(withFont(16.dp)))
    }
}

/** „Neu, Alarm unter CHF 349.00“ — Zustand und Alarm eines Merkpostens in einer Zeile. */
@Composable
private fun wantedItemText(m: WantedItemView): String {
    val zustand = stringResource(if (m.condition == Zustand.GEBRAUCHT) R.string.condition_used else R.string.condition_new)
    val alarm = m.alarm?.let { a ->
        stringResource(if (a.richtung == Alarmrichtung.UEBER) R.string.wanted_alert_above else R.string.wanted_alert_below,
            fmtMoney(a.schwelle, m.waehrung))
    }
    return listOfNotNull(zustand, alarm).joinToString(", ")
}

/** Anzahl/Preis/Zustand abfragen — wie AddSetDialog, aber ohne Setnummern-Feld. */
@Composable
private fun CatalogAddDialog(
    setName: String,
    defaultCondition: Zustand,
    householdMembers: List<MemberView>,
    /** Vorrat an Lagerorten — leer heisst: es gibt noch keine, dann wird getippt. */
    lagerorte: List<String>,
    /** Der vorausgewählte Lagerort (Stern in den Einstellungen). Leer heisst: keine Vorgabe. */
    locationDefault: String = "",
    onDismiss: () -> Unit,
    /** Ohne Setnummer: Die setzt das Detail, zu dem der Dialog gehört. */
    onAdd: (Erfassungswunsch) -> Unit
) {
    var quantity      by rememberSaveable { mutableStateOf("1") }
    var purchasePrice by rememberSaveable { mutableStateOf("") }
    var condition     by rememberSaveable { mutableStateOf(defaultCondition) }
    // Schluessel ist die Vorgabe: Sie kommt ueber das Netz und kann nach dem
    // Oeffnen eintreffen. Eine eigene Eingabe bleibt stehen, weil sich die
    // Vorgabe danach nicht mehr aendert.
    var lagerort      by rememberSaveable(locationDefault) { mutableStateOf(locationDefault) }
    // Vorbelegt mit dem eigenen Konto, genau wie im Galerie-Dialog.
    val eigenes = householdMembers.firstOrNull { it.isSelf }?.id
    var owner         by remember(householdMembers) { mutableStateOf(eigenes) }

    // Der gemeinsame Rahmen (AddDialog): Titel als Überschrift und Fenstername, rollbar
    // und bei grosser Schrift Vollbild; vorher fehlte beides.
    AddDialog(
        titel = stringResource(R.string.catalog_add_to_gallery),
        bestaetigen = stringResource(R.string.catalog_add_confirm),
        onBestaetigen = { onAdd(Erfassungswunsch(
            setNumber = "",
            menge = quantity.toIntOrNull() ?: 1,
            kaufpreis = NumericInput.readMoney(purchasePrice),
            zustand = condition,
            // Ohne Haushalt gar nichts mitschicken — der Server bleibt dann
            // beim eigenen Konto (gleiche Regel wie im Galerie-Dialog).
            besitzer = if (householdMembers.size > 1) owner else null,
            lagerort = lagerort.trim().takeIf { it.isNotEmpty() },
        )) },
        onAbbrechen = onDismiss,
        confirmAn = !entryInvalid(quantity, purchasePrice),
        geaendert = quantity != "1" || purchasePrice.isNotEmpty() || condition != defaultCondition ||
            lagerort != locationDefault || owner != eigenes,
    ) {
        Text(setName, fontWeight = FontWeight.SemiBold)
        // Blendet sich bei weniger als zwei Mitgliedern selbst aus.
        OwnerPicker(householdMembers, owner, { owner = it })
        // Menge und Preis wie im Erfassen-Dialog der Galerie: gefiltert und mit der passenden Tastatur.
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
 * Zustand und Preisalarm für einen Merkposten. Keine Anzahl und kein Kaufpreis:
 * Ein Merkposten hat beides nicht, es wird erst bei der Übernahme gefragt. Der
 * Alarm ist optional und steht unter eigener Überschrift — wer nur merken will,
 * lässt das Feld leer.
 */
@Composable
private fun MerkpostenDialog(
    setName: String,
    defaultCondition: Zustand,
    /** Konten des Haushalts — ohne Unterkonten blendet sich die Wahl selbst aus. */
    householdMembers: List<MemberView>,
    onDismiss: () -> Unit,
    onWish: (Zustand, Alarmrichtung, String, Int?) -> Unit,
) {
    var zustand  by rememberSaveable { mutableStateOf(defaultCondition) }
    var richtung by rememberSaveable { mutableStateOf(Alarmrichtung.UNTER) }
    var schwelle by rememberSaveable { mutableStateOf("") }
    // Vorbelegt mit dem eigenen Konto, genau wie im Erfassungsdialog daneben.
    var konto    by remember(householdMembers) {
        mutableStateOf(householdMembers.firstOrNull { it.isSelf }?.id)
    }

    // Derselbe Rahmen wie „Set merken“ in der Merkliste und jedes Erfassen.
    AddDialog(
        titel = stringResource(R.string.wanted_add_submit),
        bestaetigen = stringResource(R.string.wanted_add_submit),
        onBestaetigen = { onWish(zustand, richtung, schwelle,
            // Ohne Haushalt gar nichts mitschicken — dann bleibt der Server
            // beim eigenen Konto (gleiche Regel wie im Erfassungsdialog).
            if (householdMembers.size > 1) konto else null) },
        onAbbrechen = onDismiss,
        geaendert = schwelle.isNotEmpty() || zustand != defaultCondition || richtung != Alarmrichtung.UNTER,
    ) {
                Text(setName, style = MaterialTheme.typography.bodyMedium)
                // Zielkonto wie beim Erfassen; blendet sich bei weniger als
                // zwei Mitgliedern selbst aus.
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
                // Eine Schwelle ist ein Preis — dieselbe Eingaberegel und
                // dieselbe Tastatur wie ueberall (util/NumericInput.kt).
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
