package ch.brickinventoryapp.ui.components

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.selection.toggleable
import androidx.compose.material3.Checkbox
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.isSpecified
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.unit.dp
import ch.brickinventoryapp.ui.theme.Abstaende

/**
 * A switch with a label as ONE control: the whole row toggles it, and
 * TalkBack reads name, role and state together. The control itself only displays
 * (`onCheckedChange = null`); a separate callback next to it would say „off, switch“.
 */
@Composable
fun ToggleRow(
    text: String, an: Boolean, toggleOn: (Boolean) -> Unit, modifier: Modifier = Modifier,
    hinweis: String? = null, hintColor: Color = Color.Unspecified, enabled: Boolean = true,
) = Schaltzeile(text, an, toggleOn, Role.Switch, modifier, hinweis, hintColor, enabled,
    textStyle = MaterialTheme.typography.bodyMedium, vorn = false) {
    Switch(checked = an, onCheckedChange = null, enabled = enabled)
}

/** Like [ToggleRow], with the checkbox before the text. */
@Composable
fun BoxRow(
    text: String, an: Boolean, toggleOn: (Boolean) -> Unit, modifier: Modifier = Modifier,
    hinweis: String? = null, textStyle: TextStyle = MaterialTheme.typography.bodyMedium, enabled: Boolean = true,
) = Schaltzeile(text, an, toggleOn, Role.Checkbox, modifier, hinweis, Color.Unspecified, enabled, textStyle, vorn = true) {
    Checkbox(checked = an, onCheckedChange = null, enabled = enabled)
}

@Composable
private fun Schaltzeile(
    text: String, an: Boolean, toggleOn: (Boolean) -> Unit, rolle: Role, modifier: Modifier,
    hinweis: String?, hintColor: Color, enabled: Boolean, textStyle: TextStyle, vorn: Boolean,
    control: @Composable RowScope.() -> Unit,
) {
    Row(
        modifier.fillMaxWidth().heightIn(min = 48.dp)
            .toggleable(value = an, enabled = enabled, role = rolle, onValueChange = toggleOn),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Abstaende.mittel),
    ) {
        if (vorn) control()
        Column(Modifier.weight(1f)) {
            Text(text, style = textStyle)
            if (hinweis != null) Text(hinweis, style = MaterialTheme.typography.bodySmall,
                color = if (hintColor.isSpecified) hintColor else MaterialTheme.colorScheme.onSurfaceVariant)
        }
        if (!vorn) control()
    }
}
