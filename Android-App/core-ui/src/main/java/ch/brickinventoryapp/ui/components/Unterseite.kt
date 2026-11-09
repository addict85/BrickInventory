package ch.brickinventoryapp.ui.components

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import ch.brickinventoryapp.model.ui.*
import ch.brickinventoryapp.ui.*
import ch.brickinventoryapp.ui.theme.Abstaende
import ch.brickinventoryapp.ui.theme.mittigBis
import ch.brickinventoryapp.ui.theme.Lesebreite

/**
 * Der Rahmen jeder Unterseite: Titel, Zurück-Pfeil, darunter der Inhalt mit einem
 * Abstand zwischen den Karten.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun Unterseite(
    titel: String,
    snackbarHostState: SnackbarHostState,
    onZurueck: () -> Unit,
    /** Formulare schmaler als Listen: Ein Eingabefeld über 800 dp liest sich nicht mehr als eines. */
    breite: androidx.compose.ui.unit.Dp = Lesebreite.liste,
    inhalt: @Composable ColumnScope.() -> Unit,
) {
    Scaffold(
        // ── Eigener Snackbar-Halter ──
        //
        // Die Meldungen laufen über einen Fluss (vm.snackbar), und AppNavigation zeigt sie
        // auf `snackbarHostState`; der Halter dafür steht im Reiter-Gerüst, das hier nicht
        // in der Komposition ist. Ohne diese Zeile gingen „Gutschein gespeichert“, „250
        // CHF“ und jede Absage der Guthaben-Abfrage still verloren.
        snackbarHost = { SnackbarHost(snackbarHostState) },
        // Der Kopf der Detailseiten: Überschrift, bei grosser Schrift zweizeilig statt abgeschnitten.
        topBar = { DetailTopAppBar(titel, onZurueck, schliessen = false) },
    ) { innen ->
        Column(
            Modifier
                .fillMaxSize()
                .padding(innen)
                .verticalScroll(rememberScrollState())
                // Auf dem Tablet mittig auf Lesebreite: Eine Zeile über 1200 dp liest sich
                // nicht mehr in einem Zug.
                .mittigBis(breite)
                .padding(horizontal = Abstaende.gross, vertical = Abstaende.gross),
            verticalArrangement = Arrangement.spacedBy(Abstaende.gross),
        ) { inhalt() }
    }
}
