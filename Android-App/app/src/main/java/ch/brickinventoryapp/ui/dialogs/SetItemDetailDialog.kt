package ch.brickinventoryapp.ui.dialogs

// Sammel-Importe wie in den Nachbardialogen (BarcodeResultDialog.kt,
// SetPruefungDialog.kt): `Modifier.size` steckt in foundation.layout, und das
// `by` vor collectAsStateWithLifecycle braucht runtime.getValue.
import androidx.compose.foundation.clickable
import androidx.compose.ui.semantics.Role
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.*
import androidx.compose.runtime.*
// rememberSaveable liegt im UNTERPAKET runtime.saveable — der Sammelimport
// darueber deckt es nicht ab (Kotlin-Sternimporte gelten nicht fuer
// Unterpakete). Genau daran ist Lauf 81 gescheitert.
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import coil3.ImageLoader
import coil3.compose.AsyncImage
import ch.brickinventoryapp.R
import ch.brickinventoryapp.ui.viewmodel.TeileViewModel
import ch.brickinventoryapp.ui.components.ZoomableImageDialog
import ch.brickinventoryapp.ui.screens.TabellenZeile
import ch.brickinventoryapp.util.resolveFullUrlViaProxy
import ch.brickinventoryapp.util.rememberTileImageWithFallback
import ch.brickinventoryapp.ui.theme.Abstaende

/**
 * Detail-Dialog für ein Teil / eine Figur aus einem Set: Bild mit Zoom und die
 * Sets, die es verwenden, mit Link zum Set-Detail.
 *
 * Was er bewusst nicht hat: • Keinen Marktpreis — gewünscht ohne. • Keine
 * Mengenwahl. Die Zahl entsteht aus den Inventaren der Sets; eine Änderung
 * verschwände beim nächsten Abgleich. • Keinen Löschknopf. Ein Teil aus einem Set
 * verschwindet mit dem Set, nicht einzeln.
 *
 * Gegenstück in der Webapp: public/js/13-acquisition-modals.js,
 * openSetItemDetail() — dieselbe Reihenfolge, dieselbe Adresse
 * (/v1/parts/:nr/:farbe/sets bzw. /v1/minifigs/:nr/sets).
 *
 * @param onOpenSet Öffnet das Set-Detail. Parameter, weil nur der Navigationsgraph
 *         den NavController kennt — wie `onOpenDetail` in PartsScreen.
 */
@Composable
fun SetItemDetailDialog(
    vm: TeileViewModel,
    imageLoader: ImageLoader,
    serverUrl: String,
    onOpenSet: (String) -> Unit,
) {
    val zustand by vm.setItemState.collectAsStateWithLifecycle()
    // `lagerZustand`, nicht `lager`: UiStateFieldsTest bestimmt den Typ je NAME
    // und Datei — dieselbe Namensfalle wie bei `state` in SettingsScreen.kt.
    val lagerZustand by vm.lagerState.collectAsStateWithLifecycle()
    // Die Auswahlliste gehoert dem BESITZER des Teils, nicht dem Betrachter —
    // dieselbe Regel wie beim Set. Ohne `kopf` (Dialog gerade erst geoeffnet)
    // bleibt die Liste leer, und der Server antwortet mit der eigenen; der
    // naechste Durchlauf holt die richtige nach.
    LaunchedEffect(zustand.offen, zustand.kopf?.ownerIds) {
        if (zustand.offen) vm.loadLagerortVorrat(zustand.kopf?.ownerIds ?: emptyList())
    }
    if (!zustand.offen) return

    // rememberSaveable, nicht remember: Der geöffnete Zoom ist eine Entscheidung des
    // Nutzers und muss eine Drehung überstehen — wie an den übrigen Zoom-Stellen
    // (BildschirmZustandTest).
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
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        },
        text = {
            Column(Modifier.fillMaxWidth()) {
                when {
                    zustand.laedt -> Box(Modifier.fillMaxWidth().padding(Abstaende.sehrGross), Alignment.Center) {
                        CircularProgressIndicator(Modifier.size(28.dp))
                    }
                    zustand.fehler != null -> Text(
                        zustand.fehler!!,
                        color = MaterialTheme.colorScheme.error,
                    )
                    else -> {
                        if (bild != null) {
                            // Tippen vergrössert — dasselbe Bauteil wie im Set-Detail
                            // und im Dialog für manuell erfasste Teile.
                            AsyncImage(
                                model = bild,
                                contentDescription = kopf.name,
                                imageLoader = imageLoader,
                                contentScale = ContentScale.Fit,
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .height(140.dp)
                                    .clickable(role = Role.Button) { zeigeZoom = true },
                            )
                            Spacer(Modifier.height(Abstaende.mittel))
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
                        // ── Lagerort ──
                        //
                        // Nur für Teile (kopf.colorId ist bei Figuren null): Eine Minifigur steckt
                        // in ihrem Set, dessen Ort im Set-Detail steht — ein zweiter Ort könnte
                        // auseinanderlaufen. Bearbeitbar wie in der Webapp; das Feld schreibt auf
                        // alle Zeilen dieses Teil-Farb-Paares. Die Auswahlliste gehört dem Besitzer
                        // wie beim Set: Der Kopf führt seine Konten mit (owner_ids).
                        if (kopf != null && kopf.colorId != null) {
                            Row(Modifier.fillMaxWidth().padding(vertical = Abstaende.haar),
                                horizontalArrangement = Arrangement.SpaceBetween,
                                verticalAlignment = Alignment.CenterVertically) {
                                Text(stringResource(R.string.detail_storage),
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                    style = MaterialTheme.typography.bodyMedium)
                                ch.brickinventoryapp.ui.screens.LagerortFeld(
                                    wert = kopf.storage ?: "",
                                    vorrat = lagerZustand.vorrat.map { it.name },
                                    onWert = { vm.setzeTeilLagerort(kopf.nummer, kopf.colorId, it) },
                                    modifier = Modifier.padding(start = Abstaende.gross)
                                        .widthIn(max = 180.dp),
                                )
                            }
                        }
                        Spacer(Modifier.height(Abstaende.mittel))
                        Text(
                            stringResource(R.string.setitem_used_in),
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            style = MaterialTheme.typography.bodyMedium,
                        )
                        if (zustand.sets.isEmpty()) {
                            Text(
                                stringResource(R.string.setitem_used_in_none),
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                                style = MaterialTheme.typography.bodySmall,
                            )
                        } else {
                            // LazyColumn mit Hoehenbegrenzung: Ein Teil kann in
                            // Dutzenden Sets stecken, und ein Dialog, der ueber
                            // den Bildschirmrand hinauswaechst, laesst sich
                            // nicht mehr schliessen.
                            LazyColumn(Modifier.fillMaxWidth().heightIn(max = 220.dp)) {
                                items(zustand.sets, key = { it.setNumber + "-" + it.ownerUserId }) { s ->
                                    // ── Bild, Nummer, Bezeichnung, Menge ──
                                    //
                                    // Erst das kleine Bild, dann Nummer, dann Name — wie im Reiter
                                    // Finanzen. Dafür gibt es TabellenZeile; eine eigene Zeile
                                    // hätte festen Eckenradius und keinen Rückfall auf die volle
                                    // Auflösung ohne Vorschaubild.
                                    val (bildUrl, onBildFehler) =
                                        rememberTileImageWithFallback(serverUrl, s.imageLocal, s.imageUrl)
                                    TabellenZeile(
                                        bildUrl = bildUrl,
                                        nummer = s.setNumber,
                                        name = s.setName,
                                        menge = s.quantity,
                                        imageLoader = imageLoader,
                                        onBildFehler = onBildFehler,
                                        // onClickLabel sagt der Sprachausgabe, was das Antippen tut
                                        // — ohne liest sie nur die Setnummer vor. In der Webapp
                                        // steht derselbe Text als title-Attribut.
                                        onClickLabel = oeffneLabel,
                                        onClick = {
                                            // Erst schliessen, dann oeffnen:
                                            // Sonst laege der Dialog ueber dem
                                            // Set-Detail.
                                            vm.schliesseSetItem()
                                            onOpenSet(s.setNumber)
                                        },
                                    )
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
    Row(Modifier.fillMaxWidth().padding(vertical = Abstaende.haar),
        horizontalArrangement = Arrangement.SpaceBetween) {
        Text(label, color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodyMedium)
        Text(wert, fontWeight = FontWeight.SemiBold, style = MaterialTheme.typography.bodyMedium,
            modifier = Modifier.padding(start = Abstaende.gross))
    }
}
