package ch.brickinventoryapp.katalog.ui.screens

import ch.brickinventoryapp.model.ui.model.JahrAnzahlAnsicht
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
import ch.brickinventoryapp.katalog.ui.CatalogYearMath
import ch.brickinventoryapp.ui.theme.LocalIsBrickTheme

/**
 * Die Jahres-Leiste am rechten Rand, wie in der Webapp. Position ist die Stelle in
 * der Liste, nicht ein linear verteiltes Jahr: Der Katalog stammt überwiegend aus
 * den letzten Jahrzehnten, und das Etikett soll das Jahr zeigen, das an dieser
 * Stelle wirklich liegt (CatalogYearMath.jahrAnPosition). Als Row, damit das
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
    val thumbHeightPx = with(LocalDensity.current) { 36.dp.roundToPx() }

    // Beim Ziehen zeigt der Griff, WOHIN es geht; sonst, WO die Liste steht.
    // Der zweite Fall fehlte in der vorigen Fassung ganz — der Griff stand
    // dauerhaft dort, wo zuletzt gezogen worden war.
    val anteil = if (dragging) ziehAnteil else CatalogYearMath.anteilAusNummer(listenNummer, total)
    val thumbOffsetY = CatalogYearMath.daumenOffset(anteil, heightPx, thumbHeightPx)
    val etikett = CatalogYearMath.jahrFuer(anteil, total, verteilung, jahrGeladen)

    /** Beruehrung -> Anteil -> rollen. Wie js/scrollbar.js -> rollen(). */
    fun rollen(y: Float) {
        ziehAnteil = CatalogYearMath.anteilAus(y, heightPx, thumbHeightPx)
        onScrollTo(CatalogYearMath.nummerAus(ziehAnteil, total))
    }

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

        // Gesten-Leiste (28dp) mit Schiene + Griff
        Box(
            Modifier
                .width(28.dp)
                .fillMaxHeight()
                .onSizeChanged { heightPx = it.height }
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

            // Griff — immer sichtbar, folgt der Liste
            Surface(
                color = if (dragging) MaterialTheme.colorScheme.primary
                        else MaterialTheme.colorScheme.primary.copy(alpha = 0.55f),
                shape = RoundedCornerShape(topStart = 10.dp, bottomStart = 10.dp),
                shadowElevation = if (dragging) 3.dp else 1.dp,
                modifier = Modifier
                    .align(Alignment.TopEnd)
                    .offset { IntOffset(0, thumbOffsetY) }
            ) {
                Box(Modifier.width(18.dp).height(36.dp), Alignment.Center) {
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
                            modifier = Modifier.size(14.dp)
                        )
                    }
                }
            }
        }
    }
}
