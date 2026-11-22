package ch.brickinventoryapp.ui.components

import androidx.compose.foundation.layout.displayCutoutPadding
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.systemBarsPadding
import androidx.compose.ui.Modifier

/**
 * For screens without a scaffold (sign-in, register, setup): since
 * enableEdgeToEdge, the app draws under the status and gesture bars, and the keyboard
 * doesn't shrink the window. The keyboard last, so it only subtracts what sticks
 * out past the gesture bar.
 */
fun Modifier.outsideTheSystemBars(): Modifier = systemBarsPadding().displayCutoutPadding().imePadding()
