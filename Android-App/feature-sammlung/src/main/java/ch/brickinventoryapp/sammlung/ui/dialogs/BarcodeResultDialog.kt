package ch.brickinventoryapp.sammlung.ui.dialogs

import ch.brickinventoryapp.sitzung.AppUiState
import ch.brickinventoryapp.model.ui.Scannerherkunft
import ch.brickinventoryapp.model.fach.Erfassungswunsch
import ch.brickinventoryapp.model.fach.Zustand
import ch.brickinventoryapp.gemeinsam.ui.InfoPlakette
import ch.brickinventoryapp.ui.components.ErfassenDialog
import androidx.compose.runtime.saveable.rememberSaveable
import ch.brickinventoryapp.sammlung.ui.viewmodel.ErfassungAktionen
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
import ch.brickinventoryapp.sammlung.ui.BarcodeUiState
import ch.brickinventoryapp.ui.titel
import ch.brickinventoryapp.zustand.ui.BlickfeldUiState
import ch.brickinventoryapp.zustand.ui.LagerUiState
import coil3.ImageLoader
import coil3.request.crossfade
import ch.brickinventoryapp.ressourcen.R
import androidx.compose.ui.res.vectorResource
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.Color
import androidx.compose.foundation.layout.Column
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.compose.ui.res.stringResource
import ch.brickinventoryapp.ui.util.NumericInput
import ch.brickinventoryapp.sammlung.ui.viewmodel.ErfassungViewModel
import ch.brickinventoryapp.ui.theme.Abstaende
import ch.brickinventoryapp.ui.components.ProduktBild
import ch.brickinventoryapp.ui.components.bewegungReduziert
import ch.brickinventoryapp.ui.components.mitSchrift
import ch.brickinventoryapp.gemeinsam.ui.LagerortErfassung
import ch.brickinventoryapp.gemeinsam.ui.OwnerPicker
import ch.brickinventoryapp.gemeinsam.ui.Zustandszeile
import ch.brickinventoryapp.ui.theme.Formen
import ch.brickinventoryapp.ui.util.fmtInt

/**
 * Der Dialog nach einem erfolgreichen Barcode-Scan: Set (oder Teileliste)
 * bestätigen, Menge, Kaufpreis, Zustand und Eigentümer erfassen.
 *
 * Die Bedingung `if (barcodeState.result != null)` bleibt beim Aufrufer: So steht
 * an einer Stelle, wann er erscheint, und hier nur, wie er aussieht.
 */
@Composable
internal fun BarcodeResultRoute(vm: ErfassungViewModel, imageLoader: ImageLoader) {
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

// Je gescanntem Barcode neu, und über eine Drehung hinweg (rememberSaveable): Preis
// und Lagerort gingen beim Drehen verloren.
var barcodeQuantity by rememberSaveable(barcodeState.result) { mutableStateOf("1") }
var barcodePriceText by rememberSaveable(barcodeState.result) { mutableStateOf("") }
var barcodeCondition by rememberSaveable(barcodeState.result) { mutableStateOf(state.userDefaultCondition ?: Zustand.NEU) }
// Eigentümer wie im Galerie-Dialog vorbelegen: das eigene Konto. Repository, API
// und Server nehmen ihn entgegen, also muss auch dieser Weg ihn abfragen.
var barcodeOwner by rememberSaveable(barcodeState.result, blick.householdMembers) {
    mutableStateOf(blick.householdMembers.firstOrNull { it.isSelf }?.id)
}
// Lagerort zurückgesetzt auf die Vorgabe, nicht auf leer, damit sie bei einer
// Neuerfassung vorausgewählt ist; die Vorgabe kann nach dem Scan eintreffen.
val lagerZustand = zustand.lagerZustand
val lagerVorgabe = lagerZustand.vorgabe?.name ?: ""
var barcodeLagerort by rememberSaveable(barcodeState.result, lagerVorgabe) { mutableStateOf(lagerVorgabe) }
val fuerTeileliste = barcodeState.source == Scannerherkunft.TEILELISTE
// Derselbe Rahmen wie „Set erfassen“: Titel, Felder untereinander, rechts der volle Knopf.
ErfassenDialog(
    titel = if (fuerTeileliste) stringResource(R.string.main_barcode_add_partslist)
            else stringResource(R.string.main_barcode_add_set),
    bestaetigen = stringResource(R.string.barcode_add),
    // Die Sperre gegen die Doppelerfassung sitzt in confirmAddBarcode(); hier sieht man,
    // dass das Tippen angekommen ist.
    bestaetigenAn = !barcodeState.adding,
    onBestaetigen = {
        if (fuerTeileliste) {
            // Nur die Nummer: Aus der Teileliste entsteht kein Bestand.
            aktionen.confirmAddBarcode(Erfassungswunsch(barcodeState.result))
        } else {
            aktionen.confirmAddBarcode(Erfassungswunsch(
                setNumber = barcodeState.result,
                menge = barcodeQuantity.toIntOrNull()?.coerceAtLeast(1) ?: 1,
                kaufpreis = NumericInput.leseBetrag(barcodePriceText),
                zustand = barcodeCondition,
                // Ohne Haushalt gar nichts mitschicken — der Server bleibt dann beim
                // eigenen Konto (gleiche Regel wie im Galerie-Dialog).
                besitzer = if (blick.householdMembers.size > 1) barcodeOwner else null,
                lagerort = barcodeLagerort.trim().takeIf { it.isNotEmpty() },
            ))
        }
    },
    // Während des Hinzufügens nicht schliessbar — der Aufruf läuft noch.
    onAbbrechen = { if (!barcodeState.adding) aktionen.cancelBarcode() },
) {
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
                        Icon(Icons.Default.Warning, null, Modifier.size(mitSchrift(20.dp)),
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
            ProduktBild(
                model = imgUrl?.let { coil3.request.ImageRequest.Builder(ctx).data(it).crossfade(!bewegungReduziert()).build() },
                imageLoader = imageLoader,
                contentDescription = barcodeState.setName,
                modifier = Modifier.fillMaxWidth().height(160.dp).clip(MaterialTheme.shapes.medium),
                contentScale = ContentScale.Fit,
                ersatzGroesse = 56.dp,
            )
            if (barcodeState.setName != null)
                Text(barcodeState.setName, fontWeight = FontWeight.Bold,
                    style = MaterialTheme.typography.titleMedium)
            // Wie im Katalog: Wer ein Set schon hat, soll es sehen, bevor er es ein zweites Mal erfasst.
            if (barcodeState.besitzMenge > 0 && !fuerTeileliste)
                InfoPlakette(stringResource(R.string.barcode_schon_besessen, barcodeState.besitzMenge), icon = Icons.Default.Check)
            Row(horizontalArrangement = Arrangement.spacedBy(Abstaende.klein), verticalAlignment = Alignment.CenterVertically) {
                Text(barcodeState.result, style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.primary, fontWeight = FontWeight.SemiBold)
                if (barcodeState.theme != null)
                    Surface(color = MaterialTheme.colorScheme.primaryContainer, shape = MaterialTheme.shapes.small) {
                        Text(barcodeState.theme, Modifier.padding(horizontal = 6.dp, vertical = Abstaende.haar),
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onPrimaryContainer)
                    }
            }
            HorizontalDivider()
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceAround) {
                if (barcodeState.year != null) Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    Icon(Icons.Default.CalendarMonth, null, Modifier.size(mitSchrift(18.dp)), tint = MaterialTheme.colorScheme.onSurfaceVariant)
                    Text("${barcodeState.year}", style = MaterialTheme.typography.bodySmall, fontWeight = FontWeight.Bold)
                    Text(stringResource(R.string.main_barcode_year), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                if (barcodeState.pieces != null) Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    Icon(ImageVector.vectorResource(R.drawable.ic_parts_bricks), null, Modifier.size(mitSchrift(18.dp)), tint = Color.Unspecified)
                    Text(fmtInt(barcodeState.pieces), style = MaterialTheme.typography.bodySmall, fontWeight = FontWeight.Bold)
                    Text(stringResource(R.string.main_barcode_pieces), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                if (barcodeState.minifigs != null && barcodeState.minifigs > 0)
                    Column(horizontalAlignment = Alignment.CenterHorizontally) {
                        Icon(Icons.Default.Person, null, Modifier.size(mitSchrift(18.dp)), tint = MaterialTheme.colorScheme.onSurfaceVariant)
                        Text("${barcodeState.minifigs}", style = MaterialTheme.typography.bodySmall, fontWeight = FontWeight.Bold)
                        Text(stringResource(R.string.main_barcode_figs), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
            }
            // Erfassungsfelder nur beim Erfassen in die Sammlung. Aus der Teileliste entsteht
            // kein Bestand — confirmAddBarcode() reicht im Zweig TEILELISTE nur
            // die Nummer weiter. Eigentümer, Kaufpreis und Zustand wären dort Felder ohne
            // Wirkung, die aussehen wie eine Eingabe, die zählt. Bild, Name, Nummer und
            // Kennzahlen bleiben: Sie helfen zu prüfen, ob das richtige Set gescannt wurde.
            if (barcodeState.source != Scannerherkunft.TEILELISTE) {
                // Kaufpreis direkt beim Erfassen (optional) — leer lassen übernimmt
                // serverseitig den aktuellen Marktpreis (gleiche Logik wie Webapp).
                // OwnerPicker blendet sich ohne Haushalt selbst aus
                // (members.size < 2 → return), deshalb keine Bedingung hier.
                OwnerPicker(
                    blick.householdMembers, barcodeOwner, { barcodeOwner = it }
                )
                OutlinedTextField(
                    shape = Formen.feld,
                    value = barcodeQuantity,
                    onValueChange = { barcodeQuantity = NumericInput.quantity(it) },
                    label = { Text(stringResource(R.string.common_quantity)) },
                    singleLine = true,
                    keyboardOptions = NumericInput.ganzzahlTastatur(),
                    modifier = Modifier.fillMaxWidth()
                )
                OutlinedTextField(
                    shape = Formen.feld,
                    value = barcodePriceText,
                    onValueChange = { nv -> barcodePriceText = NumericInput.price(nv) },
                    label = { Text(stringResource(R.string.barcode_purchase_price)) },
                    singleLine = true,
                    keyboardOptions = NumericInput.preisTastatur(),
                    modifier = Modifier.fillMaxWidth()
                )
                Zustandszeile(
                    zustand = barcodeCondition,
                    onZustand = { barcodeCondition = it }
                )
                LagerortErfassung(
                    barcodeLagerort,
                    // Der VORRAT, nicht die belegten Orte: Beim Erfassen soll
                    // auch ein leeres Regal zur Wahl stehen.
                    lagerZustand.eigene.map { it.name },
                    { barcodeLagerort = it }
                )
            }
}
}
