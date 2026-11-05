package ch.brickinventoryapp.ui.components

import androidx.compose.foundation.layout.displayCutoutPadding
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.systemBarsPadding
import androidx.compose.ui.Modifier

/**
 * Für Bildschirme ohne Gerüst (Anmelden, Registrieren, Einrichten): Seit
 * enableEdgeToEdge zeichnet die App unter Status- und Gestenleiste, und die Tastatur
 * schrumpft das Fenster nicht. Die Tastatur zuletzt, damit sie nur abzieht, was über
 * die Gestenleiste hinausragt.
 */
fun Modifier.ausserhalbDerSystemleisten(): Modifier = systemBarsPadding().displayCutoutPadding().imePadding()
