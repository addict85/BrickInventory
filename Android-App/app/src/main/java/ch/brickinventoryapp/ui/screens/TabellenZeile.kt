package ch.brickinventoryapp.ui.screens

import androidx.compose.foundation.clickable
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
import coil.ImageLoader
import coil.compose.AsyncImage
import coil.request.ImageRequest
import ch.brickinventoryapp.R
import ch.brickinventoryapp.ui.theme.Formen
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.Clear

/**
 * Eine Zeile der Tabellenansicht — fuer Teile UND Figuren.
 *
 * ── Warum eine gemeinsame Fassung ───────────────────────────────────────────
 * Die Webapp hat zwei Tabellen (parts-view und figs-view) mit demselben
 * Aufbau: kleines Bild, Nummer in Schreibmaschinenschrift, Name, rechts die
 * Menge. Zweimal getrennt aufgeschrieben waeren es zwei Stellen, die sich
 * unterschiedlich entwickeln — und „einheitliche Ansichten" war der ganze
 * Grund fuer diese Ansicht.
 *
 * Was sich unterscheidet, kommt als Inhalt herein: bei den Teilen ein
 * Farbpunkt und eine zweite Zeile mit Kategorie und Sets, bei den Figuren das
 * Erfassungsdatum.
 *
 * ── Warum keine echte Tabelle mit Spalten ───────────────────────────────────
 * Die Webapp hat sieben Spalten und dafuer einen breiten Bildschirm. Auf dem
 * Telefon waere das eine Tabelle, die seitwaerts geschoben werden muss —
 * dieselben Daten, aber unbenutzbar. Die Zeile hier zeigt alles, was die
 * Tabelle dort zeigt; die zwei breiten Spalten stehen als zweite Zeile
 * darunter statt daneben.
 *
 * @param bildUrl     Vorschaubild, oder null
 * @param nummer      Teile- bzw. Figurennummer (Schreibmaschinenschrift)
 * @param name        Bezeichnung
 * @param menge       Rechts stehende Menge
 * @param farbe       Farbpunkt vor dem Namen (nur Teile)
 * @param zweiteZeile Kategorie/Sets bzw. Erfassungsdatum, oder null
 * @param onBildFehler Rueckfall auf die volle Auflösung, siehe
 *        rememberTileImageWithFallback
 * @param onClick Antippen der ganzen Zeile, oder null fuer „nicht anklickbar"
 * @param onClickLabel Was das Antippen TUT — fuer die Sprachausgabe. Ohne das
 *        liest sie nur den Inhalt der Zeile vor und sagt „Doppeltippen zum
 *        Aktivieren", ohne zu verraten, was dann geschieht. Vorbelegt mit
 *        null, weil die Tabellenansichten der Teile und Figuren denselben
 *        Detail-Dialog oeffnen wie ihre Kacheln und dort bisher keinen Text
 *        haben; der Dialog fuer Set-Teile bringt einen mit.
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
    // ── Warum es onClick jetzt GIBT ─────────────────────────────────────────
    //
    // Hier stand: „Kein onClick: Auch in der Webapp ist die Tabellenzeile
    // nicht anklickbar — angetippt wird in der Kachelansicht."
    //
    // Das stimmt seit dem Detail-Dialog fuer Teile und Figuren aus Sets nicht
    // mehr: Dort oeffnen BEIDE Ansichten denselben Dialog (03-parts.js und
    // 06-minifigs.js, je Kachel und Tabellenzeile). Eine Ansicht, die weniger
    // kann als die andere, ist genau das, wogegen diese gemeinsame Zeile
    // gebaut wurde.
    //
    // `null` heisst weiterhin „nicht anklickbar" — die Begruendung von damals
    // gilt fuer jeden Aufrufer, der keinen Dialog dahinter hat.
    Surface(
        modifier = modifier.fillMaxWidth()
            .let {
                if (onClick != null) it.clickable(onClickLabel = onClickLabel, onClick = onClick)
                else it
            },
        color = MaterialTheme.colorScheme.surface,
    ) {
        Column {
            Row(
                Modifier.fillMaxWidth().padding(horizontal = 14.dp, vertical = 8.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                Box(
                    Modifier.size(36.dp).clip(Formen.etikett),
                    contentAlignment = Alignment.Center,
                ) {
                    if (bildUrl != null) {
                        AsyncImage(
                            model = ImageRequest.Builder(ctx).data(bildUrl).crossfade(true).build(),
                            imageLoader = imageLoader,
                            contentDescription = name,
                            onState = { st ->
                                if (st is coil.compose.AsyncImagePainter.State.Error) onBildFehler()
                            },
                            modifier = Modifier.fillMaxSize(),
                            contentScale = ContentScale.Fit,
                        )
                    }
                }
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
                            fontSize = 12.sp,
                            fontWeight = FontWeight.Medium,
                            color = MaterialTheme.colorScheme.primary,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                        )
                    }
                    Text(
                        name ?: "—",
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
                    fontSize = 13.sp,
                )
            }
            HorizontalDivider(color = MaterialTheme.colorScheme.outline.copy(alpha = 0.15f))
        }
    }
}

/**
 * Umschalter Karten/Tabelle.
 *
 * Zwei Chips statt eines Auswahlfelds: Bei genau zwei Moeglichkeiten ist ein
 * Aufklappmenue ein Klick zu viel, und die Wahl ist so auch ohne Oeffnen zu
 * sehen. Die Webapp nimmt dort ein <select>, weil sie es neben vier weiteren
 * Auswahlfeldern in einer Zeile hat.
 */
@Composable
fun AnsichtUmschalter(
    aktuell: String,
    onWechsel: (String) -> Unit,
    modifier: Modifier = Modifier,
) {
    Row(modifier, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        for ((wert, text) in listOf("grid" to R.string.view_cards, "table" to R.string.view_table)) {
            FilterChip(
                selected = aktuell == wert,
                onClick = { onWechsel(wert) },
                label = { Text(stringResource(text), fontSize = 13.sp) },
            )
        }
    }
}

/**
 * Das Suchfeld — eines für Galerie, Teile, Minifiguren und Katalog.
 *
 * ── Warum es das jetzt gibt (Nachtrag 132) ──────────────────────────────────
 *
 * Es stand VIERMAL da, siebzehn Zeilen lang und bis auf drei Stellen
 * zeichengleich: Platzhalter, Wert und — hier wird es unangenehm — die
 * Beschriftung des Leeren-Knopfes. Die vier waren:
 *
 *     CatalogSections   cd_search_clear    „Suche leeren"  / „Clear search"
 *     GalleryScreen     gallery_clear      „Löschen"       / „Clear"
 *     MinifigsScreen    minifigs_delete    „Löschen"       / „Delete"
 *     PartsScreen       parts_delete       „Löschen"       / „Delete"
 *
 * `minifigs_delete` und `parts_delete` sind die Beschriftung der LÖSCHEN-Knöpfe
 * — desselben Textes bedient sich der Knopf, der eine Minifigur endgültig
 * entfernt, und der Bestätigungsknopf im Löschdialog. Mit TalkBack sagte der
 * Knopf, der nur das Suchfeld leert, in zwei von vier Ansichten also
 * „Löschen"; auf Englisch sogar „Delete". Wer nicht sieht, was er antippt,
 * hört dort das Wort für „Bestand vernichten".
 *
 * Gefunden nicht durch Nachdenken, sondern durch Messen: Eine Suche nach
 * gleichen Achtzeilern über den ganzen App-Baum meldete 49 Treffer, und dieser
 * stand in vier Dateien.
 *
 * Die Beschriftung ist jetzt EINE (`cd_search_clear`) und beschreibt die
 * Wirkung des Tippens — genau das, was ein Bildschirmleser braucht.
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
        placeholder = { Text(platzhalter) },
        leadingIcon = { Icon(Icons.Default.Search, null, Modifier.size(20.dp)) },
        trailingIcon = {
            if (wert.isNotEmpty()) {
                IconButton(onClick = { onWert("") }) {
                    Icon(Icons.Default.Clear, stringResource(R.string.cd_search_clear))
                }
            }
        },
        modifier = modifier.fillMaxWidth().padding(horizontal = 14.dp, vertical = 8.dp),
        singleLine = true,
        shape = Formen.karte,
        colors = OutlinedTextFieldDefaults.colors(
            unfocusedBorderColor = MaterialTheme.colorScheme.outline.copy(alpha = 0.4f)
        )
    )
}

/**
 * Die Zustands-Zeile: Beschriftung „Zustand" und daneben die Wahl Neu/Gebraucht.
 *
 * ── Warum es das jetzt gibt (Nachtrag 133) ──────────────────────────────────
 *
 * Dieselbe Messung wie beim Suchfeld darueber — gleiche Achtzeiler ueber den
 * ganzen App-Baum, Importe und Kommentare abgezogen — meldete diesen Block in
 * DREI Dateien; die vierte Stelle kam beim Nachsehen dazu, weil sie
 * `androidx.compose.ui.Alignment` ausgeschrieben hatte und der Textvergleich
 * sie deshalb nicht als gleich erkannte:
 *
 *     BarcodeResultDialog   Zustand nach dem Scannen
 *     GalleryScreen         Set von Hand anlegen
 *     MinifigsScreen        Minifigur von Hand anlegen
 *     PartsDialogs          Teil von Hand anlegen
 *
 * Diese vier waren untereinander gleich. Die FUENFTE Stelle war es nicht:
 *
 *     CatalogDetailScreen   aus dem Katalog uebernehmen
 *
 * Dort standen statt des Umschalters zwei `FilterChip` — dieselbe Wahl,
 * dieselben Werte „N"/„U", aber ein anderes Aussehen: Material-Chips mit
 * Haekchen statt der gefuellten Flaeche, und die Beschriftung ohne die feste
 * Spaltenbreite von 90.dp, also links nicht buendig mit den anderen Zeilen des
 * Dialogs. Dieselbe Entscheidung sah in der App an zwei Orten verschieden aus.
 *
 * Auch hier gilt: gefunden durch Messen, nicht durch Lesen. Die Doppelung war
 * der Anlass; der Unterschied war der Fund.
 *
 * @param zustand  „N" oder „U" — dieselben Werte, die der Server kennt
 */
@Composable
fun Zustandszeile(
    zustand: String,
    onZustand: (String) -> Unit,
    modifier: Modifier = Modifier,
    /** Durchgereicht an [ConditionToggle] — siehe dort. */
    optionen: List<Pair<String, Int>> = ZUSTAND_NEU_GEBRAUCHT,
) {
    Row(
        verticalAlignment = Alignment.CenterVertically,
        modifier = modifier.fillMaxWidth(),
    ) {
        Text(
            stringResource(R.string.common_condition),
            style = MaterialTheme.typography.bodyMedium,
            modifier = Modifier.width(90.dp),
        )
        Spacer(Modifier.width(8.dp))
        ConditionToggle(selected = zustand, onSelect = onZustand, optionen = optionen)
    }
}

/**
 * Neu/Gebraucht als zwei Flaechen.
 *
 * Stand bis Nachtrag 133 in GalleryScreen.kt und wurde von dort aus in drei
 * weiteren Dateien aufgerufen — eine Ansicht als Wohnort fuer ein Bedienelement,
 * das vier Ansichten benutzen. Jetzt liegt es neben der Zeile, die es einbaut.
 *
 * Die Werte „N" und „U" sind die des Servers (utils/validate.ts); uebersetzt
 * wird nur die Beschriftung.
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
    /**
     * Wert → Beschriftung. Vorbelegt mit „neu / gebraucht", weil das an fast
     * jeder Stelle gemeint ist.
     *
     * Als Parameter und nicht als zweite, eigene Umschaltleiste: Die
     * BrickLink-Wunschliste kennt einen dritten Wert („egal"), sieht sonst
     * aber genauso aus. Eine zweite Bauform daneben waere derselbe Knopf in
     * zwei Gestalten — genau das, was in dieser Reihe schon bei Suchfeld und
     * Zustandszeile zusammengefuehrt wurde.
     */
    optionen: List<Pair<String, Int>> = ZUSTAND_NEU_GEBRAUCHT,
) {
    Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        optionen.forEach { (value, labelRes) ->
            val isSelected = selected == value
            Surface(
                onClick = { onSelect(value) },
                shape = MaterialTheme.shapes.small,
                color = if (isSelected) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.surfaceVariant,
                modifier = Modifier.height(34.dp)
            ) {
                Box(Modifier.padding(horizontal = 14.dp), contentAlignment = Alignment.Center) {
                    Text(
                        stringResource(labelRes),
                        color = if (isSelected) MaterialTheme.colorScheme.onPrimary else MaterialTheme.colorScheme.onSurfaceVariant,
                        style = MaterialTheme.typography.labelMedium,
                        fontWeight = if (isSelected) FontWeight.Bold else FontWeight.Normal
                    )
                }
            }
        }
    }
}
