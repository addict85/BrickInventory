package ch.brickinventoryapp.ui.components

import androidx.compose.foundation.layout.size
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp

/**
 * Das große Symbol über einem leeren Zustand oder in einer Kachel ohne Bild.
 *
 * Statt Emoji: Die sehen je nach Hersteller anders aus, tragen eigene Farben,
 * die kein Design kennt, und TalkBack liest ihren Namen vor. Ohne Beschreibung,
 * weil der Text daneben die Aussage trägt.
 */
@Composable
fun LeerSymbol(bild: ImageVector, groesse: Dp = 40.dp, farbe: Color = MaterialTheme.colorScheme.onSurfaceVariant) {
    Icon(bild, contentDescription = null, modifier = Modifier.size(groesse), tint = farbe)
}
