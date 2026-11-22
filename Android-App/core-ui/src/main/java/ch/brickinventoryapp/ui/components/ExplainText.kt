package ch.brickinventoryapp.ui.components

import androidx.compose.foundation.focusable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.unit.dp
import ch.brickinventoryapp.resources.R
import ch.brickinventoryapp.ui.theme.Spacing

/**
 * One sentence up front, the rest behind „Learn more“: nobody read multi-line explanations before
 * the content, and at 200% text size they pushed it down by half a screen.
 * [theme] gives the button its own name for TalkBack („Mehr zu Preisalarme“).
 */
@Composable
fun ExplainText(
    short: String,
    more: String,
    style: TextStyle = MaterialTheme.typography.bodyMedium,
    color: Color = MaterialTheme.colorScheme.onSurfaceVariant,
    theme: String? = null,
) {
    var open by rememberSaveable { mutableStateOf(false) }
    // After tapping, the button disappears; focus and the announcement go to the new text.
    var openFocusAfter by remember { mutableStateOf(false) }
    val target = remember { FocusRequester() }
    val name = theme?.let { stringResource(R.string.explain_more_about, it) }
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.tiny)) {
        Text(short, style = style, color = color)
        if (open) {
            Text(more, Modifier.focusRequester(target).focusable().announce(), style = MaterialTheme.typography.bodySmall, color = color)
            TextButton(onClick = { open = false }, contentPadding = PaddingValues(horizontal = 0.dp)) {
                Text(stringResource(R.string.explain_less))
            }
            if (openFocusAfter) LaunchedEffect(Unit) { target.requestFocus(); openFocusAfter = false }
        } else TextButton(
            onClick = { open = true; openFocusAfter = true },
            contentPadding = PaddingValues(horizontal = 0.dp),
            modifier = if (name != null) Modifier.semantics { contentDescription = name } else Modifier,
        ) {
            Text(stringResource(R.string.common_learn_more))
        }
    }
}
