package ch.brickinventoryapp.shared.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import ch.brickinventoryapp.model.domain.AccountView
import ch.brickinventoryapp.model.domain.Condition
import ch.brickinventoryapp.model.domain.CurrencyCode
import ch.brickinventoryapp.model.domain.Money
import ch.brickinventoryapp.model.domain.PurchaseView
import ch.brickinventoryapp.resources.R
import ch.brickinventoryapp.ui.components.ProductImage
import ch.brickinventoryapp.ui.components.SmallerButton
import ch.brickinventoryapp.ui.components.WithTooltip
import ch.brickinventoryapp.ui.components.announce
import ch.brickinventoryapp.ui.components.largeFont
import ch.brickinventoryapp.ui.components.movementReduced
import ch.brickinventoryapp.ui.components.quantity
import ch.brickinventoryapp.ui.components.readAloudAs
import ch.brickinventoryapp.ui.components.secondaryButtonColors
import ch.brickinventoryapp.ui.components.secondaryButtonRand
import ch.brickinventoryapp.ui.components.withFont
import ch.brickinventoryapp.ui.theme.BrickSay
import ch.brickinventoryapp.ui.theme.BrickSayText
import ch.brickinventoryapp.ui.theme.LocalIsBrickTheme
import ch.brickinventoryapp.ui.theme.Shapes
import ch.brickinventoryapp.ui.theme.Spacing
import ch.brickinventoryapp.ui.util.NumericInput
import ch.brickinventoryapp.ui.util.fmtMoney
import coil3.ImageLoader
import coil3.request.ImageRequest
import coil3.request.crossfade

/**
 * Shared composables for manually captured parts AND minifigs.
 * Both types have identical acquisition logic — no code duplication.
 */

// ── Compact read-only acquisition summary (as in the set detail) ─────────────────

@Composable
fun AcquisitionSummarySection(
    acquisitions: List<PurchaseView>,
    currency: CurrencyCode,
    onEditPrices: () -> Unit
) {
    // With large text, the purchases go UNDER the label: next to it there was
    // so little width left for „CHF 700.00“ that the amount wrapped digit by digit.
    val stacked = largeFont()
    val alignment = if (stacked) Alignment.Start else Alignment.End
    val purchases: @Composable () -> Unit = {
        Column(horizontalAlignment = alignment) {
            if (acquisitions.isEmpty()) {
                Text(stringResource(R.string.detail_purchase_none), style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant)
            } else {
                acquisitions.forEach { acq -> PurchaseRow(acq, currency) }
            }
            Spacer(Modifier.height(Spacing.tiny))
            // Visibly small below the purchases, tapped in 48 dp.
            SmallerButton(onClick = onEditPrices,
                form = ButtonDefaults.outlinedShape,
                surface = Modifier.heightIn(min = 28.dp),
                contentColor = secondaryButtonColors().contentColor,
                edge = secondaryButtonRand(),
                inner = PaddingValues(horizontal = 10.dp, vertical = Spacing.hairline)) {
                Icon(Icons.Default.Edit, null, Modifier.size(withFont(14.dp)))
                Spacer(Modifier.width(Spacing.tiny))
                Text(stringResource(R.string.detail_edit_prices), style = MaterialTheme.typography.labelMedium)
            }
        }
    }
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.tiny)) {
        val name: @Composable () -> Unit = {
            Text(
                stringResource(R.string.detail_purchase_price),
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(top = Spacing.hairline)
            )
        }
        if (stacked) {
            name()
            purchases()
        } else Row(
            Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.Top
        ) {
            name()
            purchases()
        }
        HorizontalDivider()
    }
}

/**
 * A purchase: quantity, condition, amount. FlowRow, so the amount, with little space, moves
 * to the next line as a whole; it itself never wraps.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun PurchaseRow(acq: PurchaseView, currency: CurrencyCode) {
    FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        val middle = Modifier.align(Alignment.CenterVertically)
        Text(quantityManual(acq.quantity), middle.readAloudAs(quantity(acq.quantity)),
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant)
        Box(middle) { ConditionBadge(acq.condition) }
        // Without an amount, the row says none is captured; otherwise „×2 Neu“ stood there alone.
        val price = acq.effectivePrice
        if (price != null) {
            Text(fmtMoney(price, currency), fontWeight = FontWeight.SemiBold, style = MaterialTheme.typography.bodyMedium,
                maxLines = 1, softWrap = false, modifier = middle)
        } else {
            Text(stringResource(R.string.detail_purchase_none), style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = middle)
        }
    }
}

// ── Condition badge (shared by sets, parts, figs) ────────────────────────────

/**
 * One badge per captured condition. `condition` is an aggregate with a single value
 * and would hide the new-condition entry next to a used one. Which ones exist
 * is decided by the server (`conditions`); older responses without the field fall back to
 * `condition`.
 */
@Composable
fun ConditionBadges(conditions: List<Condition>, fallback: Condition? = null) {
    val list = if (conditions.isNotEmpty()) conditions else listOf(fallback ?: Condition.NEW)
    Row(horizontalArrangement = Arrangement.spacedBy(3.dp)) {
        list.forEach { ConditionBadge(it) }
    }
}

@Composable
fun ConditionBadge(condition: Condition) {
    val isUsed = condition == Condition.USED
    // Sage only in the light stone theme: in the dark theme, the light pill glowed on the dark card.
    val isBrick = LocalIsBrickTheme.current && MaterialTheme.colorScheme.surface.luminance() > 0.5f
    val bgColor = when {
        isUsed  -> MaterialTheme.colorScheme.secondaryContainer
        isBrick -> BrickSay
        else    -> MaterialTheme.colorScheme.primaryContainer
    }
    val fgColor = when {
        isUsed  -> MaterialTheme.colorScheme.onSecondaryContainer
        isBrick -> BrickSayText
        else    -> MaterialTheme.colorScheme.onPrimaryContainer
    }
    Surface(
        shape = Shapes.tag,
        color = bgColor
    ) {
        Text(
            if (isUsed) stringResource(R.string.condition_used) else stringResource(R.string.condition_new),
            Modifier.padding(horizontal = 6.dp, vertical = 1.dp),
            style = MaterialTheme.typography.labelSmall,
            fontWeight = FontWeight.SemiBold,
            color = fgColor
        )
    }
}

/**
 * Replacement-part badge in the shape of [ConditionBadge], but in a calm
 * fill color: a replacement part is secondary information, not a condition.
 */
@Composable
fun SparePartBadge(modifier: Modifier = Modifier) {
    Surface(shape = Shapes.tag, color = MaterialTheme.colorScheme.surfaceVariant, modifier = modifier) {
        Text(
            stringResource(R.string.parts_spare_tag),
            Modifier.padding(horizontal = 6.dp, vertical = 1.dp),
            style = MaterialTheme.typography.labelSmall,
            fontWeight = FontWeight.SemiBold,
            color = MaterialTheme.colorScheme.onSurfaceVariant
        )
    }
}

/**
 * A piece of information in chip form, not tappable: an AssistChip with an empty
 * onClick looked like a button, was read out as a button, and did nothing.
 */
@Composable
fun InfoBadge(text: String, modifier: Modifier = Modifier, icon: androidx.compose.ui.graphics.vector.ImageVector? = null) {
    Surface(shape = Shapes.chip, color = MaterialTheme.colorScheme.secondaryContainer,
            contentColor = MaterialTheme.colorScheme.onSecondaryContainer, modifier = modifier) {
        Row(Modifier.padding(horizontal = Spacing.small, vertical = Spacing.tiny),
            verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Spacing.tiny)) {
            if (icon != null) Icon(icon, null, Modifier.size(withFont(16.dp)))
            Text(text, style = MaterialTheme.typography.labelMedium)
        }
    }
}

// Only building blocks here that both the set detail and ManualItemDetailScreen use
// (AcquisitionSummarySection, ConditionBadge(s), purchase-price editor), so both pages
// show purchase prices the same way.

/**
 * The footer of a tile for a manually captured entry: the price, as on
 * the web app's `man-tile` and in the same order:
 *
 *   avg_purchase_price ?? unit_price ?? purchase_price
 *
 * The first is quantity-weighted across all captured purchases; the second is only the most recently
 * written single price.
 *
 * @param preis    raw amount; null = none stored, then it says „noch kein Preis“
 * @param waehrung currency code from settings
 */
@Composable
fun ManualTileFooter(price: Money?, currency: CurrencyCode) {
    Text(
        if (price != null) fmtMoney(price, currency) else stringResource(R.string.detail_price_none_yet),
        style = MaterialTheme.typography.bodySmall,
        fontWeight = FontWeight.Bold,
        color = MaterialTheme.colorScheme.onSurface,
        maxLines = 1,
        overflow = TextOverflow.Ellipsis,
        modifier = Modifier.padding(top = Spacing.hairline),
    )
}

/**
 * Quantity, purchase price and condition — what every manual capture has, whether part or
 * figure; one implementation, so both dialogs look alike. The state stays
 * with the caller in `rememberSaveable`, so it survives a rotation. The number
 * stays outside: it's the real difference between the two dialogs.
 */
@Composable
fun EntryFields(
    count: String,
    onCount: (String) -> Unit,
    /** What is being counted („quantity of identical parts“). */
    countHint: String,
    price: String,
    onPrice: (String) -> Unit,
    condition: Condition,
    onUiState: (Condition) -> Unit,
    /**
     * Storage location and its stock — here, because it belongs to the same block as the other
     * capture fields.
     */
    storageLocation: String = "",
    onLocation: (String) -> Unit = {},
    storageLocations: List<String> = emptyList(),
) {
    CountField(count, onCount, countHint)
    PurchasePriceField(price, onPrice, stringResource(R.string.common_unit_price))
    ConditionRow(condition = condition, onUiState = onUiState)
    StorageLocationEntry(storageLocation, storageLocations, onLocation)
}

/**
 * The quantity field of every capture, always with a help line: without it the fields
 * stood unevenly spaced apart, and one dialog left an empty gap.
 */
@Composable
fun CountField(value: String, onValue: (String) -> Unit, hint: String) {
    OutlinedTextField(
        value = value, onValueChange = { onValue(NumericInput.quantity(it)) },
        label = { Text(stringResource(R.string.common_quantity)) },
        isError = NumericInput.quantityInvalid(value),
        supportingText = {
            if (NumericInput.quantityInvalid(value)) Text(stringResource(R.string.record_quantity_invalid), Modifier.announce())
            else Text(hint)
        },
        modifier = Modifier.fillMaxWidth(), singleLine = true,
        shape = Shapes.field,
        keyboardOptions = NumericInput.integerKeyboard(),
    )
}

/**
 * The purchase-price field of every capture. The hint sits as a help line instead of a
 * placeholder: that one disappeared on the first keystroke.
 */
@Composable
fun PurchasePriceField(value: String, onValue: (String) -> Unit, label: String, onDone: (() -> Unit)? = null) {
    OutlinedTextField(
        value = value, onValueChange = { onValue(NumericInput.price(it)) },
        label = { Text(label) },
        isError = NumericInput.priceInvalid(value),
        supportingText = {
            if (NumericInput.priceInvalid(value)) Text(stringResource(R.string.record_price_invalid), Modifier.announce())
            else Text(stringResource(R.string.common_unit_price_placeholder))
        },
        modifier = Modifier.fillMaxWidth(), singleLine = true,
        shape = Shapes.field,
        keyboardOptions = NumericInput.priceKeyboard(),
        keyboardActions = if (onDone != null) KeyboardActions(onDone = { onDone() }) else KeyboardActions.Default,
    )
}

/**
 * The tile of a manually captured part or figure — one implementation, so
 * badges and footer don't need to be ported in just one of them. Only the
 * three differences go in (color dot, color row, label); size, shape, placeholder image
 * and order belong to the tile.
 */
@Composable
fun ManualTile(
    imageUrl: String?,
    onImageError: () -> Unit,
    imageLoader: ImageLoader,
    name: String,
    quantity: Int,
    states: List<Condition>,
    condition: Condition?,
    owner: List<AccountView>,
    price: Money?,
    currency: CurrencyCode,
    onEdit: () -> Unit,
    color: Color? = null,
    colorName: String? = null,
) {
    val ctx = LocalContext.current
    Card(
        onClick = onEdit,  // whole card clickable — opens the purchase-price/quantity dialog, like sets
        modifier = Modifier.width(Shapes.tileWidth).heightIn(min = Shapes.tileHeight),
        shape = Shapes.bar,
        elevation = CardDefaults.cardElevation(defaultElevation = Shapes.cardElevation),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
    ) {
        Column {
            Box(Modifier.fillMaxWidth().height(76.dp)) {
                ProductImage(
                    model = imageUrl?.let { ImageRequest.Builder(ctx).data(it).crossfade(!movementReduced()).build() },
                    imageLoader = imageLoader,
                    // Without a description: the name sits below it, TalkBack would otherwise read it twice.
                    contentDescription = null,
                    onState = { st ->
                        if (st is coil3.compose.AsyncImagePainter.State.Error) onImageError()
                    },
                    modifier = Modifier.fillMaxSize().clip(Shapes.tileImageCorners),
                    contentScale = ContentScale.Fit,
                    fallbackSize = 28.dp,
                )
                Surface(
                    color = MaterialTheme.colorScheme.primary,
                    shape = Shapes.brand,
                    modifier = Modifier.align(Alignment.TopEnd).padding(3.dp),
                ) {
                    // The quantity badge: „×N" on a MANUALLY captured tile,
                    // „N×" on a tile from a set. That's not a whim,
                    // but the web app's rule — there, `man-tile` carries a
                    // `qbadge` with ×N, `part-card` a `part-qty` with N×.
                    Text(quantityManual(quantity), Modifier.padding(horizontal = Spacing.tiny, vertical = 1.dp).readAloudAs(quantity(quantity)),
                        color = MaterialTheme.colorScheme.onPrimary,
                        style = MaterialTheme.typography.labelSmall, fontWeight = FontWeight.Bold)
                }
                if (color != null) {
                    Box(Modifier.size(12.dp).align(Alignment.BottomStart).padding(3.dp)
                        .clip(CircleShape).background(color))
                }
                Row(Modifier.align(Alignment.TopStart).padding(Spacing.hairline)) {
                    WithTooltip(stringResource(R.string.common_edit)) {
                        IconButton(onClick = onEdit) {
                            Icon(Icons.Default.Edit, stringResource(R.string.common_edit),
                                Modifier.size(14.dp), tint = MaterialTheme.colorScheme.primary)
                        }
                    }
                }
                // No trash icon on the tile: the card opens the detail, and it sits there
                // in the same spot as for the set.
            }
            Column(Modifier.padding(horizontal = 6.dp, vertical = Spacing.tiny)) {
                Text(name, style = MaterialTheme.typography.bodySmall,
                    fontWeight = FontWeight.SemiBold, maxLines = 2, overflow = TextOverflow.Ellipsis)
                if (colorName != null) {
                    Text(colorName, style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        maxLines = 1, overflow = TextOverflow.Ellipsis)
                }
                Box(Modifier.padding(top = 3.dp)) { ConditionBadges(states, condition) }
                // Who owns the entry? The server only attaches owners when
                // several accounts are in the Blickfeld — in a single account, „gehört mir" would sit on
                // every single tile.
                OwnerBadges(owner, Modifier.padding(top = Spacing.hairline))
                ManualTileFooter(price = price, currency = currency)
            }
        }
    }
}
