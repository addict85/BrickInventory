package ch.brickinventoryapp.parts.ui.screens

import ch.brickinventoryapp.model.domain.Herkunft
import ch.brickinventoryapp.model.domain.Waehrung
import androidx.compose.material3.Button
import ch.brickinventoryapp.ui.components.focusFrame
import ch.brickinventoryapp.model.domain.FigurAnsicht
import ch.brickinventoryapp.model.domain.ManualMinifigView
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
import ch.brickinventoryapp.resources.R
import ch.brickinventoryapp.ui.theme.Abstaende
import ch.brickinventoryapp.ui.components.stueckzahl
import ch.brickinventoryapp.ui.components.readAloudAs
import ch.brickinventoryapp.ui.components.ProduktBild
import ch.brickinventoryapp.ui.components.largeFont
import ch.brickinventoryapp.ui.components.catalogName
import ch.brickinventoryapp.model.util.DateYear
import ch.brickinventoryapp.ui.util.fmtTag
import ch.brickinventoryapp.shared.ui.ConditionBadges
import ch.brickinventoryapp.shared.ui.ManuelleKachel
import ch.brickinventoryapp.shared.ui.OwnerBadges
import ch.brickinventoryapp.shared.ui.TabellenZeile
import ch.brickinventoryapp.shared.ui.mengeAusSet

@Composable
internal fun ManualFigTile(fig: ManualMinifigView, serverUrl: String, imageLoader: ImageLoader,
                  waehrung: Waehrung, onEdit: () -> Unit) {
    // Thumbnail with a fallback to full resolution — see
    // util/BildRueckfall.kt, rememberTileImageWithFallback().
    val (bild, onBildFehler) =
        rememberTileImageWithFallback(serverUrl, fig.imageLocal, fig.imageUrl, fullViaProxy = true)
    // Everything else lives in ManuelleKachel (ManualItemComposables.kt), which the
    // parts also use — so that condition and owner badges are not maintained in only
    // one twin.
    ManuelleKachel(
        bildUrl = bild,
        onBildFehler = onBildFehler,
        imageLoader = imageLoader,
        name = fig.figName ?: fig.figNumber,
        menge = fig.quantity,
        states = fig.conditions,
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
        // Tapping opens the detail dialog — as with the parts next to it.
        modifier = Modifier.fillMaxWidth().heightIn(min = 196.dp)
            .semantics { selected = ausgewaehlt }
            .then(if (ausgewaehlt) Modifier.border(2.dp, MaterialTheme.colorScheme.primary, Formen.leiste) else Modifier)
            .let { if (onClick != null) it.focusFrame(Formen.leiste).clickable(role = Role.Button, onClick = onClick) else it },
        shape = Formen.leiste,
        elevation = CardDefaults.cardElevation(defaultElevation = Formen.karteErhebung),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface)
    ) {
        Column {
            Box(Modifier.fillMaxWidth().height(110.dp)) {
                // Thumbnail with a fallback to full resolution — see
                // util/BildRueckfall.kt, rememberTileImageWithFallback().
                val (figImg, onFigImgError) = rememberTileImageWithFallback(serverUrl, fig.imageLocal, fig.imageUrl, fullViaProxy = true)
                ProduktBild(
                    model = figImg,
                    imageLoader = imageLoader,
                    // Without a description: the name stands below it, TalkBack would otherwise read it twice.
                    contentDescription = null,
                    onState = { st ->
                        if (st is coil3.compose.AsyncImagePainter.State.Error) onFigImgError()
                    },
                    modifier = Modifier.fillMaxSize()
                        .clip(Formen.kachelBildEcken),
                    contentScale = ContentScale.Fit,
                    // Image background across the whole tile width as with sets and parts: the tall
                    // figure image otherwise stood narrow in the middle with white margins.
                    bildgrund = true,
                    innerGap = Abstaende.tiny,
                )
                if (qty > 1) {
                    Surface(
                        color = MaterialTheme.colorScheme.primary,
                        shape = Formen.marke,
                        modifier = Modifier.align(Alignment.TopEnd).padding(Abstaende.tiny)
                    ) {
                        // The quantity badge: "×N" on a manually entered tile, "N×" on
                        // a tile from a set — the web app's rule (`man-tile` with
                        // `qbadge` ×N, `part-card` with `part-qty` N×).
                        Text(mengeAusSet(qty), Modifier.padding(horizontal = 5.dp, vertical = Abstaende.hairline)
                            .readAloudAs(stueckzahl(qty)),
                            color = MaterialTheme.colorScheme.onPrimary,
                            style = MaterialTheme.typography.labelSmall, fontWeight = FontWeight.Bold)
                    }
                }
                // Condition only for manually entered minifigures (ones taken over from sets have none
                // of their own). The owner badge, however, always: "whose is this?" comes up just
                // the same for a figure from a child's set, and this list only loads
                // `source=set`. Without a household, `owners` is empty and OwnerBadges returns
                // right away. Column instead of Box: two badges stacked, not at the same point.
                Column(Modifier.align(Alignment.BottomStart).padding(Abstaende.tiny),
                    verticalArrangement = Arrangement.spacedBy(Abstaende.hairline)) {
                    if (fig.source == Herkunft.MANUELL) ConditionBadges(fig.conditions, fig.condition)
                    OwnerBadges(fig.owners)
                }
                if (fig.source == Herkunft.MANUELL) {
                    Surface(
                        color = MaterialTheme.colorScheme.tertiaryContainer,
                        shape = Formen.marke,
                        modifier = Modifier.align(Alignment.TopStart).padding(Abstaende.tiny)
                    ) {
                        Text(stringResource(R.string.minifigs_manual_badge), Modifier.padding(horizontal = 5.dp, vertical = Abstaende.hairline),
                            color = MaterialTheme.colorScheme.onTertiaryContainer,
                            style = MaterialTheme.typography.labelSmall, fontWeight = FontWeight.Bold)
                    }
                }
            }
            Column(Modifier.padding(Abstaende.klein), verticalArrangement = Arrangement.spacedBy(1.dp)) {
                Text(fig.figNumber, Modifier.readAloudAs(stringResource(R.string.cd_figur_nummer, fig.figNumber)),
                    style = MaterialTheme.typography.bodySmall,
                    // A number, not a link: primary blue is for what can be tapped.
                    color = MaterialTheme.colorScheme.onSurfaceVariant, fontWeight = FontWeight.SemiBold)
                // The number already stands above it; without a name, the same number again looked like a name.
                val figName = fig.figName
                if (figName != null) {
                    Text(catalogName(figName),
                        style = MaterialTheme.typography.bodySmall,
                        fontWeight = FontWeight.Medium,
                        maxLines = if (largeFont()) 3 else 2, overflow = TextOverflow.Ellipsis)
                } else {
                    Text(stringResource(R.string.name_unknown), style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                // A shared helper (util/DatumFormat.kt): it also handles timestamps without
                // milliseconds.
                val dateLabel = remember(fig.setAddedAt) {
                    fmtTag(fig.setAddedAt, DateYear.SHORT)
                }
                if (dateLabel != null)
                    Text(dateLabel, style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
    }
}

/**
 * A figure as a table row: image, number, name, quantity, entry date — what
 * the web app's table shows (renderFigs in minifigs.js). No columns
 * for "source" or trash can: this list only loads `source=set`, and both would be
 * constant.
 */
@Composable
internal fun MinifigTableRow(fig: FigurAnsicht, serverUrl: String, imageLoader: ImageLoader,
                    onClick: (() -> Unit)? = null) {
    val (bildUrl, onError) = rememberTileImageWithFallback(
        serverUrl, fig.imageLocal, fig.imageUrl, fullViaProxy = true)
    TabellenZeile(
        bildUrl = bildUrl,
        nummer = fig.figNumber,
        name = fig.figName,
        menge = fig.totalQuantity ?: fig.quantity,
        imageLoader = imageLoader,
        secondRow = fmtTag(fig.setAddedAt),
        onBildFehler = onError,
        onClick = onClick,
    )
}
