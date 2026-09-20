package ch.brickinventoryapp.ui.screens

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import ch.brickinventoryapp.R
import ch.brickinventoryapp.data.model.Wunsch
import ch.brickinventoryapp.ui.MainViewModel
import ch.brickinventoryapp.ui.ladeWunschliste
import ch.brickinventoryapp.ui.legeWunschAn
import ch.brickinventoryapp.ui.loescheWunsch
import ch.brickinventoryapp.ui.setScannerSource
import ch.brickinventoryapp.ui.setzeWunschEingabe
import ch.brickinventoryapp.ui.setzeWunschNotiz
import ch.brickinventoryapp.ui.setzeWunschZustand
import ch.brickinventoryapp.ui.uebernimmWunsch
import ch.brickinventoryapp.util.resolveThumbUrl

/**
 * Die Wunschliste.
 *
 * ── Warum eine Liste und keine Kachelwand ───────────────────────────────────
 *
 * Die Galerie zeigt Kacheln, weil man seine Sammlung ansieht. Eine
 * Wunschliste wird GELESEN und abgearbeitet, und die Notiz („Geschenk Enkel")
 * ist dabei so wichtig wie das Bild — auf einer Kachel haette sie keinen
 * Platz. Dieselbe Entscheidung wie in der Webapp; die beiden Oberflaechen
 * sollen sich gleich anfuehlen.
 *
 * ── Was hier NICHT entschieden wird ─────────────────────────────────────────
 *
 * Alle Regeln stehen am Server (utils/wunschliste.ts). Dieser Bildschirm
 * zeigt und ruft.
 */
@Composable
fun WunschlisteScreen(
    vm: MainViewModel,
    imageLoader: coil.ImageLoader,
    onScan: () -> Unit,
) {
    val zustand by vm.wunschState.collectAsStateWithLifecycle()
    // Die Bildadressen zeigen auf den eigenen Server (Proxy), nicht roh aufs
    // CDN — dieselbe Regel wie in Galerie, Teilen und Finanzen.
    val appState by vm.state.collectAsStateWithLifecycle()

    LaunchedEffect(Unit) { vm.ladeWunschliste() }

    Column(Modifier.fillMaxSize().padding(horizontal = 12.dp)) {
        WunschErfassen(vm, zustand.eingabe, zustand.zustand, zustand.notiz, onScan)

        when {
            zustand.laedt && zustand.wuensche.isEmpty() ->
                Box(Modifier.fillMaxWidth().padding(32.dp), Alignment.Center) { CircularProgressIndicator() }

            zustand.wuensche.isEmpty() ->
                Box(Modifier.fillMaxWidth().padding(32.dp), Alignment.Center) {
                    Text(stringResource(R.string.wishlist_empty),
                         color = MaterialTheme.colorScheme.onSurfaceVariant)
                }

            else -> LazyColumn(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                // Schluessel aus Nummer UND Zustand: Dasselbe Set kann zweimal
                // dastehen (neu und gebraucht). Nur die Nummer waere doppelt
                // und Compose verloere die Zuordnung beim Neuzeichnen.
                items(zustand.wuensche, key = { "${it.setNumber}|${it.condition}|${it.userId}" }) { w ->
                    WunschZeile(w, appState.serverUrl, imageLoader,
                        onUebernehmen = { vm.uebernimmWunsch(w.setNumber, w.condition, w.userId) },
                        onLoeschen    = { vm.loescheWunsch(w.setNumber, w.condition, w.userId) })
                }
            }
        }
    }
}

/**
 * Der Erfassungskasten — „analog den Sets".
 *
 * Nummer, Zustand, Notiz und der Scanner. Anzahl und Kaufpreis fehlen
 * bewusst: Ein Wunsch hat weder das eine noch das andere; beides wird erst
 * bei der Uebernahme in die Galerie gefragt.
 */
@Composable
private fun WunschErfassen(
    vm: MainViewModel, eingabe: String, zustandWahl: String, notiz: String, onScan: () -> Unit,
) {
    Card(Modifier.fillMaxWidth().padding(vertical = 8.dp)) {
        Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(stringResource(R.string.wishlist_add_title), fontWeight = FontWeight.Bold)
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp),
                verticalAlignment = Alignment.CenterVertically) {
                OutlinedTextField(
                    value = eingabe,
                    onValueChange = { vm.setzeWunschEingabe(it) },
                    label = { Text(stringResource(R.string.gallery_set_number)) },
                    singleLine = true,
                    modifier = Modifier.weight(1f),
                )
                // Der Scanner ist derselbe wie in der Galerie — nur die
                // Herkunft unterscheidet sich, und die entscheidet am Ende,
                // wohin die Nummer geht (ui/BarcodeFeature.kt).
                IconButton(onClick = { vm.setScannerSource("wishlist"); onScan() }) {
                    Text("📷")
                }
            }
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp),
                verticalAlignment = Alignment.CenterVertically) {
                ZustandsWahl(zustandWahl) { vm.setzeWunschZustand(it) }
            }
            OutlinedTextField(
                value = notiz,
                onValueChange = { vm.setzeWunschNotiz(it) },
                label = { Text(stringResource(R.string.wishlist_note)) },
                singleLine = true,
                modifier = Modifier.fillMaxWidth(),
            )
            Button(
                onClick = { vm.legeWunschAn(eingabe, zustandWahl, notiz) },
                modifier = Modifier.align(Alignment.End),
            ) { Text(stringResource(R.string.wishlist_add_submit)) }
        }
    }
}

/** Neu oder gebraucht — zwei Knoepfe statt einer Auswahlliste, wie im Baum ueblich. */
@Composable
private fun ZustandsWahl(gewaehlt: String, onWahl: (String) -> Unit) {
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        FilterChip(selected = gewaehlt == "N", onClick = { onWahl("N") },
                   label = { Text(stringResource(R.string.condition_new)) })
        FilterChip(selected = gewaehlt == "U", onClick = { onWahl("U") },
                   label = { Text(stringResource(R.string.condition_used)) })
    }
}

@Composable
private fun WunschZeile(
    w: Wunsch, serverUrl: String, imageLoader: coil.ImageLoader,
    onUebernehmen: () -> Unit, onLoeschen: () -> Unit,
) {
    Card(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(10.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp),
                verticalAlignment = Alignment.CenterVertically) {
                coil.compose.AsyncImage(
                    model = resolveThumbUrl(serverUrl, null, w.imageUrl),
                    contentDescription = null,
                    imageLoader = imageLoader,
                    modifier = Modifier.size(56.dp),
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
                    if (!w.notiz.isNullOrBlank()) {
                        Text(w.notiz, style = MaterialTheme.typography.bodySmall,
                             color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                }
            }
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp),
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
