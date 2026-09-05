package ch.brickinventoryapp.ui.screens

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.material3.Button
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import ch.brickinventoryapp.R

/**
 * „Die Kamera wird gebraucht" — der Rueckfall, wenn die Erlaubnis fehlt.
 *
 * Stand zweimal wortgleich da: BarcodeScannerScreen.kt und SetupScreen.kt, die
 * beiden Ansichten, die eine Kamera brauchen. Gefunden beim Zaehlen gleicher
 * Achtzeiler. Ein Unterschied zwischen den Kopien war diesmal nicht dabei —
 * beide sagen dasselbe und tun dasselbe.
 *
 * Der Kamera-AUFBAU liegt schon gemeinsam in KameraAufbau.kt. Diese Datei ist
 * getrennt davon, weil dort bewusst kein einziger Compose-Import steht: Die
 * Bindung an CameraX soll ohne Oberflaeche pruefbar bleiben.
 *
 * Weisse Schrift, weil beide Ansichten den Hinweis vor einem schwarzen
 * Kamerabild zeigen — dort waere die Farbe des Themas nicht zu lesen.
 *
 * @param onErlauben Fragt die Erlaubnis erneut an.
 */
@Composable
fun KameraErlaubnisHinweis(onErlauben: () -> Unit) {
    Box(Modifier.fillMaxSize(), Alignment.Center) {
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            Text(stringResource(R.string.scanner_camera_needed),
                color = Color.White, fontWeight = FontWeight.Bold)
            Spacer(Modifier.height(12.dp))
            Button(onClick = onErlauben) { Text(stringResource(R.string.scanner_allow)) }
        }
    }
}
