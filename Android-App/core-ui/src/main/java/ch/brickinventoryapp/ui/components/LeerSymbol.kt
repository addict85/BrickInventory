package ch.brickinventoryapp.ui.components

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp

/**
 * Das grosse Symbol über einem leeren Zustand, immer auf derselben runden Fläche:
 * Einmal mit, einmal ohne Fläche sahen die Leerzustände nach zwei Mustern aus.
 *
 * Statt Emoji: Die sehen je nach Hersteller anders aus, tragen eigene Farben,
 * die kein Design kennt, und TalkBack liest ihren Namen vor. Ohne Beschreibung,
 * weil der Text daneben die Aussage trägt.
 */
@Composable
fun LeerSymbol(bild: ImageVector, groesse: Dp = 40.dp) {
    Surface(shape = CircleShape, color = MaterialTheme.colorScheme.secondaryContainer,
        contentColor = MaterialTheme.colorScheme.onSecondaryContainer) {
        Box(Modifier.size(groesse * 2), contentAlignment = Alignment.Center) {
            Icon(bild, contentDescription = null, modifier = Modifier.size(groesse))
        }
    }
}
