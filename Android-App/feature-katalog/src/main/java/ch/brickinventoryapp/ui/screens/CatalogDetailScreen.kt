package ch.brickinventoryapp.ui.screens

import androidx.compose.ui.draw.clip
import ch.brickinventoryapp.ui.components.AuswahlChip
import ch.brickinventoryapp.ui.model.KatalogDetailAnsicht
import ch.brickinventoryapp.ui.model.MitgliedAnsicht
import ch.brickinventoryapp.ui.theme.Formen
import android.net.Uri
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
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
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import ch.brickinventoryapp.ressourcen.R
import ch.brickinventoryapp.util.NumericInput
import ch.brickinventoryapp.util.BrickLinkUrls
import androidx.compose.foundation.clickable
import androidx.compose.ui.semantics.Role
import androidx.compose.runtime.getValue
import androidx.compose.runtime.setValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.layout.onPlaced
import androidx.compose.ui.layout.positionInParent
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import ch.brickinventoryapp.ui.zweiSpaltig
import ch.brickinventoryapp.ui.components.ZoomableImageDialog
import ch.brickinventoryapp.util.resolveFullUrl
import coil3.ImageLoader
import coil3.request.ImageRequest
import coil3.request.crossfade
import ch.brickinventoryapp.ui.theme.Abstaende
import ch.brickinventoryapp.ui.components.LeerSymbol
import androidx.compose.material.icons.filled.ViewInAr

/**
 * Katalog-Detail: Bild, Metadaten (Jahr, Thema, Teile, Minifiguren) und
 * "In Galerie aufnehmen"-Button mit Anzahl/Preis/Zustand-Dialog.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun CatalogDetailScreen(
    setNumber: String,
    detail: KatalogDetailAnsicht?,
    isLoading: Boolean,
    imageLoader: ImageLoader,
    serverUrl: String,
    defaultCondition: String = "N",
    /** Mitglieder des Haushalts — die Kontowahl blendet sich ohne sie selbst aus. */
    householdMembers: List<MitgliedAnsicht> = emptyList(),
    /** Vorrat an Lagerorten fuer den Erfassungsdialog. */
    lagerorte: List<String> = emptyList(),
    /** Der vorausgewählte Lagerort (Stern in den Einstellungen). Leer heisst: keine Vorgabe. */
    lagerortVorgabe: String = "",
    onLoad: (String) -> Unit,
    onAddToGallery: (String, Int, Double?, String?, Int?, String?) -> Unit,
    /**
     * Auf die Merkliste — Setnummer, Zustand, Alarmrichtung, Schwelle (roh) und
     * Zielkonto. Die Schwelle kommt als Text: Leer heisst „kein Alarm“, nicht
     * „Schwelle 0“, und die Umwandlung gehört an die eine Stelle, die sie kann
     * (alarm/Alarmeingabe.kt). Das Zielkonto wie im Erfassungsdialog und in der Webapp
     * (cat-m-owner).
     */
    onWish: (String, String, String, String, Int?) -> Unit,
    onOpenInGallery: (String) -> Unit,
    onBack: () -> Unit
) {
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
    val keineAppText = stringResource(R.string.common_no_app_to_open)

    val rollen = rememberScrollState()
    // Wo die Überschrift im gerollten Inhalt endet. Erst wenn sie unter der App-Leiste
    // verschwunden ist, steht der Name oben — vorher stand er zweimal da.
    var kopfUnten by remember { mutableFloatStateOf(Float.MAX_VALUE) }
    val titelOben by remember { derivedStateOf { rollen.value > kopfUnten } }

    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    if (titelOben) Text(detail?.name ?: setNumber, maxLines = 1, overflow = TextOverflow.Ellipsis)
                },
                navigationIcon = { ch.brickinventoryapp.ui.components.ZurueckKnopf(onBack) }
            )
        }
    ) { padding ->
        when {
            isLoading || detail == null -> Box(Modifier.fillMaxSize().padding(padding), Alignment.Center) {
                CircularProgressIndicator()
            }
            else -> BoxWithConstraints(Modifier.fillMaxSize().padding(padding)) {
                // Über den Server-Proxy — volle Auflösung; die heruntergeladene Datei geht
                // vor, derselbe Server-Check wie in der Katalog-Liste.
                val fullUrl = remember(detail.setNumber, serverUrl) {
                    resolveFullUrl(serverUrl, detail.imageLocal, detail.imageUrl)
                }
                // Antippen öffnet den Zoom wie im Set-Detail. Weisser Bildgrund, im Dunkeln
                // gedämpft — wie das Set-Detail, statt einer grellen Fläche.
                val bild: @Composable (Modifier) -> Unit = { m ->
                    ch.brickinventoryapp.ui.components.ProduktBild(
                        model = fullUrl?.let { ImageRequest.Builder(ctx).data(it).crossfade(true).build() },
                        imageLoader = imageLoader,
                        contentDescription = detail.name,
                        modifier = m.clip(Formen.karte)
                            .clickable(enabled = fullUrl != null, role = Role.Button) { showImageZoom = true },
                        contentScale = androidx.compose.ui.layout.ContentScale.Fit,
                        ersatzGroesse = 64.dp,
                        bildgrund = true,
                        innenAbstand = Abstaende.mittel,
                    )
                }
                val angaben: @Composable ColumnScope.() -> Unit = {
                    KatalogAngaben(
                        detail = detail,
                        onKopf = { kopfUnten = it },
                        onMerken = { showWishDialog = true },
                        onAufnehmen = { showAddDialog = true },
                        onOpenInGallery = onOpenInGallery,
                        onBrickLink = { url ->
                            // Nicht still schlucken: Ist kein Browser da, passierte sonst nichts.
                            if (!ch.brickinventoryapp.util.oeffneExtern(ctx, url)) {
                                android.widget.Toast.makeText(ctx, keineAppText,
                                    android.widget.Toast.LENGTH_SHORT).show()
                            }
                        },
                    )
                }
                // Ab „expanded“ zwei Spalten wie das Set-Detail: Bild links, Angaben und
                // Handlungen rechts. Einspaltig liefen Tabelle und Knöpfe über die ganze
                // Tablet-Breite, „Jahr“ stand eine Armlänge von „2022“.
                if (zweiSpaltig(maxWidth.value)) {
                    Row(Modifier.fillMaxSize().padding(horizontal = Abstaende.gross),
                        horizontalArrangement = Arrangement.spacedBy(Abstaende.sehrGross)) {
                        Box(Modifier.weight(1f).fillMaxHeight().padding(vertical = Abstaende.gross)) {
                            bild(Modifier.fillMaxWidth().aspectRatio(BILD_VERHAELTNIS))
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
    }

    if (showWishDialog && detail != null) {
        MerkpostenDialog(
            setName = detail.name ?: detail.setNumber,
            defaultCondition = defaultCondition,
            householdMembers = householdMembers,
            onDismiss = { showWishDialog = false },
            onWish = { zustand, richtung, schwelle, konto ->
                onWish(detail.setNumber, zustand, richtung, schwelle, konto)
                showWishDialog = false
            },
        )
    }

    if (showAddDialog && detail != null) {
        CatalogAddDialog(
            setName = detail.name ?: detail.setNumber,
            defaultCondition = defaultCondition,
            householdMembers = householdMembers,
            lagerorte = lagerorte,
            lagerortVorgabe = lagerortVorgabe,
            onDismiss = { showAddDialog = false },
            onAdd = { qty, price, cond, owner, ort ->
                showAddDialog = false
                onAddToGallery(detail.setNumber, qty, price, cond, owner, ort)
            }
        )
    }

    if (showImageZoom) {
        // Dieselbe Adresse wie das Vorschaubild oben: resolveFullUrl() liefert
        // bereits die volle Auflösung (kein Thumb) — ein zweiter Aufruf mit
        // anderen Werten würde nur auseinanderlaufen.
        val zoomUrl = resolveFullUrl(serverUrl, detail?.imageLocal, detail?.imageUrl)
        if (zoomUrl != null) {
            ZoomableImageDialog(
                imageUrl = zoomUrl,
                contentDescription = detail?.name,
                imageLoader = imageLoader,
                onDismiss = { showImageZoom = false }
            )
        }
    }
}

/** Seitenverhältnis der Setbilder; auf dem Tablet hat das Bild so seine eigene Spalte. */
private const val BILD_VERHAELTNIS = 4f / 3f

/**
 * Name, Angaben und Handlungen. Die eigenen Handlungen zuerst (Aufnehmen, Merken), der
 * Weg nach draussen als Textknopf mit Pfeil darunter: Er stand über ihnen und sah aus
 * wie die Haupthandlung. [onKopf] meldet, wo die Überschrift endet.
 */
@Composable
private fun ColumnScope.KatalogAngaben(
    detail: KatalogDetailAnsicht,
    onKopf: (Float) -> Unit,
    onMerken: () -> Unit,
    onAufnehmen: () -> Unit,
    onOpenInGallery: (String) -> Unit,
    onBrickLink: (String) -> Unit,
) {
    Column(Modifier.onPlaced { onKopf(it.positionInParent().y + it.size.height) }) {
        Text(detail.name ?: "—", fontWeight = FontWeight.Bold, style = MaterialTheme.typography.titleLarge,
            modifier = Modifier.semantics { heading() })
        Text(detail.setNumber, color = MaterialTheme.colorScheme.primary,
            fontWeight = FontWeight.SemiBold, style = MaterialTheme.typography.bodyMedium)
    }

    Card(shape = Formen.karte, colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.4f))) {
        Column(Modifier.padding(Abstaende.rand), verticalArrangement = Arrangement.spacedBy(Abstaende.klein)) {
            CatalogDetailRow(stringResource(R.string.catalog_detail_year),   detail.year?.toString() ?: "—")
            CatalogDetailRow(stringResource(R.string.catalog_detail_theme),  detail.themeName ?: "—")
            CatalogDetailRow(stringResource(R.string.catalog_detail_parts),  detail.numParts?.takeIf { it > 0 }?.toString() ?: "—")
            CatalogDetailRow(stringResource(R.string.catalog_detail_minifigs), if (detail.minifigs > 0) detail.minifigs.toString() else "—")
            if (detail.owned) {
                CatalogDetailRow(stringResource(R.string.catalog_owned), "✓ ×${detail.ownedQuantity}")
            }
        }
    }

    // Aufnehmen ist die häufigere Handlung und steht deshalb vorn und gefüllt; Merken
    // daneben umrandet. labelMedium und eine Zeile, weil sich zwei Knöpfe die Breite
    // teilen — „In Galerie aufnehmen“ stünde bei labelLarge auf 360 dp über dem Rand.
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(Abstaende.klein)) {
        Button(
            onClick = onAufnehmen,
            modifier = Modifier.weight(1f),
            contentPadding = PaddingValues(horizontal = Abstaende.klein, vertical = Abstaende.klein),
        ) {
            Icon(Icons.Default.Add, null, Modifier.size(ch.brickinventoryapp.ui.components.mitSchrift(18.dp)))
            Spacer(Modifier.width(Abstaende.winzig))
            Text(stringResource(if (detail.owned) R.string.catalog_add_again else R.string.catalog_add_to_gallery),
                maxLines = 1, overflow = TextOverflow.Ellipsis, style = MaterialTheme.typography.labelMedium)
        }
        OutlinedButton(
            onClick = onMerken,
            modifier = Modifier.weight(1f),
            contentPadding = PaddingValues(horizontal = Abstaende.klein, vertical = Abstaende.klein),
        ) {
            Icon(Icons.Default.BookmarkAdd, null, Modifier.size(ch.brickinventoryapp.ui.components.mitSchrift(18.dp)))
            Spacer(Modifier.width(Abstaende.winzig))
            Text(stringResource(R.string.wanted_add_submit),
                maxLines = 1, overflow = TextOverflow.Ellipsis, style = MaterialTheme.typography.labelMedium)
        }
    }
    if (detail.owned) {
        OutlinedButton(onClick = { onOpenInGallery(detail.setNumber) }, modifier = Modifier.fillMaxWidth()) {
            Icon(Icons.Default.Check, null, Modifier.size(ch.brickinventoryapp.ui.components.mitSchrift(18.dp)))
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
    TextButton(onClick = { onBrickLink(blUrl) }, modifier = Modifier.align(Alignment.CenterHorizontally)) {
        Icon(Icons.Default.ShoppingCart, null, Modifier.size(ch.brickinventoryapp.ui.components.mitSchrift(18.dp)))
        Spacer(Modifier.width(Abstaende.klein))
        Text(stringResource(blLabel))
        Spacer(Modifier.width(Abstaende.winzig))
        Icon(Icons.AutoMirrored.Filled.OpenInNew, null, Modifier.size(ch.brickinventoryapp.ui.components.mitSchrift(16.dp)))
    }
}

/** Anzahl/Preis/Zustand abfragen — wie AddSetDialog, aber ohne Setnummern-Feld. */
@Composable
private fun CatalogAddDialog(
    setName: String,
    defaultCondition: String,
    householdMembers: List<MitgliedAnsicht>,
    /** Vorrat an Lagerorten — leer heisst: es gibt noch keine, dann wird getippt. */
    lagerorte: List<String>,
    /** Der vorausgewählte Lagerort (Stern in den Einstellungen). Leer heisst: keine Vorgabe. */
    lagerortVorgabe: String = "",
    onDismiss: () -> Unit,
    onAdd: (Int, Double?, String?, Int?, String?) -> Unit
) {
    var quantity      by rememberSaveable { mutableStateOf("1") }
    var purchasePrice by rememberSaveable { mutableStateOf("") }
    var condition     by rememberSaveable { mutableStateOf(defaultCondition) }
    // Schluessel ist die Vorgabe: Sie kommt ueber das Netz und kann nach dem
    // Oeffnen eintreffen. Eine eigene Eingabe bleibt stehen, weil sich die
    // Vorgabe danach nicht mehr aendert.
    var lagerort      by rememberSaveable(lagerortVorgabe) { mutableStateOf(lagerortVorgabe) }
    // Vorbelegt mit dem eigenen Konto, genau wie im Galerie-Dialog.
    var owner         by remember(householdMembers) {
        mutableStateOf(householdMembers.firstOrNull { it.isSelf }?.id)
    }

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(stringResource(R.string.catalog_add_to_gallery), fontWeight = FontWeight.Bold) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Text(setName, fontWeight = FontWeight.SemiBold)
                // Blendet sich bei weniger als zwei Mitgliedern selbst aus.
                OwnerPicker(householdMembers, owner, { owner = it })
                // Menge und Preis wie im Erfassen-Dialog der Galerie: gefiltert
                // UND mit der passenden Tastatur. Hier fehlte beides — derselbe
                // Dialog, zwei Bildschirme weiter, hatte es laengst.
                OutlinedTextField(
                    shape = Formen.feld,
                    value = quantity,
                    onValueChange = { quantity = NumericInput.quantity(it) },
                    label = { Text(stringResource(R.string.common_quantity)) },
                    singleLine = true, modifier = Modifier.fillMaxWidth(),
                    keyboardOptions = NumericInput.ganzzahlTastatur()
                )
                OutlinedTextField(
                    shape = Formen.feld,
                    value = purchasePrice,
                    onValueChange = { purchasePrice = NumericInput.price(it) },
                    label = { Text(stringResource(R.string.gallery_purchase_price)) },
                    singleLine = true, modifier = Modifier.fillMaxWidth(),
                    keyboardOptions = NumericInput.preisTastatur()
                )
                Zustandszeile(zustand = condition, onZustand = { condition = it })
                LagerortErfassung(lagerort, lagerorte, { lagerort = it })
            }
        },
        confirmButton = {
            Button(onClick = { onAdd(
                quantity.toIntOrNull() ?: 1,
                purchasePrice.replace(',', '.').toDoubleOrNull(),
                condition,
                // Ohne Haushalt gar nichts mitschicken — der Server bleibt dann
                // beim eigenen Konto (gleiche Regel wie im Galerie-Dialog).
                if (householdMembers.size > 1) owner else null,
                lagerort.trim().takeIf { it.isNotEmpty() }
            ) }) {
                Text(stringResource(R.string.catalog_add_confirm))
            }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text(stringResource(R.string.common_cancel)) } }
    )

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
    defaultCondition: String,
    /** Konten des Haushalts — ohne Unterkonten blendet sich die Wahl selbst aus. */
    householdMembers: List<MitgliedAnsicht>,
    onDismiss: () -> Unit,
    onWish: (String, String, String, Int?) -> Unit,
) {
    var zustand  by rememberSaveable { mutableStateOf(defaultCondition) }
    var richtung by rememberSaveable { mutableStateOf("unter") }
    var schwelle by rememberSaveable { mutableStateOf("") }
    // Vorbelegt mit dem eigenen Konto, genau wie im Erfassungsdialog daneben.
    var konto    by remember(householdMembers) {
        mutableStateOf(householdMembers.firstOrNull { it.isSelf }?.id)
    }

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(stringResource(R.string.wanted_add_submit), fontWeight = FontWeight.Bold) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(Abstaende.mittel)) {
                Text(setName, style = MaterialTheme.typography.bodyMedium)
                // Zielkonto wie beim Erfassen; blendet sich bei weniger als
                // zwei Mitgliedern selbst aus.
                OwnerPicker(householdMembers, konto, { konto = it })
                Zustandszeile(zustand = zustand, onZustand = { zustand = it })
                HorizontalDivider()
                Text(stringResource(R.string.detail_alert),
                     style = MaterialTheme.typography.labelLarge)
                ch.brickinventoryapp.ui.components.SegmentWahl(
                    optionen = listOf("unter" to stringResource(R.string.detail_alert_chip_below),
                                      "ueber" to stringResource(R.string.detail_alert_chip_above)),
                    gewaehlt = richtung,
                    onWahl = { richtung = it },
                )
                // Eine Schwelle ist ein Preis — dieselbe Eingaberegel und
                // dieselbe Tastatur wie ueberall (util/NumericInput.kt).
                OutlinedTextField(
                    shape = Formen.feld,
                    value = schwelle,
                    onValueChange = { schwelle = ch.brickinventoryapp.util.NumericInput.price(it) },
                    label = { Text(stringResource(R.string.wanted_threshold)) },
                    singleLine = true,
                    keyboardOptions = ch.brickinventoryapp.util.NumericInput.preisTastatur(),
                    modifier = Modifier.fillMaxWidth(),
                )
            }
        },
        confirmButton = {
            Button(onClick = { onWish(zustand, richtung, schwelle,
                // Ohne Haushalt gar nichts mitschicken — dann bleibt der Server
                // beim eigenen Konto (gleiche Regel wie im Erfassungsdialog).
                if (householdMembers.size > 1) konto else null) }) {
                Text(stringResource(R.string.wanted_add_submit))
            }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text(stringResource(R.string.common_cancel)) } },
    )
}
