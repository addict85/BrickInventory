package ch.brickinventoryapp.ui.screens

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import ch.brickinventoryapp.R
import ch.brickinventoryapp.data.model.Wunsch
import ch.brickinventoryapp.ui.MainViewModel
import ch.brickinventoryapp.ui.ladeWunschDetail
import ch.brickinventoryapp.ui.loescheWunsch
import ch.brickinventoryapp.ui.uebernimmWunsch
import ch.brickinventoryapp.ui.theme.Abstaende
import ch.brickinventoryapp.ui.theme.Formen
import ch.brickinventoryapp.util.resolveFullUrl

/**
 * Das Detail eines Wunschlisten-Eintrags.
 *
 * ── Marcos Vorgabe ──────────────────────────────────────────────────────────
 *
 * „Gleich wie der Detail Dialog der Sets aussehen. Ausser dem Kaufpreis."
 *
 * Dieselben Zeilen in derselben Reihenfolge wie im Set-Detail. Was fehlt,
 * fehlt aus einem Grund:
 *
 *     Kaufpreis      ausdruecklich ausgenommen
 *     Anzahl         ein Wunsch hat keine
 *     Lagerort       man kann nichts einlagern, was man nicht hat
 *     Hinzugefuegt   ersetzt durch „auf der Liste seit"
 *     Anleitungen    gehoeren zum Besitz; hier waere die Liste immer leer
 *
 * Was bleibt, bleibt ebenfalls aus einem Grund: Marktpreis und Preisverlauf
 * sind fuer einen WUNSCH das Wichtigste ueberhaupt — man wartet ja auf einen
 * Preis. Gezeichnet werden sie von PriceChart(), derselben Funktion wie im
 * Set-Detail.
 *
 * ── Warum der Wunsch aus der LISTE kommt ────────────────────────────────────
 *
 * Nicht als Parameter durchgereicht und nicht kopiert: Er wird aus dem
 * geladenen Zustand gesucht. Nach dem Loeschen oder Uebernehmen verschwindet
 * er dort, und dieser Bildschirm merkt es — eine Kopie stuende weiter da und
 * zeigte etwas, das es nicht mehr gibt.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun WunschDetailScreen(
    vm: MainViewModel,
    setNumber: String,
    condition: String,
    imageLoader: coil.ImageLoader,
    onBack: () -> Unit,
) {
    val appState by vm.state.collectAsStateWithLifecycle()
    val liste    by vm.wunschState.collectAsStateWithLifecycle()
    val detail   by vm.wunschDetailState.collectAsStateWithLifecycle()
    // Der Alarm liegt im Set-Detail-Zustand — Begruendung an ladeWunschDetail().
    val setDetail by vm.setDetailState.collectAsStateWithLifecycle()
    val ctx = LocalContext.current
    // Derselbe Dialog wie in der Liste, nicht ein zweiter: Anzahl, Kaufpreis
    // und Zustand muessen hier dieselbe Maske sein.
    var uebernahmeOffen by rememberSaveable { mutableStateOf(false) }

    val wunsch = liste.wuensche.firstOrNull {
        it.setNumber == setNumber && it.condition == condition
    }

    LaunchedEffect(setNumber) { vm.ladeWunschDetail(setNumber) }

    // Der Wunsch ist weg (geloescht oder uebernommen) — dann gehoert dieser
    // Bildschirm ebenfalls weg, statt eine Leiche zu zeigen.
    LaunchedEffect(wunsch == null, liste.laedt) {
        if (wunsch == null && !liste.laedt && liste.wuensche.isNotEmpty()) onBack()
    }

    fun preis(v: Double?) = if (v == null) "—"
        else ch.brickinventoryapp.util.fmtMoney(v, appState.currency)

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(wunsch?.name ?: setNumber, maxLines = 1) },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, stringResource(R.string.common_back))
                    }
                },
            )
        },
    ) { padding ->
        if (wunsch == null) {
            Box(Modifier.fillMaxSize().padding(padding), Alignment.Center) { CircularProgressIndicator() }
            return@Scaffold
        }
        LazyColumn(
            Modifier.fillMaxSize().padding(padding),
            contentPadding = PaddingValues(Abstaende.gross),
            verticalArrangement = Arrangement.spacedBy(Abstaende.mittel),
        ) {
            item {
                coil.compose.AsyncImage(
                    model = resolveFullUrl(appState.serverUrl,
                        detail.katalog?.imageLocal ?: wunsch.imageLocal, wunsch.imageUrl),
                    contentDescription = null,
                    imageLoader = imageLoader,
                    modifier = Modifier.fillMaxWidth().height(Abstaende.riesig * 5),
                )
            }

            item {
                Card(Modifier.fillMaxWidth()) {
                    Column(Modifier.padding(Abstaende.mittel)) {
                        CatalogDetailRow(stringResource(R.string.detail_set_number), wunsch.setNumber)
                        CatalogDetailRow(stringResource(R.string.detail_year),
                            wunsch.year?.toString() ?: "—")
                        CatalogDetailRow(stringResource(R.string.detail_theme),
                            detail.katalog?.themeName ?: "—")
                        CatalogDetailRow(stringResource(R.string.detail_pieces),
                            (detail.katalog?.numParts ?: wunsch.numParts)?.toString() ?: "—")
                        CatalogDetailRow(stringResource(R.string.detail_minifigs),
                            detail.katalog?.minifigs?.toString() ?: "—")
                        CatalogDetailRow(stringResource(R.string.common_condition),
                            stringResource(if (wunsch.condition == "U") R.string.condition_used
                                           else R.string.condition_new))
                        CatalogDetailRow(stringResource(R.string.wishlist_since),
                            ch.brickinventoryapp.util.fmtDatum(wunsch.createdAt) ?: "—")
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
            setDetailAlarmSection(wunsch.setNumber, setDetail.preisalarme, appState.currency, vm)

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
                    // BrickLink zuerst, der Preisvergleich darunter (Marcos Vorgabe).
                    for ((beschriftung, url) in listOfNotNull(
                        detail.katalog?.bricklink?.url?.takeIf { it.isNotBlank() }
                            ?.let { R.string.catalog_buy_bricklink to it },
                        // Der Katalog liefert dieselbe Adresse, nur mit Namen
                        // darin („LEGO 75192 Millennium Falcon" statt nur der
                        // Nummer). Kommt er nicht — 404 fuer ein Set, das
                        // rb_sets nicht kennt —, steht die vom Wunsch bereit.
                        (detail.katalog?.preisvergleichUrl ?: wunsch.preisvergleichUrl)
                            ?.takeIf { it.isNotBlank() }
                            ?.let { R.string.detail_compare to it },
                    )) {
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
                            modifier = Modifier.fillMaxWidth(),
                            shape = Formen.leiste,
                        ) { Text(stringResource(beschriftung)) }
                    }

                    Button(
                        onClick = { uebernahmeOffen = true },
                        modifier = Modifier.fillMaxWidth(),
                        shape = Formen.leiste,
                    ) { Text(stringResource(R.string.wishlist_take)) }

                    OutlinedButton(
                        onClick = { vm.loescheWunsch(wunsch.setNumber, wunsch.condition, wunsch.userId) },
                        modifier = Modifier.fillMaxWidth(),
                        shape = Formen.leiste,
                    ) { Text(stringResource(R.string.common_delete)) }
                }
            }
        }
    }

    // Ausserhalb des Scaffolds, damit der Dialog ueber allem liegt — und mit
    // `let`, weil `wunsch` hier wieder nullbar ist: Wer waehrend des offenen
    // Dialogs den letzten Eintrag anderswo loescht, soll keinen Absturz
    // bekommen, sondern nichts.
    if (uebernahmeOffen) wunsch?.let { w ->
        UebernahmeDialog(
            wunsch = w,
            onDismiss = { uebernahmeOffen = false },
            onUebernehmen = { anzahl, preisRoh, zustandWahl ->
                vm.uebernimmWunsch(w.setNumber, w.condition, w.userId,
                                   anzahl, preisRoh, zustandWahl)
                uebernahmeOffen = false
            },
        )
    }
}
