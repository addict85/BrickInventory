package ch.brickinventoryapp.ui.dialogs

import ch.brickinventoryapp.ui.viewmodel.ErfassungAktionen
import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.draw.clip
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.unit.dp
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.navigation.compose.*
import ch.brickinventoryapp.ui.*
import ch.brickinventoryapp.ui.screens.*
import coil3.ImageLoader
import coil3.request.crossfade
import ch.brickinventoryapp.ressourcen.R
import androidx.compose.ui.res.vectorResource
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.Color
import androidx.compose.foundation.layout.Column
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.compose.ui.res.stringResource
import ch.brickinventoryapp.util.NumericInput
import ch.brickinventoryapp.ui.viewmodel.ErfassungViewModel
import ch.brickinventoryapp.ui.theme.Abstaende

/**
 * Der Dialog nach einem erfolgreichen Barcode-Scan: Set (oder Teileliste)
 * bestätigen, Menge, Kaufpreis, Zustand und Eigentümer erfassen.
 *
 * Die Bedingung `if (barcodeState.result != null)` bleibt beim Aufrufer: So steht
 * an einer Stelle, wann er erscheint, und hier nur, wie er aussieht.
 */
@Composable
fun BarcodeResultRoute(vm: ErfassungViewModel, imageLoader: ImageLoader) {
    val state by vm.state.collectAsStateWithLifecycle()
    val blick by vm.blickfeld.collectAsStateWithLifecycle()
    val barcodeState by vm.barcodeState.collectAsStateWithLifecycle()
    val lagerZustand by vm.lagerState.collectAsStateWithLifecycle()
    BarcodeResultDialog(BarcodeDialogZustand(state, blick, barcodeState, lagerZustand), vm, imageLoader)
}

/** Was der Barcode-Dialog zeigt. */
data class BarcodeDialogZustand(
    val state: AppUiState,
    val blick: BlickfeldUiState,
    val barcodeState: BarcodeUiState,
    val lagerZustand: LagerUiState,
)

@Composable
fun BarcodeResultDialog(zustand: BarcodeDialogZustand, aktionen: ErfassungAktionen, imageLoader: ImageLoader) {
    val state = zustand.state
    val blick = zustand.blick
    val barcodeState = zustand.barcodeState
    if (barcodeState.result == null) return

// Preisfeld pro gescanntem Barcode zurücksetzen
var barcodePriceText by remember(barcodeState.result) { mutableStateOf("") }
var barcodeCondition by remember(barcodeState.result) { mutableStateOf(state.userDefaultCondition ?: "N") }
// Eigentümer wie im Galerie-Dialog vorbelegen: das eigene Konto. Repository, API
// und Server nehmen ihn entgegen, also muss auch dieser Weg ihn abfragen.
var barcodeOwner by remember(barcodeState.result, blick.householdMembers) {
    mutableStateOf(blick.householdMembers.firstOrNull { it.isSelf }?.id)
}
// Lagerort, ebenfalls je gescanntem Barcode zurückgesetzt — der Barcode-Weg soll
// dieselben Felder haben wie die übrigen. Zurückgesetzt auf die Vorgabe, nicht auf
// leer, damit sie bei einer Neuerfassung vorausgewählt ist. Der zweite Schlüssel
// ist die Vorgabe selbst: Sie kommt übers Netz und kann nach dem Scan eintreffen.
val lagerZustand = zustand.lagerZustand
val lagerVorgabe = lagerZustand.vorgabe?.name ?: ""
var barcodeLagerort by remember(barcodeState.result, lagerVorgabe) { mutableStateOf(lagerVorgabe) }
AlertDialog(
    // Während des Hinzufügens nicht per Tipp daneben schliessbar —
    // sonst verschwindet der Dialog, während der Aufruf noch läuft.
    onDismissRequest = { if (!barcodeState.adding) aktionen.cancelBarcode() },
    title = {
        Text(
            if (barcodeState.source == "partslist") stringResource(R.string.main_barcode_add_partslist)
            else stringResource(R.string.main_barcode_add_set),
            fontWeight = FontWeight.Bold
        )
    },
    text = {
        Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
            // ── Hinweis bei geratener Nummer ──
            //
            // Der Dialog zeigt Bild und Namen; der Hinweis sagt, wann man hinsehen muss
            // (Server ohne EAN-Abgleich, utils/barcodeQuelle.ts, oder Texterkennung). Oben und
            // in der Warnfarbe, aber ohne den Vorgang zu sperren: Der Treffer ist oft richtig,
            // und Bestätigen soll ein Blick sein, kein Klick mehr.
            if (barcodeState.unsicher) {
                Surface(
                    color = MaterialTheme.colorScheme.errorContainer,
                    shape = MaterialTheme.shapes.small,
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Row(
                        Modifier.padding(horizontal = 10.dp, vertical = Abstaende.klein),
                        horizontalArrangement = Arrangement.spacedBy(Abstaende.klein),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Icon(Icons.Default.Warning, null, Modifier.size(ch.brickinventoryapp.ui.components.mitSchrift(20.dp)),
                            tint = MaterialTheme.colorScheme.onErrorContainer)
                        Text(
                            stringResource(R.string.main_barcode_unsure),
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onErrorContainer,
                            fontWeight = FontWeight.SemiBold
                        )
                    }
                }
            }
            val imgUrl = barcodeState.imageLocal?.let { "${state.serverUrl}$it" } ?: barcodeState.imageUrl
            val ctx = androidx.compose.ui.platform.LocalContext.current
            ch.brickinventoryapp.ui.components.ProduktBild(
                model = imgUrl?.let { coil3.request.ImageRequest.Builder(ctx).data(it).crossfade(!ch.brickinventoryapp.ui.components.bewegungReduziert()).build() },
                imageLoader = imageLoader,
                contentDescription = barcodeState.setName,
                modifier = Modifier.fillMaxWidth().height(160.dp).clip(MaterialTheme.shapes.medium),
                contentScale = ContentScale.Fit,
                ersatzGroesse = 56.dp,
            )
            if (barcodeState.setName != null)
                Text(barcodeState.setName, fontWeight = FontWeight.Bold,
                    style = MaterialTheme.typography.titleMedium)
            Row(horizontalArrangement = Arrangement.spacedBy(Abstaende.klein), verticalAlignment = Alignment.CenterVertically) {
                Text(barcodeState.result, style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.primary, fontWeight = FontWeight.SemiBold)
                if (barcodeState.theme != null)
                    Surface(color = MaterialTheme.colorScheme.primaryContainer, shape = MaterialTheme.shapes.small) {
                        Text(barcodeState.theme, Modifier.padding(horizontal = 6.dp, vertical = 2.dp),
                            style = MaterialTheme.typography.labelSmall,
                            color = MaterialTheme.colorScheme.onPrimaryContainer)
                    }
            }
            HorizontalDivider()
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceAround) {
                if (barcodeState.year != null) Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    Icon(Icons.Default.CalendarMonth, null, Modifier.size(ch.brickinventoryapp.ui.components.mitSchrift(18.dp)), tint = MaterialTheme.colorScheme.onSurfaceVariant)
                    Text("${barcodeState.year}", style = MaterialTheme.typography.labelSmall, fontWeight = FontWeight.Bold)
                    Text(stringResource(R.string.main_barcode_year), style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                if (barcodeState.pieces != null) Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    Icon(ImageVector.vectorResource(R.drawable.ic_parts_bricks), null, Modifier.size(ch.brickinventoryapp.ui.components.mitSchrift(18.dp)), tint = Color.Unspecified)
                    Text(ch.brickinventoryapp.util.fmtInt(barcodeState.pieces), style = MaterialTheme.typography.labelSmall, fontWeight = FontWeight.Bold)
                    Text(stringResource(R.string.main_barcode_pieces), style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                if (barcodeState.minifigs != null && barcodeState.minifigs > 0)
                    Column(horizontalAlignment = Alignment.CenterHorizontally) {
                        Icon(Icons.Default.Person, null, Modifier.size(ch.brickinventoryapp.ui.components.mitSchrift(18.dp)), tint = MaterialTheme.colorScheme.onSurfaceVariant)
                        Text("${barcodeState.minifigs}", style = MaterialTheme.typography.labelSmall, fontWeight = FontWeight.Bold)
                        Text(stringResource(R.string.main_barcode_figs), style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
            }
            // Erfassungsfelder nur beim Erfassen in die Sammlung. Aus der Teileliste entsteht
            // kein Bestand — confirmAddBarcode() reicht im Zweig `source == "partslist"` nur
            // die Nummer weiter. Eigentümer, Kaufpreis und Zustand wären dort Felder ohne
            // Wirkung, die aussehen wie eine Eingabe, die zählt. Bild, Name, Nummer und
            // Kennzahlen bleiben: Sie helfen zu prüfen, ob das richtige Set gescannt wurde.
            if (barcodeState.source != "partslist") {
                // Kaufpreis direkt beim Erfassen (optional) — leer lassen übernimmt
                // serverseitig den aktuellen Marktpreis (gleiche Logik wie Webapp).
                // OwnerPicker blendet sich ohne Haushalt selbst aus
                // (members.size < 2 → return), deshalb keine Bedingung hier.
                ch.brickinventoryapp.ui.screens.OwnerPicker(
                    blick.householdMembers, barcodeOwner, { barcodeOwner = it }
                )
                OutlinedTextField(
                    shape = ch.brickinventoryapp.ui.theme.Formen.feld,
                    value = barcodePriceText,
                    onValueChange = { nv -> barcodePriceText = NumericInput.price(nv) },
                    label = { Text(stringResource(R.string.barcode_purchase_price)) },
                    singleLine = true,
                    keyboardOptions = NumericInput.preisTastatur(),
                    modifier = Modifier.fillMaxWidth()
                )
                ch.brickinventoryapp.ui.screens.Zustandszeile(
                    zustand = barcodeCondition,
                    onZustand = { barcodeCondition = it }
                )
                ch.brickinventoryapp.ui.screens.LagerortErfassung(
                    barcodeLagerort,
                    // Der VORRAT, nicht die belegten Orte: Beim Erfassen soll
                    // auch ein leeres Regal zur Wahl stehen.
                    lagerZustand.eigene.map { it.name },
                    { barcodeLagerort = it }
                )
            }
        }
    },
    confirmButton = {
        // Zweite Verteidigungslinie gegen die Doppelerfassung: sichtbar gesperrter Knopf
        // mit Spinner. Die eigentliche Sperre sitzt in confirmAddBarcode() — hier sieht
        // der Nutzer, dass sein Tippen angekommen ist, und tippt kein zweites Mal.
        Button(
            onClick = {
                if (barcodeState.source == "partslist") {
                    // Nur die Nummer: Aus der Teileliste entsteht kein Bestand, die Felder sind
                    // oben nicht sichtbar. confirmAddBarcode() verwürfe sie zwar, aber der Aufruf
                    // soll beim Lesen zeigen, was gemeint ist.
                    aktionen.confirmAddBarcode(barcodeState.result)
                } else {
                    val price = barcodePriceText.replace(',', '.').toDoubleOrNull()
                    aktionen.confirmAddBarcode(
                        barcodeState.result, price, barcodeCondition,
                        // Ohne Haushalt gar nichts mitschicken — der Server
                        // bleibt dann beim eigenen Konto (gleiche Regel wie
                        // im Galerie-Dialog).
                        if (blick.householdMembers.size > 1) barcodeOwner else null,
                        barcodeLagerort.trim().takeIf { it.isNotEmpty() }
                    )
                }
            },
            enabled = !barcodeState.adding,
            colors = ButtonDefaults.buttonColors(containerColor = MaterialTheme.colorScheme.primary)
        ) {
            if (barcodeState.adding) {
                CircularProgressIndicator(
                    Modifier.size(16.dp),
                    color = MaterialTheme.colorScheme.onPrimary,
                    strokeWidth = 2.dp
                )
                Spacer(Modifier.width(Abstaende.klein))
                Text(stringResource(R.string.barcode_add))
            } else {
                Icon(Icons.Default.Check, null, Modifier.size(ch.brickinventoryapp.ui.components.mitSchrift(18.dp)))
                Spacer(Modifier.width(Abstaende.klein))
                Text(stringResource(R.string.barcode_add))
            }
        }
    },
    dismissButton = {
        TextButton(
            onClick = { aktionen.cancelBarcode() },
            enabled = !barcodeState.adding
        ) { Text(stringResource(R.string.common_cancel)) }
    }
)
}
