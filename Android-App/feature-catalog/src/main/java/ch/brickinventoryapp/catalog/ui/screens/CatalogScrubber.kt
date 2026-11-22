package ch.brickinventoryapp.catalog.ui.screens

import androidx.compose.foundation.focusable
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.gestures.detectVerticalDragGestures
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.grid.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.input.key.Key
import androidx.compose.ui.input.key.KeyEvent
import androidx.compose.ui.input.key.KeyEventType
import androidx.compose.ui.input.key.key
import androidx.compose.ui.input.key.onKeyEvent
import androidx.compose.ui.input.key.type
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.onClick
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import ch.brickinventoryapp.catalog.ui.CatalogYearMath
import ch.brickinventoryapp.model.domain.YearCountView
import ch.brickinventoryapp.resources.R
import ch.brickinventoryapp.ui.theme.LocalIsBrickTheme
import ch.brickinventoryapp.ui.theme.Shapes
import ch.brickinventoryapp.ui.util.fmtInt

/**
 * The year bar on the right edge, as in the web app. Position is the spot in
 * the list, not a linearly distributed year: the catalog comes mostly from
 * the last few decades, and the label should show the year that's actually at
 * that spot (CatalogYearMath.yearAnPosition). As a Row, so the
 * label can stick out over the tiles without catching touches.
 */
@Composable
internal fun YearScrubber(
    /** The spot in the list the display is currently at (0 .. total-1). */
    listNumber: Int,
    total: Int,
    distribution: List<YearCountView>,
    /** Year of the tile at a running number — null if not loaded. */
    yearLoaded: (Int) -> Int?,
    /** Dragging: scroll to this spot. Runs during the movement, not only at the end. */
    onScrollTo: (Int) -> Unit,
    modifier: Modifier = Modifier
) {
    var dragging by remember { mutableStateOf(false) }
    var dragShare by remember { mutableStateOf(0f) }
    var heightPx by rememberSaveable { mutableStateOf(1) }
    var jumpMenu by rememberSaveable { mutableStateOf(false) }
    val thumbHeightPx = with(LocalDensity.current) { HANDLE_HEIGHT.roundToPx() }

    // While dragging, the handle shows WHERE it's going; otherwise, WHERE the list is.
    val share = if (dragging) dragShare else CatalogYearMath.shareFromNumber(listNumber, total)
    val thumbOffsetY = CatalogYearMath.thumbOffset(share, heightPx, thumbHeightPx)
    val tag = CatalogYearMath.yearFor(share, total, distribution, yearLoaded)

    /** Touch → share → scroll, as in `js/rollbalken.js`. */
    fun roles(y: Float) {
        dragShare = CatalogYearMath.shareFrom(y, heightPx, thumbHeightPx)
        onScrollTo(CatalogYearMath.numberFrom(dragShare, total))
    }

    val jumpName = stringResource(R.string.catalog_year_jump)
    Row(modifier) {
        // Label track — only visible while dragging, catches no touches.
        Box(Modifier.fillMaxHeight()) {
            if (dragging && tag != null) YearLabel(tag, thumbOffsetY)
        }

        // 48 dp track like every tap target; dragging is only one of the paths. TalkBack and
        // keyboard open a jump menu with the years, because a gesture alone was
        // unreachable for them.
        Box(
            Modifier
                .width(TRACK_WIDTH)
                .fillMaxHeight()
                .onSizeChanged { heightPx = it.height }
                .semantics {
                    contentDescription = jumpName
                    role = Role.Button
                    onClick { jumpMenu = true; true }
                }
                .focusable()
                .onKeyEvent { e -> e.opensMenu().also { if (it) jumpMenu = true } }
                .pointerInput(total) {
                    detectVerticalDragGestures(
                        onDragStart = { offset -> dragging = true; roles(offset.y) },
                        onVerticalDrag = { change, _ -> change.consume(); roles(change.position.y) },
                        onDragEnd = { dragging = false },
                        onDragCancel = { dragging = false }
                    )
                }
                .pointerInput(total) {
                    // Tapped next to the handle: jump there — as with a
                    // regular scrollbar.
                    detectTapGestures { offset -> roles(offset.y) }
                }
        ) {
            ScrubberHandle(thumbOffsetY, dragging)
            YearJumpMenu(jumpMenu, distribution, onClose = { jumpMenu = false }) { number ->
                jumpMenu = false
                onScrollTo(number.coerceIn(0, (total - 1).coerceAtLeast(0)))
            }
        }
    }
}

/** The year at the handle while dragging. */
@Composable
private fun YearLabel(tag: Int, thumbOffsetY: Int) {
    Surface(
        color = MaterialTheme.colorScheme.surface,
        contentColor = MaterialTheme.colorScheme.onSurface,
        shape = Shapes.brand,
        shadowElevation = 3.dp,
        modifier = Modifier
            .offset { IntOffset(0, thumbOffsetY) }
            .padding(end = 6.dp)
    ) {
        Text(
            "$tag",
            fontWeight = FontWeight.SemiBold, style = MaterialTheme.typography.bodyMedium,
            modifier = Modifier.padding(horizontal = 10.dp, vertical = 3.dp)
        )
    }
}

/** Rail and handle; the handle follows the list, opaque so it stands out on every tile. */
@Composable
private fun BoxScope.ScrubberHandle(thumbOffsetY: Int, dragging: Boolean) {
    // Rail
    Surface(
        color = MaterialTheme.colorScheme.outline.copy(alpha = 0.25f),
        shape = Shapes.stroke,
        modifier = Modifier
            .align(Alignment.CenterEnd)
            .padding(end = 11.dp, top = 6.dp, bottom = 6.dp)
            .width(3.dp)
            .fillMaxHeight()
    ) {}

    // Handle — opaque, so it stands out on every tile; follows the list.
    Surface(
        color = MaterialTheme.colorScheme.primary,
        shape = RoundedCornerShape(topStart = 12.dp, bottomStart = 12.dp),
        shadowElevation = if (dragging) 3.dp else 1.dp,
        modifier = Modifier
            .align(Alignment.TopEnd)
            .offset { IntOffset(0, thumbOffsetY) }
    ) {
        Box(Modifier.width(HANDLE_WIDTH).height(HANDLE_HEIGHT), Alignment.Center) {
            if (LocalIsBrickTheme.current) {
                // Brick design: handle as a stud (lighter stud dot)
                Surface(
                    color = MaterialTheme.colorScheme.onPrimary.copy(alpha = 0.55f),
                    shape = androidx.compose.foundation.shape.CircleShape,
                    modifier = Modifier.size(8.dp)
                ) {}
            } else {
                Icon(
                    Icons.Default.UnfoldMore, null,
                    tint = MaterialTheme.colorScheme.onPrimary,
                    modifier = Modifier.size(16.dp)
                )
            }
        }
    }
}

/** The distribution's years to tap on; also selectable with TalkBack and keyboard. */
@Composable
private fun YearJumpMenu(
    open: Boolean,
    distribution: List<YearCountView>,
    onClose: () -> Unit,
    onJump: (Int) -> Unit,
) {
    DropdownMenu(expanded = open, onDismissRequest = onClose) {
        for (entry in distribution) {
            val year = entry.year ?: continue
            val number = CatalogYearMath.numberOfYear(year, distribution) ?: continue
            DropdownMenuItem(
                text = { Text("$year") },
                trailingIcon = {
                    Text(pluralStringResource(R.plurals.gallery_stat_sets, entry.n, fmtInt(entry.n)),
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant)
                },
                onClick = { onJump(number) },
            )
        }
    }
}

/** Enter, space bar, or the center of the D-pad open the jump menu. */
private fun KeyEvent.opensMenu(): Boolean =
    type == KeyEventType.KeyUp && (key == Key.Enter || key == Key.Spacebar || key == Key.DirectionCenter)

/** Width of the tap track: the minimum size of a tap target. */
internal val TRACK_WIDTH = 48.dp

private val HANDLE_WIDTH = 24.dp
private val HANDLE_HEIGHT = 48.dp
