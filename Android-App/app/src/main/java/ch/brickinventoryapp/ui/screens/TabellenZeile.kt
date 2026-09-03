package ch.brickinventoryapp.ui.screens

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
) {
    val ctx = LocalContext.current
    // Kein onClick: Auch in der Webapp ist die Tabellenzeile nicht anklickbar
    // — angetippt wird in der Kachelansicht. Ein Parameter, den niemand
    // benutzt, waere nur eine Einladung, es an einer Stelle anders zu machen.
    Surface(
        modifier = modifier.fillMaxWidth(),
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
