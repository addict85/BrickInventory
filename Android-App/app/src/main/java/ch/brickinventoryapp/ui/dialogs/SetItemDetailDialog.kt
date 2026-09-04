package ch.brickinventoryapp.ui.dialogs

// Sammel-Importe wie in den Nachbardialogen (BarcodeResultDialog.kt,
// SetPruefungDialog.kt): `Modifier.size` steckt in foundation.layout, und das
// `by` vor collectAsStateWithLifecycle braucht runtime.getValue.
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import coil.ImageLoader
import coil.compose.AsyncImage
import ch.brickinventoryapp.R
import ch.brickinventoryapp.ui.MainViewModel
import ch.brickinventoryapp.ui.components.ZoomableImageDialog
import ch.brickinventoryapp.ui.schliesseSetItem
import ch.brickinventoryapp.util.resolveFullUrlViaProxy

/**
 * Detail-Dialog fuer ein Teil / eine Figur AUS EINEM SET.
 *
 * ── Marcos Wunsch ──────────────────────────────────────────────────────────
 * „Auch die automatisch erfassten Teile und Minifiguren sollen einen
 * Detail-Dialog inkl. Zoom haben. Der Marktpreis kann weggelassen werden. Die
 * Anzahl soll nicht geaendert werden koennen. Dafuer soll angezeigt werden,
 * welche Sets dieses Teil und Minifigur verwenden — inkl. Link, um den
 * Detail-Dialog des Sets oeffnen zu koennen."
 *
 * Bis hierher war die Kachel eines Teils aus einem Set TOT: kein Bild in
 * voller Groesse, keine Angabe, aus welchem Set es stammt. Manuell erfasste
 * Teile hatten laengst einen Dialog.
 *
 * ── Was er NICHT hat, und warum ────────────────────────────────────────────
 *  • Keinen Marktpreis — Marcos Vorgabe.
 *  • Keine Mengenwahl. Die Zahl entsteht aus den Inventaren der Sets; sie hier
 *    zu aendern hiesse, etwas zu behaupten, das beim naechsten Abgleich wieder
 *    verschwindet.
 *  • Keinen Loeschknopf. Ein Teil aus einem Set loescht man nicht einzeln — es
 *    verschwindet mit dem Set. Der Knopf saesse fuer eine Handlung da, die es
 *    nicht gibt.
 *
 * ── Gegenstueck in der Webapp ──────────────────────────────────────────────
 * public/js/13-acquisition-modals.js, openSetItemDetail(). Beide zeigen
 * dasselbe in derselben Reihenfolge und holen es von derselben Adresse
 * (/v1/parts/:nr/:farbe/sets bzw. /v1/minifigs/:nr/sets).
 *
 * @param onOpenSet Oeffnet das Set-Detail. Bleibt Parameter, weil nur der
 *        Navigationsgraph den NavController kennt — dieselbe Bauart wie
 *        `onOpenDetail` in PartsScreen.
 */
@Composable
fun SetItemDetailDialog(
    vm: MainViewModel,
    imageLoader: ImageLoader,
    serverUrl: String,
    onOpenSet: (String) -> Unit,
) {
    val zustand by vm.setItemState.collectAsStateWithLifecycle()
    if (!zustand.offen) return

    // rememberSaveable, nicht remember: Der geoeffnete Zoom ist eine
    // Entscheidung des Nutzers und muss eine Drehung ueberstehen — so
    // halten es die drei uebrigen Zoom-Stellen (SetDetailScreen,
    // ManualItemDetailScreen, CatalogDetailScreen) auch. Gemeldet hat das
    // BildschirmZustandTest; hier stand als einziger Stelle im Baum noch
    // das blosse remember.
    var zeigeZoom by rememberSaveable { mutableStateOf(false) }
    // stringResource() geht nur ausserhalb des LazyColumn-Rumpfs — dort ist
    // kein Composable-Kontext fuer jedes Element noetig, und einmal lesen
    // reicht.
    val oeffneLabel = stringResource(R.string.setitem_open_set)
    val kopf = zustand.kopf
    // Volle Aufloesung UEBER den Server-Proxy — bei Teilen und Figuren ist das
    // ausdruecklich so entschieden (siehe resolveFullUrlViaProxy), damit kein
    // Geraet am Server vorbei direkt mit dem CDN spricht. Genau dieselbe Wahl
    // trifft der Dialog fuer manuell erfasste Teile.
    val bild = kopf?.let { resolveFullUrlViaProxy(serverUrl, it.imageLocal, it.imageUrl) }

    AlertDialog(
        onDismissRequest = { vm.schliesseSetItem() },
        confirmButton = {
            TextButton(onClick = { vm.schliesseSetItem() }) {
                Text(stringResource(R.string.detail_close))
            }
        },
        title = {
            Column {
                Text(kopf?.name ?: zustand.nummer, fontWeight = FontWeight.SemiBold)
                Text(
                    zustand.nummer + (kopf?.colorName?.let { " · $it" } ?: ""),
                    fontSize = 12.sp,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        },
        text = {
            Column(Modifier.fillMaxWidth()) {
                when {
                    zustand.laedt -> Box(Modifier.fillMaxWidth().padding(24.dp), Alignment.Center) {
                        CircularProgressIndicator(Modifier.size(28.dp))
                    }
                    zustand.fehler != null -> Text(
                        zustand.fehler!!,
                        color = MaterialTheme.colorScheme.error,
                    )
                    else -> {
                        if (bild != null) {
                            // Tippen vergroessert — genau der Zoom, den Marco
                            // wollte. Dasselbe Bauteil wie im Set-Detail und im
                            // Dialog fuer manuell erfasste Teile.
                            AsyncImage(
                                model = bild,
                                contentDescription = kopf.name,
                                imageLoader = imageLoader,
                                contentScale = ContentScale.Fit,
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .height(140.dp)
                                    .clickable { zeigeZoom = true },
                            )
                            Spacer(Modifier.height(12.dp))
                        }
                        SetItemZeile(
                            stringResource(R.string.setitem_total_qty),
                            "${kopf?.totalQuantity ?: 0}×")
                        kopf?.colorName?.let {
                            SetItemZeile(stringResource(R.string.setitem_color), it)
                        }
                        kopf?.categoryName?.let {
                            SetItemZeile(stringResource(R.string.setitem_category), it)
                        }
                        if (kopf?.isSpare == true) {
                            SetItemZeile(stringResource(R.string.parts_spare_tag), "✓")
                        }
                        Spacer(Modifier.height(12.dp))
                        Text(
                            stringResource(R.string.setitem_used_in),
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            fontSize = 14.sp,
                        )
                        if (zustand.sets.isEmpty()) {
                            Text(
                                stringResource(R.string.setitem_used_in_none),
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                                fontSize = 13.sp,
                            )
                        } else {
                            // LazyColumn mit Hoehenbegrenzung: Ein Teil kann in
                            // Dutzenden Sets stecken, und ein Dialog, der ueber
                            // den Bildschirmrand hinauswaechst, laesst sich
                            // nicht mehr schliessen.
                            LazyColumn(Modifier.fillMaxWidth().heightIn(max = 220.dp)) {
                                items(zustand.sets, key = { it.setNumber + "-" + it.ownerUserId }) { s ->
                                    Row(
                                        Modifier
                                            .fillMaxWidth()
                                            // onClickLabel sagt der
                                            // Sprachausgabe, was das Antippen
                                            // TUT — ohne das liest sie nur die
                                            // Setnummer vor. In der Webapp
                                            // steht derselbe Text als
                                            // title-Attribut.
                                            .clickable(
                                                onClickLabel = oeffneLabel,
                                            ) {
                                                // Erst schliessen, dann oeffnen:
                                                // Sonst laege der Dialog ueber
                                                // dem Set-Detail.
                                                vm.schliesseSetItem()
                                                onOpenSet(s.setNumber)
                                            }
                                            .padding(vertical = 6.dp),
                                        verticalAlignment = Alignment.CenterVertically,
                                    ) {
                                        Text(s.setNumber, fontSize = 13.sp,
                                            fontWeight = FontWeight.SemiBold)
                                        Spacer(Modifier.width(8.dp))
                                        Text(
                                            s.setName ?: "",
                                            fontSize = 13.sp,
                                            maxLines = 1,
                                            modifier = Modifier.weight(1f),
                                        )
                                        Text("×${s.quantity}", fontSize = 13.sp,
                                            color = MaterialTheme.colorScheme.onSurfaceVariant)
                                    }
                                }
                            }
                        }
                    }
                }
            }
        },
    )

    if (zeigeZoom && bild != null) {
        ZoomableImageDialog(
            imageUrl = bild,
            contentDescription = kopf.name,
            imageLoader = imageLoader,
            onDismiss = { zeigeZoom = false },
        )
    }
}

/** Beschriftung links, Wert rechts — wie CatalogDetailRow im Katalog-Detail. */
@Composable
private fun SetItemZeile(label: String, wert: String) {
    Row(Modifier.fillMaxWidth().padding(vertical = 2.dp),
        horizontalArrangement = Arrangement.SpaceBetween) {
        Text(label, color = MaterialTheme.colorScheme.onSurfaceVariant, fontSize = 14.sp)
        Text(wert, fontWeight = FontWeight.SemiBold, fontSize = 14.sp,
            modifier = Modifier.padding(start = 16.dp))
    }
}
