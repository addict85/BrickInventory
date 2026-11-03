package ch.brickinventoryapp.ui.screens

import androidx.compose.ui.draw.clip
import ch.brickinventoryapp.ui.components.AuswahlChip
import ch.brickinventoryapp.ui.model.MerkpostenAnsicht
import ch.brickinventoryapp.ui.model.MitgliedAnsicht
import androidx.compose.foundation.clickable
import androidx.compose.ui.semantics.Role
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.selected
import ch.brickinventoryapp.ui.components.Bewegt
import ch.brickinventoryapp.ui.components.HinweisText
import ch.brickinventoryapp.ui.components.KeinTrefferHinweis
import ch.brickinventoryapp.ui.components.Ladezustand
import ch.brickinventoryapp.ui.Ladeanzeige
import ch.brickinventoryapp.ui.ladeanzeige
import androidx.compose.material.icons.filled.BookmarkBorder
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Sort
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Check
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import ch.brickinventoryapp.ressourcen.R
import androidx.compose.ui.unit.dp
import ch.brickinventoryapp.data.repository.MERKLISTE_DEFAULT_SORT
import ch.brickinventoryapp.ui.viewmodel.MerklisteViewModel
import ch.brickinventoryapp.ui.theme.Abstaende
import ch.brickinventoryapp.ui.theme.Formen
import ch.brickinventoryapp.ui.theme.LocalIsBrickTheme
import ch.brickinventoryapp.ui.theme.mittigBis
import ch.brickinventoryapp.util.NumericInput
import ch.brickinventoryapp.util.resolveThumbUrl
import androidx.compose.material.icons.filled.NotificationsActive
import androidx.compose.material.icons.filled.Alarm

/**
 * Die Merkliste — als Liste, weil sie gelesen und abgearbeitet wird: Nummer, Jahr,
 * Zustand und Preisalarm nebeneinander, wie in der Webapp. Die Regeln stehen am
 * Server (utils/merkliste.ts); der Bildschirm zeigt und ruft.
 */
/**
 * Der Schlüssel einer Zeile: Nummer, Zustand und Konto. Dasselbe Set kann neu und
 * gebraucht und bei zwei Konten dastehen; mit der Nummer allein verlöre Compose
 * die Zuordnung.
 */
private fun merkpostenSchluessel(w: MerkpostenAnsicht) = "${w.setNumber}|${w.condition}|${w.userId}"

@Composable
fun MerklisteScreen(
    vm: MerklisteViewModel,
    imageLoader: coil3.ImageLoader,
    onScan: () -> Unit,
    onOeffnen: (String, String) -> Unit,
    /** Setnummer und Zustand des Merkpostens, dessen Detail daneben offen ist. */
    gewaehlt: Pair<String, String>? = null,
) {
    val zustand by vm.merklisteState.collectAsStateWithLifecycle()
    // Die Bildadressen zeigen auf den eigenen Server (Proxy), nicht roh aufs
    // CDN — dieselbe Regel wie in Galerie, Teilen und Finanzen.
    val appState by vm.state.collectAsStateWithLifecycle()
    val blick by vm.blickfeld.collectAsStateWithLifecycle()

    // Übernommen wird über das Detail (MerkpostenDetailScreen), wo Anzahl, Kaufpreis
    // und Zustand zur Wahl stehen; die Zeile zeigt dafür den Marktpreis.
    var maskeOffen by rememberSaveable { mutableStateOf(false) }

    LaunchedEffect(Unit) { vm.ladeMerkliste() }

    // ── Der Filter ──
    //
    // Dieselben Bausteine in derselben Reihenfolge wie in der Galerie: Kontofilter,
    // Suchfeld, Chips. Kein Lagerortfilter — was man nicht hat, liegt nirgends; dafür
    // der Zustand, weil dasselbe Set neu und gebraucht dastehen kann.
    val scopeModus = blick.scopeModes[ch.brickinventoryapp.data.ScopeFilter.View.MERKLISTE.key]
        ?: ch.brickinventoryapp.data.ScopeFilter.ALL
    // Das Eingabefeld haelt seinen Text selbst (Tippen bleibt fluessig); die
    // Entprellung liegt im ViewModel. Wechselt der Wert von aussen, zieht das
    // Feld nach — dieselbe Zeile wie in der Galerie.
    var sucheInput by remember(zustand.query) { mutableStateOf(zustand.query) }

    // Zwei Leermeldungen: „Noch keine Merkposten“ sagt etwas über die Liste,
    // „nichts gefunden“ über den Filter; ein Ladefehler eine dritte.
    val gefiltert = zustand.query.isNotBlank() ||
        zustand.zustandFilter.isNotBlank() ||
        scopeModus != ch.brickinventoryapp.data.ScopeFilter.ALL
    val anzeige = ladeanzeige(zustand.merkposten.isNotEmpty(), zustand.laedt, zustand.fehler, gefiltert)
    Box(Modifier.fillMaxSize()) {
        // Volle Breite wie jedes Raster (Lesebreite.kt): Mittig auf 840 dp stand der Preis
        // auf dem Tablet 1200 px vom Titel entfernt; im Raster bleibt er neben ihm.
        Column(Modifier.fillMaxSize()) {

            ScopeFilterZeile(
                members  = blick.householdMembers,
                current  = scopeModus,
                onSelect = { vm.setScope(ch.brickinventoryapp.data.ScopeFilter.View.MERKLISTE, it) },
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
                    onWert = { sucheInput = it; vm.setzeMerklisteSuche(it) },
                    platzhalter = stringResource(R.string.wanted_search),
                    modifier = Modifier.weight(1f),
                )
                // Dieselben Werte wie MERK_SORTS am Server und dieselbe Auswahl wie in
                // der Webapp. qty_* fehlt in beiden: Ein Merkposten hat keine Anzahl.
                ch.brickinventoryapp.ui.components.SortierMenue(
                    optionen = listOf("added_desc", "added_asc", "name_asc", "num_asc",
                                      "year_desc", "price_desc", "price_asc").map { it to gallerySortLabel(it) },
                    gewaehlt = zustand.sortierung,
                    onWahl = { vm.setzeMerklisteSortierung(it) },
                    modifier = Modifier.padding(end = Abstaende.winzig),
                    vorgabe = MERKLISTE_DEFAULT_SORT,
                )
                ch.brickinventoryapp.ui.components.ScanKnopf({ onScan() }, Modifier.padding(end = 14.dp))
            }

            // Der Zustand ist eine Einfachwahl mit drei Antworten — „beide“ ist die
            // Vorgabe, weil ein Filter sie immer hat (Zustandszeile kennt nur zwei).
            if (mitKopf) ch.brickinventoryapp.ui.components.SegmentWahl(
                optionen = listOf("" to stringResource(R.string.filter_condition_all),
                                  "N" to stringResource(R.string.condition_new),
                                  "U" to stringResource(R.string.condition_used)),
                gewaehlt = zustand.zustandFilter,
                onWahl = { vm.setzeMerklisteZustand(it) },
                modifier = Modifier.padding(horizontal = Abstaende.rand).padding(bottom = Abstaende.klein),
            )

            Column(Modifier.fillMaxSize().padding(horizontal = Abstaende.rand)) {
                Ladezustand(
                    anzeige = anzeige,
                    fehler = zustand.fehler,
                    onErneut = { vm.ladeMerkliste() },
                    // Wie die leere Galerie: sagen, wozu die Liste da ist, und beide Wege
                    // zum ersten Eintrag anbieten — dieselben wie die Knöpfe unten rechts.
                    leer = {
                        HinweisText(Icons.Default.BookmarkBorder, stringResource(R.string.wanted_empty),
                            stringResource(R.string.wanted_empty_hint))
                        Button(onClick = { maskeOffen = true }) {
                            Icon(Icons.Default.Add, null, Modifier.size(ch.brickinventoryapp.ui.components.mitSchrift(18.dp)))
                            Spacer(Modifier.width(Abstaende.klein))
                            Text(stringResource(R.string.wanted_add_first))
                        }
                        OutlinedButton(onClick = { onScan() }) {
                            Icon(ch.brickinventoryapp.ui.components.BarcodeSymbol, null, Modifier.size(ch.brickinventoryapp.ui.components.mitSchrift(18.dp)))
                            Spacer(Modifier.width(Abstaende.klein))
                            Text(stringResource(R.string.gallery_scan_barcode))
                        }
                    },
                    keineTreffer = { KeinTrefferHinweis(stringResource(R.string.wanted_no_results)) },
                    fehlerKlasse = zustand.fehlerKlasse,
                ) {
                    androidx.compose.foundation.lazy.grid.LazyVerticalGrid(
                        columns = androidx.compose.foundation.lazy.grid.GridCells.Adaptive(340.dp),
                        modifier = Modifier.fillMaxSize(),
                        verticalArrangement = Arrangement.spacedBy(Abstaende.klein),
                        horizontalArrangement = Arrangement.spacedBy(Abstaende.klein),
                        // Platz für den Erfassen-Knopf: Ohne ihn verdeckt er die letzte Zeile.
                        contentPadding = PaddingValues(bottom = ch.brickinventoryapp.ui.components.FabPlatz),
                    ) {
                        items(zustand.merkposten, key = ::merkpostenSchluessel) { w ->
                            Bewegt {
                                MerkpostenZeile(w, appState.serverUrl, imageLoader,
                                    gewaehlt = gewaehlt == w.setNumber to w.condition,
                                    onOeffnen = { onOeffnen(w.setNumber, w.condition) })
                            }
                        }
                    }
                }
            }
        }

        // Ein Knopf wie in der Galerie; Scannen steht neben der Suche. Im Fehlerzustand
        // nicht, und leer auch nicht: Dort steht „Set merken“ schon mitten im Bild.
        if (anzeige != Ladeanzeige.FEHLER && anzeige != Ladeanzeige.LEER) ch.brickinventoryapp.ui.components.ErfassenFab(
            stringResource(R.string.wanted_add_title), { maskeOffen = true },
            Modifier.align(Alignment.BottomEnd).padding(Abstaende.gross),
        )
    }

    if (maskeOffen) {
        MerkpostenErfassenDialog(
            householdMembers = blick.householdMembers,
            defaultCondition = appState.userDefaultCondition ?: "N",
            onDismiss = { maskeOffen = false },
            onAnlegen = { nummer, zustandWahl, besitzer ->
                vm.legeMerkpostenAn(nummer, zustandWahl, besitzer)
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
fun MerklisteUndDetail(
    vm: MerklisteViewModel,
    imageLoader: coil3.ImageLoader,
    nebeneinander: Boolean,
    onScan: () -> Unit,
    onOeffnenEinzeln: (String, String) -> Unit,
) {
    var offen by rememberSaveable { mutableStateOf<List<String>?>(null) }
    val auswahl = offen?.let { it[0] to it[1] }
    val liste: @Composable () -> Unit = {
        MerklisteScreen(vm = vm, imageLoader = imageLoader, onScan = onScan,
            onOeffnen = { sn, z -> if (nebeneinander) offen = listOf(sn, z) else onOeffnenEinzeln(sn, z) },
            gewaehlt = auswahl.takeIf { nebeneinander })
    }
    if (nebeneinander && auswahl != null) {
        ch.brickinventoryapp.ui.components.ListeUndDetail(
            liste = liste,
            detail = {
                // key: Ein anderer Merkposten ist ein anderes Detail (Dialoge, Zoom zu).
                androidx.compose.runtime.key(auswahl) {
                    MerkpostenDetailScreen(vm = vm, setNumber = auswahl.first, condition = auswahl.second,
                        imageLoader = imageLoader, onBack = { offen = null })
                }
            },
        )
    } else liste()
}

/**
 * Anzahl, Kaufpreis und Zustand vor der Übernahme — für ein gerade gekauftes Set
 * ist keine Vorgabe zuverlässig richtig. Dieselben Felder in derselben Reihenfolge
 * wie im Katalog-Dialog. Der Zustand ist mit dem des Merkpostens vorbelegt;
 * welcher Merkposten erledigt ist, entscheidet der Server.
 */
@Composable
internal fun UebernahmeDialog(
    merkposten: MerkpostenAnsicht,
    /** Vorrat an Lagerorten — leer heisst: es gibt noch keine, dann wird getippt. */
    lagerorte: List<String> = emptyList(),
    /** Der vorausgewählte Lagerort (Stern in den Einstellungen). Leer heisst: keine Vorgabe. */
    lagerortVorgabe: String = "",
    onDismiss: () -> Unit,
    onUebernehmen: (Int, String, String, String?) -> Unit,
) {
    var anzahl   by rememberSaveable { mutableStateOf("1") }
    var preis    by rememberSaveable { mutableStateOf("") }
    var zustand  by rememberSaveable { mutableStateOf(merkposten.condition) }
    // Schluessel ist die Vorgabe — dieselbe Begruendung wie im Katalog-Dialog.
    var lagerort by rememberSaveable(lagerortVorgabe) { mutableStateOf(lagerortVorgabe) }

    ch.brickinventoryapp.ui.components.ErfassenDialog(
        titel = stringResource(R.string.wanted_take),
        bestaetigen = stringResource(R.string.wanted_take),
        onBestaetigen = { onUebernehmen(anzahl.toIntOrNull() ?: 1, preis, zustand,
                                        lagerort.trim().takeIf { it.isNotEmpty() }) },
        onAbbrechen = onDismiss,
    ) {
        Text(merkposten.name ?: merkposten.setNumber, style = MaterialTheme.typography.bodyMedium)
        Row(horizontalArrangement = Arrangement.spacedBy(Abstaende.klein)) {
            // NumericInput statt eigener Filterung: Die Regel, was eine Zahl ist (genau ein
            // Trennzeichen), steht einmal in util/NumericInput.kt.
            OutlinedTextField(
                value = anzahl,
                onValueChange = { anzahl = NumericInput.quantity(it) },
                label = { Text(stringResource(R.string.common_quantity)) },
                singleLine = true,
                keyboardOptions = NumericInput.ganzzahlTastatur(),
                modifier = Modifier.weight(1f),
            )
            OutlinedTextField(
                value = preis,
                onValueChange = { preis = NumericInput.price(it) },
                label = { Text(stringResource(R.string.gallery_purchase_price)) },
                singleLine = true,
                keyboardOptions = NumericInput.preisTastatur(),
                modifier = Modifier.weight(1f),
            )
        }
        // Mit Beschriftung „Zustand“: Zwei Chips ohne Überschrift sagten nicht, wonach sie fragen.
        Zustandszeile(zustand, { zustand = it })
        // Lagerort wie bei jeder anderen Erfassung.
        LagerortErfassung(lagerort, lagerorte, { lagerort = it })
    }
}

/**
 * Die Erfassungsmaske als Dialog, wie AddSetDialog in der Galerie — eine Karte
 * kostete auf jedem Bildschirm Platz. Nummer, Zustand, Konto; Anzahl und Kaufpreis
 * erst bei der Übernahme, ein Merkposten hat beides nicht. Der Cursor steht sofort
 * im Nummernfeld; die kurze Pause davor braucht es, weil das Feld beim ersten
 * Durchlauf noch nicht angeordnet ist.
 */
@Composable
private fun MerkpostenErfassenDialog(
    householdMembers: List<MitgliedAnsicht>,
    defaultCondition: String,
    onDismiss: () -> Unit,
    onAnlegen: (String, String, Int?) -> Unit,
) {
    var nummer  by rememberSaveable { mutableStateOf("") }
    var zustand by rememberSaveable { mutableStateOf(defaultCondition) }
    // Vorbelegt mit dem eigenen Konto — wer nichts waehlt, wuenscht fuer sich.
    var besitzer by remember(householdMembers) {
        mutableStateOf(householdMembers.firstOrNull { it.isSelf }?.id)
    }

    val nummerFokus = remember { FocusRequester() }
    LaunchedEffect(Unit) {
        kotlinx.coroutines.delay(120)
        try { nummerFokus.requestFocus() } catch (_: Exception) { /* Dialog schon zu */ }
    }

    ch.brickinventoryapp.ui.components.ErfassenDialog(
        titel = stringResource(R.string.wanted_add_title),
        bestaetigen = stringResource(R.string.wanted_add_submit),
        // Nur mitschicken, wenn es ueberhaupt eine Wahl gab — sonst schreibt der
        // Server auf das eigene Konto.
        onBestaetigen = { onAnlegen(nummer, zustand, if (householdMembers.size > 1) besitzer else null) },
        onAbbrechen = onDismiss,
        bestaetigenAn = nummer.isNotBlank(),
    ) {
        OutlinedTextField(
            value = nummer,
            onValueChange = { nummer = NumericInput.setNumber(it) },
            label = { Text(stringResource(R.string.gallery_set_number)) },
            // Als Hilfetext statt Platzhalter: Der Platzhalter verschwand mit dem
            // Fokus, und der Dialog fokussiert das Feld sofort.
            supportingText = { Text(stringResource(R.string.gallery_set_number_placeholder)) },
            singleLine = true,
            shape = Formen.feld,
            // Dieselbe Tastatur wie im AddSetDialog. Ein Zahlenfeld
            // ohne Tastaturwahl oeffnet die Buchstabentastatur — die
            // Regel dazu steht in NumericInputTest.
            keyboardOptions = NumericInput.ganzzahlTastatur(),
            modifier = Modifier.fillMaxWidth().focusRequester(nummerFokus),
        )
        // Mit Beschriftung „Zustand“: Zwei Chips ohne Überschrift sagten nicht, wonach sie fragen.
        Zustandszeile(zustand, { zustand = it })
        // Derselbe Waehler wie beim Erfassen eines Sets. Bei einem
        // Einzelkonto blendet er sich selbst aus (members.size < 2).
        OwnerPicker(householdMembers, besitzer, { besitzer = it })
    }
}



@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun MerkpostenZeile(
    w: MerkpostenAnsicht, serverUrl: String, imageLoader: coil3.ImageLoader,
    gewaehlt: Boolean,
    onOeffnen: () -> Unit,
) {
    // Die ganze Karte öffnet das Detail — wie die Kachel in der Galerie. Sie
    // trägt keinen Knopf, tut also auf ihrer ganzen Fläche dasselbe;
    // Übernehmen und Löschen stehen im Detail. Steht das Detail daneben, trägt
    // die geöffnete Karte einen Rahmen in der Hauptfarbe.
    Card(
        Modifier.fillMaxWidth()
            .semantics { selected = gewaehlt }
            .clickable(role = Role.Button, onClick = onOeffnen),
        border = if (gewaehlt) androidx.compose.foundation.BorderStroke(2.dp, MaterialTheme.colorScheme.primary) else null,
        // Dieselbe Karte wie Galerie und Finanzen (AppKarte): Die graue Fläche der
        // Vorgabe-Card war ein dritter Kartenstil für dieselbe Ebene.
        shape = ch.brickinventoryapp.ui.theme.Formen.karte,
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        elevation = CardDefaults.cardElevation(defaultElevation = ch.brickinventoryapp.ui.theme.Formen.karteErhebung),
    ) {
        Column(Modifier.padding(Abstaende.mittel), verticalArrangement = Arrangement.spacedBy(Abstaende.winzig)) {
            Row(horizontalArrangement = Arrangement.spacedBy(Abstaende.klein),
                verticalAlignment = Alignment.CenterVertically) {
                ch.brickinventoryapp.ui.components.ProduktBild(
                    model = resolveThumbUrl(serverUrl, w.imageLocal, w.imageUrl),
                    contentDescription = null,
                    imageLoader = imageLoader,
                    modifier = Modifier.size(Abstaende.riesig + Abstaende.sehrGross).clip(MaterialTheme.shapes.small),
                    ersatzGroesse = 28.dp,
                    bildgrund = true,
                )
                Column(Modifier.weight(1f)) {
                    // Kein Name heisst: Der Katalog kennt das Set nicht. Der
                    // benannte Preis dafuer, dass die Merkliste keine zweite
                    // Kopie der Stammdaten fuehrt (Migration 0021).
                    Text(w.name ?: w.setNumber, fontWeight = FontWeight.SemiBold, maxLines = 2)
                    Text(
                        listOfNotNull(
                            w.setNumber,
                            w.year?.toString(),
                            stringResource(if (w.condition == "U") R.string.condition_used
                                           else R.string.condition_new),
                        ).joinToString(" · "),
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
            // FlowRow: Bei grosser Schrift rückt der Preis unter die Plaketten, statt sie zu quetschen.
            // Mindesthöhe einer Plakette: Karten mit und ohne Plakette sind dann gleich hoch.
            FlowRow(Modifier.heightIn(min = 32.dp),
                    horizontalArrangement = Arrangement.spacedBy(Abstaende.klein),
                    verticalArrangement = Arrangement.spacedBy(Abstaende.winzig)) {
                w.alarm?.let { a ->
                    InfoPlakette(
                        stringResource(if (a.richtung == "ueber") R.string.wanted_alert_above else R.string.wanted_alert_below,
                                       ch.brickinventoryapp.util.fmtMoney(a.schwelle, w.waehrung)),
                        icon = if (a.ausgeloest) Icons.Default.NotificationsActive else Icons.Default.Alarm,
                    )
                }
                // „Habe ich das inzwischen?" meint das BLICKFELD: Beim
                // Grossvater heisst „ich habe es" auch „der Enkel hat es".
                if (w.owned) InfoPlakette(stringResource(R.string.wanted_owned), icon = Icons.Default.Check)
                Spacer(Modifier.weight(1f))
                // ── Marktpreis statt Knopf ──
                //
                // In die Galerie übernommen wird im Merkposten-Detail. Ohne Preis im Cache war der
                // Preisjob seit dem Eintragen noch nicht da — das sagt der Text, ein Strich sagte nichts.
                val preis = w.marktpreis
                if (preis != null) {
                    Text(ch.brickinventoryapp.util.fmtMoney(preis, w.waehrung), fontWeight = FontWeight.Bold,
                         maxLines = 1, softWrap = false, modifier = Modifier.align(Alignment.CenterVertically))
                } else {
                    Text(stringResource(R.string.wanted_price_pending), style = MaterialTheme.typography.bodySmall,
                         color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
        }
    }
}
