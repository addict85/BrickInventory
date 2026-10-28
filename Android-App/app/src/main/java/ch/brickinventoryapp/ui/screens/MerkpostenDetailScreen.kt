package ch.brickinventoryapp.ui.screens

import androidx.compose.foundation.clickable
import androidx.compose.ui.semantics.Role
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Delete
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
import androidx.core.net.toUri
import ch.brickinventoryapp.R
import ch.brickinventoryapp.data.model.Merkposten
import ch.brickinventoryapp.ui.viewmodel.MerklisteViewModel
import ch.brickinventoryapp.ui.components.ZoomableImageDialog
import ch.brickinventoryapp.ui.theme.Abstaende
import ch.brickinventoryapp.ui.theme.Formen
import ch.brickinventoryapp.util.resolveFullUrl

/**
 * Das Detail eines Merkpostens — dieselben Zeilen in derselben Reihenfolge wie das
 * Set-Detail, ohne was ein Merkposten nicht hat (Kaufpreis, Anzahl, Lagerort,
 * Anleitungen; „hinzugefügt“ heisst hier „auf der Liste seit“). Marktpreis und
 * Verlauf zeichnet dieselbe PriceChart(). Der Merkposten wird aus dem geladenen
 * Zustand gesucht statt kopiert, damit der Bildschirm merkt, wenn er gelöscht oder
 * übernommen wurde.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun MerkpostenDetailScreen(
    vm: MerklisteViewModel,
    setNumber: String,
    condition: String,
    imageLoader: coil3.ImageLoader,
    onBack: () -> Unit,
) {
    val appState by vm.state.collectAsStateWithLifecycle()
    val blick by vm.blickfeld.collectAsStateWithLifecycle()
    // Der VORRAT an Lagerorten fuer den Uebernahme-Dialog.
    val lagerZustand by vm.lagerState.collectAsStateWithLifecycle()
    val liste    by vm.merklisteState.collectAsStateWithLifecycle()
    val detail   by vm.merkpostenDetailState.collectAsStateWithLifecycle()
    val ctx = LocalContext.current
    // stringResource statt ctx.getString im Rückruf: Ein aus LocalContext gegriffener
    // Context liefert nach einem Konfigurationswechsel veraltete Werte (Lint
    // LocalContextGetResourceValueCall).
    val keineAppText = stringResource(R.string.common_no_app_to_open)
    // Derselbe Dialog wie in der Liste, nicht ein zweiter: Anzahl, Kaufpreis
    // und Zustand muessen hier dieselbe Maske sein.
    var uebernahmeOffen by rememberSaveable { mutableStateOf(false) }
    // Zoom wie in Set- und Katalog-Detail und in der Webapp. rememberSaveable: Wer im
    // Zoom das Telefon dreht, soll darin bleiben.
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
                // Der Papierkorb in der Kopfleiste wie in Set- und Teile-Detail — wer von dort
                // kommt, sucht ihn oben. Ohne Rückfrage wie in der Webapp: Ein Merkposten ist kein
                // Besitz und schnell wieder eingetragen. Beschriftung `common_delete` wie dort,
                // damit der Bildschirmleser alle gleich ansagt. `let`, weil der Merkposten hier
                // oben noch nullbar ist.
                actions = {
                    merkposten?.let { w ->
                        IconButton(onClick = {
                            vm.loescheMerkposten(w.setNumber, w.condition, w.userId)
                        }) {
                            Icon(Icons.Default.Delete, stringResource(R.string.common_delete))
                        }
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
                coil3.compose.AsyncImage(
                    model = bildUrl,
                    contentDescription = merkposten.name,
                    imageLoader = imageLoader,
                    // Antippen oeffnet den Zoom — dasselbe Verhalten wie im
                    // Set- und im Katalog-Detail.
                    modifier = Modifier.fillMaxWidth().height(Abstaende.riesig * 5)
                        .clickable(enabled = bildUrl != null, role = Role.Button) { zoomOffen = true },
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

                        // ── Der Inhaber, änderbar ──
                        //
                        // Derselbe Wähler wie in den Erfassungsmasken; bei einem Einzelkonto
                        // blendet er sich selbst aus.
                        if (blick.householdMembers.size > 1) {
                            Spacer(Modifier.height(Abstaende.klein))
                            OwnerPicker(
                                members = blick.householdMembers,
                                selected = merkposten.userId,
                                onSelect = { vm.verschiebeMerkposten(
                                    merkposten.setNumber, merkposten.condition, merkposten.userId, it) },
                            )
                        }
                    }
                }
            }

            // ── Der Preisalarm, editierbar ──
            //
            // Derselbe Abschnitt wie im Set-Detail: derselbe Eintrag in price_alerts am selben
            // Schlüssel, und /sets/:sn/alert verlangt keinen Besitz.
            setDetailAlarmSection(merkposten.setNumber, detail.preisalarme, appState.currency, vm::setzePreisalarm)

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
                    // BrickLink und Preisvergleich nebeneinander, darunter mit Abstand die
                    // Übernahme: oben die Wege nach draussen, unten die Griffe, die etwas
                    // verändern. Fällt eine Adresse weg, nimmt die andere die ganze Zeile.
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
                                                android.content.Intent.ACTION_VIEW, url.toUri()))
                                        } catch (_: Exception) {
                                            android.widget.Toast.makeText(
                                                ctx, keineAppText,
                                                android.widget.Toast.LENGTH_SHORT).show()
                                        }
                                    },
                                    modifier = Modifier.weight(1f),
                                    shape = Formen.leiste,
                                    contentPadding = PaddingValues(
                                        horizontal = Abstaende.klein, vertical = Abstaende.klein),
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
                }
            }
        }
    }

    // Ausserhalb des Scaffolds, damit die Dialoge ueber allem liegen — und mit
    // `let`, weil `merkposten` hier wieder nullbar ist: Wer waehrend des offenen
    // Dialogs den letzten Eintrag anderswo loescht, soll keinen Absturz
    // bekommen, sondern nichts.
    if (zoomOffen) merkposten?.let { w ->
        // Dieselbe Adresse wie das Bild oben, hier neu berechnet, weil `merkposten`
        // ausserhalb des Scaffold-Rumpfs wieder nullbar ist. Gezeichnet von
        // ui/components/ZoomableImageDialog.kt wie in Set- und Katalog-Detail.
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
            lagerorte = lagerZustand.eigene.map { it.name },
            lagerortVorgabe = lagerZustand.vorgabe?.name ?: "",
            onDismiss = { uebernahmeOffen = false },
            onUebernehmen = { anzahl, preisRoh, zustandWahl, ort ->
                vm.uebernimmMerkposten(w.setNumber, w.condition, w.userId,
                                   anzahl, preisRoh, zustandWahl, ort)
                uebernahmeOffen = false
            },
        )
    }
}
