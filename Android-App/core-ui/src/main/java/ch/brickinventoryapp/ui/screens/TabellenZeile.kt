package ch.brickinventoryapp.ui.screens

import ch.brickinventoryapp.ui.components.AuswahlChip
import androidx.compose.foundation.clickable
import androidx.compose.ui.semantics.Role
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.platform.LocalContext
import coil3.ImageLoader
import coil3.request.ImageRequest
import coil3.request.crossfade
import ch.brickinventoryapp.ressourcen.R
import ch.brickinventoryapp.ui.theme.Formen
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.Clear
import ch.brickinventoryapp.ui.theme.Abstaende

/**
 * Eine Zeile der Tabellenansicht — für Teile und Figuren, wie die beiden gleich
 * gebauten Tabellen der Webapp; eine Fassung, damit sie sich nicht
 * auseinanderentwickeln. Keine echten Spalten: Sieben Spalten müsste man am
 * Telefon seitwärts schieben, die breiten stehen deshalb als zweite Zeile
 * darunter.
 *
 * @param bildUrl     Vorschaubild, oder null
 * @param nummer      Teile- bzw. Figurennummer (Schreibmaschinenschrift)
 * @param name        Bezeichnung
 * @param menge       rechts stehende Menge
 * @param farbe       Farbpunkt vor dem Namen (nur Teile)
 * @param zweiteZeile Kategorie/Sets bzw. Erfassungsdatum, oder null
 * @param onBildFehler Rückfall auf die volle Auflösung
 *         (rememberTileImageWithFallback)
 * @param onClick Antippen der ganzen Zeile, oder null für „nicht anklickbar“
 * @param onClickLabel Was das Antippen tut, für die Sprachausgabe — sonst sagt sie
 *         nur „Doppeltippen zum Aktivieren“. Vorbelegt mit null für Aufrufer ohne
 *         eigenen Text.
 */
@Composable
fun TabellenZeile(
    bildUrl: String?,
    nummer: String,
    name: String?,
    menge: Int,
    imageLoader: ImageLoader,
    modifier: Modifier = Modifier,
    farbe: Color? = null,
    zweiteZeile: String? = null,
    onBildFehler: () -> Unit = {},
    onClick: (() -> Unit)? = null,
    onClickLabel: String? = null,
) {
    val ctx = LocalContext.current
    // onClick: Beide Ansichten öffnen denselben Dialog wie in der Webapp; eine Ansicht
    // soll nicht weniger können als die andere. `null` heisst nicht anklickbar.
    Surface(
        modifier = modifier.fillMaxWidth()
            .let {
                if (onClick != null) it.clickable(onClickLabel = onClickLabel, role = Role.Button, onClick = onClick)
                else it
            },
        color = MaterialTheme.colorScheme.surface,
    ) {
        Column {
            Row(
                Modifier.fillMaxWidth().padding(horizontal = 14.dp, vertical = Abstaende.klein),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                ch.brickinventoryapp.ui.components.ProduktBild(
                    model = bildUrl?.let { ImageRequest.Builder(ctx).data(it).crossfade(true).build() },
                    imageLoader = imageLoader,
                    contentDescription = name,
                    onState = { st ->
                        if (st is coil3.compose.AsyncImagePainter.State.Error) onBildFehler()
                    },
                    modifier = Modifier.size(36.dp).clip(Formen.etikett),
                    contentScale = ContentScale.Fit,
                    ersatzGroesse = 20.dp,
                )
                Column(Modifier.weight(1f)) {
                    Row(verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(5.dp)) {
                        if (farbe != null) {
                            Surface(color = farbe,
                                shape = androidx.compose.foundation.shape.CircleShape,
                                modifier = Modifier.size(10.dp)) {}
                        }
                        Text(
                            nummer,
                            fontFamily = FontFamily.Monospace,
                            style = MaterialTheme.typography.bodySmall,
                            fontWeight = FontWeight.Medium,
                            color = MaterialTheme.colorScheme.primary,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                        )
                    }
                    Text(
                        name ?: stringResource(R.string.name_unknown),
                        color = if (name == null) MaterialTheme.colorScheme.onSurfaceVariant else MaterialTheme.colorScheme.onSurface,
                        style = MaterialTheme.typography.bodySmall,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                    if (!zweiteZeile.isNullOrBlank()) {
                        Text(
                            zweiteZeile,
                            style = MaterialTheme.typography.labelSmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                        )
                    }
                }
                Text(
                    "$menge",
                    fontFamily = FontFamily.Monospace,
                    fontWeight = FontWeight.Bold,
                    style = MaterialTheme.typography.bodyMedium,
                )
            }
            HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
        }
    }
}

/**
 * Umschalter Karten/Tabelle als zwei Chips: Bei zwei Möglichkeiten wäre ein
 * Aufklappmenü ein Klick zu viel, und die Wahl ist ohne Öffnen sichtbar.
 */
@Composable
fun AnsichtUmschalter(
    aktuell: String,
    onWechsel: (String) -> Unit,
    modifier: Modifier = Modifier,
) {
    ch.brickinventoryapp.ui.components.SegmentWahl(
        optionen = listOf("grid" to stringResource(R.string.view_cards), "table" to stringResource(R.string.view_table)),
        gewaehlt = aktuell,
        onWahl = onWechsel,
        modifier = modifier,
    )
}

/**
 * Das Suchfeld für Galerie, Teile, Minifiguren und Katalog. Eine Fassung, damit
 * auch der Leeren-Knopf überall gleich heisst: `cd_search_clear` beschreibt die
 * Wirkung — „Löschen“ hätte TalkBack-Nutzern das Wort für „Bestand vernichten“
 * vorgelesen.
 */
@Composable
fun Suchfeld(
    wert: String,
    onWert: (String) -> Unit,
    platzhalter: String,
    modifier: Modifier = Modifier,
) {
    OutlinedTextField(
        value = wert,
        onValueChange = onWert,
        // Eine Zeile: Ein umbrechender Platzhalter machte das Feld doppelt so hoch
        // wie den Filterknopf daneben.
        placeholder = { Text(platzhalter, maxLines = 1, overflow = TextOverflow.Ellipsis) },
        leadingIcon = { Icon(Icons.Default.Search, null, Modifier.size(ch.brickinventoryapp.ui.components.mitSchrift(20.dp))) },
        trailingIcon = {
            if (wert.isNotEmpty()) {
                IconButton(onClick = { onWert("") }) {
                    Icon(Icons.Default.Clear, stringResource(R.string.cd_search_clear))
                }
            }
        },
        modifier = modifier.fillMaxWidth().padding(horizontal = 14.dp, vertical = Abstaende.klein),
        singleLine = true,
        shape = Formen.karte,
    )
}

/**
 * Die Zustands-Zeile: Beschriftung „Zustand“ und daneben Neu/Gebraucht. Eine
 * Fassung für alle Erfassungsdialoge, damit dieselbe Entscheidung überall gleich
 * aussieht und die Beschriftung mit ihrer festen Breite bündig steht.
 *
 * @param zustand „N“ oder „U“ — die Werte des Servers
 */
@Composable
fun Zustandszeile(
    zustand: String,
    onZustand: (String) -> Unit,
    modifier: Modifier = Modifier,
    /** Durchgereicht an [ConditionToggle] — siehe dort. */
    optionen: List<Pair<String, Int>> = ZUSTAND_NEU_GEBRAUCHT,
) {
    // Ab 130 % Schrift steht die Beschriftung über der Wahl: In der festen Spalte
    // daneben brach „Zustan|d“ mitten im Wort.
    if (androidx.compose.ui.platform.LocalDensity.current.fontScale > 1.3f) {
        Column(modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(Abstaende.klein)) {
            Text(stringResource(R.string.common_condition), style = MaterialTheme.typography.bodyMedium)
            ConditionToggle(selected = zustand, onSelect = onZustand, optionen = optionen)
        }
        return
    }
    Row(
        verticalAlignment = Alignment.CenterVertically,
        modifier = modifier.fillMaxWidth(),
    ) {
        Text(
            stringResource(R.string.common_condition),
            style = MaterialTheme.typography.bodyMedium,
            modifier = Modifier.width(90.dp),
        )
        Spacer(Modifier.width(Abstaende.klein))
        ConditionToggle(selected = zustand, onSelect = onZustand, modifier = Modifier.weight(1f), optionen = optionen)
    }
}

/**
 * Neu/Gebraucht als zwei Flächen, neben der Zeile, die es einbaut. Die Werte „N“
 * und „U“ sind die des Servers (utils/validate.ts); übersetzt wird nur die
 * Beschriftung.
 */
/**
 * Die Vorbelegung von [ConditionToggle] und [Zustandszeile] — an einer Stelle,
 * damit die beiden nicht mit verschiedenen Listen dastehen.
 */
val ZUSTAND_NEU_GEBRAUCHT: List<Pair<String, Int>> =
    listOf("N" to R.string.condition_new, "U" to R.string.condition_used)

@Composable
fun ConditionToggle(
    selected: String,
    onSelect: (String) -> Unit,
    modifier: Modifier = Modifier,
    /**
     * Wert → Beschriftung, vorbelegt mit „neu / gebraucht“. Als Parameter, weil die
     * BrickLink-Wunschliste einen dritten Wert („egal“) kennt und sonst gleich
     * aussieht.
     */
    optionen: List<Pair<String, Int>> = ZUSTAND_NEU_GEBRAUCHT,
) {
    // Dieselbe Segmentschaltfläche wie jede Einfachwahl der App (SegmentWahl): Die
    // eigene Fassung mit Flächen ohne Rand liess „Gebraucht“ wie Text aussehen.
    ch.brickinventoryapp.ui.components.SegmentWahl(
        optionen = optionen.map { (wert, text) -> wert to stringResource(text) },
        gewaehlt = selected,
        onWahl = onSelect,
        modifier = modifier,
    )
}
