package ch.brickinventoryapp.sammlung.ui.screens

import ch.brickinventoryapp.model.fach.Merksortierung
import ch.brickinventoryapp.model.fach.Zustand
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.material3.SnackbarDuration
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.SnackbarResult
import androidx.compose.runtime.LaunchedEffect
import ch.brickinventoryapp.zustand.ui.LagerUiState
import ch.brickinventoryapp.sammlung.ui.MerkpostenDetailUiState
import ch.brickinventoryapp.sammlung.ui.MerklisteUiState
import ch.brickinventoryapp.zustand.ui.BlickfeldUiState
import ch.brickinventoryapp.sitzung.AppUiState
import ch.brickinventoryapp.sammlung.ui.viewmodel.MerklisteAktionen
import ch.brickinventoryapp.ui.components.nebenKnopfFarben
import ch.brickinventoryapp.ui.components.nebenKnopfRand
import ch.brickinventoryapp.model.ui.model.MerkpostenAnsicht
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.grid.items
import ch.brickinventoryapp.ui.components.Bewegt
import ch.brickinventoryapp.ui.components.HinweisText
import ch.brickinventoryapp.ui.components.KeinTrefferHinweis
import ch.brickinventoryapp.ui.components.Ladezustand
import ch.brickinventoryapp.ui.Ladeanzeige
import ch.brickinventoryapp.ui.ladeanzeige
import ch.brickinventoryapp.ui.satz
import androidx.compose.material.icons.filled.BookmarkBorder
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import ch.brickinventoryapp.ressourcen.R
import androidx.compose.ui.unit.dp
import ch.brickinventoryapp.sammlung.ui.viewmodel.MerklisteViewModel
import ch.brickinventoryapp.ui.theme.Abstaende
import ch.brickinventoryapp.model.data.ScopeFilter
import ch.brickinventoryapp.ui.components.BarcodeSymbol
import ch.brickinventoryapp.ui.components.ErfassenFab
import ch.brickinventoryapp.ui.components.FabPlatz
import ch.brickinventoryapp.ui.components.KnopfStapel
import ch.brickinventoryapp.ui.components.ListeUndDetail
import ch.brickinventoryapp.ui.components.ScanKnopf
import ch.brickinventoryapp.ui.components.SegmentWahl
import ch.brickinventoryapp.ui.components.SortierMenue
import ch.brickinventoryapp.ui.components.mitSchrift
import ch.brickinventoryapp.gemeinsam.ui.ScopeFilterZeile
import ch.brickinventoryapp.ui.components.Suchfeld

/**
 * Der Schlüssel einer Zeile: Nummer, Zustand und Konto. Dasselbe Set kann neu und
 * gebraucht und bei zwei Konten dastehen; mit der Nummer allein verlöre Compose
 * die Zuordnung.
 */
private fun merkpostenSchluessel(w: MerkpostenAnsicht) = "${w.setNumber}|${w.condition.kennung}|${w.userId}"

/** Was Merkliste und Merkposten-Detail zeigen; die Route sammelt es aus den Flüssen. */
internal data class MerklisteZustand(
    val appState: AppUiState,
    val blick: BlickfeldUiState,
    val liste: MerklisteUiState,
    val detail: MerkpostenDetailUiState,
    val lagerZustand: LagerUiState,
)

/** Merkliste und Detail am Navigationsziel: ein ViewModel für beide Hälften. */
@Composable
fun MerklisteRoute(
    vm: MerklisteViewModel,
    imageLoader: coil3.ImageLoader,
    onScan: () -> Unit,
    onOeffnenEinzeln: (String, Zustand) -> Unit,
    nebeneinander: Boolean = false,
) {
    val appState by vm.state.collectAsStateWithLifecycle()
    val blick by vm.blickfeld.collectAsStateWithLifecycle()
    val liste by vm.merklisteState.collectAsStateWithLifecycle()
    val detail by vm.merkpostenDetailState.collectAsStateWithLifecycle()
    val lagerZustand by vm.lagerState.collectAsStateWithLifecycle()
    val ansicht = MerklisteZustand(appState, blick, liste, detail, lagerZustand)
    MerklisteUndDetail(ansicht, vm, imageLoader, nebeneinander, onScan, onOeffnenEinzeln)
}

/**
 * „von der Merkliste genommen“ mit „Rückgängig“. Gelöscht wird erst, wenn die Snackbar
 * ohne Rückgängig endet — auch wenn sie verschwindet, weil man die Merkliste verlässt.
 */
@Composable
fun MerkpostenRueckgaengigRoute(vm: MerklisteViewModel, snackbarHostState: SnackbarHostState) {
    val vorgemerkt by vm.vorgemerkt.collectAsStateWithLifecycle()
    val text = vorgemerkt?.let { stringResource(R.string.wanted_deleted, it.name) }
    val rueckgaengig = stringResource(R.string.common_undo)
    LaunchedEffect(vorgemerkt) {
        val v = vorgemerkt ?: return@LaunchedEffect
        var zurueck = false
        try {
            zurueck = snackbarHostState.showSnackbar(text ?: v.name, rueckgaengig,
                duration = SnackbarDuration.Long) ==
                SnackbarResult.ActionPerformed
        } finally {
            if (zurueck) vm.merkpostenRueckgaengig(v) else vm.merkpostenLoeschenAusfuehren(v)
        }
    }
}

/** Das Merkposten-Detail als eigene Seite (Telefon). */
@Composable
internal fun MerkpostenDetailRoute(
    vm: MerklisteViewModel,
    setNumber: String,
    condition: Zustand,
    imageLoader: coil3.ImageLoader,
    onBack: () -> Unit,
) {
    val appState by vm.state.collectAsStateWithLifecycle()
    val blick by vm.blickfeld.collectAsStateWithLifecycle()
    val liste by vm.merklisteState.collectAsStateWithLifecycle()
    val detail by vm.merkpostenDetailState.collectAsStateWithLifecycle()
    val lagerZustand by vm.lagerState.collectAsStateWithLifecycle()
    val ansicht = MerklisteZustand(appState, blick, liste, detail, lagerZustand)
    MerkpostenDetailScreen(ansicht, vm, setNumber, condition, imageLoader, onBack)
}

/**
 * Die Merkliste — als Liste, weil sie gelesen und abgearbeitet wird: Nummer, Jahr,
 * Zustand und Preisalarm nebeneinander, wie in der Webapp. Die Regeln stehen am
 * Server (utils/merkliste.ts); der Bildschirm zeigt und ruft.
 */
@Composable
internal fun MerklisteScreen(
    ansicht: MerklisteZustand,
    aktionen: MerklisteAktionen,
    imageLoader: coil3.ImageLoader,
    onScan: () -> Unit,
    onOeffnen: (String, Zustand) -> Unit,
    /** Setnummer und Zustand des Merkpostens, dessen Detail daneben offen ist. */
    gewaehlt: Pair<String, Zustand>? = null,
) {
    val zustand = ansicht.liste
    // Die Bildadressen zeigen auf den eigenen Server (Proxy), nicht roh aufs
    // CDN — dieselbe Regel wie in Galerie, Teilen und Finanzen.
    val appState = ansicht.appState
    val blick = ansicht.blick

    // Übernommen wird über das Detail (MerkpostenDetailScreen), wo Anzahl, Kaufpreis
    // und Zustand zur Wahl stehen; die Zeile zeigt dafür den Marktpreis.
    var maskeOffen by rememberSaveable { mutableStateOf(false) }

    LaunchedEffect(Unit) { aktionen.ladeMerkliste() }

    // ── Der Filter ──
    //
    // Dieselben Bausteine in derselben Reihenfolge wie in der Galerie: Kontofilter,
    // Suchfeld, Chips. Kein Lagerortfilter — was man nicht hat, liegt nirgends; dafür
    // der Zustand, weil dasselbe Set neu und gebraucht dastehen kann.
    val scopeModus = blick.scopeModes[ScopeFilter.View.MERKLISTE]
        ?: ScopeFilter.ALL
    // Das Eingabefeld haelt seinen Text selbst (Tippen bleibt fluessig); die
    // Entprellung liegt im ViewModel. Wechselt der Wert von aussen, zieht das
    // Feld nach — dieselbe Zeile wie in der Galerie.
    var sucheInput by remember(zustand.query) { mutableStateOf(zustand.query) }

    // Zwei Leermeldungen: „Noch keine Merkposten“ sagt etwas über die Liste,
    // „nichts gefunden“ über den Filter; ein Ladefehler eine dritte.
    val gefiltert = zustand.query.isNotBlank() ||
        zustand.zustandFilter != null ||
        scopeModus != ScopeFilter.ALL
    val fehler = zustand.fehler?.satz()
    val anzeige = ladeanzeige(zustand.merkposten.isNotEmpty(), zustand.laedt, fehler, gefiltert)
    Box(Modifier.fillMaxSize()) {
        // Volle Breite wie jedes Raster (Lesebreite.kt): Mittig auf 840 dp stand der Preis
        // auf dem Tablet 1200 px vom Titel entfernt; im Raster bleibt er neben ihm.
        Column(Modifier.fillMaxSize()) {
            ScopeFilterZeile(
                members  = blick.householdMembers,
                current  = scopeModus,
                onSelect = { aktionen.setScope(ScopeFilter.View.MERKLISTE, it) },
            )

            // Scannen neben der Suche wie in der Galerie: unten schwebt nur EIN Knopf. Im
            // Fehlerzustand weder Suche noch Filter — es gibt nichts zu durchsuchen.
            // Ohne Merkposten weder Suche noch Filter: Die Leermeldung bietet Merken und
            // Scannen an, ein zweiter Scan-Knopf darüber wäre derselbe Weg noch einmal.
            val mitKopf = anzeige != Ladeanzeige.FEHLER && anzeige != Ladeanzeige.LEER
            if (mitKopf) Row(
                Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Suchfeld(
                    wert = sucheInput,
                    onWert = { sucheInput = it; aktionen.setzeMerklisteSuche(it) },
                    platzhalter = stringResource(R.string.wanted_search),
                    modifier = Modifier.weight(1f),
                )
                SortierMenue(
                    optionen = Merksortierung.entries.map { it to it.beschriftung() },
                    gewaehlt = zustand.sortierung,
                    onWahl = { aktionen.setzeMerklisteSortierung(it) },
                    modifier = Modifier.padding(end = Abstaende.winzig),
                    vorgabe = Merksortierung.VORGABE,
                )
                ScanKnopf({ onScan() }, Modifier.padding(end = 14.dp))
            }

            // Der Zustand ist eine Einfachwahl mit drei Antworten — „beide“ ist die
            // Vorgabe, weil ein Filter sie immer hat (Zustandszeile kennt nur zwei).
            if (mitKopf) SegmentWahl(
                optionen = listOf(null to stringResource(R.string.filter_condition_all),
                                  Zustand.NEU to stringResource(R.string.condition_new),
                                  Zustand.GEBRAUCHT to stringResource(R.string.condition_used)),
                gewaehlt = zustand.zustandFilter,
                onWahl = { aktionen.setzeMerklisteZustand(it) },
                modifier = Modifier.padding(horizontal = Abstaende.rand).padding(bottom = Abstaende.klein),
            )

            Column(Modifier.fillMaxSize().padding(horizontal = Abstaende.rand)) {
                Ladezustand(
                    anzeige = anzeige,
                    fehler = fehler,
                    onErneut = { aktionen.ladeMerkliste() },
                    // Wie die leere Galerie: sagen, wozu die Liste da ist, und beide Wege
                    // zum ersten Eintrag anbieten — dieselben wie die Knöpfe unten rechts.
                    leer = {
                        HinweisText(Icons.Default.BookmarkBorder, stringResource(R.string.wanted_empty),
                            stringResource(R.string.wanted_empty_hint))
                        KnopfStapel {
                            Button(onClick = { maskeOffen = true }, modifier = Modifier.fillMaxWidth()) {
                                Icon(Icons.Default.Add, null, Modifier.size(mitSchrift(18.dp)))
                                Spacer(Modifier.width(Abstaende.klein))
                                Text(stringResource(R.string.wanted_add_first))
                            }
                            OutlinedButton(onClick = { onScan() }, modifier = Modifier.fillMaxWidth(), colors = nebenKnopfFarben(), border = nebenKnopfRand()) {
                                Icon(BarcodeSymbol, null, Modifier.size(mitSchrift(18.dp)))
                                Spacer(Modifier.width(Abstaende.klein))
                                Text(stringResource(R.string.gallery_scan_barcode))
                            }
                        }
                    },
                    keineTreffer = { KeinTrefferHinweis(stringResource(R.string.wanted_no_results)) },
                    fehlerKlasse = zustand.fehlerKlasse,
                ) {
                    BoxWithConstraints {
                    val mehrspaltig = maxWidth >= MERKLISTE_SPALTE * 2
                    LazyVerticalGrid(
                        columns = GridCells.Adaptive(MERKLISTE_SPALTE),
                        modifier = Modifier.fillMaxSize(),
                        verticalArrangement = Arrangement.spacedBy(Abstaende.klein),
                        horizontalArrangement = Arrangement.spacedBy(Abstaende.klein),
                        // Platz für den Erfassen-Knopf: Ohne ihn verdeckt er die letzte Zeile.
                        contentPadding = PaddingValues(bottom = FabPlatz),
                    ) {
                        items(zustand.merkposten, key = ::merkpostenSchluessel) { w ->
                            Bewegt {
                                MerkpostenZeile(w, appState.serverUrl, imageLoader,
                                    gewaehlt = gewaehlt == w.setNumber to w.condition,
                                    onOeffnen = { onOeffnen(w.setNumber, w.condition) }, mehrspaltig = mehrspaltig)
                            }
                        }
                    }
                    }
                }
            }
        }

        // Ein Knopf wie in der Galerie; Scannen steht neben der Suche. Im Fehlerzustand
        // nicht, und leer auch nicht: Dort steht „Set merken“ schon mitten im Bild.
        if (anzeige != Ladeanzeige.FEHLER && anzeige != Ladeanzeige.LEER) ErfassenFab(
            stringResource(R.string.wanted_add_title), { maskeOffen = true },
            Modifier.align(Alignment.BottomEnd).padding(Abstaende.gross),
        )
    }

    if (maskeOffen) {
        MerkpostenErfassenDialog(
            householdMembers = blick.householdMembers,
            defaultCondition = appState.userDefaultCondition ?: Zustand.NEU,
            onDismiss = { maskeOffen = false },
            onAnlegen = { nummer, zustandWahl, besitzer ->
                aktionen.legeMerkpostenAn(nummer, zustandWahl, besitzer)
                maskeOffen = false
            },
        )
    }
}

/**
 * Die Merkliste mit dem Detail des geöffneten Merkpostens daneben, wenn
 * [nebeneinander] (breites Fenster, listeUndDetail()); sonst öffnet [onOeffnenEinzeln]
 * das Detail als eigene Seite. Ein Zustand für beide Hälften: dasselbe ViewModel.
 */
@Composable
internal fun MerklisteUndDetail(
    ansicht: MerklisteZustand,
    aktionen: MerklisteAktionen,
    imageLoader: coil3.ImageLoader,
    nebeneinander: Boolean,
    onScan: () -> Unit,
    onOeffnenEinzeln: (String, Zustand) -> Unit,
) {
    var offen by rememberSaveable { mutableStateOf<List<String>?>(null) }
    val auswahl = offen?.let { it[0] to (Zustand.aus(it[1]) ?: Zustand.NEU) }
    val liste: @Composable () -> Unit = {
        MerklisteScreen(ansicht = ansicht, aktionen = aktionen, imageLoader = imageLoader, onScan = onScan,
            onOeffnen = { sn, z -> if (nebeneinander) offen = listOf(sn, z.kennung) else onOeffnenEinzeln(sn, z) },
            gewaehlt = auswahl.takeIf { nebeneinander })
    }
    if (nebeneinander && auswahl != null) {
        ListeUndDetail(
            liste = liste,
            detail = {
                // key: Ein anderer Merkposten ist ein anderes Detail (Dialoge, Zoom zu).
                androidx.compose.runtime.key(auswahl) {
                    MerkpostenDetailScreen(ansicht = ansicht, aktionen = aktionen, setNumber = auswahl.first, condition = auswahl.second,
                        imageLoader = imageLoader, onBack = { offen = null })
                }
            },
        )
    } else liste()
}
