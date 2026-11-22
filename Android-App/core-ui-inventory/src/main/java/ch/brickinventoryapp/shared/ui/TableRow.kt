package ch.brickinventoryapp.shared.ui

import ch.brickinventoryapp.model.domain.Condition
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.AnnotatedString
import coil3.compose.AsyncImagePainter
import ch.brickinventoryapp.ui.components.catalogName
import ch.brickinventoryapp.ui.components.focusFrame
import androidx.compose.ui.semantics.contentDescription
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
import androidx.compose.ui.platform.LocalContext
import coil3.ImageLoader
import coil3.request.ImageRequest
import coil3.request.crossfade
import ch.brickinventoryapp.resources.R
import ch.brickinventoryapp.ui.theme.Shapes
import ch.brickinventoryapp.ui.theme.Spacing
import ch.brickinventoryapp.ui.components.quantity
import ch.brickinventoryapp.ui.components.readAloudAs
import ch.brickinventoryapp.ui.components.ProductImage
import ch.brickinventoryapp.ui.components.SegmentChoice
import ch.brickinventoryapp.ui.components.movementReduced
import ch.brickinventoryapp.ui.util.fmtInt

/**
 * A row of the table view — for parts and figures, like the web app's two
 * identically built tables; one implementation, so they don't
 * drift apart. No real columns: seven columns would have to be scrolled sideways
 * on the phone, which is why the wide ones sit as a second row
 * below.
 *
 * @param imageUrl     preview image, or null
 * @param nummer      part or figure number (monospace)
 * @param name        label
 * @param menge       quantity shown on the right
 * @param farbe       color dot before the name (parts only)
 * @param secondRow category/sets resp. capture date, or null
 * @param onImageError fallback to the full resolution
 *         (rememberTileImageWithFallback)
 * @param onClick tapping the whole row, or null for „not clickable“
 * @param onClickLabel what tapping does, for voice output — otherwise it only
 *         says „double-tap to activate“. Defaults to null for callers without
 *         text of their own.
 */
@Composable
fun TableRow(
    imageUrl: String?,
    number: String,
    name: String?,
    quantity: Int,
    imageLoader: ImageLoader,
    modifier: Modifier = Modifier,
    color: Color? = null,
    secondRow: String? = null,
    onImageError: () -> Unit = {},
    onClick: (() -> Unit)? = null,
    onClickLabel: String? = null,
) {
    val ctx = LocalContext.current
    // onClick: both views open the same dialog as in the web app; one view
    // shouldn't do less than the other. `null` means not clickable.
    Surface(
        modifier = modifier.fillMaxWidth()
            .let {
                if (onClick != null) it.focusFrame(Shapes.tag).clickable(onClickLabel = onClickLabel, role = Role.Button, onClick = onClick)
                else it
            },
        color = MaterialTheme.colorScheme.surface,
    ) {
        Column {
            Row(
                Modifier.fillMaxWidth().padding(horizontal = 14.dp, vertical = Spacing.small),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                ProductImage(
                    model = imageUrl?.let { ImageRequest.Builder(ctx).data(it).crossfade(!movementReduced()).build() },
                    imageLoader = imageLoader,
                    // Without a description: the name sits next to it, TalkBack would otherwise read it twice.
                    contentDescription = null,
                    onState = { st ->
                        if (st is AsyncImagePainter.State.Error) onImageError()
                    },
                    modifier = Modifier.size(36.dp).clip(Shapes.tag),
                    contentScale = ContentScale.Fit,
                    fallbackSize = 20.dp,
                )
                TablesText(number, name, color, secondRow, Modifier.weight(1f))
                Text(
                    fmtInt(quantity),
                    Modifier.readAloudAs(quantity(quantity)),
                    fontFamily = FontFamily.Monospace,
                    fontWeight = FontWeight.Bold,
                    style = MaterialTheme.typography.bodyMedium,
                )
            }
            HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
        }
    }
}

/** Number with color dot, name and second row: the middle of a [TableRow]. */
@Composable
private fun TablesText(number: String, name: String?, color: Color?, secondRow: String?, modifier: Modifier) {
    Column(modifier) {
        Row(verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(5.dp)) {
            if (color != null) {
                Surface(color = color,
                    shape = CircleShape,
                    modifier = Modifier.size(10.dp)) {}
            }
            Text(
                number,
                fontFamily = FontFamily.Monospace,
                style = MaterialTheme.typography.bodySmall,
                fontWeight = FontWeight.Medium,
                // A number, not a link: primary blue is for what can be tapped.
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        }
        // Catalog names are in English; TalkBack pronounces them that way (catalogName).
        Text(
            name?.let { catalogName(it) } ?: AnnotatedString(stringResource(R.string.name_unknown)),
            color = if (name == null) MaterialTheme.colorScheme.onSurfaceVariant else MaterialTheme.colorScheme.onSurface,
            style = MaterialTheme.typography.bodySmall,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
        if (!secondRow.isNullOrBlank()) {
            Text(
                secondRow,
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        }
    }
}

/**
 * The condition row: label „Zustand“ and next to it new/used. One
 * implementation for all capture dialogs, so the same choice looks the same
 * everywhere and the label, with its fixed width, lines up flush.
 *
 */
@Composable
fun ConditionRow(
    condition: Condition,
    onUiState: (Condition) -> Unit,
    modifier: Modifier = Modifier,
    /** Durchgereicht an [ConditionToggle] — siehe dort. */
    options: List<Pair<Condition, Int>> = STATE_NEW_USED,
) {
    // From 130% text size the label sits above the choice: in the fixed column
    // next to it, „Zustan|d“ broke in the middle of the word.
    if (LocalDensity.current.fontScale > 1.3f) {
        Column(modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(Spacing.small)) {
            Text(stringResource(R.string.common_condition), style = MaterialTheme.typography.bodyMedium)
            ConditionToggle(selected = condition, onSelect = onUiState, options = options)
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
        Spacer(Modifier.width(Spacing.small))
        ConditionToggle(selected = condition, onSelect = onUiState, modifier = Modifier.weight(1f), options = options)
    }
}

/**
 * The default of [ConditionToggle] and [ConditionRow] — in one place,
 * so the two don't end up with different lists.
 */
val STATE_NEW_USED: List<Pair<Condition, Int>> =
    listOf(Condition.NEW to R.string.condition_new, Condition.USED to R.string.condition_used)

/**
 * New/used as two surfaces, next to the row that embeds it.
 */
@Composable
fun ConditionToggle(
    selected: Condition,
    onSelect: (Condition) -> Unit,
    modifier: Modifier = Modifier,
    /** Value → label, defaulting to „neu / gebraucht“. */
    options: List<Pair<Condition, Int>> = STATE_NEW_USED,
) {
    // The same segmented button as every single choice in the app (SegmentChoice): the
    // own implementation with borderless surfaces made „Gebraucht“ look like plain text.
    SegmentChoice(
        options = options.map { (value, text) -> value to stringResource(text) },
        chosen = selected,
        onChoice = onSelect,
        modifier = modifier,
    )
}
