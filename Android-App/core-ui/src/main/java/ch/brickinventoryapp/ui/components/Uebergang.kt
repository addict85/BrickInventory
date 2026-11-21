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
 * Shared element transitions: the tile's image flies into the
 * image of the set detail when opening, and back in on returning (also with the
 * predictive back swipe). Via CompositionLocals, so gallery and detail don't have to
 * pass transition parameters through every layer; without a frame (preview,
 * tests) everything stays without animation.
 */
@OptIn(ExperimentalSharedTransitionApi::class)
val LocalTransition = compositionLocalOf<SharedTransitionScope?> { null }
val LocalTargetVisibility = compositionLocalOf<AnimatedVisibilityScope?> { null }

/** Around the NavHost: the shared space in which elements travel between destinations. */
@OptIn(ExperimentalSharedTransitionApi::class)
@Composable
fun TransitionFrame(inhalt: @Composable () -> Unit) {
    SharedTransitionLayout {
        CompositionLocalProvider(LocalTransition provides this) { inhalt() }
    }
}

/** In a navigation destination: its appearing and disappearing drives the transition. */
@Composable
fun WithTarget(ziel: AnimatedVisibilityScope, inhalt: @Composable () -> Unit) {
    CompositionLocalProvider(LocalTargetVisibility provides ziel) { inhalt() }
}

/**
 * The image of a set, under the same key in gallery and detail. As a
 * wrapper that passes the modifier in: a @Composable that returns a
 * modifier would be a modifier factory outside of Modifier.
 */
@OptIn(ExperimentalSharedTransitionApi::class)
@Composable
fun SharedImage(setNumber: String, inhalt: @Composable (Modifier) -> Unit) {
    val transition = LocalTransition.current
    val ziel = LocalTargetVisibility.current
    // Without motion, only the crossfade of the navigation destination remains.
    val ruhig = movementReduced()
    if (transition == null || ziel == null || ruhig) return inhalt(Modifier)
    with(transition) {
        inhalt(Modifier.sharedElement(rememberSharedContentState("set-bild-$setNumber"), ziel))
    }
}
