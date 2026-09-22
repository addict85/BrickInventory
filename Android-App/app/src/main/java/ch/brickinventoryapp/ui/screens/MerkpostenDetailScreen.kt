package ch.brickinventoryapp.ui.screens

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Add
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import ch.brickinventoryapp.R
import ch.brickinventoryapp.data.model.Merkposten
import ch.brickinventoryapp.ui.MainViewModel
import ch.brickinventoryapp.ui.components.ZoomableImageDialog
import ch.brickinventoryapp.ui.ladeMerkpostenDetail
import ch.brickinventoryapp.ui.loescheMerkposten
import ch.brickinventoryapp.ui.uebernimmMerkposten
import ch.brickinventoryapp.ui.verschiebeMerkposten
import ch.brickinventoryapp.ui.theme.Abstaende
import ch.brickinventoryapp.ui.theme.Formen
import ch.brickinventoryapp.util.resolveFullUrl

/**
 * Das Detail eines Merklisten-Eintrags.
 *
 * ── Marcos Vorgabe ──────────────────────────────────────────────────────────
 *
 * „Gleich wie der Detail Dialog der Sets aussehen. Ausser dem Kaufpreis."
 *
 * Dieselben Zeilen in derselben Reihenfolge wie im Set-Detail. Was fehlt,
 * fehlt aus einem Grund:
 *
 *     Kaufpreis      ausdruecklich ausgenommen
 *     Anzahl         ein Merkposten hat keine
 *     Lagerort       man kann nichts einlagern, was man nicht hat
 *     Hinzugefuegt   ersetzt durch „auf der Liste seit"
 *     Anleitungen    gehoeren zum Besitz; hier waere die Liste immer leer
 *
 * Was bleibt, bleibt ebenfalls aus einem Grund: Marktpreis und Preisverlauf
 * sind fuer einen MERKPOSTEN das Wichtigste ueberhaupt — man wartet ja auf einen
 * Preis. Gezeichnet werden sie von PriceChart(), derselben Funktion wie im
 * Set-Detail.
 *
 * ── Warum der Merkposten aus der LISTE kommt ────────────────────────────────────
 *
 * Nicht als Parameter durchgereicht und nicht kopiert: Er wird aus dem
 * geladenen Zustand gesucht. Nach dem Loeschen oder Uebernehmen verschwindet
 * er dort, und dieser Bildschirm merkt es — eine Kopie stuende weiter da und
 * zeigte etwas, das es nicht mehr gibt.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun MerkpostenDetailScreen(
    vm: MainViewModel,
    setNumber: String,
    condition: String,
    imageLoader: coil.ImageLoader,
    onBack: () -> Unit,
) {
    val appState by vm.state.collectAsStateWithLifecycle()
    val liste    by vm.merklisteState.collectAsStateWithLifecycle()
    val detail   by vm.merkpostenDetailState.collectAsStateWithLifecycle()
    // Der Alarm liegt im Set-Detail-Zustand — Begruendung an ladeMerkpostenDetail().
    val setDetail by vm.setDetailState.collectAsStateWithLifecycle()
    val ctx = LocalContext.current
    // Derselbe Dialog wie in der Liste, nicht ein zweiter: Anzahl, Kaufpreis
    // und Zustand muessen hier dieselbe Maske sein.
    var uebernahmeOffen by rememberSaveable { mutableStateOf(false) }
    // Marcos Befund: „Der Zoom in der Merkliste funktioniert nicht,
    // zumindest nicht in der Android-App." Er hat recht — das Bild war das
    // einzige Detailbild der App ohne Zoom. Set-Detail und Katalog-Detail
    // haben ihn seit jeher, die Webapp im Merkposten-Detail ebenfalls
    // (index.html: data-click="openImageLightboxFromEl" auf mk-m-img).
    //
    // rememberSaveable: Wer im Zoom das Telefon dreht, soll darin bleiben.
    var zoomOffen by rememberSaveable { mutableStateOf(false) }

    val merkposten = liste.merkposten.firstOrNull {
        it.setNumber == setNumber && it.condition == condition
    }

    LaunchedEffect(setNumber) { vm.ladeMerkpostenDetail(setNumber) }

    // Der Merkposten ist weg (geloescht oder uebernommen) — dann gehoert dieser
    // Bildschirm ebenfalls weg, statt eine Leiche zu zeigen.
    LaunchedEffect(merkposten == null, liste.laedt) {
        if (merkposten == null && !liste.laedt && liste.merkposten.isNotEmpty()) onBack()
    }

    fun preis(v: Double?) = if (v == null) "—"
        else ch.brickinventoryapp.util.fmtMoney(v, appState.currency)

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(merkposten?.name ?: setNumber, maxLines = 1) },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, stringResource(R.string.common_back))
                    }
                },
            )
        },
    ) { padding ->
        if (merkposten == null) {
            Box(Modifier.fillMaxSize().padding(padding), Alignment.Center) { CircularProgressIndicator() }
            return@Scaffold
        }
        // Die Adresse EINMAL bestimmen: Vorschaubild und Zoom zeigen sonst
        // womoeglich zwei verschiedene Bilder — und `resolveFullUrl` liefert
        // ohnehin schon die volle Aufloesung (kein Thumb).
        val bildUrl = resolveFullUrl(appState.serverUrl,
            detail.katalog?.imageLocal ?: merkposten.imageLocal, merkposten.imageUrl)

        LazyColumn(
            Modifier.fillMaxSize().padding(padding),
            contentPadding = PaddingValues(Abstaende.gross),
            verticalArrangement = Arrangement.spacedBy(Abstaende.mittel),
        ) {
            item {
                coil.compose.AsyncImage(
                    model = bildUrl,
                    contentDescription = merkposten.name,
                    imageLoader = imageLoader,
                    // Antippen oeffnet den Zoom — dasselbe Verhalten wie im
                    // Set- und im Katalog-Detail.
                    modifier = Modifier.fillMaxWidth().height(Abstaende.riesig * 5)
                        .clickable(enabled = bildUrl != null) { zoomOffen = true },
                )
            }

            item {
                Card(Modifier.fillMaxWidth()) {
                    Column(Modifier.padding(Abstaende.mittel)) {
                        CatalogDetailRow(stringResource(R.string.detail_set_number), merkposten.setNumber)
                        CatalogDetailRow(stringResource(R.string.detail_year),
                            merkposten.year?.toString() ?: "—")
                        CatalogDetailRow(stringResource(R.string.detail_theme),
                            detail.katalog?.themeName ?: "—")
                        CatalogDetailRow(stringResource(R.string.detail_pieces),
                            (detail.katalog?.numParts ?: merkposten.numParts)?.toString() ?: "—")
                        CatalogDetailRow(stringResource(R.string.detail_minifigs),
                            detail.katalog?.minifigs?.toString() ?: "—")
                        CatalogDetailRow(stringResource(R.string.common_condition),
                            stringResource(if (merkposten.condition == "U") R.string.condition_used
                                           else R.string.condition_new))
                        CatalogDetailRow(stringResource(R.string.wanted_since),
                            ch.brickinventoryapp.util.fmtDatum(merkposten.createdAt) ?: "—")

                        // ── Der Inhaber, AENDERBAR ──────────────────────────
                        //
                        // Marcos Befund: „Auf dem Detail-Dialog der
                        // Merkliste kann der Inhaber nicht geaendert werden.
                        // Auch in der Android-App nicht." Waehlbar war er nur
                        // beim Erfassen.
                        //
                        // Derselbe Waehler wie in den Erfassungsmasken; bei
                        // einem Einzelkonto blendet er sich selbst aus
                        // (OwnerPicker: `if (members.size < 2) return`).
                        if (appState.householdMembers.size > 1) {
                            Spacer(Modifier.height(Abstaende.klein))
                            OwnerPicker(
                                members = appState.householdMembers,
                                selected = merkposten.userId,
                                onSelect = { vm.verschiebeMerkposten(
                                    merkposten.setNumber, merkposten.condition, merkposten.userId, it) },
                            )
                        }
                    }
                }
            }

            // ── Der Preisalarm, EDITIERBAR ───────────────────────────────────
            //
            // Marcos Vorgabe. Derselbe Abschnitt wie im Set-Detail, nicht ein
            // zweiter: Es ist derselbe Eintrag in price_alerts, am selben
            // Schluessel (Konto, Set, Zustand). /sets/:sn/alert verlangt
            // keinen Besitz — nachgesehen im Routenrumpf —, also funktioniert
            // er hier unveraendert.
            setDetailAlarmSection(merkposten.setNumber, setDetail.preisalarme, appState.currency, vm)

            item {
                Card(Modifier.fillMaxWidth()) {
                    Column(Modifier.padding(Abstaende.mittel)) {
                        Text(stringResource(R.string.detail_section_market), fontWeight = FontWeight.Bold)
                        Spacer(Modifier.height(Abstaende.klein))
                        // Aus der PREIS-Antwort, nicht aus dem Verlauf: Die
                        // holt frisch, der Verlauf liest nur den Cache.
                        CatalogDetailRow(stringResource(R.string.condition_new),
                            preis(detail.preise?.current?.new?.avgPrice))
                        CatalogDetailRow(stringResource(R.string.condition_used),
                            preis(detail.preise?.current?.used?.avgPrice))

                        val chart = detail.historie?.chart
                        if (chart != null && chart.values.isNotEmpty()) {
                            Spacer(Modifier.height(Abstaende.klein))
                            PriceChart(chart)
                        } else if (detail.laedt) {
                            Spacer(Modifier.height(Abstaende.klein))
                            PreisLaedtZeile()
                        }
                    }
                }
            }

            item {
                Column(verticalArrangement = Arrangement.spacedBy(Abstaende.klein)) {
                    // Marcos Vorgabe: BrickLink und Preisvergleich NEBENEINANDER,
                    // und darunter mit ABSTAND die Uebernahme. Der groessere
                    // Abstand ist die ganze Aussage: Oben zwei Wege nach
                    // draussen, unten die Griffe, die hier etwas veraendern.
                    //
                    // `weight(1f)` teilt die Breite gleich auf. Faellt eine der
                    // beiden Adressen weg, nimmt die andere die ganze Zeile —
                    // ein halber leerer Streifen waere die schlechtere Antwort
                    // auf „dafuer gibt es keine Adresse".
                    val adressen = listOfNotNull(
                        detail.katalog?.bricklink?.url?.takeIf { it.isNotBlank() }
                            ?.let { R.string.catalog_buy_bricklink to it },
                        // Der Katalog liefert dieselbe Adresse, nur mit Namen
                        // darin („LEGO 75192 Millennium Falcon" statt nur der
                        // Nummer). Kommt er nicht — 404 fuer ein Set, das
                        // rb_sets nicht kennt —, steht die vom Merkposten bereit.
                        (detail.katalog?.preisvergleichUrl ?: merkposten.preisvergleichUrl)
                            ?.takeIf { it.isNotBlank() }
                            ?.let { R.string.detail_compare to it },
                    )
                    if (adressen.isNotEmpty()) {
                        Row(
                            Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.spacedBy(Abstaende.klein),
                        ) {
                            for ((beschriftung, url) in adressen) {
                                OutlinedButton(
                                    onClick = {
                                        try {
                                            ctx.startActivity(android.content.Intent(
                                                android.content.Intent.ACTION_VIEW, android.net.Uri.parse(url)))
                                        } catch (_: Exception) {
                                            android.widget.Toast.makeText(
                                                ctx, ctx.getString(R.string.common_no_app_to_open),
                                                android.widget.Toast.LENGTH_SHORT).show()
                                        }
                                    },
                                    modifier = Modifier.weight(1f),
                                    shape = Formen.leiste,
                                    contentPadding = PaddingValues(
                                        horizontal = Abstaende.klein, vertical = 8.dp),
                                ) {
                                    // Eine Stufe kleiner, aus demselben Grund wie im
                                    // Katalog-Detail: Zwei Knoepfe teilen sich die
                                    // Breite, die vorher einer allein hatte.
                                    Text(stringResource(beschriftung), maxLines = 1,
                                        overflow = TextOverflow.Ellipsis,
                                        style = MaterialTheme.typography.labelMedium)
                                }
                            }
                        }
                        Spacer(Modifier.height(Abstaende.klein))
                    }

                    Button(
                        onClick = { uebernahmeOffen = true },
                        modifier = Modifier.fillMaxWidth(),
                        shape = Formen.leiste,
                    ) {
                        Icon(Icons.Default.Add, null, Modifier.size(18.dp))
                        Spacer(Modifier.width(Abstaende.winzig))
                        Text(stringResource(R.string.wanted_take))
                    }

                    OutlinedButton(
                        onClick = { vm.loescheMerkposten(merkposten.setNumber, merkposten.condition, merkposten.userId) },
                        modifier = Modifier.fillMaxWidth(),
                        shape = Formen.leiste,
                    ) { Text(stringResource(R.string.common_delete)) }
                }
            }
        }
    }

    // Ausserhalb des Scaffolds, damit die Dialoge ueber allem liegen — und mit
    // `let`, weil `merkposten` hier wieder nullbar ist: Wer waehrend des offenen
    // Dialogs den letzten Eintrag anderswo loescht, soll keinen Absturz
    // bekommen, sondern nichts.
    if (zoomOffen) merkposten?.let { w ->
        // Dieselbe Adresse wie das Bild oben, nach denselben Regeln. Neu
        // berechnet und nicht `bildUrl` weitergereicht: Die steht im
        // Scaffold-Rumpf, wo `merkposten` nicht mehr nullbar ist — hier draussen
        // ist es das wieder (siehe der Absatz beim Uebernahme-Dialog).
        //
        // Gezeichnet wird er von derselben Stelle wie im Set- und im
        // Katalog-Detail: ui/components/ZoomableImageDialog.kt.
        val zoomUrl = resolveFullUrl(appState.serverUrl,
            detail.katalog?.imageLocal ?: w.imageLocal, w.imageUrl)
        if (zoomUrl != null) {
            ZoomableImageDialog(
                imageUrl = zoomUrl,
                contentDescription = w.name,
                imageLoader = imageLoader,
                onDismiss = { zoomOffen = false },
            )
        }
    }

    if (uebernahmeOffen) merkposten?.let { w ->
        UebernahmeDialog(
            merkposten = w,
            onDismiss = { uebernahmeOffen = false },
            onUebernehmen = { anzahl, preisRoh, zustandWahl ->
                vm.uebernimmMerkposten(w.setNumber, w.condition, w.userId,
                                   anzahl, preisRoh, zustandWahl)
                uebernahmeOffen = false
            },
        )
    }
}
