package ch.brickinventoryapp.ui.screens

import androidx.compose.material3.MaterialTheme
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Surface
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.sp
import ch.brickinventoryapp.ui.theme.Formen
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
import ch.brickinventoryapp.ui.theme.Abstaende

/**
 * „Die Kamera wird gebraucht“ — der Rückfall, wenn die Erlaubnis fehlt; gemeinsam
 * für Barcodescanner und SetupScreen. Getrennt von KameraAufbau.kt, weil dort
 * bewusst kein Compose-Import steht: Die Bindung an CameraX soll ohne Oberfläche
 * prüfbar bleiben. Weisse Schrift, weil beide Ansichten den Hinweis vor einem
 * schwarzen Kamerabild zeigen.
 *
 * @param onErlauben Fragt die Erlaubnis erneut an.
 */
@Composable
fun KameraErlaubnisHinweis(onErlauben: () -> Unit) {
    Box(Modifier.fillMaxSize(), Alignment.Center) {
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            Text(stringResource(R.string.scanner_camera_needed),
                color = Color.White, fontWeight = FontWeight.Bold)
            Spacer(Modifier.height(Abstaende.mittel))
            Button(onClick = onErlauben) { Text(stringResource(R.string.scanner_allow)) }
        }
    }
}

/**
 * Die Überlagerung über dem Kamerabild: Rahmen in der Mitte, darunter ein dunkles
 * Schild mit dem Hinweistext — eine Gestaltung für Barcode-Scanner und QR-Aufbau
 * (Gewichtung 0.2 / 0.8, damit der Rahmen etwas über der Mitte sitzt; Schwarz mit
 * 72 % Deckung, Formen.kachel, weisse Schrift in 13 sp). Nur der Rahmen ist
 * verschieden: ein breites Rechteck mit Eckwinkeln für den Strichcode, ein Quadrat
 * für den QR-Code.
 *
 * @param rahmen Was in der Mitte steht; bekommt den ColumnScope, damit ein Rahmen
 *         sich darin ausrichten kann.
 * @param unten  Was unter dem Schild noch dazugehört — im Barcode-Scanner der
 *         Lampenknopf, im QR-Aufbau nichts. Den Abstand nach oben setzt der
 *         Aufrufer, weil nur er weiss, ob etwas kommt.
 */
@Composable
fun KameraUeberlagerung(
    hinweis: String,
    unten: @Composable ColumnScope.() -> Unit = {},
    rahmen: @Composable ColumnScope.() -> Unit,
) {
    Column(
        Modifier.fillMaxSize(),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        Spacer(Modifier.weight(0.2f))
        rahmen()
        Spacer(Modifier.height(Abstaende.gross))
        Surface(color = Color.Black.copy(alpha = 0.72f), shape = Formen.kachel) {
            Text(
                hinweis,
                Modifier.padding(horizontal = 18.dp, vertical = 10.dp),
                color = Color.White, style = MaterialTheme.typography.bodyMedium,
                textAlign = TextAlign.Center,
            )
        }
        unten()
        Spacer(Modifier.weight(0.8f))
    }
}
