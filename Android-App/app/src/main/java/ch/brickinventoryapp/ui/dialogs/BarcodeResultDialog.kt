package ch.brickinventoryapp.ui.dialogs

import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material.icons.automirrored.filled.Logout
import androidx.compose.material.icons.automirrored.filled.OpenInNew
import androidx.compose.material.icons.automirrored.filled.ListAlt
import androidx.compose.material3.*
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.draw.clip
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.ui.window.Dialog
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.navigation.NavDestination.Companion.hierarchy
import androidx.navigation.NavGraph.Companion.findStartDestination
import androidx.navigation.compose.*
import ch.brickinventoryapp.nav.authGraph
import ch.brickinventoryapp.nav.collectionGraph
import ch.brickinventoryapp.nav.catalogGraph
import ch.brickinventoryapp.nav.toolsGraph
import ch.brickinventoryapp.ui.*
import ch.brickinventoryapp.ui.AppUiState
import ch.brickinventoryapp.ui.screens.*
import ch.brickinventoryapp.ui.theme.BrickInventoryManagerTheme
import ch.brickinventoryapp.ui.theme.LocalIsBrickTheme
import ch.brickinventoryapp.ui.theme.Petrol
import coil.ImageLoader
import coil.util.DebugLogger
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.ui.res.painterResource
import ch.brickinventoryapp.R
import androidx.compose.ui.res.vectorResource
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.Color
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Column
import androidx.compose.material3.LinearProgressIndicator
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.compose.ui.res.stringResource
import javax.inject.Named
import javax.inject.Inject
import ch.brickinventoryapp.util.NumericInput
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import ch.brickinventoryapp.ui.MainViewModel

/**
 * Der Dialog nach einem erfolgreichen Barcode-Scan: Set (oder Teileliste)
 * bestätigen, Menge, Kaufpreis, Zustand und Eigentümer erfassen.
 *
 * ── Warum eigene Datei (Nachtrag 97) ────────────────────────────────────────
 *
 * Diese 170 Zeilen standen mitten in `BrickInventoryManagerApp()` — der
 * Funktion, die den NavHost aufbaut. Sie war damit 277 Zeilen lang, wovon rund
 * fünfzehn der eigentliche Navigationsaufbau waren.
 *
 * Dasselbe Muster wie im Webfrontend, wo Kaufpreis- und Detailfenster in
 * js/07-admin.js lagen (hardened-222): ein Dialog liegt dort, wo er AUFGERUFEN
 * wird, statt wo er hingehört. Wer am Navigationsaufbau etwas ändern wollte,
 * las erst an einem Erfassungsformular vorbei.
 *
 * Der Dialog liest seinen Zustand selbst vom ViewModel — dieselbe Bauart, die
 * die Reiter-Bildschirme seit Nachtrag 96 haben. Von aussen kommt nur der
 * ImageLoader, den der Aufrufer ohnehin hält.
 *
 * Die äussere Bedingung `if (barcodeState.result != null)` bleibt beim
 * AUFRUFER: So steht an genau einer Stelle, WANN der Dialog erscheint, und
 * diese Datei beschreibt nur, WIE er aussieht.
 */
@Composable
fun BarcodeResultDialog(vm: MainViewModel, imageLoader: ImageLoader) {
    val state by vm.state.collectAsStateWithLifecycle()
    val barcodeState by vm.barcodeState.collectAsStateWithLifecycle()
    if (barcodeState.result == null) return

// Preisfeld pro gescanntem Barcode zurücksetzen
var barcodePriceText by remember(barcodeState.result) { mutableStateOf("") }
var barcodeCondition by remember(barcodeState.result) { mutableStateOf(state.userDefaultCondition ?: "N") }
// Eigentümer wie im Galerie-Dialog vorbelegen: das eigene Konto
// (Nachtrag 44, Marcos Bericht — beim Barcode-Erfassen liess sich der
// Eigentümer gar nicht wählen, obwohl Repository, API und Server ihn
// seit jeher entgegennehmen; nur dieser Dialog fragte ihn nie ab).
var barcodeOwner by remember(barcodeState.result, state.householdMembers) {
    mutableStateOf(state.householdMembers.firstOrNull { it.isSelf }?.id)
}
AlertDialog(
    // Während des Hinzufügens nicht per Tipp daneben schliessbar —
    // sonst verschwindet der Dialog, während der Aufruf noch läuft.
    onDismissRequest = { if (!barcodeState.adding) vm.cancelBarcode() },
    title = {
        Text(
            if (barcodeState.source == "partslist") stringResource(R.string.main_barcode_add_partslist)
            else stringResource(R.string.main_barcode_add_set),
            fontWeight = FontWeight.Bold
        )
    },
    text = {
        Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
            // ── Hinweis bei geratener Nummer ────────────────────────────────
            //
            // Marcos Meldung: „Es werden regelmässig falsche Nummern erkannt."
            //
            // Der Dialog zeigt Bild und Namen seit jeher — es fehlte nur der
            // Hinweis, WANN man hinsehen muss. Zwei Fälle setzen das Feld: Der
            // Server konnte die EAN nicht abgleichen und hat nur einen
            // plausiblen Kandidaten (utils/barcodeQuelle.ts), oder die Nummer
            // kam aus der Texterkennung, wo schon das Lesen eine Vermutung ist.
            //
            // Bewusst ganz oben und in der Warnfarbe, aber ohne den Vorgang zu
            // sperren: Der Treffer ist oft richtig, und wer ihn bestätigt,
            // soll das mit einem Blick tun können statt mit einem Klick mehr.
            if (barcodeState.unsicher) {
                Surface(
                    color = MaterialTheme.colorScheme.errorContainer,
                    shape = MaterialTheme.shapes.small,
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Row(
                        Modifier.padding(horizontal = 10.dp, vertical = 8.dp),
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Text("⚠️", fontSize = 16.sp)
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
            if (imgUrl != null) {
                coil.compose.AsyncImage(
                    model = coil.request.ImageRequest.Builder(androidx.compose.ui.platform.LocalContext.current)
                        .data(imgUrl).crossfade(true).build(),
                    imageLoader = imageLoader,
                    contentDescription = barcodeState.setName,
                    modifier = Modifier.fillMaxWidth().height(160.dp).clip(MaterialTheme.shapes.medium),
                    contentScale = ContentScale.Fit
                )
            }
            if (barcodeState.setName != null)
                Text(barcodeState.setName!!, fontWeight = FontWeight.Bold,
                    style = MaterialTheme.typography.titleMedium)
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                Text(barcodeState.result!!, style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.primary, fontWeight = FontWeight.SemiBold)
                if (barcodeState.theme != null)
                    Surface(color = MaterialTheme.colorScheme.primaryContainer, shape = MaterialTheme.shapes.small) {
                        Text(barcodeState.theme!!, Modifier.padding(horizontal=6.dp, vertical=2.dp),
                            style = MaterialTheme.typography.labelSmall,
                            color = MaterialTheme.colorScheme.onPrimaryContainer)
                    }
            }
            HorizontalDivider()
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceAround) {
                if (barcodeState.year != null) Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    Text("📅", fontSize = 18.sp)
                    Text("${barcodeState.year}", style = MaterialTheme.typography.labelSmall, fontWeight = FontWeight.Bold)
                    Text(stringResource(R.string.main_barcode_year), style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                if (barcodeState.pieces != null) Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    Text("⚙️", fontSize = 18.sp)
                    Text(ch.brickinventoryapp.util.fmtInt(barcodeState.pieces!!), style = MaterialTheme.typography.labelSmall, fontWeight = FontWeight.Bold)
                    Text(stringResource(R.string.main_barcode_pieces), style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                if (barcodeState.minifigs != null && barcodeState.minifigs!! > 0)
                    Column(horizontalAlignment = Alignment.CenterHorizontally) {
                        Text("👷", fontSize = 18.sp)
                        Text("${barcodeState.minifigs}", style = MaterialTheme.typography.labelSmall, fontWeight = FontWeight.Bold)
                        Text(stringResource(R.string.main_barcode_figs), style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
            }
            // Erfassungsfelder NUR beim Erfassen in die Sammlung
            // (Nachtrag 56, Marcos Wunsch).
            //
            // Aus der TEILELISTE heraus dient der Scanner nur dazu, ein
            // Set in die Liste aufzunehmen, aus der später die
            // Teileübersicht erzeugt wird. Es entsteht dabei KEIN
            // Bestand: confirmAddBarcode() reicht die Nummer im Zweig
            // `source == "partslist"` nur weiter und ruft gar
            // keine Erfassung auf. Eigentümer, Kaufpreis und Zustand
            // wären dort also Felder ohne jede Wirkung — man füllt sie
            // aus, und nichts davon wird je gespeichert. Das ist
            // schlimmer als fehlende Felder: Es sieht aus wie eine
            // Eingabe, die zählt.
            //
            // Bild, Name, Nummer und die Kennzahlen darüber bleiben —
            // sie helfen beim Prüfen, ob das richtige Set gescannt
            // wurde, und genau darum geht es hier.
            if (barcodeState.source != "partslist") {
                // Kaufpreis direkt beim Erfassen (optional) — leer lassen übernimmt
                // serverseitig den aktuellen Marktpreis (gleiche Logik wie Webapp).
                // OwnerPicker blendet sich ohne Haushalt selbst aus
                // (members.size < 2 → return), deshalb keine Bedingung hier.
                ch.brickinventoryapp.ui.screens.OwnerPicker(
                    state.householdMembers, barcodeOwner, { barcodeOwner = it }
                )
                OutlinedTextField(
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
            }
        }
    },
    confirmButton = {
        // Zweite Verteidigungslinie gegen die Doppelerfassung: sichtbar
        // gesperrter Knopf mit Spinner. Die eigentliche Sperre sitzt in
        // confirmAddBarcode() — hier geht es darum, dass der Nutzer
        // sieht, dass sein Tippen angekommen ist, und gar nicht erst
        // ein zweites Mal tippt.
        Button(
            onClick = {
                if (barcodeState.source == "partslist") {
                    // Nur die Nummer (Nachtrag 56): Aus der Teileliste
                    // entsteht kein Bestand, die Felder sind oben gar
                    // nicht sichtbar. Sie hier trotzdem mitzuschicken,
                    // hiesse Werte zu übergeben, die niemand eingeben
                    // konnte — confirmAddBarcode() verwirft sie im
                    // partslist-Zweig zwar, aber der Aufruf soll auch
                    // beim Lesen zeigen, was gemeint ist.
                    vm.confirmAddBarcode(barcodeState.result!!)
                } else {
                    val price = barcodePriceText.replace(',', '.').toDoubleOrNull()
                    vm.confirmAddBarcode(
                        barcodeState.result!!, price, barcodeCondition,
                        // Ohne Haushalt gar nichts mitschicken — der Server
                        // bleibt dann beim eigenen Konto (gleiche Regel wie
                        // im Galerie-Dialog).
                        if (state.householdMembers.size > 1) barcodeOwner else null
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
                Spacer(Modifier.width(8.dp))
                Text(stringResource(R.string.barcode_add))
            } else {
                Text("✅ " + stringResource(R.string.barcode_add))
            }
        }
    },
    dismissButton = {
        TextButton(
            onClick = { vm.cancelBarcode() },
            enabled = !barcodeState.adding
        ) { Text(stringResource(R.string.common_cancel)) }
    }
)
}
