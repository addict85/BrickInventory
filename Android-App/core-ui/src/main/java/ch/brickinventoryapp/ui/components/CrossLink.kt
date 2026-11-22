package ch.brickinventoryapp.ui.components

import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowForward
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import ch.brickinventoryapp.ui.theme.Spacing

/**
 * The way to a related page in another area (watchlist → price alerts, finances → vouchers):
 * a text button with an arrow, so it reads as „go there“, not as an action on this page.
 */
@Composable
fun CrossLink(text: String, onClick: () -> Unit, modifier: Modifier = Modifier) {
    TextButton(onClick = onClick, modifier = modifier.heightIn(min = 48.dp)) {
        Text(text)
        Spacer(Modifier.width(Spacing.tiny))
        Icon(Icons.AutoMirrored.Filled.ArrowForward, null, Modifier.size(withFont(16.dp)))
    }
}
