package ch.brickinventoryapp.ui.components

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ErrorOutline
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import ch.brickinventoryapp.resources.R
import ch.brickinventoryapp.ui.sentence
import ch.brickinventoryapp.ui.theme.Spacing
import ch.brickinventoryapp.uistate.Load

/**
 * A part of a page that did not load (key figures, filter lists, a side value): one line with
 * the reason and a retry, the rest of the page stays usable. Nothing while [fetch] is not a failure.
 */
@Composable
fun PartialLoadFailed(fetch: Load<*>, onAgain: () -> Unit, modifier: Modifier = Modifier) {
    val failure = fetch as? Load.Failure ?: return
    Row(
        modifier.fillMaxWidth().semantics { liveRegion = LiveRegionMode.Polite }.padding(horizontal = Spacing.medium),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.small),
    ) {
        Icon(Icons.Default.ErrorOutline, null, tint = MaterialTheme.colorScheme.error)
        Text(failure.message.sentence(), Modifier.weight(1f), style = MaterialTheme.typography.bodySmall)
        TextButton(onClick = onAgain) { Text(stringResource(R.string.common_retry)) }
    }
}
