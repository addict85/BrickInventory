package ch.brickinventoryapp.ui.components

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.text
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import ch.brickinventoryapp.ui.theme.Abstaende

/**
 * Die Überschrift einer Karte oder eines Abschnitts in einer Kartenliste: kleine
 * Versalien wie eine Overline. Eine Fassung statt vier — Set-Detail, Einstellungen,
 * Haushalt und Finanzen zeigten dieselbe Ebene in vier Stilen.
 */
@Composable
fun Abschnittstitel(text: String, modifier: Modifier = Modifier, symbol: ImageVector? = null) {
    val vorgelesen = AnnotatedString(text)
    Row(
        // Vorgelesen wird der Text, wie er geschrieben ist, nicht in Versalien buchstabiert.
        modifier.clearAndSetSemantics { heading(); this.text = vorgelesen },
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Abstaende.klein),
    ) {
        if (symbol != null) Icon(symbol, null, Modifier.size(mitSchrift(18.dp)), tint = MaterialTheme.colorScheme.primary)
        Text(
            text.uppercase(),
            style = MaterialTheme.typography.labelSmall,
            fontWeight = FontWeight.Bold,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            letterSpacing = 0.8.sp,
        )
    }
}

/**
 * Die Überschrift einer Gruppe in einer Liste ohne Karten (Seite „Mehr“): derselbe
 * Stil wie [Abschnittstitel], mit Trennlinie davor. Ein eigener Stil in der
 * Hauptfarbe liess dieselbe Ebene anders aussehen als in Einstellungen und Detail.
 */
@Composable
fun Gruppentitel(text: String, modifier: Modifier = Modifier, trenner: Boolean = true) {
    if (trenner) HorizontalDivider(Modifier.padding(top = Abstaende.klein))
    Abschnittstitel(text, modifier.padding(start = Abstaende.gross, end = Abstaende.gross, top = Abstaende.gross,
        bottom = Abstaende.winzig))
}
