package ch.brickinventoryapp.teile.ui.screens

import ch.brickinventoryapp.model.fach.Waehrung
import androidx.compose.material3.Button
import ch.brickinventoryapp.ui.components.fokusRahmen
import ch.brickinventoryapp.model.ui.model.FigurAnsicht
import ch.brickinventoryapp.model.ui.model.ManuelleFigurAnsicht
import ch.brickinventoryapp.ui.theme.Formen
import androidx.compose.foundation.clickable
import androidx.compose.foundation.border
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.Role
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.grid.*
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import ch.brickinventoryapp.ui.util.rememberTileImageWithFallback
import coil3.ImageLoader
import androidx.compose.ui.res.stringResource
import ch.brickinventoryapp.ressourcen.R
import ch.brickinventoryapp.model.ui.*
import ch.brickinventoryapp.teile.ui.*
import ch.brickinventoryapp.ui.*
import ch.brickinventoryapp.zustand.ui.*
import ch.brickinventoryapp.ui.theme.Abstaende
import ch.brickinventoryapp.ui.components.stueckzahl
import ch.brickinventoryapp.ui.components.vorgelesenAls
import ch.brickinventoryapp.ui.components.ProduktBild
import ch.brickinventoryapp.ui.components.grosseSchrift
import ch.brickinventoryapp.ui.components.katalogName
import ch.brickinventoryapp.model.util.DatumJahr
import ch.brickinventoryapp.ui.util.fmtTag
import ch.brickinventoryapp.gemeinsam.ui.ConditionBadges
import ch.brickinventoryapp.gemeinsam.ui.ManuelleKachel
import ch.brickinventoryapp.gemeinsam.ui.OwnerBadges
import ch.brickinventoryapp.gemeinsam.ui.TabellenZeile
import ch.brickinventoryapp.gemeinsam.ui.mengeAusSet

@Composable
internal fun ManualFigTile(fig: ManuelleFigurAnsicht, serverUrl: String, imageLoader: ImageLoader,
                  waehrung: Waehrung, onEdit: () -> Unit) {
    // Vorschaubild mit Rückfall auf volle Auflösung — siehe
    // util/BildRueckfall.kt, rememberTileImageWithFallback().
    val (bild, onBildFehler) =
        rememberTileImageWithFallback(serverUrl, fig.imageLocal, fig.imageUrl, fullViaProxy = true)
    // Alles Weitere steht in ManuelleKachel (ManualItemComposables.kt), die auch die
    // Teile benutzen — damit Zustands- und Besitzer-Plaketten nicht nur in einem
    // Zwilling nachgezogen werden.
    ManuelleKachel(
        bildUrl = bild,
        onBildFehler = onBildFehler,
        imageLoader = imageLoader,
        name = fig.figName ?: fig.figNumber,
        menge = fig.quantity,
        zustaende = fig.conditions,
        zustand = fig.condition,
        besitzer = fig.owners,
        preis = fig.avgPurchasePrice ?: fig.unitPrice ?: fig.purchasePrice,
        waehrung = waehrung,
        onEdit = onEdit,
    )
}

@Composable
fun MinifigCard(fig: FigurAnsicht, serverUrl: String, imageLoader: ImageLoader,
                onClick: (() -> Unit)? = null, ausgewaehlt: Boolean = false) {
    val qty = fig.totalQuantity ?: fig.quantity

    Card(
        // Antippen oeffnet den Detail-Dialog — wie bei den Teilen daneben.
        modifier = Modifier.fillMaxWidth().heightIn(min = 196.dp)
            .semantics { selected = ausgewaehlt }
            .then(if (ausgewaehlt) Modifier.border(2.dp, MaterialTheme.colorScheme.primary, Formen.leiste) else Modifier)
            .let { if (onClick != null) it.fokusRahmen(Formen.leiste).clickable(role = Role.Button, onClick = onClick) else it },
        shape = Formen.leiste,
        elevation = CardDefaults.cardElevation(defaultElevation = Formen.karteErhebung),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface)
    ) {
        Column {
            Box(Modifier.fillMaxWidth().height(110.dp)) {
                // Vorschaubild mit Rückfall auf volle Auflösung — siehe
                // util/BildRueckfall.kt, rememberTileImageWithFallback().
                val (figImg, onFigImgError) = rememberTileImageWithFallback(serverUrl, fig.imageLocal, fig.imageUrl, fullViaProxy = true)
                ProduktBild(
                    model = figImg,
                    imageLoader = imageLoader,
                    // Ohne Beschreibung: Der Name steht darunter, TalkBack las ihn sonst zweimal.
                    contentDescription = null,
                    onState = { st ->
                        if (st is coil3.compose.AsyncImagePainter.State.Error) onFigImgError()
                    },
                    modifier = Modifier.fillMaxSize()
                        .clip(Formen.kachelBildEcken),
                    contentScale = ContentScale.Fit,
                    // Bildgrund über die ganze Kachelbreite wie bei Sets und Teilen: Das hohe
                    // Figurenbild stand sonst schmal in der Mitte mit weissen Rändern.
                    bildgrund = true,
                    innenAbstand = Abstaende.winzig,
                )
                if (qty > 1) {
                    Surface(
                        color = MaterialTheme.colorScheme.primary,
                        shape = Formen.marke,
                        modifier = Modifier.align(Alignment.TopEnd).padding(Abstaende.winzig)
                    ) {
                        // Die Menge-Plakette: „×N“ auf einer manuell erfassten Kachel, „N×“ auf
                        // einer Kachel aus einem Set — die Regel der Webapp (`man-tile` mit
                        // `qbadge` ×N, `part-card` mit `part-qty` N×).
                        Text(mengeAusSet(qty), Modifier.padding(horizontal = 5.dp, vertical = Abstaende.haar)
                            .vorgelesenAls(stueckzahl(qty)),
                            color = MaterialTheme.colorScheme.onPrimary,
                            style = MaterialTheme.typography.labelSmall, fontWeight = FontWeight.Bold)
                    }
                }
                // Zustand nur bei manuell erfassten Minifiguren (aus Sets übernommene haben keinen
                // eigenen). Die Besitzer-Plakette dagegen immer: „Wem gehört das?“ stellt sich bei
                // einer Figur aus dem Set eines Kindes genauso, und diese Liste lädt nur
                // `source=set`. Ohne Haushalt ist `owners` leer und OwnerBadges kehrt sofort
                // zurück. Column statt Box: zwei Plaketten übereinander, nicht am selben Punkt.
                Column(Modifier.align(Alignment.BottomStart).padding(Abstaende.winzig),
                    verticalArrangement = Arrangement.spacedBy(Abstaende.haar)) {
                    if (fig.source == "manual") ConditionBadges(fig.conditions, fig.condition)
                    OwnerBadges(fig.owners)
                }
                if (fig.source == "manual") {
                    Surface(
                        color = MaterialTheme.colorScheme.tertiaryContainer,
                        shape = Formen.marke,
                        modifier = Modifier.align(Alignment.TopStart).padding(Abstaende.winzig)
                    ) {
                        Text(stringResource(R.string.minifigs_manual_badge), Modifier.padding(horizontal = 5.dp, vertical = Abstaende.haar),
                            color = MaterialTheme.colorScheme.onTertiaryContainer,
                            style = MaterialTheme.typography.labelSmall, fontWeight = FontWeight.Bold)
                    }
                }
            }
            Column(Modifier.padding(Abstaende.klein), verticalArrangement = Arrangement.spacedBy(1.dp)) {
                Text(fig.figNumber, Modifier.vorgelesenAls(stringResource(R.string.cd_figur_nummer, fig.figNumber)),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.primary, fontWeight = FontWeight.SemiBold)
                // Die Nummer steht schon darüber; ohne Namen dieselbe Nummer noch einmal sah wie ein Name aus.
                val figName = fig.figName
                if (figName != null) {
                    Text(katalogName(figName),
                        style = MaterialTheme.typography.bodySmall,
                        fontWeight = FontWeight.Medium,
                        maxLines = if (grosseSchrift()) 3 else 2, overflow = TextOverflow.Ellipsis)
                } else {
                    Text(stringResource(R.string.name_unknown), style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                // Gemeinsamer Helfer (util/DatumFormat.kt): Er kommt auch mit Zeitstempeln ohne
                // Millisekunden zurecht.
                val dateLabel = remember(fig.setAddedAt) {
                    fmtTag(fig.setAddedAt, DatumJahr.KURZ)
                }
                if (dateLabel != null)
                    Text(dateLabel, style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
    }
}

/**
 * Eine Figur als Tabellenzeile: Bild, Nummer, Name, Menge, Erfassungsdatum — was
 * die Tabelle der Webapp zeigt (renderFigs in 06-minifigs.js). Keine Spalten
 * „Quelle“ und Papierkorb: Diese Liste lädt nur `source=set`, beide wären
 * konstant.
 */
@Composable
internal fun MinifigTableRow(fig: FigurAnsicht, serverUrl: String, imageLoader: ImageLoader,
                    onClick: (() -> Unit)? = null) {
    val (bildUrl, onFehler) = rememberTileImageWithFallback(
        serverUrl, fig.imageLocal, fig.imageUrl, fullViaProxy = true)
    TabellenZeile(
        bildUrl = bildUrl,
        nummer = fig.figNumber,
        name = fig.figName,
        menge = fig.totalQuantity ?: fig.quantity,
        imageLoader = imageLoader,
        zweiteZeile = fmtTag(fig.setAddedAt),
        onBildFehler = onFehler,
        onClick = onClick,
    )
}
