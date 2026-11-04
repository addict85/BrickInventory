package ch.brickinventoryapp.ui.components

import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.grid.GridItemSpan
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.lazy.LazyItemScope
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyGridItemScope
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import ch.brickinventoryapp.ressourcen.R
import ch.brickinventoryapp.ui.theme.Abstaende
import ch.brickinventoryapp.ui.theme.Formen

/**
 * Kacheln ohne Inhalt, solange die erste Seite lädt. Die Fläche steht schon so
 * da, wie die Liste gleich aussieht — Bildfläche und zwei Textbalken je Kachel,
 * auf Wunsch die Kennzahlenzeile darüber —, damit beim Eintreffen nichts springt.
 */
@Composable
fun SkelettRaster(
    spalten: GridCells,
    kachelHoehe: Dp,
    modifier: Modifier = Modifier,
    anzahl: Int = 12,
    innenabstand: PaddingValues = PaddingValues(Abstaende.mittel),
    abstand: Dp = 10.dp,
    /** Eine Zeile über die ganze Breite vorweg, wo die Liste Kennzahlen zeigt (Galerie). */
    kopfzeile: Boolean = false,
    /**
     * Seitenverhältnis der Bildfläche, wo die echte Kachel eines hat (Galerie 4:3).
     * Ohne nimmt das Bild den Rest der Höhe; mit springt beim Eintreffen nichts.
     */
    bildVerhaeltnis: Float? = null,
) {
    val laedt = stringResource(R.string.common_loading)
    // Ein Schimmer für alle Kacheln: Läuft er über alle gleich, liest es sich als eine
    // Fläche, die lädt. Der Ton kommt aus skelettTon (Theme.kt), damit die Kacheln
    // sich in jedem Design vom Hintergrund abheben.
    val weg by rememberInfiniteTransition(label = "skelett").animateFloat(
        initialValue = -600f, targetValue = 1800f,
        animationSpec = infiniteRepeatable(tween(1400, easing = LinearEasing), RepeatMode.Restart),
        label = "skelett-schimmer",
    )
    val grund = ch.brickinventoryapp.ui.theme.skelettTon(MaterialTheme.colorScheme)
    val licht = ch.brickinventoryapp.ui.theme.skelettTon(MaterialTheme.colorScheme, 0.04f)
    // Ohne Bewegung eine ruhige Fläche statt des wandernden Lichts.
    val schimmer = if (bewegungReduziert()) SolidColor(grund) else Brush.linearGradient(listOf(grund, licht, grund),
        start = Offset(weg, 0f), end = Offset(weg + 600f, 600f))
    LazyVerticalGrid(
        columns = spalten,
        modifier = modifier.fillMaxSize().semantics { contentDescription = laedt },
        contentPadding = innenabstand,
        horizontalArrangement = Arrangement.spacedBy(abstand),
        verticalArrangement = Arrangement.spacedBy(abstand),
        userScrollEnabled = false,
    ) {
        if (kopfzeile) item(key = "skelett-kopf", span = { GridItemSpan(maxLineSpan) }) {
            Box(Modifier.fillMaxWidth().height(SKELETT_KOPF).clip(Formen.karte).background(schimmer))
        }
        items(anzahl, key = { "skelett-$it" }) {
            // Wie eine Karte: Fläche, darin Bild und zwei Zeilen Text als Balken.
            Column(
                Modifier.fillMaxWidth().height(kachelHoehe).clip(Formen.leiste)
                    .background(MaterialTheme.colorScheme.surface).padding(Abstaende.klein),
                verticalArrangement = Arrangement.spacedBy(Abstaende.klein),
            ) {
                val bild = if (bildVerhaeltnis != null) Modifier.aspectRatio(bildVerhaeltnis) else Modifier.weight(1f)
                Box(Modifier.fillMaxWidth().then(bild).clip(Formen.kachel).background(schimmer))
                Box(Modifier.fillMaxWidth(0.8f).height(Abstaende.mittel).clip(Formen.strich).background(schimmer))
                Box(Modifier.fillMaxWidth(0.5f).height(Abstaende.mittel).clip(Formen.strich).background(schimmer))
            }
        }
    }
}

/** Höhe der Kennzahlenzeile im Skelett — so hoch wie die echte bei 100 %. */
private val SKELETT_KOPF = 88.dp

/**
 * Ein Eintrag, der beim Einfügen, Entfernen und Umsortieren gleitet statt zu
 * springen. Als Hülle statt als Parameter jeder Kachel: Die Kacheln werden
 * auch ausserhalb von Listen benutzt, wo animateItem() nicht gilt.
 */
@Composable
fun LazyGridItemScope.Bewegt(inhalt: @Composable () -> Unit) {
    Box(if (bewegungReduziert()) Modifier else Modifier.animateItem(), propagateMinConstraints = true) { inhalt() }
}

/** Dasselbe für Einträge einer LazyColumn. */
@Composable
fun LazyItemScope.Bewegt(inhalt: @Composable () -> Unit) {
    Box(if (bewegungReduziert()) Modifier else Modifier.animateItem(), propagateMinConstraints = true) { inhalt() }
}
