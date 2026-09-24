package ch.brickinventoryapp.ui.screens

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Sort
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.QrCodeScanner
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
import ch.brickinventoryapp.R
import androidx.compose.ui.unit.dp
import ch.brickinventoryapp.data.model.Merkposten
import ch.brickinventoryapp.data.repository.MERKLISTE_DEFAULT_SORT
import ch.brickinventoryapp.ui.MainViewModel
import ch.brickinventoryapp.ui.setScope
import ch.brickinventoryapp.ui.setzeMerklisteSortierung
import ch.brickinventoryapp.ui.setzeMerklisteSuche
import ch.brickinventoryapp.ui.setzeMerklisteZustand
import ch.brickinventoryapp.ui.ladeMerkliste
import ch.brickinventoryapp.ui.legeMerkpostenAn
import ch.brickinventoryapp.ui.setScannerSource
import ch.brickinventoryapp.ui.uebernimmMerkposten
import ch.brickinventoryapp.ui.theme.Abstaende
import ch.brickinventoryapp.ui.theme.Formen
import ch.brickinventoryapp.ui.theme.Schrift
import ch.brickinventoryapp.ui.theme.LocalIsBrickTheme
import ch.brickinventoryapp.util.NumericInput
import ch.brickinventoryapp.util.resolveThumbUrl

/**
 * Die Merkliste.
 *
 * ── Warum eine Liste und keine Kachelwand ───────────────────────────────────
 *
 * Die Galerie zeigt Kacheln, weil man seine Sammlung ansieht. Eine
 * Merkliste wird GELESEN und abgearbeitet — Nummer, Jahr und Zustand
 * nebeneinander, dazu der Preisalarm. Dieselbe Entscheidung wie in der
 * Webapp; die beiden Oberflaechen sollen sich gleich anfuehlen.
 *
 * ── Was hier NICHT entschieden wird ─────────────────────────────────────────
 *
 * Alle Regeln stehen am Server (utils/merkliste.ts). Dieser Bildschirm
 * zeigt und ruft.
 */
/**
 * Der Schluessel einer Zeile: Nummer, Zustand UND Konto.
 *
 * Dasselbe Set kann zweimal dastehen (neu und gebraucht), und im Kontenbaum
 * auch bei zwei Konten. Nur die Nummer waere mehrdeutig — Compose verloere
 * beim Neuzeichnen die Zuordnung, und der Uebernahme-Dialog stuende nach
 * einer Drehung ueber der falschen Zeile.
 */
private fun merkpostenSchluessel(w: Merkposten) = "${w.setNumber}|${w.condition}|${w.userId}"

@Composable
fun MerklisteScreen(
    vm: MainViewModel,
    imageLoader: coil.ImageLoader,
    onScan: () -> Unit,
    onOeffnen: (String, String) -> Unit,
) {
    val zustand by vm.merklisteState.collectAsStateWithLifecycle()
    // Die Bildadressen zeigen auf den eigenen Server (Proxy), nicht roh aufs
    // CDN — dieselbe Regel wie in Galerie, Teilen und Finanzen.
    val appState by vm.state.collectAsStateWithLifecycle()

    // Hier stand der Uebernahme-Dialog samt seinem Zustand. Beides ist mit dem
    // Knopf aus der Zeile entfallen (Marcos Vorgabe vom 24.09.: „den Button In
    // die Galerie aufnehme entfernen und dafuer den Marktpreis anzeigen") —
    // ohne den Knopf ginge er nie mehr auf. Die Uebernahme fuehrt jetzt ueber
    // das Detail, wo derselbe Dialog steht (MerkpostenDetailScreen) und wo
    // ohnehin Anzahl, Kaufpreis und Zustand zur Wahl stehen.
    var maskeOffen by rememberSaveable { mutableStateOf(false) }

    LaunchedEffect(Unit) { vm.ladeMerkliste() }

    // ── Der Filter (Marcos Vorgabe vom 24.09.) ──────────────────────────────
    //
    //   „In der Merkliste noch einen Filter analog den Sets einbauen inkl.
    //    Inhaber."
    //
    // Dieselben Bausteine in derselben Reihenfolge wie im Galerie-Bildschirm:
    // Kontofilter, Suchfeld, dann eine Zeile Chips. Wer das eine kennt, kennt
    // das andere — darum geht es bei „einheitlichen Ansichten".
    //
    // Kein Lagerortfilter: Ein Merkposten ist ein Set, das man NICHT hat, und
    // was man nicht hat, liegt nirgends. Dafuer der Zustand, den es bei den
    // Sets als Filter nicht gibt: Hier steht dasselbe Set zweimal, neu und
    // gebraucht, und genau das ist die Frage, die man an eine Merkliste stellt.
    val scopeModus = appState.scopeModes[ch.brickinventoryapp.data.ScopeFilter.View.MERKLISTE.key]
        ?: ch.brickinventoryapp.data.ScopeFilter.ALL
    // Das Eingabefeld haelt seinen Text selbst (Tippen bleibt fluessig); die
    // Entprellung liegt im ViewModel. Wechselt der Wert von aussen, zieht das
    // Feld nach — dieselbe Zeile wie in der Galerie.
    var sucheInput by remember(zustand.query) { mutableStateOf(zustand.query) }
    var sortMenueOffen by rememberSaveable { mutableStateOf(false) }

    Box(Modifier.fillMaxSize()) {
        Column(Modifier.fillMaxSize()) {

            ScopeFilterZeile(
                members  = appState.householdMembers,
                current  = scopeModus,
                onSelect = { vm.setScope(ch.brickinventoryapp.data.ScopeFilter.View.MERKLISTE, it) },
            )

            Suchfeld(
                wert = sucheInput,
                onWert = { sucheInput = it; vm.setzeMerklisteSuche(it) },
                platzhalter = stringResource(R.string.wanted_search),
            )

            LazyRow(
                contentPadding = PaddingValues(horizontal = Abstaende.rand),
                horizontalArrangement = Arrangement.spacedBy(Abstaende.winzig),
                modifier = Modifier.padding(bottom = Abstaende.klein),
            ) {
                item {
                    Box {
                        FilterChip(
                            selected = zustand.sortierung != MERKLISTE_DEFAULT_SORT,
                            onClick = { sortMenueOffen = true },
                            label = { Text(gallerySortLabel(zustand.sortierung), fontSize = Schrift.klein) },
                            leadingIcon = { Icon(Icons.AutoMirrored.Filled.Sort, null, Modifier.size(16.dp)) },
                            shape = Formen.chip,
                        )
                        DropdownMenu(sortMenueOffen, { sortMenueOffen = false }) {
                            // Dieselben Werte wie MERK_SORTS am Server und
                            // dieselbe Auswahl wie in der Webapp. qty_* fehlt
                            // in beiden: Ein Merkposten hat keine Anzahl.
                            listOf("added_desc", "added_asc", "name_asc", "num_asc",
                                   "year_desc", "price_desc", "price_asc").forEach { w ->
                                DropdownMenuItem(
                                    text = { Text(gallerySortLabel(w)) },
                                    onClick = { sortMenueOffen = false; vm.setzeMerklisteSortierung(w) },
                                    trailingIcon = { if (zustand.sortierung == w) Icon(Icons.Default.Check, null, Modifier.size(16.dp)) },
                                )
                            }
                        }
                    }
                }
                // Drei Chips statt ZustandsWahl(): Dort gibt es nur „neu" und
                // „gebraucht", weil ein ERFASSTER Merkposten sich entscheiden
                // muss. Ein Filter hat immer eine dritte Antwort — „beide" —,
                // und die ist hier die Vorgabe.
                items(listOf("" to R.string.filter_condition_all,
                             "N" to R.string.condition_new,
                             "U" to R.string.condition_used)) { (wert, text) ->
                    FilterChip(
                        selected = zustand.zustandFilter == wert,
                        onClick = { vm.setzeMerklisteZustand(wert) },
                        label = { Text(stringResource(text), fontSize = Schrift.klein) },
                        shape = Formen.chip,
                    )
                }
            }

            Column(Modifier.fillMaxSize().padding(horizontal = Abstaende.mittel)) {
                when {
                    zustand.laedt && zustand.merkposten.isEmpty() ->
                        Box(Modifier.fillMaxWidth().padding(Abstaende.riesig), Alignment.Center) { CircularProgressIndicator() }

                    zustand.merkposten.isEmpty() ->
                        Box(Modifier.fillMaxWidth().padding(Abstaende.riesig), Alignment.Center) {
                            // Zwei verschiedene Leermeldungen: „Noch keine
                            // Merkposten" ist eine Aussage ueber die Liste,
                            // „nichts gefunden" eine ueber den Filter. Stuende
                            // hier immer die erste, saehe eine Suche ohne Treffer
                            // wie eine geleerte Merkliste aus — dieselbe
                            // Verwechslung, wegen der der Kontofilter beim
                            // Anmelden zurueckgesetzt wird (ScopeFilter.kt).
                            val gefiltert = zustand.query.isNotBlank() ||
                                zustand.zustandFilter.isNotBlank() ||
                                scopeModus != ch.brickinventoryapp.data.ScopeFilter.ALL
                            Text(stringResource(if (gefiltert) R.string.wanted_no_results else R.string.wanted_empty),
                                 color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }

                    else -> LazyColumn(
                        verticalArrangement = Arrangement.spacedBy(Abstaende.klein),
                        // Platz fuer die Knoepfe: Ohne ihn verdeckt der grosse die
                        // letzte Zeile — dieselbe Vorsorge wie in der Galerie.
                        contentPadding = PaddingValues(bottom = Abstaende.riesig + Abstaende.riesig),
                    ) {
                        items(zustand.merkposten, key = ::merkpostenSchluessel) { w ->
                            MerkpostenZeile(w, appState.serverUrl, imageLoader,
                                onOeffnen = { onOeffnen(w.setNumber, w.condition) })
                        }
                    }
                }
            }
        }

        // ── Zwei Knoepfe, genau wie in der Galerie ───────────────────────────
        //
        // Marcos Vorgabe: „2 Buttons in der Liste, die die Erfassungsmaske
        // entweder mit Barcode oder Setnummern oeffnet."
        //
        // Dieselbe Anordnung, dieselben Symbole, dieselbe Groessenstaffelung
        // wie in GalleryScreen — der kleine scannt, der grosse oeffnet die
        // Maske. Wer das eine kennt, kennt das andere; genau darum geht es bei
        // „gleich wie bei den Sets".
        Column(
            modifier = Modifier.align(Alignment.BottomEnd)
                .padding(end = Abstaende.gross, bottom = Abstaende.gross),
            horizontalAlignment = Alignment.End,
            verticalArrangement = Arrangement.spacedBy(Abstaende.klein),
        ) {
            SmallFloatingActionButton(
                onClick = { vm.setScannerSource("wanted"); onScan() },
                containerColor = MaterialTheme.colorScheme.secondaryContainer,
                contentColor = MaterialTheme.colorScheme.onSecondaryContainer,
                shape = Formen.leiste,
            ) { Icon(Icons.Default.QrCodeScanner, stringResource(R.string.gallery_scan_barcode)) }
            FloatingActionButton(
                onClick = { maskeOffen = true },
                containerColor = if (LocalIsBrickTheme.current) MaterialTheme.colorScheme.secondary else MaterialTheme.colorScheme.primary,
                contentColor = if (LocalIsBrickTheme.current) MaterialTheme.colorScheme.onSecondary else MaterialTheme.colorScheme.onPrimary,
                shape = Formen.fab,
            ) { Icon(Icons.Default.Add, stringResource(R.string.wanted_add_title)) }
        }
    }

    if (maskeOffen) {
        MerkpostenErfassenDialog(
            householdMembers = appState.householdMembers,
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
 * Anzahl, Kaufpreis und Zustand vor der Uebernahme.
 *
 * ── Marcos Nachtrag ─────────────────────────────────────────────────────────
 *
 * „gewisse Inhalte wie zB. Preis und Zustand, Anzahl muessen beim Uebernehmen
 * angepasst werden." Vorher ging die Uebernahme wortlos mit Anzahl 1, ohne
 * Kaufpreis und im Zustand des Merkpostens durch — fuer ein Set, das man gerade
 * gekauft hat, ist keins davon zuverlaessig richtig.
 *
 * Dieselben drei Felder in derselben Reihenfolge wie im Katalog-Dialog
 * (CatalogAddDialog): Wer das eine kennt, kennt das andere.
 *
 * Der Zustand ist mit dem des MERKPOSTENS vorbelegt — der haeufigste Fall —,
 * laesst sich aber aendern. Welcher Merkposten dadurch erledigt ist, bleibt davon
 * unberuehrt; das entscheidet der Server.
 */
@Composable
internal fun UebernahmeDialog(
    merkposten: Merkposten,
    /** Vorrat an Lagerorten — leer heisst: es gibt noch keine, dann wird getippt. */
    lagerorte: List<String> = emptyList(),
    onDismiss: () -> Unit,
    onUebernehmen: (Int, String, String, String?) -> Unit,
) {
    var anzahl   by rememberSaveable { mutableStateOf("1") }
    var preis    by rememberSaveable { mutableStateOf("") }
    var zustand  by rememberSaveable { mutableStateOf(merkposten.condition) }
    var lagerort by rememberSaveable { mutableStateOf("") }

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(stringResource(R.string.wanted_take), fontWeight = FontWeight.Bold) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(Abstaende.mittel)) {
                Text(merkposten.name ?: merkposten.setNumber, style = MaterialTheme.typography.bodyMedium)
                Row(horizontalArrangement = Arrangement.spacedBy(Abstaende.klein)) {
                    // NumericInput und keine eigene Filterung: Die Regel, was
                    // eine Zahl ist, steht genau einmal im Baum
                    // (util/NumericInput.kt). Die Preis-Fassung laesst GENAU
                    // ein Trennzeichen zu — das haette eine hier
                    // hingeschriebene Filterung nicht gewusst.
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
                ZustandsWahl(zustand) { zustand = it }
                // Marcos Befund vom 24.09.: „Wenn ich etwas aus der Merkliste in
                // die Galerie aufnehme, kann ich den Lagerort nicht setzen."
                LagerortErfassung(lagerort, lagerorte, { lagerort = it })
            }
        },
        confirmButton = {
            Button(onClick = { onUebernehmen(anzahl.toIntOrNull() ?: 1, preis, zustand,
                                             lagerort.trim().takeIf { it.isNotEmpty() }) }) {
                Text(stringResource(R.string.wanted_take))
            }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text(stringResource(R.string.common_cancel)) } },
    )
}

/**
 * Die Erfassungsmaske — dieselbe Rolle wie AddSetDialog in der Galerie.
 *
 * ── Warum ein Dialog und keine Karte mehr ───────────────────────────────────
 *
 * Marcos Vorgabe: „gleich wie bei den Sets". Dort steht kein Formular
 * dauerhaft ueber der Liste; es oeffnet sich auf Knopfdruck und ist danach
 * wieder weg. Die Karte kostete auf jedem Bildschirm Platz, auch wenn gerade
 * niemand etwas erfassen wollte.
 *
 * ── Was drin steht und was nicht ────────────────────────────────────────────
 *
 * Nummer, Zustand, Konto — Anzahl und Kaufpreis fehlen bewusst: Ein
 * Merkposten hat weder das eine noch das andere. Beides wird erst bei der
 * Uebernahme in die Galerie gefragt.
 *
 * Der Cursor steht sofort im Nummernfeld, wie im AddSetDialog seit Nachtrag
 * 113 — und aus demselben Grund die kurze Pause davor: Beim ersten Durchlauf
 * ist das Feld noch nicht angeordnet, ein requestFocus() liefe ins Leere.
 */
@Composable
private fun MerkpostenErfassenDialog(
    householdMembers: List<ch.brickinventoryapp.data.model.HouseholdMember>,
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

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(stringResource(R.string.wanted_add_title), fontWeight = FontWeight.Bold) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(Abstaende.mittel)) {
                OutlinedTextField(
                    value = nummer,
                    onValueChange = { nummer = NumericInput.setNumber(it) },
                    label = { Text(stringResource(R.string.gallery_set_number)) },
                    placeholder = { Text(stringResource(R.string.gallery_set_number_placeholder)) },
                    singleLine = true,
                    shape = Formen.knopf,
                    // Dieselbe Tastatur wie im AddSetDialog. Ein Zahlenfeld
                    // ohne Tastaturwahl oeffnet die Buchstabentastatur — die
                    // Regel dazu steht in NumericInputTest.
                    keyboardOptions = NumericInput.ganzzahlTastatur(),
                    modifier = Modifier.fillMaxWidth().focusRequester(nummerFokus),
                )
                ZustandsWahl(zustand) { zustand = it }
                // Derselbe Waehler wie beim Erfassen eines Sets. Bei einem
                // Einzelkonto blendet er sich selbst aus (members.size < 2).
                OwnerPicker(householdMembers, besitzer, { besitzer = it })
            }
        },
        confirmButton = {
            Button(
                onClick = {
                    // Nur mitschicken, wenn es ueberhaupt eine Wahl gab —
                    // sonst schreibt der Server auf das eigene Konto.
                    onAnlegen(nummer, zustand,
                              if (householdMembers.size > 1) besitzer else null)
                },
                enabled = nummer.isNotBlank(),
            ) { Text(stringResource(R.string.wanted_add_submit)) }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text(stringResource(R.string.common_cancel)) } },
    )
}

/** Neu oder gebraucht — zwei Knoepfe statt einer Auswahlliste, wie im Baum ueblich. */
@Composable
internal fun ZustandsWahl(gewaehlt: String, onWahl: (String) -> Unit) {
    Row(horizontalArrangement = Arrangement.spacedBy(Abstaende.klein)) {
        FilterChip(selected = gewaehlt == "N", onClick = { onWahl("N") },
                   label = { Text(stringResource(R.string.condition_new)) })
        FilterChip(selected = gewaehlt == "U", onClick = { onWahl("U") },
                   label = { Text(stringResource(R.string.condition_used)) })
    }
}

@Composable
private fun MerkpostenZeile(
    w: Merkposten, serverUrl: String, imageLoader: coil.ImageLoader,
    onOeffnen: () -> Unit,
) {
    // Die ganze Karte oeffnet das Detail — wie die Kachel in der Galerie.
    // Seit dem 24.09. traegt sie GAR KEINEN Knopf mehr (Marcos Vorgabe: der
    // Uebernahme- und der Loeschknopf sind beide entfallen), tut also auf
    // ihrer ganzen Flaeche dasselbe.
    Card(Modifier.fillMaxWidth().clickable(onClick = onOeffnen)) {
        Column(Modifier.padding(Abstaende.mittel), verticalArrangement = Arrangement.spacedBy(Abstaende.winzig)) {
            Row(horizontalArrangement = Arrangement.spacedBy(Abstaende.klein),
                verticalAlignment = Alignment.CenterVertically) {
                coil.compose.AsyncImage(
                    model = resolveThumbUrl(serverUrl, w.imageLocal, w.imageUrl),
                    contentDescription = null,
                    imageLoader = imageLoader,
                    modifier = Modifier.size(Abstaende.riesig + Abstaende.sehrGross),
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
            Row(horizontalArrangement = Arrangement.spacedBy(Abstaende.klein),
                verticalAlignment = Alignment.CenterVertically) {
                w.alarm?.let { a ->
                    AssistChip(onClick = {}, label = {
                        Text("${if (a.ausgeloest) "🔔" else "⏰"} " +
                             stringResource(if (a.richtung == "ueber") R.string.detail_alert_above
                                            else R.string.detail_alert_below) +
                             " ${a.schwelle}")
                    })
                }
                // „Habe ich das inzwischen?" meint das BLICKFELD: Beim
                // Grossvater heisst „ich habe es" auch „der Enkel hat es".
                if (w.owned) {
                    AssistChip(onClick = {},
                        label = { Text(stringResource(R.string.wanted_owned)) })
                }
                Spacer(Modifier.weight(1f))
                // ── Marktpreis statt Knopf ────────────────────────────────
                //
                // Marcos Vorgabe vom 24.09.: „Bitte in der Tabelle der
                // Merkliste der Button In die Galerie aufnehme entfernen und
                // dafuer den Marktpreis anzeigen."
                //
                // Der Knopf verschwindet nur aus der ZEILE, nicht aus der App:
                // Das Merkposten-Detail hat ihn weiterhin, und dort steht
                // ohnehin der Dialog mit Anzahl, Kaufpreis und Zustand.
                //
                // Ein Strich, solange kein Preis im Cache liegt — das ist kein
                // Fehler, sondern „der Preisjob war seit dem Eintragen noch
                // nicht da".
                Text(
                    w.marktpreis?.let { ch.brickinventoryapp.util.fmtMoney(it, w.waehrung) } ?: "—",
                    fontWeight = FontWeight.Bold,
                    color = if (w.marktpreis == null) MaterialTheme.colorScheme.onSurfaceVariant
                            else MaterialTheme.colorScheme.onSurface,
                )
            }
        }
    }
}
