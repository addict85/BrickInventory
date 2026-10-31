package ch.brickinventoryapp.ui.screens

import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import ch.brickinventoryapp.ressourcen.R
import ch.brickinventoryapp.ui.*
import ch.brickinventoryapp.ui.theme.Abstaende
import androidx.compose.material.icons.automirrored.filled.ArrowBack

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
        topBar = {
            TopAppBar(
                // Überschrift der Unterseite: Vorleseprogramme springen dorthin.
                title = { Text(titel, maxLines = 1, modifier = Modifier.semantics { heading() }) },
                navigationIcon = {
                    IconButton(onClick = onZurueck) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack,
                             stringResource(R.string.common_back))
                    }
                },
            )
        },
    ) { innen ->
        Column(
            Modifier
                .fillMaxSize()
                .padding(innen)
                .verticalScroll(rememberScrollState())
                .padding(horizontal = Abstaende.gross, vertical = Abstaende.gross),
            verticalArrangement = Arrangement.spacedBy(Abstaende.gross),
        ) { inhalt() }
    }
}
