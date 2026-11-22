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
import ch.brickinventoryapp.ui.theme.Spacing

/**
 * The heading of a card or a section in a card list: small
 * caps like an overline. One implementation instead of four — set detail, settings,
 * household and finances used to show the same level in four styles.
 */
@Composable
fun SectionTitle(text: String, modifier: Modifier = Modifier, symbol: ImageVector? = null) {
    val announced = AnnotatedString(text)
    Row(
        // The text is read out as written, not spelled out letter by letter in caps.
        modifier.clearAndSetSemantics { heading(); this.text = announced },
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.small),
    ) {
        if (symbol != null) Icon(symbol, null, Modifier.size(withFont(18.dp)), tint = MaterialTheme.colorScheme.primary)
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
 * The heading of a group in a card-less list (the „More“ page): the same
 * style as [SectionTitle], with a divider before it. A separate style in the
 * primary color made the same level look different than in settings and detail.
 */
@Composable
fun GroupTitle(text: String, modifier: Modifier = Modifier, separator: Boolean = true) {
    if (separator) HorizontalDivider(Modifier.padding(top = Spacing.small))
    SectionTitle(text, modifier.padding(start = Spacing.large, end = Spacing.large, top = Spacing.large,
        bottom = Spacing.tiny))
}
