package ch.brickinventoryapp.ui.components

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.size
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import ch.brickinventoryapp.resources.R
import ch.brickinventoryapp.ui.theme.Spacing
import ch.brickinventoryapp.ui.theme.Shapes

/**
 * The header of setup and sign-in: logo in a framed tile, name, below it
 * a sentence on request. Both screens follow right after each other and used to look
 * different (logo without a frame, name on two lines).
 * The tile sits on surface: on some primary, the red brick disappeared.
 */
@Composable
fun BrandsHeader(modifier: Modifier = Modifier, subtitle: String? = null) {
    // With large text, small on one line: tile and two-line name took up
    // a quarter of the page at 200%, and the first field sat below the fold.
    if (largeFont()) {
        Column(modifier, horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(Spacing.tiny)) {
            Row(verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(Spacing.small)) {
                Image(painterResource(R.drawable.ic_logo), contentDescription = null, modifier = Modifier.size(32.dp))
                Text(stringResource(R.string.app_name), fontWeight = FontWeight.ExtraBold,
                    style = MaterialTheme.typography.titleMedium, modifier = Modifier.semantics { heading() })
            }
            if (subtitle != null) Text(subtitle, style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant, textAlign = TextAlign.Center)
        }
        return
    }
    Column(modifier, horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(Spacing.tiny)) {
        Surface(shape = MaterialTheme.shapes.large, color = MaterialTheme.colorScheme.surface,
            border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
            modifier = Modifier.size(80.dp)) {
            Box(contentAlignment = Alignment.Center) {
                Image(painterResource(R.drawable.ic_logo), contentDescription = null, modifier = Modifier.size(64.dp))
            }
        }
        Spacer(Modifier.height(Spacing.medium))
        Text(stringResource(R.string.app_name), fontWeight = FontWeight.ExtraBold,
            style = MaterialTheme.typography.headlineSmall, textAlign = TextAlign.Center,
            modifier = Modifier.semantics { heading() })
        if (subtitle != null) Text(subtitle, style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant, textAlign = TextAlign.Center)
    }
}

/**
 * The card below the brand header: sign-in, register, starting password and second
 * factor all sit framed the same way: free-floating on the background with a different
 * heading, the mandatory screens would look like a second app.
 */
@Composable
fun LoginCard(modifier: Modifier = Modifier, content: @Composable ColumnScope.() -> Unit) {
    Card(
        modifier = modifier.fillMaxWidth(),
        shape = Shapes.chip,
        elevation = CardDefaults.cardElevation(defaultElevation = Shapes.cardElevationHigh),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
    ) {
        Column(Modifier.padding(horizontal = 20.dp, vertical = 22.dp),
            verticalArrangement = Arrangement.spacedBy(Spacing.medium), content = content)
    }
}

/** The heading in a [LoginCard] — the same for each of the four screens. */
@Composable
fun LoginTitle(text: String) {
    Text(text, fontWeight = FontWeight.Bold, style = MaterialTheme.typography.titleMedium,
        modifier = Modifier.semantics { heading() })
}
