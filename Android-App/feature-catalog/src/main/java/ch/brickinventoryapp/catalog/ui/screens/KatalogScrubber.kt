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
 * Die Jahres-Leiste am rechten Rand, wie in der Webapp. Position ist die Stelle in
 * der Liste, nicht ein linear verteiltes Jahr: Der Katalog stammt überwiegend aus
 * den letzten Jahrzehnten, und das Etikett soll das Jahr zeigen, das an dieser
 * Stelle wirklich liegt (CatalogYearMath.yearAnPosition). Als Row, damit das
 * Etikett über die Kacheln ragen kann, ohne Berührungen abzufangen.
 */
@Composable
internal fun YearScrubber(
    /** Stelle in der Liste, an der die Anzeige gerade steht (0 .. total-1). */
    listenNummer: Int,
    total: Int,
    verteilung: List<JahrAnzahlAnsicht>,
    /** Jahr der Kachel an einer laufenden Nummer — null, wenn nicht geladen. */
    jahrGeladen: (Int) -> Int?,
    /** Ziehen: zu dieser Stelle rollen. Laeuft waehrend der Bewegung, nicht erst am Ende. */
    onScrollTo: (Int) -> Unit,
    modifier: Modifier = Modifier
) {
    var dragging by remember { mutableStateOf(false) }
    var ziehAnteil by remember { mutableStateOf(0f) }
    var heightPx by rememberSaveable { mutableStateOf(1) }
    var sprungmenue by rememberSaveable { mutableStateOf(false) }
    val thumbHeightPx = with(LocalDensity.current) { HANDLE_HEIGHT.roundToPx() }

    // Beim Ziehen zeigt der Griff, WOHIN es geht; sonst, WO die Liste steht.
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
        // Etikett-Spur — nur sichtbar beim Ziehen, faengt keine Beruehrungen.
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

        // 48 dp Spur wie jede Tippfläche; Ziehen ist nur einer der Wege. TalkBack und
        // Tastatur öffnen ein Sprungmenü mit den Jahrgängen, weil eine Geste allein für sie
        // unerreichbar war.
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
                    // Neben den Griff getippt: dorthin springen — wie bei einem
                    // gewoehnlichen Scrollbalken.
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

            // Griff — deckend, damit er sich auf jeder Kachel abhebt; folgt der Liste.
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
                        // Stein-Design: Griff als Noppe (heller Stud-Punkt)
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

/** Die Jahrgänge der Verteilung zum Antippen; wählbar auch mit TalkBack und Tastatur. */
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

/** Eingabe, Leertaste oder die Mitte des Steuerkreuzes öffnen das Sprungmenü. */
private fun KeyEvent.opensMenu(): Boolean =
    type == KeyEventType.KeyUp && (key == Key.Enter || key == Key.Spacebar || key == Key.DirectionCenter)

/** Breite der Tippspur: die Mindestgrösse einer Tippfläche. */
internal val TRACK_WIDTH = 48.dp

private val HANDLE_WIDTH = 24.dp
private val HANDLE_HEIGHT = 48.dp
