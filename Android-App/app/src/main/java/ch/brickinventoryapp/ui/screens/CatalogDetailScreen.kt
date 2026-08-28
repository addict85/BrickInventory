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
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import ch.brickinventoryapp.R
import ch.brickinventoryapp.data.model.CatalogSetDetail
import ch.brickinventoryapp.util.BrickLinkUrls
import androidx.compose.foundation.clickable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.setValue
import androidx.compose.runtime.mutableStateOf
import ch.brickinventoryapp.ui.components.ZoomableImageDialog
import ch.brickinventoryapp.util.resolveFullUrl
import coil.ImageLoader
import coil.compose.AsyncImage
import coil.request.ImageRequest

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
    onLoad: (String) -> Unit,
    onAddToGallery: (String, Int, Double?, String?, Int?) -> Unit,
    onOpenInGallery: (String) -> Unit,
    onBack: () -> Unit
) {
    LaunchedEffect(setNumber) { onLoad(setNumber) }
    var showAddDialog by remember { mutableStateOf(false) }
    // Bildschirmfüllender Zoom wie im Set-Detail — auf Nutzerwunsch auch hier.
    var showImageZoom by remember { mutableStateOf(false) }
    val ctx = LocalContext.current

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(detail?.name ?: setNumber, maxLines = 1) },
                navigationIcon = {
                    IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, stringResource(R.string.acq_back)) }
                }
            )
        }
    ) { padding ->
        when {
            isLoading || detail == null -> Box(Modifier.fillMaxSize().padding(padding), Alignment.Center) {
                CircularProgressIndicator()
            }
            else -> Column(
                Modifier.fillMaxSize().padding(padding).verticalScroll(rememberScrollState()).padding(16.dp),
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
                                    .clickable { showImageZoom = true },
                                contentScale = androidx.compose.ui.layout.ContentScale.Fit
                            )
                        } else {
                            Text("🧱", fontSize = 56.sp)
                        }
                    }
                }

                // Titel + Nummer
                Column {
                    Text(detail.name ?: "—", fontWeight = FontWeight.Bold, fontSize = 20.sp)
                    Text(detail.setNumber, color = MaterialTheme.colorScheme.primary,
                        fontWeight = FontWeight.SemiBold, fontSize = 14.sp)
                }

                // Metadaten
                Card(shape = Formen.karte, colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.4f))) {
                    Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        CatalogDetailRow(stringResource(R.string.catalog_detail_year),   detail.year?.toString() ?: "—")
                        CatalogDetailRow(stringResource(R.string.catalog_detail_theme),  detail.themeName ?: "—")
                        CatalogDetailRow(stringResource(R.string.catalog_detail_parts),  detail.numParts?.takeIf { it > 0 }?.toString() ?: "—")
                        CatalogDetailRow(stringResource(R.string.catalog_detail_minifigs), if (detail.minifigs > 0) detail.minifigs.toString() else "—")
                        if (detail.owned) {
                            CatalogDetailRow(stringResource(R.string.catalog_owned), "✓ ×${detail.ownedQuantity}")
                        }
                    }
                }

                // Aktionen
                Button(
                    onClick = { showAddDialog = true },
                    modifier = Modifier.fillMaxWidth(),
                    shape = Formen.leiste
                ) {
                    Icon(Icons.Default.Add, null, Modifier.size(18.dp))
                    Spacer(Modifier.width(6.dp))
                    Text(stringResource(if (detail.owned) R.string.catalog_add_again else R.string.catalog_add_to_gallery))
                }
                // Kauf-Link: URL kommt fertig vom Server. Vorher wurde sie hier
                // aus der Rebrickable-Nummer gebaut und immer als Set verlinkt
                // (S=…) — für Gear und Bücher war damit sowohl der Parameter als
                // auch die Nummer falsch (dort ohne "-1"-Suffix).
                // Fallback auf die alte Bauweise nur für ältere Server, die das
                // Feld noch nicht liefern.
                // Der Button wird nie ausgeblendet: Bei Sammelminifiguren führt
                // BrickLink den Artikel unter einer anderen Nummer (Rebrickable
                // 71021-1 → BrickLink col325), die sich aus keiner der beiden
                // Datenquellen herleiten lässt. Statt den Button zu verstecken,
                // liefert der Server dann eine Such-URL und exact = false.
                val bl = detail.bricklink
                val blUrl = bl?.url ?: BrickLinkUrls.searchFor(detail.setNumber)
                val blLabel = if (bl != null && !bl.exact) R.string.catalog_search_bricklink
                              else R.string.catalog_buy_bricklink
                OutlinedButton(
                    onClick = {
                        // Nicht mehr still schlucken (Nachtrag 49): Ist kein
                        // Browser da oder scheitert der Aufruf, tippte der
                        // Nutzer bisher auf den Knopf und es passierte NICHTS —
                        // dieselbe Sorte Sackgasse wie „klicken, nichts
                        // passiert" in der Webapp.
                        try { ctx.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(blUrl))) }
                        catch (_: Exception) {
                            android.widget.Toast.makeText(ctx, ctx.getString(R.string.common_no_app_to_open),
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

    if (showAddDialog && detail != null) {
        CatalogAddDialog(
            setName = detail.name ?: detail.setNumber,
            defaultCondition = defaultCondition,
            householdMembers = householdMembers,
            onDismiss = { showAddDialog = false },
            onAdd = { qty, price, cond, owner ->
                showAddDialog = false
                onAddToGallery(detail.setNumber, qty, price, cond, owner)
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
private fun CatalogDetailRow(label: String, value: String) {
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
        Text(label, color = MaterialTheme.colorScheme.onSurfaceVariant, fontSize = 14.sp)
        Text(value, fontWeight = FontWeight.SemiBold, fontSize = 14.sp,
            modifier = Modifier.padding(start = 16.dp))
    }
}

/** Anzahl/Preis/Zustand abfragen — wie AddSetDialog, aber ohne Setnummern-Feld. */
@Composable
private fun CatalogAddDialog(
    setName: String,
    defaultCondition: String,
    householdMembers: List<ch.brickinventoryapp.data.model.HouseholdMember>,
    onDismiss: () -> Unit,
    onAdd: (Int, Double?, String?, Int?) -> Unit
) {
    var quantity      by remember { mutableStateOf("1") }
    var purchasePrice by remember { mutableStateOf("") }
    var condition     by remember { mutableStateOf(defaultCondition) }
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
                OutlinedTextField(
                    value = quantity, onValueChange = { quantity = it },
                    label = { Text(stringResource(R.string.gallery_quantity)) },
                    singleLine = true, modifier = Modifier.fillMaxWidth()
                )
                OutlinedTextField(
                    value = purchasePrice, onValueChange = { purchasePrice = it },
                    label = { Text(stringResource(R.string.gallery_purchase_price)) },
                    singleLine = true, modifier = Modifier.fillMaxWidth()
                )
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(stringResource(R.string.common_condition), fontSize = 14.sp)
                    FilterChip(selected = condition == "N", onClick = { condition = "N" },
                        label = { Text(stringResource(R.string.condition_new), fontSize = 12.sp) })
                    FilterChip(selected = condition == "U", onClick = { condition = "U" },
                        label = { Text(stringResource(R.string.condition_used), fontSize = 12.sp) })
                }
            }
        },
        confirmButton = {
            Button(onClick = { onAdd(
                quantity.toIntOrNull() ?: 1,
                purchasePrice.replace(',', '.').toDoubleOrNull(),
                condition,
                // Ohne Haushalt gar nichts mitschicken — der Server bleibt dann
                // beim eigenen Konto (gleiche Regel wie im Galerie-Dialog).
                if (householdMembers.size > 1) owner else null
            ) }) {
                Text(stringResource(R.string.catalog_add_confirm))
            }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text(stringResource(R.string.common_cancel)) } }
    )

}
