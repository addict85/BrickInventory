package ch.brickinventoryapp.ui.screens

import ch.brickinventoryapp.ui.model.MerkpostenAnsicht
import ch.brickinventoryapp.ui.model.MitgliedAnsicht
import androidx.compose.foundation.clickable
import androidx.compose.ui.semantics.Role
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import ch.brickinventoryapp.ui.components.Bewegt
import ch.brickinventoryapp.ui.components.HinweisText
import ch.brickinventoryapp.ui.components.KeinTrefferHinweis
import ch.brickinventoryapp.ui.components.Ladezustand
import ch.brickinventoryapp.ui.ladeanzeige
import androidx.compose.material.icons.filled.BookmarkBorder
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
    var sortMenueOffen by rememberSaveable { mutableStateOf(false) }

    Box(Modifier.fillMaxSize()) {
        Column(Modifier.fillMaxSize()) {

            ScopeFilterZeile(
                members  = blick.householdMembers,
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
                            label = { Text(gallerySortLabel(zustand.sortierung), style = MaterialTheme.typography.labelMedium) },
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
                        label = { Text(stringResource(text), style = MaterialTheme.typography.labelMedium) },
                        shape = Formen.chip,
                    )
                }
            }

            Column(Modifier.fillMaxSize().padding(horizontal = Abstaende.mittel)) {
                // Zwei Leermeldungen: „Noch keine Merkposten“ sagt etwas über die
                // Liste, „nichts gefunden“ über den Filter; ein Ladefehler eine dritte.
                val gefiltert = zustand.query.isNotBlank() ||
                    zustand.zustandFilter.isNotBlank() ||
                    scopeModus != ch.brickinventoryapp.data.ScopeFilter.ALL
                Ladezustand(
                    anzeige = ladeanzeige(zustand.merkposten.isNotEmpty(), zustand.laedt, zustand.fehler, gefiltert),
                    fehler = zustand.fehler,
                    onErneut = { vm.ladeMerkliste() },
                    leer = { HinweisText(Icons.Default.BookmarkBorder, stringResource(R.string.wanted_empty)) },
                    keineTreffer = { KeinTrefferHinweis(stringResource(R.string.wanted_no_results)) },
                ) {
                    LazyColumn(
                        // Auf dem Tablet mittig statt über die ganze Breite: Name links,
                        // Preis rechts lagen dort eine Armlänge auseinander.
                        modifier = Modifier.mittigBis(ch.brickinventoryapp.ui.theme.Lesebreite.liste),
                        verticalArrangement = Arrangement.spacedBy(Abstaende.klein),
                        // Platz fuer die Knoepfe: Ohne ihn verdeckt der grosse die
                        // letzte Zeile — dieselbe Vorsorge wie in der Galerie.
                        contentPadding = PaddingValues(bottom = Abstaende.riesig + Abstaende.riesig),
                    ) {
                        items(zustand.merkposten, key = ::merkpostenSchluessel) { w ->
                            Bewegt {
                                MerkpostenZeile(w, appState.serverUrl, imageLoader,
                                    onOeffnen = { onOeffnen(w.setNumber, w.condition) })
                            }
                        }
                    }
                }
            }
        }

        // ── Zwei Knöpfe, wie in der Galerie ──
        //
        // Dieselbe Anordnung und Grössenstaffelung: Der kleine scannt, der grosse öffnet
        // die Maske.
        Column(
            modifier = Modifier.align(Alignment.BottomEnd)
                .padding(end = Abstaende.gross, bottom = Abstaende.gross),
            horizontalAlignment = Alignment.End,
            verticalArrangement = Arrangement.spacedBy(Abstaende.klein),
        ) {
            SmallFloatingActionButton(
                onClick = { onScan() },
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

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(stringResource(R.string.wanted_take), fontWeight = FontWeight.Bold) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(Abstaende.mittel)) {
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
                ZustandsWahl(zustand) { zustand = it }
                // Lagerort wie bei jeder anderen Erfassung.
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
    w: MerkpostenAnsicht, serverUrl: String, imageLoader: coil3.ImageLoader,
    onOeffnen: () -> Unit,
) {
    // Die ganze Karte öffnet das Detail — wie die Kachel in der Galerie. Sie
    // trägt keinen Knopf, tut also auf ihrer ganzen Fläche dasselbe;
    // Übernehmen und Löschen stehen im Detail.
    Card(Modifier.fillMaxWidth().clickable(role = Role.Button, onClick = onOeffnen)) {
        Column(Modifier.padding(Abstaende.mittel), verticalArrangement = Arrangement.spacedBy(Abstaende.winzig)) {
            Row(horizontalArrangement = Arrangement.spacedBy(Abstaende.klein),
                verticalAlignment = Alignment.CenterVertically) {
                // Ohne Bild oder beim Fehler das Logo wie in der Galerie, statt eines leeren Flecks.
                val ersatz = androidx.compose.ui.res.painterResource(R.drawable.ic_logo)
                coil3.compose.AsyncImage(
                    model = resolveThumbUrl(serverUrl, w.imageLocal, w.imageUrl),
                    contentDescription = null,
                    imageLoader = imageLoader,
                    placeholder = ersatz,
                    error = ersatz,
                    fallback = ersatz,
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
                    InfoPlakette(
                        stringResource(if (a.richtung == "ueber") R.string.wanted_alert_above else R.string.wanted_alert_below,
                                       ch.brickinventoryapp.util.fmtMoney(a.schwelle, w.waehrung)),
                        if (a.ausgeloest) Icons.Default.NotificationsActive else Icons.Default.Alarm,
                    )
                }
                // „Habe ich das inzwischen?" meint das BLICKFELD: Beim
                // Grossvater heisst „ich habe es" auch „der Enkel hat es".
                if (w.owned) InfoPlakette(stringResource(R.string.wanted_owned), Icons.Default.Check)
                Spacer(Modifier.weight(1f))
                // ── Marktpreis statt Knopf ──
                //
                // In die Galerie übernommen wird im Merkposten-Detail. Ohne Preis im Cache war der
                // Preisjob seit dem Eintragen noch nicht da — das sagt der Text, ein Strich sagte nichts.
                val preis = w.marktpreis
                if (preis != null) {
                    Text(ch.brickinventoryapp.util.fmtMoney(preis, w.waehrung), fontWeight = FontWeight.Bold)
                } else {
                    Text(stringResource(R.string.wanted_price_pending), style = MaterialTheme.typography.bodySmall,
                         color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
        }
    }
}
