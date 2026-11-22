package ch.brickinventoryapp.catalog.ui.screens

import ch.brickinventoryapp.model.domain.JahrAnzahlAnsicht
import ch.brickinventoryapp.ui.theme.Formen
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
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import ch.brickinventoryapp.catalog.ui.CatalogYearMath
import ch.brickinventoryapp.ui.theme.LocalIsBrickTheme
import ch.brickinventoryapp.resources.R
import ch.brickinventoryapp.ui.util.fmtInt
import androidx.compose.foundation.focusable
import androidx.compose.ui.input.key.Key
import androidx.compose.ui.input.key.KeyEvent
import androidx.compose.ui.input.key.KeyEventType
import androidx.compose.ui.input.key.key
import androidx.compose.ui.input.key.onKeyEvent
import androidx.compose.ui.input.key.type
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.onClick
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.semantics

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
    listenNummer: Int,
    total: Int,
    verteilung: List<JahrAnzahlAnsicht>,
    /** Year of the tile at a running number — null if not loaded. */
    jahrGeladen: (Int) -> Int?,
    /** Dragging: scroll to this spot. Runs during the movement, not only at the end. */
    onScrollTo: (Int) -> Unit,
    modifier: Modifier = Modifier
) {
    var dragging by remember { mutableStateOf(false) }
    var ziehAnteil by remember { mutableStateOf(0f) }
    var heightPx by rememberSaveable { mutableStateOf(1) }
    var sprungmenue by rememberSaveable { mutableStateOf(false) }
    val thumbHeightPx = with(LocalDensity.current) { HANDLE_HEIGHT.roundToPx() }

    // While dragging, the handle shows WHERE it's going; otherwise, WHERE the list is.
    val share = if (dragging) ziehAnteil else CatalogYearMath.anteilAusNummer(listenNummer, total)
    val thumbOffsetY = CatalogYearMath.thumbOffset(share, heightPx, thumbHeightPx)
    val etikett = CatalogYearMath.yearFor(share, total, verteilung, jahrGeladen)

    /** Beruehrung -> Anteil -> rollen. Wie js/rollbalken.js -> rollen(). */
    fun rollen(y: Float) {
        ziehAnteil = CatalogYearMath.shareFrom(y, heightPx, thumbHeightPx)
        onScrollTo(CatalogYearMath.numberFrom(ziehAnteil, total))
    }

    val jumpName = stringResource(R.string.catalog_jahr_springen)
    Row(modifier) {
        // Label track — only visible while dragging, catches no touches.
        Box(Modifier.fillMaxHeight()) {
            if (dragging && etikett != null) {
                Surface(
                    color = MaterialTheme.colorScheme.surface,
                    contentColor = MaterialTheme.colorScheme.onSurface,
                    shape = Formen.marke,
                    shadowElevation = 3.dp,
                    modifier = Modifier
                        .offset { IntOffset(0, thumbOffsetY) }
                        .padding(end = 6.dp)
                ) {
                    Text(
                        "$etikett",
                        fontWeight = FontWeight.SemiBold, style = MaterialTheme.typography.bodyMedium,
                        modifier = Modifier.padding(horizontal = 10.dp, vertical = 3.dp)
                    )
                }
            }
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
                    onClick { sprungmenue = true; true }
                }
                .focusable()
                .onKeyEvent { e -> e.opensMenu().also { if (it) sprungmenue = true } }
                .pointerInput(total) {
                    detectVerticalDragGestures(
                        onDragStart = { offset -> dragging = true; rollen(offset.y) },
                        onVerticalDrag = { change, _ -> change.consume(); rollen(change.position.y) },
                        onDragEnd = { dragging = false },
                        onDragCancel = { dragging = false }
                    )
                }
                .pointerInput(total) {
                    // Tapped next to the handle: jump there — as with a
                    // regular scrollbar.
                    detectTapGestures { offset -> rollen(offset.y) }
                }
        ) {
            // Schiene
            Surface(
                color = MaterialTheme.colorScheme.outline.copy(alpha = 0.25f),
                shape = Formen.strich,
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
            YearJumpMenu(sprungmenue, verteilung, onSchliessen = { sprungmenue = false }) { nummer ->
                sprungmenue = false
                onScrollTo(nummer.coerceIn(0, (total - 1).coerceAtLeast(0)))
            }
        }
    }
}

/** The distribution's years to tap on; also selectable with TalkBack and keyboard. */
@Composable
private fun YearJumpMenu(
    offen: Boolean,
    verteilung: List<JahrAnzahlAnsicht>,
    onSchliessen: () -> Unit,
    onJump: (Int) -> Unit,
) {
    DropdownMenu(expanded = offen, onDismissRequest = onSchliessen) {
        for (entry in verteilung) {
            val jahr = entry.year ?: continue
            val nummer = CatalogYearMath.numberOfYear(jahr, verteilung) ?: continue
            DropdownMenuItem(
                text = { Text("$jahr") },
                trailingIcon = {
                    Text(pluralStringResource(R.plurals.gallery_stat_sets, entry.n, fmtInt(entry.n)),
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant)
                },
                onClick = { onJump(nummer) },
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
