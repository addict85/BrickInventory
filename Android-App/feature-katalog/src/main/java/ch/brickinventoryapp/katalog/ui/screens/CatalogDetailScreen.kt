package ch.brickinventoryapp.katalog.ui.screens

import ch.brickinventoryapp.model.fach.Alarmrichtung
import ch.brickinventoryapp.katalog.ui.Merkwunsch
import ch.brickinventoryapp.model.fach.Erfassungswunsch
import ch.brickinventoryapp.model.fach.Zustand
import androidx.compose.material.icons.filled.Bookmark
import ch.brickinventoryapp.ui.util.fmtMoney
import ch.brickinventoryapp.ui.components.ErfassenDialog
import ch.brickinventoryapp.model.ui.model.MerkpostenAnsicht
import ch.brickinventoryapp.ui.components.nebenKnopfFarben
import ch.brickinventoryapp.ui.components.nebenKnopfRand
import androidx.compose.ui.draw.clip
import ch.brickinventoryapp.model.ui.model.KatalogDetailAnsicht
import ch.brickinventoryapp.model.ui.model.MitgliedAnsicht
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
import ch.brickinventoryapp.ui.zweiSpaltig
import ch.brickinventoryapp.ui.components.ZoomableImageDialog
import ch.brickinventoryapp.model.util.resolveFullUrl
import coil3.ImageLoader
import kotlinx.coroutines.launch
import coil3.request.ImageRequest
import coil3.request.crossfade
import ch.brickinventoryapp.ui.theme.Abstaende
import ch.brickinventoryapp.ui.components.DetailTopAppBar
import ch.brickinventoryapp.ui.components.ProduktBild
import ch.brickinventoryapp.ui.components.ansagen
import ch.brickinventoryapp.gemeinsam.ui.erfassungUngueltig
import ch.brickinventoryapp.ui.components.SegmentWahl
import ch.brickinventoryapp.ui.components.bewegungReduziert
import ch.brickinventoryapp.ui.components.mitSchrift
import ch.brickinventoryapp.ui.theme.Lesebreite
import ch.brickinventoryapp.ui.util.fmtInt
import ch.brickinventoryapp.netz.util.externeAdresse
import ch.brickinventoryapp.ui.util.oeffneExtern
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
    detail: KatalogDetailAnsicht?,
    isLoading: Boolean,
    imageLoader: ImageLoader,
    serverUrl: String,
    defaultCondition: Zustand = Zustand.NEU,
    /** Mitglieder des Haushalts — die Kontowahl blendet sich ohne sie selbst aus. */
    householdMembers: List<MitgliedAnsicht> = emptyList(),
    /** Vorrat an Lagerorten fuer den Erfassungsdialog. */
    lagerorte: List<String> = emptyList(),
    /** Der vorausgewählte Lagerort (Stern in den Einstellungen). Leer heisst: keine Vorgabe. */
    lagerortVorgabe: String = "",
    onLoad: (String) -> Unit,
    onAddToGallery: (Erfassungswunsch) -> Unit,
    /** Auf die Merkliste; das Zielkonto wie im Erfassungsdialog und in der Webapp (cat-m-owner). */
    onWish: (Merkwunsch) -> Unit,
    onOpenInGallery: (String) -> Unit,
    onBack: () -> Unit,
    /** Der Merkposten zu diesem Set, falls es schon auf der Merkliste steht. */
    gemerkt: MerkpostenAnsicht? = null,
    /** Den Merkposten öffnen — Setnummer und Zustand. */
    onOeffneMerkposten: (String, Zustand) -> Unit = { _, _ -> },
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
                    ProduktBild(
                        model = fullUrl?.let { ImageRequest.Builder(ctx).data(it).crossfade(!bewegungReduziert()).build() },
                        imageLoader = imageLoader,
                        contentDescription = detail.name,
                        modifier = m.clip(Formen.karte)
                            .clickable(enabled = fullUrl != null, onClickLabel = stringResource(R.string.cd_bild_vergroessern), role = Role.Button) { showImageZoom = true },
                        contentScale = androidx.compose.ui.layout.ContentScale.Fit,
                        ersatzGroesse = 64.dp,
                        bildgrund = true,
                        innenAbstand = Abstaende.mittel,
                    )
                }
                val angaben: @Composable ColumnScope.() -> Unit = {
                    KatalogAngaben(
                        detail = detail,
                        gemerkt = gemerkt,
                        onMerken = { if (gemerkt != null) onOeffneMerkposten(gemerkt.setNumber, gemerkt.condition) else showWishDialog = true },
                        onAufnehmen = { showAddDialog = true },
                        onOpenInGallery = onOpenInGallery,
                        onBrickLink = { url ->
                            // Nicht still schlucken: Ist kein Browser da, passierte sonst nichts.
                            if (!oeffneExtern(ctx, externeAdresse(url))) {
                                bereich.launch { meldungen.showSnackbar(keineAppText) }
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
                        Box(Modifier.weight(1f).fillMaxHeight().padding(vertical = Abstaende.gross),
                            contentAlignment = Alignment.TopCenter) {
                            bild(Modifier.widthIn(max = BILD_HOECHSTENS).fillMaxWidth().aspectRatio(BILD_VERHAELTNIS))
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
                onWish(Merkwunsch(detail.setNumber, zustand, richtung, schwelle, konto))
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
            onAdd = { wunsch ->
                showAddDialog = false
                onAddToGallery(wunsch.copy(setNumber = detail.setNumber))
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

/** Grösser als die Vorlage wird ein Setbild nur unscharf; daneben bleibt Platz für die Angaben. */
private val BILD_HOECHSTENS = 480.dp

/** Die Angaben des Sets als Tabelle, mit Besitz und Merkposten, wenn es sie gibt. */
@Composable
private fun KatalogTabelle(detail: KatalogDetailAnsicht, gemerkt: MerkpostenAnsicht?) {
    Card(shape = Formen.karte, colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.4f))) {
        Column(Modifier.padding(Abstaende.rand), verticalArrangement = Arrangement.spacedBy(Abstaende.klein)) {
            CatalogDetailRow(stringResource(R.string.catalog_detail_year),   detail.year?.toString() ?: "—")
            CatalogDetailRow(stringResource(R.string.catalog_detail_theme),  detail.themeName ?: "—")
            CatalogDetailRow(stringResource(R.string.catalog_detail_parts),  detail.numParts?.takeIf { it > 0 }?.let { fmtInt(it) } ?: "—")
            CatalogDetailRow(stringResource(R.string.catalog_detail_minifigs), if (detail.minifigs > 0) detail.minifigs.toString() else "—")
            if (detail.owned) {
                CatalogDetailRow(stringResource(R.string.catalog_owned), "✓ ×${detail.ownedQuantity}")
            }
            // Steht das Set schon auf der Merkliste, sagt es die Tabelle — mit Zustand und Alarm.
            if (gemerkt != null) CatalogDetailRow(stringResource(R.string.catalog_auf_merkliste), merkpostenText(gemerkt))
        }
    }
}

/**
 * Nummer, Angaben und Handlungen; der Name steht in der Leiste. Die eigenen Handlungen
 * zuerst (Aufnehmen, Merken), der Weg nach draussen als Textknopf mit Pfeil darunter:
 * Er stand über ihnen und sah aus wie die Haupthandlung.
 */
@Composable
private fun ColumnScope.KatalogAngaben(
    detail: KatalogDetailAnsicht,
    gemerkt: MerkpostenAnsicht?,
    onMerken: () -> Unit,
    onAufnehmen: () -> Unit,
    onOpenInGallery: (String) -> Unit,
    onBrickLink: (String) -> Unit,
) {
    Text(detail.setNumber, color = MaterialTheme.colorScheme.primary,
        fontWeight = FontWeight.SemiBold, style = MaterialTheme.typography.bodyMedium)

    KatalogTabelle(detail, gemerkt)

    // Untereinander in voller Breite wie im Merkposten-Detail: Nebeneinander war
    // „Zur Sammlung hinzufügen“ schon bei normaler Schrift gekürzt. Aufnehmen ist die
    // häufigere Handlung und steht oben und gefüllt, Merken darunter umrandet.
    // Höchstens Bedienbreite: Auf dem Tablet liefen die Knöpfe sonst über die ganze Spalte.
    val knopf = Modifier.widthIn(max = Lesebreite.bedienung).fillMaxWidth()
    Button(onClick = onAufnehmen, modifier = knopf) {
        Icon(Icons.Default.Add, null, Modifier.size(mitSchrift(18.dp)))
        Spacer(Modifier.width(Abstaende.klein))
        Text(stringResource(if (detail.owned) R.string.catalog_add_again else R.string.catalog_add_to_gallery),
            textAlign = TextAlign.Center)
    }
    // Gemerkt: zum Merkposten statt ein zweites Mal merken.
    OutlinedButton(onClick = onMerken, modifier = knopf, colors = nebenKnopfFarben(), border = nebenKnopfRand()) {
        Icon(if (gemerkt != null) Icons.Default.Bookmark else Icons.Default.BookmarkAdd, null, Modifier.size(mitSchrift(18.dp)))
        Spacer(Modifier.width(Abstaende.klein))
        Text(stringResource(if (gemerkt != null) R.string.catalog_merkposten_oeffnen else R.string.wanted_add_submit),
            textAlign = TextAlign.Center)
    }
    if (detail.owned) {
        OutlinedButton(onClick = { onOpenInGallery(detail.setNumber) }, modifier = knopf, colors = nebenKnopfFarben(), border = nebenKnopfRand()) {
            Icon(Icons.Default.Check, null, Modifier.size(mitSchrift(18.dp)))
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
    TextButton(onClick = { onBrickLink(blUrl) }, modifier = knopf) {
        Icon(Icons.Default.ShoppingCart, null, Modifier.size(mitSchrift(18.dp)))
        Spacer(Modifier.width(Abstaende.klein))
        Text(stringResource(blLabel))
        Spacer(Modifier.width(Abstaende.winzig))
        Icon(Icons.AutoMirrored.Filled.OpenInNew, null, Modifier.size(mitSchrift(16.dp)))
    }
}

/** „Neu, Alarm unter CHF 349.00“ — Zustand und Alarm eines Merkpostens in einer Zeile. */
@Composable
private fun merkpostenText(m: MerkpostenAnsicht): String {
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
    householdMembers: List<MitgliedAnsicht>,
    /** Vorrat an Lagerorten — leer heisst: es gibt noch keine, dann wird getippt. */
    lagerorte: List<String>,
    /** Der vorausgewählte Lagerort (Stern in den Einstellungen). Leer heisst: keine Vorgabe. */
    lagerortVorgabe: String = "",
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
                    isError = NumericInput.mengeUngueltig(quantity),
                    supportingText = { if (NumericInput.mengeUngueltig(quantity)) Text(stringResource(R.string.erfassen_menge_ungueltig), Modifier.ansagen()) },
                    singleLine = true, modifier = Modifier.fillMaxWidth(),
                    keyboardOptions = NumericInput.ganzzahlTastatur()
                )
                OutlinedTextField(
                    shape = Formen.feld,
                    value = purchasePrice,
                    onValueChange = { purchasePrice = NumericInput.price(it) },
                    label = { Text(stringResource(R.string.gallery_purchase_price)) },
                    isError = NumericInput.preisUngueltig(purchasePrice),
                    supportingText = { if (NumericInput.preisUngueltig(purchasePrice)) Text(stringResource(R.string.erfassen_preis_ungueltig), Modifier.ansagen()) },
                    singleLine = true, modifier = Modifier.fillMaxWidth(),
                    keyboardOptions = NumericInput.preisTastatur()
                )
                Zustandszeile(zustand = condition, onZustand = { condition = it })
                LagerortErfassung(lagerort, lagerorte, { lagerort = it })
            }
        },
        confirmButton = {
            Button(onClick = { if (!erfassungUngueltig(quantity, purchasePrice)) onAdd(Erfassungswunsch(
                setNumber = "",
                menge = quantity.toIntOrNull() ?: 1,
                kaufpreis = NumericInput.leseBetrag(purchasePrice),
                zustand = condition,
                // Ohne Haushalt gar nichts mitschicken — der Server bleibt dann
                // beim eigenen Konto (gleiche Regel wie im Galerie-Dialog).
                besitzer = if (householdMembers.size > 1) owner else null,
                lagerort = lagerort.trim().takeIf { it.isNotEmpty() },
            )) }) {
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
    defaultCondition: Zustand,
    /** Konten des Haushalts — ohne Unterkonten blendet sich die Wahl selbst aus. */
    householdMembers: List<MitgliedAnsicht>,
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
    ErfassenDialog(
        titel = stringResource(R.string.wanted_add_submit),
        bestaetigen = stringResource(R.string.wanted_add_submit),
        onBestaetigen = { onWish(zustand, richtung, schwelle,
            // Ohne Haushalt gar nichts mitschicken — dann bleibt der Server
            // beim eigenen Konto (gleiche Regel wie im Erfassungsdialog).
            if (householdMembers.size > 1) konto else null) },
        onAbbrechen = onDismiss,
    ) {
                Text(setName, style = MaterialTheme.typography.bodyMedium)
                // Zielkonto wie beim Erfassen; blendet sich bei weniger als
                // zwei Mitgliedern selbst aus.
                OwnerPicker(householdMembers, konto, { konto = it })
                Zustandszeile(zustand = zustand, onZustand = { zustand = it })
                HorizontalDivider()
                Text(stringResource(R.string.detail_alert),
                     style = MaterialTheme.typography.labelLarge)
                SegmentWahl(
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
                    keyboardOptions = NumericInput.preisTastatur(),
                    modifier = Modifier.fillMaxWidth(),
                )
    }
}
