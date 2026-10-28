package ch.brickinventoryapp.ui.screens

import ch.brickinventoryapp.ui.theme.Formen
import android.content.Intent
import android.net.Uri
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Add
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
import ch.brickinventoryapp.R
import ch.brickinventoryapp.util.NumericInput
import ch.brickinventoryapp.data.model.CatalogSetDetail
import ch.brickinventoryapp.util.BrickLinkUrls
import androidx.compose.foundation.clickable
import androidx.compose.ui.semantics.Role
import androidx.compose.runtime.getValue
import androidx.compose.runtime.setValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.core.net.toUri
import ch.brickinventoryapp.ui.components.ZoomableImageDialog
import ch.brickinventoryapp.util.resolveFullUrl
import coil3.ImageLoader
import coil3.compose.AsyncImage
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
    detail: CatalogSetDetail?,
    isLoading: Boolean,
    imageLoader: ImageLoader,
    serverUrl: String,
    defaultCondition: String = "N",
    /** Mitglieder des Haushalts — die Kontowahl blendet sich ohne sie selbst aus. */
    householdMembers: List<ch.brickinventoryapp.data.model.HouseholdMember> = emptyList(),
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

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(detail?.name ?: setNumber, maxLines = 1) },
                navigationIcon = {
                    IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, stringResource(R.string.common_back)) }
                }
            )
        }
    ) { padding ->
        when {
            isLoading || detail == null -> Box(Modifier.fillMaxSize().padding(padding), Alignment.Center) {
                CircularProgressIndicator()
            }
            else -> Column(
                Modifier.fillMaxSize().padding(padding).verticalScroll(rememberScrollState()).padding(Abstaende.gross),
                verticalArrangement = Arrangement.spacedBy(14.dp)
            ) {
                // Bild
                Card(shape = Formen.karte, colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface)) {
                    Box(Modifier.fillMaxWidth().height(220.dp), Alignment.Center) {
                        // Über den Server-Proxy — volle Auflösung, da es hier
                        // keinen separaten Zoom gibt (anders als beim
                        // Set-Detail-Dialog des eigenen Bestands).
                        val fullUrl = remember(detail.setNumber, serverUrl) {
                            // Nutzerunabhängige, bereits heruntergeladene
                            // Datei bevorzugen — derselbe Server-Check wie
                            // in der Katalog-Liste.
                            resolveFullUrl(serverUrl, detail.imageLocal, detail.imageUrl)
                        }
                        if (fullUrl != null) {
                            AsyncImage(
                                model = ImageRequest.Builder(ctx).data(fullUrl).crossfade(true).build(),
                                imageLoader = imageLoader,
                                contentDescription = detail.name,
                                // Kaputte/fehlende CDN-Bilder -> Logo-Platzhalter statt leerer Fläche
                                error = androidx.compose.ui.res.painterResource(R.drawable.ic_logo),
                                // Antippen öffnet den Zoom — gleiches Verhalten wie im
                                // Set-Detail des eigenen Bestands.
                                modifier = Modifier.fillMaxSize().padding(10.dp)
                                    .clickable(role = Role.Button) { showImageZoom = true },
                                contentScale = androidx.compose.ui.layout.ContentScale.Fit
                            )
                        } else {
                            LeerSymbol(Icons.Default.ViewInAr, 56.dp)
                        }
                    }
                }

                // Titel + Nummer
                Column {
                    Text(detail.name ?: "—", fontWeight = FontWeight.Bold, style = MaterialTheme.typography.titleLarge)
                    Text(detail.setNumber, color = MaterialTheme.colorScheme.primary,
                        fontWeight = FontWeight.SemiBold, style = MaterialTheme.typography.bodyMedium)
                }

                // Metadaten
                Card(shape = Formen.karte, colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.4f))) {
                    Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(Abstaende.klein)) {
                        CatalogDetailRow(stringResource(R.string.catalog_detail_year),   detail.year?.toString() ?: "—")
                        CatalogDetailRow(stringResource(R.string.catalog_detail_theme),  detail.themeName ?: "—")
                        CatalogDetailRow(stringResource(R.string.catalog_detail_parts),  detail.numParts?.takeIf { it > 0 }?.toString() ?: "—")
                        CatalogDetailRow(stringResource(R.string.catalog_detail_minifigs), if (detail.minifigs > 0) detail.minifigs.toString() else "—")
                        if (detail.owned) {
                            CatalogDetailRow(stringResource(R.string.catalog_owned), "✓ ×${detail.ownedQuantity}")
                        }
                    }
                }

                // ── Aktionen ──
                //
                // BrickLink zuerst, darunter die beiden Erfassungsknöpfe nebeneinander, beide mit
                // Plus: oben der Weg nach draussen, unten die zwei Griffe, die hier etwas anlegen.
                //
                // Die Kauf-URL kommt fertig vom Server — für Gear und Bücher wären Parameter und
                // Nummer anders als bei Sets. Der Rückfall auf die eigene Bauweise bleibt für
                // ältere Server. Der Knopf wird nie ausgeblendet: Bei Sammelminifiguren führt
                // BrickLink eine Nummer, die sich nicht herleiten lässt (71021-1 → col325); dann
                // liefert der Server eine Such-URL und exact = false.
                val bl = detail.bricklink
                val blUrl = bl?.url ?: BrickLinkUrls.searchFor(detail.setNumber)
                val blLabel = if (bl != null && !bl.exact) R.string.catalog_search_bricklink
                              else R.string.catalog_buy_bricklink
                OutlinedButton(
                    onClick = {
                        // Nicht still schlucken: Ist kein Browser da oder scheitert der Aufruf,
                        // passierte sonst beim Tippen nichts.
                        try { ctx.startActivity(Intent(Intent.ACTION_VIEW, blUrl.toUri())) }
                        catch (_: Exception) {
                            android.widget.Toast.makeText(ctx, keineAppText,
                                android.widget.Toast.LENGTH_SHORT).show()
                        }
                    },
                    modifier = Modifier.fillMaxWidth(),
                    shape = Formen.leiste
                ) {
                    Icon(Icons.Default.ShoppingCart, null, Modifier.size(18.dp))
                    Spacer(Modifier.width(6.dp))
                    Text(stringResource(blLabel))
                }
                // Die beiden Erfassungsknöpfe nebeneinander; `weight(1f)` teilt die Breite gleich
                // auf. Die Merkliste bleibt zweitrangig (OutlinedButton), denn häufiger wird
                // aufgenommen. labelMedium und maxLines = 1, weil sich zwei Knöpfe die Breite
                // teilen — „In Galerie aufnehmen“ stünde bei labelLarge auf einem 360dp-Telefon
                // über dem Rand. Die Ellipse ist der Fallschirm für weitere Sprachen.
                Row(
                    Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(Abstaende.klein),
                ) {
                    OutlinedButton(
                        onClick = { showWishDialog = true },
                        modifier = Modifier.weight(1f),
                        shape = Formen.leiste,
                        contentPadding = PaddingValues(horizontal = Abstaende.klein, vertical = Abstaende.klein),
                    ) {
                        Icon(Icons.Default.Add, null, Modifier.size(18.dp))
                        Spacer(Modifier.width(Abstaende.winzig))
                        Text(stringResource(R.string.wanted_add_submit),
                            maxLines = 1, overflow = TextOverflow.Ellipsis,
                            style = MaterialTheme.typography.labelMedium)
                    }
                    Button(
                        onClick = { showAddDialog = true },
                        modifier = Modifier.weight(1f),
                        shape = Formen.leiste,
                        contentPadding = PaddingValues(horizontal = Abstaende.klein, vertical = Abstaende.klein),
                    ) {
                        Icon(Icons.Default.Add, null, Modifier.size(18.dp))
                        Spacer(Modifier.width(Abstaende.winzig))
                        Text(stringResource(if (detail.owned) R.string.catalog_add_again
                                            else R.string.catalog_add_to_gallery),
                            maxLines = 1, overflow = TextOverflow.Ellipsis,
                            style = MaterialTheme.typography.labelMedium)
                    }
                }
                if (detail.owned) {
                    OutlinedButton(
                        onClick = { onOpenInGallery(detail.setNumber) },
                        modifier = Modifier.fillMaxWidth(),
                        shape = Formen.leiste
                    ) {
                        Icon(Icons.Default.Check, null, Modifier.size(18.dp))
                        Spacer(Modifier.width(6.dp))
                        Text(stringResource(R.string.catalog_open_in_gallery))
                    }
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

@Composable
internal fun CatalogDetailRow(label: String, value: String) {
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
        Text(label, color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodyMedium)
        Text(value, fontWeight = FontWeight.SemiBold, style = MaterialTheme.typography.bodyMedium,
            modifier = Modifier.padding(start = Abstaende.gross))
    }
}

/** Anzahl/Preis/Zustand abfragen — wie AddSetDialog, aber ohne Setnummern-Feld. */
@Composable
private fun CatalogAddDialog(
    setName: String,
    defaultCondition: String,
    householdMembers: List<ch.brickinventoryapp.data.model.HouseholdMember>,
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
                    value = quantity,
                    onValueChange = { quantity = NumericInput.quantity(it) },
                    label = { Text(stringResource(R.string.common_quantity)) },
                    singleLine = true, modifier = Modifier.fillMaxWidth(),
                    keyboardOptions = NumericInput.ganzzahlTastatur()
                )
                OutlinedTextField(
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
    householdMembers: List<ch.brickinventoryapp.data.model.HouseholdMember>,
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
                Row(horizontalArrangement = Arrangement.spacedBy(Abstaende.klein),
                    verticalAlignment = Alignment.CenterVertically) {
                    FilterChip(selected = richtung == "unter", onClick = { richtung = "unter" },
                               label = { Text(stringResource(R.string.detail_alert_below)) })
                    FilterChip(selected = richtung == "ueber", onClick = { richtung = "ueber" },
                               label = { Text(stringResource(R.string.detail_alert_above)) })
                }
                // Eine Schwelle ist ein Preis — dieselbe Eingaberegel und
                // dieselbe Tastatur wie ueberall (util/NumericInput.kt).
                OutlinedTextField(
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
