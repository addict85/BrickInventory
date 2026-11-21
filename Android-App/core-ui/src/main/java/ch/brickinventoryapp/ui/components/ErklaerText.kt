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
import ch.brickinventoryapp.ui.theme.Abstaende

/**
 * One sentence up front, the rest behind „Learn more“: nobody read multi-line explanations before
 * the content, and at 200% text size they pushed it down by half a screen.
 * [thema] gives the button its own name for TalkBack („Mehr zu Preisalarme“).
 */
@Composable
fun ErklaerText(
    kurz: String,
    mehr: String,
    stil: TextStyle = MaterialTheme.typography.bodyMedium,
    farbe: Color = MaterialTheme.colorScheme.onSurfaceVariant,
    thema: String? = null,
) {
    var offen by rememberSaveable { mutableStateOf(false) }
    // After tapping, the button disappears; focus and the announcement go to the new text.
    var openFocusAfter by remember { mutableStateOf(false) }
    val ziel = remember { FocusRequester() }
    val name = thema?.let { stringResource(R.string.erklaer_mehr_zu, it) }
    Column(verticalArrangement = Arrangement.spacedBy(Abstaende.tiny)) {
        Text(kurz, style = stil, color = farbe)
        if (offen) {
            Text(mehr, Modifier.focusRequester(ziel).focusable().announce(), style = MaterialTheme.typography.bodySmall, color = farbe)
            TextButton(onClick = { offen = false }, contentPadding = PaddingValues(horizontal = 0.dp)) {
                Text(stringResource(R.string.erklaer_weniger))
            }
            if (openFocusAfter) LaunchedEffect(Unit) { ziel.requestFocus(); openFocusAfter = false }
        } else TextButton(
            onClick = { offen = true; openFocusAfter = true },
            contentPadding = PaddingValues(horizontal = 0.dp),
            modifier = if (name != null) Modifier.semantics { contentDescription = name } else Modifier,
        ) {
            Text(stringResource(R.string.common_learn_more))
        }
    }
}
