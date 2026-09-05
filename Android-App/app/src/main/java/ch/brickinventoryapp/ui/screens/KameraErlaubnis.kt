package ch.brickinventoryapp.ui.screens

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

/**
 * Die Ueberlagerung ueber dem Kamerabild: Rahmen in der Mitte, darunter ein
 * dunkles Schild mit dem Hinweistext.
 *
 * ── Warum gemeinsam ────────────────────────────────────────────────────────
 *
 * Der Barcode-Scanner und der QR-Aufbau zeigen beide ein Kamerabild mit
 * derselben Gestaltung: dieselbe Gewichtung 0.2 / 0.8, damit der Rahmen etwas
 * ueber der Mitte sitzt, und darunter dasselbe Schild — Schwarz mit 72 Prozent
 * Deckung, Formen.kachel, weisse Schrift in 13 sp, mittig. Nur der RAHMEN ist
 * verschieden: ein breites Rechteck mit Eckwinkeln fuer den Strichcode, ein
 * Quadrat fuer den QR-Code.
 *
 * Gefunden beim Zaehlen gleicher Achtzeiler — es war der letzte, der im
 * Android-Baum noch stand.
 *
 * ── Ein Unterschied, der eingeebnet wurde ──────────────────────────────────
 *
 * Der Abstand zwischen Rahmen und Schild war 16 dp im Scanner und 20 dp im
 * Aufbau. Ein Grund dafuer stand nirgends, und vier Pixel sind keiner. Jetzt
 * beide 16 dp — die haeufigere der beiden Zahlen.
 *
 * @param rahmen Was in der Mitte steht; bekommt den ColumnScope, damit ein
 *               Rahmen sich darin ausrichten kann.
 * @param unten  Was unter dem Schild noch dazugehoert — im Barcode-Scanner der
 *               Lampenknopf, im QR-Aufbau nichts. Den eigenen Abstand nach
 *               oben setzt der Aufrufer, weil nur er weiss, ob ueberhaupt
 *               etwas kommt.
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
        Spacer(Modifier.height(16.dp))
        Surface(color = Color.Black.copy(alpha = 0.72f), shape = Formen.kachel) {
            Text(
                hinweis,
                Modifier.padding(horizontal = 18.dp, vertical = 10.dp),
                color = Color.White, fontSize = 13.sp,
                textAlign = TextAlign.Center,
            )
        }
        unten()
        Spacer(Modifier.weight(0.8f))
    }
}
