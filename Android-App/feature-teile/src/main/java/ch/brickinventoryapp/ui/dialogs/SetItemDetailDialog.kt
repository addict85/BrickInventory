package ch.brickinventoryapp.ui.dialogs

import ch.brickinventoryapp.ui.LagerUiState
import ch.brickinventoryapp.ui.SetItemUiState
import ch.brickinventoryapp.ui.viewmodel.TeileAktionen
import androidx.compose.ui.draw.clip
import androidx.compose.foundation.clickable
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
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
import coil3.ImageLoader
import ch.brickinventoryapp.ressourcen.R
import ch.brickinventoryapp.ui.components.ZoomableImageDialog
import ch.brickinventoryapp.ui.screens.TabellenZeile
import ch.brickinventoryapp.util.resolveFullUrlViaProxy
import ch.brickinventoryapp.util.rememberTileImageWithFallback
import ch.brickinventoryapp.ui.theme.Abstaende
import ch.brickinventoryapp.ui.components.DetailTopAppBar
import ch.brickinventoryapp.ui.components.ProduktBild
import ch.brickinventoryapp.ui.components.ZurueckKnopf
import ch.brickinventoryapp.ui.components.farbUebersetzer
import ch.brickinventoryapp.ui.components.kategorieUebersetzer
import ch.brickinventoryapp.ui.mengeAusSet
import ch.brickinventoryapp.ui.screens.LagerortFeld

/**
 * Detail für ein Teil / eine Figur aus einem Set, auf dem Telefon als Blatt von unten:
 * Bild mit Zoom und die Sets, die es verwenden, mit Link zum Set-Detail. Ein Blatt
 * statt eines Dialogs, weil Lagerort und Liste Platz brauchen und das Wischen nach
 * unten schliesst wie überall.
 * Ausführlich: docs/begruendungen/feature-teile/ui/dialogs/SetItemDetailDialog.kt.md#setitemdetaildialog
 */
@Composable
fun SetItemDetailDialog(
    zustand: SetItemUiState,
    lagerZustand: LagerUiState,
    aktionen: TeileAktionen,
    imageLoader: ImageLoader,
    serverUrl: String,
    onOpenSet: (String) -> Unit,
) {
    SetItemDetail(zustand, lagerZustand, aktionen, imageLoader, serverUrl, onOpenSet, alsDialog = true)
}

/**
 * Dasselbe Detail als rechte Hälfte neben der Liste (Tablet, Listen-Detail wie in
 * der Merkliste): Titel mit Schliessen-Knopf, darunter der Inhalt, rollbar.
 */
@Composable
fun SetItemDetailBereich(
    zustand: SetItemUiState,
    lagerZustand: LagerUiState,
    aktionen: TeileAktionen,
    imageLoader: ImageLoader,
    serverUrl: String,
    onOpenSet: (String) -> Unit,
) {
    SetItemDetail(zustand, lagerZustand, aktionen, imageLoader, serverUrl, onOpenSet, alsDialog = false)
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun SetItemDetail(
    zustand: SetItemUiState,
    lagerZustand: LagerUiState,
    aktionen: TeileAktionen,
    imageLoader: ImageLoader,
    serverUrl: String,
    onOpenSet: (String) -> Unit,
    alsDialog: Boolean,
) {
    val farbe = farbUebersetzer()
    // Die Auswahlliste gehoert dem BESITZER des Teils, nicht dem Betrachter —
    // dieselbe Regel wie beim Set. Ohne `kopf` (Dialog gerade erst geoeffnet)
    // bleibt die Liste leer, und der Server antwortet mit der eigenen; der
    // naechste Durchlauf holt die richtige nach.
    LaunchedEffect(zustand.offen, zustand.kopf?.ownerIds) {
        if (zustand.offen) aktionen.loadLagerortVorrat(zustand.kopf?.ownerIds ?: emptyList())
    }
    if (!zustand.offen) return

    // rememberSaveable, nicht remember: Der geöffnete Zoom ist eine Entscheidung des
    // Nutzers und muss eine Drehung überstehen — wie an den übrigen Zoom-Stellen.
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

    val titel: @Composable () -> Unit = {
            Column {
                Text(kopf?.name ?: zustand.nummer, fontWeight = FontWeight.SemiBold)
                Text(
                    zustand.nummer + (kopf?.colorName?.let { " · " + farbe(it) } ?: ""),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
    }
    val inhalt: @Composable () -> Unit = {
            Column(Modifier.fillMaxWidth()) {
                when {
                    zustand.laedt -> Box(Modifier.fillMaxWidth().padding(Abstaende.sehrGross), Alignment.Center) {
                        CircularProgressIndicator(Modifier.size(28.dp))
                    }
                    zustand.fehler != null -> Text(
                        zustand.fehler,
                        color = MaterialTheme.colorScheme.error,
                    )
                    else -> {
                        // Tippen vergrössert — dasselbe Bauteil wie im Set-Detail
                        // und im Dialog für manuell erfasste Teile.
                        ProduktBild(
                            model = bild,
                            imageLoader = imageLoader,
                            contentDescription = kopf?.name,
                            contentScale = ContentScale.Fit,
                            modifier = Modifier
                                .fillMaxWidth()
                                .height(140.dp)
                                .clip(MaterialTheme.shapes.medium)
                                .clickable(enabled = bild != null, role = Role.Button) { zeigeZoom = true },
                        )
                        Spacer(Modifier.height(Abstaende.mittel))
                        SetItemZeile(
                            stringResource(R.string.setitem_total_qty),
                            mengeAusSet(kopf?.totalQuantity ?: 0))
                        kopf?.colorName?.let {
                            SetItemZeile(stringResource(R.string.setitem_color), farbe(it))
                        }
                        kopf?.categoryName?.let {
                            SetItemZeile(stringResource(R.string.setitem_category),
                                kategorieUebersetzer()(it))
                        }
                        if (kopf?.isSpare == true) {
                            SetItemZeile(stringResource(R.string.parts_spare_tag), "✓")
                        }
                        // Nur für Teile (kopf.colorId ist bei Figuren null): Eine Minifigur
                        // steckt in ihrem Set, dessen Ort im Set-Detail steht — ein zweiter
                        // Ort könnte auseinanderlaufen. Bearbeitbar wie in der Webapp; das
                        // Feld schreibt auf alle Zeilen dieses Teil-Farb-Paares.
                        // Ausführlich: docs/begruendungen/feature-teile/ui/dialogs/SetItemDetailDialog.kt.md#kopffarbe
                        val kopfFarbe = kopf?.colorId
                        if (kopf != null && kopfFarbe != null) {
                            Row(Modifier.fillMaxWidth().padding(vertical = Abstaende.haar),
                                horizontalArrangement = Arrangement.SpaceBetween,
                                verticalAlignment = Alignment.CenterVertically) {
                                Text(stringResource(R.string.detail_storage),
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                    style = MaterialTheme.typography.bodyMedium)
                                LagerortFeld(
                                    wert = kopf.storage ?: "",
                                    vorrat = lagerZustand.vorrat.map { it.name },
                                    onWert = { aktionen.setzeTeilLagerort(kopf.nummer, kopfFarbe, it) },
                                    modifier = Modifier.padding(start = Abstaende.gross)
                                        .weight(1f).widthIn(max = 320.dp),
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
                                            aktionen.schliesseSetItem()
                                            onOpenSet(s.setNumber)
                                        },
                                    )
                                }
                            }
                        }
                    }
                }
            }
    }

    // Schliessen links wie in jedem Detailkopf (DetailTopAppBar), im Blatt wie neben der Liste.
    val schliessen = { aktionen.schliesseSetItem() }
    if (alsDialog) {
        ModalBottomSheet(onDismissRequest = schliessen) {
            Column(
                Modifier.padding(start = Abstaende.gross, end = Abstaende.sehrGross, bottom = Abstaende.sehrGross)
                    .verticalScroll(rememberScrollState()),
                verticalArrangement = Arrangement.spacedBy(Abstaende.mittel),
            ) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    ZurueckKnopf(schliessen, schliessen = true)
                    Box(Modifier.weight(1f)) {
                        ProvideTextStyle(MaterialTheme.typography.titleLarge) { titel() }
                    }
                }
                inhalt()
            }
        }
    } else {
        Column(Modifier.fillMaxSize()) {
            DetailTopAppBar(
                titel = kopf?.name ?: zustand.nummer,
                untertitel = zustand.nummer + (kopf?.colorName?.let { " · " + farbe(it) } ?: ""),
                onZurueck = schliessen,
                schliessen = true,
            )
            Column(
                Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(Abstaende.gross),
                verticalArrangement = Arrangement.spacedBy(Abstaende.mittel),
            ) { inhalt() }
        }
    }

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
