package ch.brickinventoryapp.ui.theme

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/**
 * Noppen-„Deckel" für Stein-Karten: eine schmale, farbige Leiste mit hellen
 * Noppen (Kreisen) links. Wird oben in Karten platziert und über das
 * Karten-Clipping automatisch oben abgerundet.
 */
@Composable
fun BrickStudCap(
    modifier: Modifier = Modifier,
    color: Color = MaterialTheme.colorScheme.primary,
    height: Dp = 16.dp,
    studCount: Int = 4
) {
    Box(
        modifier
            .fillMaxWidth()
            .height(height)
            .background(color)
    ) {
        Row(
            Modifier.align(Alignment.CenterStart).padding(start = 10.dp),
            horizontalArrangement = Arrangement.spacedBy(6.dp)
        ) {
            repeat(studCount) {
                Box(
                    Modifier.size(6.dp).clip(CircleShape)
                        .background(Color.White.copy(alpha = 0.55f))
                )
            }
        }
    }
}

/**
 * Farbige Wert-Kachel für die Set-Details (z. B. "Aktueller Wert" in Petrol,
 * "Kaufpreis" in Schiefer) — Label oben, großer Wert darunter.
 */
@Composable
fun BrickStatTile(
    label: String,
    value: String,
    container: Color,
    onContainer: Color,
    modifier: Modifier = Modifier
) {
    Box(
        modifier
            .clip(RoundedCornerShape(14.dp))
            .background(container)
            .padding(horizontal = 16.dp, vertical = 14.dp)
    ) {
        Column {
            Text(
                label,
                color = onContainer.copy(alpha = 0.85f),
                style = MaterialTheme.typography.labelMedium
            )
            Text(
                value,
                color = onContainer,
                fontSize = 22.sp,
                fontWeight = FontWeight.Bold
            )
        }
    }
}
