package ch.brickinventoryapp.ui.screens

import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import ch.brickinventoryapp.ui.theme.AppKarte
import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import ch.brickinventoryapp.ui.*
import ch.brickinventoryapp.ui.theme.Abstaende

/**
 * Der Rahmen einer Einstellungs-Rubrik. Öffentlich in core-ui, weil Einstellungen
 * und Gutscheine ihn teilen — eine zweite Fassung sähe irgendwann anders aus.
 */
@Composable
fun SettingsCard(
    title: String,
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    content: @Composable ColumnScope.() -> Unit
) {
    AppKarte {
        // Der Abstand zwischen den Kindern einer Karte steht einmal hier, damit jede Karte
        // ihn bekommt, ohne dass jemand daran denkt.
        Column(
            Modifier.padding(Abstaende.gross),
            verticalArrangement = Arrangement.spacedBy(Abstaende.klein),
        ) {
            ch.brickinventoryapp.ui.components.Abschnittstitel(title, Modifier.padding(bottom = Abstaende.mittel), symbol = icon)
            content()
        }
    }
}
