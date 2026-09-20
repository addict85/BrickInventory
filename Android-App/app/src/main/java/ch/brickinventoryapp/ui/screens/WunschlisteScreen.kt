package ch.brickinventoryapp.ui.screens

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
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
import ch.brickinventoryapp.data.model.Wunsch
import ch.brickinventoryapp.ui.MainViewModel
import ch.brickinventoryapp.ui.ladeWunschliste
import ch.brickinventoryapp.ui.legeWunschAn
import ch.brickinventoryapp.ui.loescheWunsch
import ch.brickinventoryapp.ui.setScannerSource
import ch.brickinventoryapp.ui.uebernimmWunsch
import ch.brickinventoryapp.ui.theme.Abstaende
import ch.brickinventoryapp.ui.theme.Formen
import ch.brickinventoryapp.ui.theme.LocalIsBrickTheme
import ch.brickinventoryapp.util.NumericInput
import ch.brickinventoryapp.util.resolveThumbUrl

/**
 * Die Wunschliste.
 *
 * ── Warum eine Liste und keine Kachelwand ───────────────────────────────────
 *
 * Die Galerie zeigt Kacheln, weil man seine Sammlung ansieht. Eine
 * Wunschliste wird GELESEN und abgearbeitet — Nummer, Jahr und Zustand
 * nebeneinander, dazu der Preisalarm. Dieselbe Entscheidung wie in der
 * Webapp; die beiden Oberflaechen sollen sich gleich anfuehlen.
 *
 * ── Was hier NICHT entschieden wird ─────────────────────────────────────────
 *
 * Alle Regeln stehen am Server (utils/wunschliste.ts). Dieser Bildschirm
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
private fun wunschSchluessel(w: Wunsch) = "${w.setNumber}|${w.condition}|${w.userId}"

@Composable
fun WunschlisteScreen(
    vm: MainViewModel,
    imageLoader: coil.ImageLoader,
    onScan: () -> Unit,
    onOeffnen: (String, String) -> Unit,
) {
    val zustand by vm.wunschState.collectAsStateWithLifecycle()
    // Die Bildadressen zeigen auf den eigenen Server (Proxy), nicht roh aufs
    // CDN — dieselbe Regel wie in Galerie, Teilen und Finanzen.
    val appState by vm.state.collectAsStateWithLifecycle()

    // Der Wunsch, ueber dem der Uebernahme-Dialog gerade steht — als
    // SCHLUESSEL, nicht als Objekt.
    //
    // Wer den Dialog offen hat und das Telefon dreht, soll ihn offen
    // wiederfinden; der Zustand muss also ins Bundle. Ein ganzes Wunsch-Objekt
    // passt dort nicht hinein (nicht Parcelable), eine Zeichenkette schon —
    // und die Zeile dazu steht ohnehin in der geladenen Liste.
    var uebernahmeSchluessel by rememberSaveable { mutableStateOf<String?>(null) }
    var maskeOffen by rememberSaveable { mutableStateOf(false) }
    val uebernahme = zustand.wuensche.firstOrNull { wunschSchluessel(it) == uebernahmeSchluessel }

    LaunchedEffect(Unit) { vm.ladeWunschliste() }

    Box(Modifier.fillMaxSize()) {
        Column(Modifier.fillMaxSize().padding(horizontal = Abstaende.mittel)) {
            when {
                zustand.laedt && zustand.wuensche.isEmpty() ->
                    Box(Modifier.fillMaxWidth().padding(Abstaende.riesig), Alignment.Center) { CircularProgressIndicator() }

                zustand.wuensche.isEmpty() ->
                    Box(Modifier.fillMaxWidth().padding(Abstaende.riesig), Alignment.Center) {
                        Text(stringResource(R.string.wishlist_empty),
                             color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }

                else -> LazyColumn(
                    verticalArrangement = Arrangement.spacedBy(Abstaende.klein),
                    // Platz fuer die Knoepfe: Ohne ihn verdeckt der grosse die
                    // letzte Zeile — dieselbe Vorsorge wie in der Galerie.
                    contentPadding = PaddingValues(bottom = Abstaende.riesig + Abstaende.riesig),
                ) {
                    items(zustand.wuensche, key = ::wunschSchluessel) { w ->
                        WunschZeile(w, appState.serverUrl, imageLoader,
                            onOeffnen     = { onOeffnen(w.setNumber, w.condition) },
                            onUebernehmen = { uebernahmeSchluessel = wunschSchluessel(w) },
                            onLoeschen    = { vm.loescheWunsch(w.setNumber, w.condition, w.userId) })
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
                onClick = { vm.setScannerSource("wishlist"); onScan() },
                containerColor = MaterialTheme.colorScheme.secondaryContainer,
                contentColor = MaterialTheme.colorScheme.onSecondaryContainer,
                shape = Formen.leiste,
            ) { Icon(Icons.Default.QrCodeScanner, stringResource(R.string.gallery_scan_barcode)) }
            FloatingActionButton(
                onClick = { maskeOffen = true },
                containerColor = if (LocalIsBrickTheme.current) MaterialTheme.colorScheme.secondary else MaterialTheme.colorScheme.primary,
                contentColor = if (LocalIsBrickTheme.current) MaterialTheme.colorScheme.onSecondary else MaterialTheme.colorScheme.onPrimary,
                shape = Formen.fab,
            ) { Icon(Icons.Default.Add, stringResource(R.string.wishlist_add_title)) }
        }
    }

    if (maskeOffen) {
        WunschErfassenDialog(
            householdMembers = appState.householdMembers,
            defaultCondition = appState.userDefaultCondition ?: "N",
            onDismiss = { maskeOffen = false },
            onAnlegen = { nummer, zustandWahl, besitzer ->
                vm.legeWunschAn(nummer, zustandWahl, besitzer)
                maskeOffen = false
            },
        )
    }

    uebernahme?.let { w ->
        UebernahmeDialog(
            wunsch = w,
            onDismiss = { uebernahmeSchluessel = null },
            onUebernehmen = { anzahl, preis, zustandWahl ->
                vm.uebernimmWunsch(w.setNumber, w.condition, w.userId, anzahl, preis, zustandWahl)
                uebernahmeSchluessel = null
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
 * Kaufpreis und im Zustand des Wunsches durch — fuer ein Set, das man gerade
 * gekauft hat, ist keins davon zuverlaessig richtig.
 *
 * Dieselben drei Felder in derselben Reihenfolge wie im Katalog-Dialog
 * (CatalogAddDialog): Wer das eine kennt, kennt das andere.
 *
 * Der Zustand ist mit dem des WUNSCHES vorbelegt — der haeufigste Fall —,
 * laesst sich aber aendern. Welcher Wunsch dadurch erfuellt ist, bleibt davon
 * unberuehrt; das entscheidet der Server.
 */
@Composable
internal fun UebernahmeDialog(
    wunsch: Wunsch,
    onDismiss: () -> Unit,
    onUebernehmen: (Int, String, String) -> Unit,
) {
    var anzahl  by rememberSaveable { mutableStateOf("1") }
    var preis   by rememberSaveable { mutableStateOf("") }
    var zustand by rememberSaveable { mutableStateOf(wunsch.condition) }

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(stringResource(R.string.wishlist_take), fontWeight = FontWeight.Bold) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(Abstaende.mittel)) {
                Text(wunsch.name ?: wunsch.setNumber, style = MaterialTheme.typography.bodyMedium)
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
            }
        },
        confirmButton = {
            Button(onClick = { onUebernehmen(anzahl.toIntOrNull() ?: 1, preis, zustand) }) {
                Text(stringResource(R.string.wishlist_take))
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
 * Wunsch hat weder das eine noch das andere. Beides wird erst bei der
 * Uebernahme in die Galerie gefragt.
 *
 * Der Cursor steht sofort im Nummernfeld, wie im AddSetDialog seit Nachtrag
 * 113 — und aus demselben Grund die kurze Pause davor: Beim ersten Durchlauf
 * ist das Feld noch nicht angeordnet, ein requestFocus() liefe ins Leere.
 */
@Composable
private fun WunschErfassenDialog(
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
        title = { Text(stringResource(R.string.wishlist_add_title), fontWeight = FontWeight.Bold) },
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
            ) { Text(stringResource(R.string.wishlist_add_submit)) }
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
private fun WunschZeile(
    w: Wunsch, serverUrl: String, imageLoader: coil.ImageLoader,
    onOeffnen: () -> Unit, onUebernehmen: () -> Unit, onLoeschen: () -> Unit,
) {
    // Die ganze Karte oeffnet das Detail — wie die Kachel in der Galerie. Die
    // zwei Knoepfe darin fangen ihre eigenen Klicks ab.
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
                    // benannte Preis dafuer, dass die Wunschliste keine zweite
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
                        label = { Text(stringResource(R.string.wishlist_owned)) })
                }
                Spacer(Modifier.weight(1f))
                TextButton(onClick = onLoeschen) { Text(stringResource(R.string.common_delete)) }
                Button(onClick = onUebernehmen) { Text(stringResource(R.string.wishlist_take)) }
            }
        }
    }
}
