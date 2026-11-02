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
 * da, wie die Liste gleich aussieht — kein Kringel in der Mitte, der beim
 * Eintreffen einer vollen Seite weicht, und nichts springt.
 */
@Composable
fun SkelettRaster(
    spalten: GridCells,
    kachelHoehe: Dp,
    modifier: Modifier = Modifier,
    anzahl: Int = 12,
    innenabstand: PaddingValues = PaddingValues(Abstaende.mittel),
    abstand: Dp = 10.dp,
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
    val schimmer = Brush.linearGradient(listOf(grund, licht, grund),
        start = Offset(weg, 0f), end = Offset(weg + 600f, 600f))
    LazyVerticalGrid(
        columns = spalten,
        modifier = modifier.fillMaxSize().semantics { contentDescription = laedt },
        contentPadding = innenabstand,
        horizontalArrangement = Arrangement.spacedBy(abstand),
        verticalArrangement = Arrangement.spacedBy(abstand),
        userScrollEnabled = false,
    ) {
        items(anzahl, key = { "skelett-$it" }) {
            Box(
                Modifier.fillMaxWidth().height(kachelHoehe).clip(Formen.leiste).background(schimmer)
            )
        }
    }
}

/**
 * Ein Eintrag, der beim Einfügen, Entfernen und Umsortieren gleitet statt zu
 * springen. Als Hülle statt als Parameter jeder Kachel: Die Kacheln werden
 * auch ausserhalb von Listen benutzt, wo animateItem() nicht gilt.
 */
@Composable
fun LazyGridItemScope.Bewegt(inhalt: @Composable () -> Unit) {
    Box(Modifier.animateItem(), propagateMinConstraints = true) { inhalt() }
}

/** Dasselbe für Einträge einer LazyColumn. */
@Composable
fun LazyItemScope.Bewegt(inhalt: @Composable () -> Unit) {
    Box(Modifier.animateItem(), propagateMinConstraints = true) { inhalt() }
}
