package ch.brickinventoryapp.collection.ui.screens

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Alarm
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.NotificationsActive
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import ch.brickinventoryapp.model.domain.AlarmDirection
import ch.brickinventoryapp.model.domain.Condition
import ch.brickinventoryapp.model.domain.WantedItemView
import ch.brickinventoryapp.model.util.resolveThumbUrl
import ch.brickinventoryapp.resources.R
import ch.brickinventoryapp.shared.ui.InfoBadge
import ch.brickinventoryapp.ui.components.ProductImage
import ch.brickinventoryapp.ui.theme.Shapes
import ch.brickinventoryapp.ui.theme.Spacing
import ch.brickinventoryapp.ui.util.fmtMoney

@OptIn(ExperimentalLayoutApi::class)
@Composable
internal fun WantedItemRow(
    w: WantedItemView, serverUrl: String, imageLoader: coil3.ImageLoader,
    chosen: Boolean,
    onOpen: () -> Unit,
    /** In the grid with neighbors: force equal height. Not on the phone — there a blank line stayed. */
    multiColumn: Boolean = false,
) {
    // The whole card opens the detail — like the tile in the gallery. It
    // carries no button, so it does the same thing across its whole surface;
    // taking over and deleting live in the detail. If the detail sits next to it,
    // the open card carries a border in the main color.
    Card(
        Modifier.fillMaxWidth()
            .semantics { selected = chosen }
            .clickable(role = Role.Button, onClick = onOpen),
        border = if (chosen) BorderStroke(2.dp, MaterialTheme.colorScheme.primary) else null,
        // The same card as gallery and finances (AppCard): the gray surface of the
        // default card was a third card style for the same level.
        shape = Shapes.card,
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        elevation = CardDefaults.cardElevation(defaultElevation = Shapes.cardElevation),
    ) {
        // Without a price in the cache, the price job hasn't run since it was entered. "Price
        // coming" then sits in the row with number and year: alone at the bottom right it left
        // an empty line in the card.
        val price = w.marketPrice
        Column(Modifier.padding(Spacing.medium), verticalArrangement = Arrangement.spacedBy(Spacing.tiny)) {
            Row(horizontalArrangement = Arrangement.spacedBy(Spacing.small),
                verticalAlignment = Alignment.CenterVertically) {
                ProductImage(
                    model = resolveThumbUrl(serverUrl, w.imageLocal, w.imageUrl),
                    contentDescription = null,
                    imageLoader = imageLoader,
                    modifier = Modifier.size(Spacing.huge + Spacing.veryLarge).clip(MaterialTheme.shapes.small),
                    fallbackSize = 28.dp,
                    imageBackground = true,
                )
                Column(Modifier.weight(1f)) {
                    // No name means: the catalog doesn't know the set. Named for the
                    // reason that the watchlist keeps no second
                    // copy of the core data (migration 0021).
                    // Always room for two lines as in the gallery: in the tablet grid, a
                    // card with a short name used to sit lower than its neighbors.
                    Text(w.name ?: w.setNumber, fontWeight = FontWeight.SemiBold, minLines = if (multiColumn) 2 else 1, maxLines = 2,
                        overflow = TextOverflow.Ellipsis)
                    Text(
                        listOfNotNull(
                            w.setNumber,
                            w.year?.toString(),
                            stringResource(if (w.condition == Condition.USED) R.string.condition_used
                                           else R.string.condition_new),
                            if (price == null) stringResource(R.string.detail_price_none_yet) else null,
                        ).joinToString(" · "),
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
            // FlowRow: at large font size, the price moves under the badges instead of squeezing them.
            // Minimum badge height, even without content: cards with and without a badge are the same height.
            FlowRow(if (multiColumn) Modifier.heightIn(min = 32.dp) else Modifier,
                    horizontalArrangement = Arrangement.spacedBy(Spacing.small),
                    verticalArrangement = Arrangement.spacedBy(Spacing.tiny)) {
                w.alarm?.let { a ->
                    InfoBadge(
                        stringResource(if (a.direction == AlarmDirection.OVER) R.string.wanted_alert_above else R.string.wanted_alert_below,
                                       fmtMoney(a.threshold, w.currency)),
                        icon = if (a.triggered) Icons.Default.NotificationsActive else Icons.Default.Alarm,
                    )
                }
                // "Do I have this by now?" means the BLICKFELD: for a
                // grandfather account, "I have it" also means "the sub-account has it".
                if (w.owned) InfoBadge(stringResource(R.string.wanted_owned), icon = Icons.Default.Check)
                Spacer(Modifier.weight(1f))
                // Market price instead of a button: taking it into the collection happens in the watchlist-item detail.
                if (price != null) {
                    Text(fmtMoney(price, w.currency), fontWeight = FontWeight.Bold,
                         maxLines = 1, softWrap = false, modifier = Modifier.align(Alignment.CenterVertically))
                }
            }
        }
    }
}

/** Minimum width of a watchlist column. */
internal val WANTED_COLUMN = 340.dp
