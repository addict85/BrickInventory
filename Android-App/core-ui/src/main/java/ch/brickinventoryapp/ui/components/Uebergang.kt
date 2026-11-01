package ch.brickinventoryapp.ui.components

import androidx.compose.animation.AnimatedVisibilityScope
import androidx.compose.animation.ExperimentalSharedTransitionApi
import androidx.compose.animation.SharedTransitionLayout
import androidx.compose.animation.SharedTransitionScope
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.compositionLocalOf
import androidx.compose.ui.Modifier

/**
 * Gemeinsame Elementübergänge: Das Bild der Kachel fliegt beim Öffnen in das
 * Bild des Set-Details und beim Zurück (auch beim vorhersagbaren Wischen)
 * wieder hinein. Über CompositionLocals, damit Galerie und Detail keine
 * Übergangs-Parameter durch jede Ebene reichen müssen; ohne Rahmen (Vorschau,
 * Tests) bleibt alles ohne Animation.
 */
@OptIn(ExperimentalSharedTransitionApi::class)
val LocalUebergang = compositionLocalOf<SharedTransitionScope?> { null }
val LocalZielSichtbarkeit = compositionLocalOf<AnimatedVisibilityScope?> { null }

/** Um den NavHost: der gemeinsame Raum, in dem Elemente zwischen Zielen wandern. */
@OptIn(ExperimentalSharedTransitionApi::class)
@Composable
fun UebergangsRahmen(inhalt: @Composable () -> Unit) {
    SharedTransitionLayout {
        CompositionLocalProvider(LocalUebergang provides this) { inhalt() }
    }
}

/** In einem Navigationsziel: dessen Ein- und Ausblenden steuert den Übergang. */
@Composable
fun MitZiel(ziel: AnimatedVisibilityScope, inhalt: @Composable () -> Unit) {
    CompositionLocalProvider(LocalZielSichtbarkeit provides ziel) { inhalt() }
}

/**
 * Das Bild eines Sets, in Galerie und Detail unter demselben Schlüssel. Als
 * Hülle, die den Modifier hineinreicht: Ein @Composable, der einen Modifier
 * zurückgibt, wäre eine Modifier-Fabrik ausserhalb von Modifier.
 */
@OptIn(ExperimentalSharedTransitionApi::class)
@Composable
fun GemeinsamesBild(setNumber: String, inhalt: @Composable (Modifier) -> Unit) {
    val uebergang = LocalUebergang.current
    val ziel = LocalZielSichtbarkeit.current
    if (uebergang == null || ziel == null) return inhalt(Modifier)
    with(uebergang) {
        inhalt(Modifier.sharedElement(rememberSharedContentState("set-bild-$setNumber"), ziel))
    }
}
