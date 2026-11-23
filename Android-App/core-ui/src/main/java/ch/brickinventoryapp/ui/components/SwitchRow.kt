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
import ch.brickinventoryapp.ui.theme.Spacing

/**
 * A switch with a label as ONE control: the whole row toggles it, and
 * TalkBack reads name, role and state together. The control itself only displays
 * (`onCheckedChange = null`); a separate callback next to it would say „off, switch“.
 */
@Composable
fun ToggleRow(
    text: String, an: Boolean, toggleOn: (Boolean) -> Unit, modifier: Modifier = Modifier,
    hint: String? = null, hintColor: Color = Color.Unspecified, enabled: Boolean = true,
) = SwitchRow(text, an, toggleOn, modifier, hint,
    SwitchLook(Role.Switch, front = false, MaterialTheme.typography.bodyMedium, hintColor, enabled)) {
    Switch(checked = an, onCheckedChange = null, enabled = enabled)
}

/** Like [ToggleRow], with the checkbox before the text. */
@Composable
fun BoxRow(
    text: String, an: Boolean, toggleOn: (Boolean) -> Unit, modifier: Modifier = Modifier,
    hint: String? = null, textStyle: TextStyle = MaterialTheme.typography.bodyMedium, enabled: Boolean = true,
) = SwitchRow(text, an, toggleOn, modifier, hint, SwitchLook(Role.Checkbox, front = true, textStyle, Color.Unspecified, enabled)) {
    Checkbox(checked = an, onCheckedChange = null, enabled = enabled)
}

/** How a [SwitchRow] looks: its role, whether the control comes first, text style and hint color. */
private class SwitchLook(val role: Role, val front: Boolean, val textStyle: TextStyle, val hintColor: Color, val enabled: Boolean)

@Composable
private fun SwitchRow(
    text: String, an: Boolean, toggleOn: (Boolean) -> Unit, modifier: Modifier, hint: String?, look: SwitchLook,
    control: @Composable RowScope.() -> Unit,
) {
    val front = look.front
    val hintColor = look.hintColor
    Row(
        modifier.fillMaxWidth().heightIn(min = 48.dp)
            .toggleable(value = an, enabled = look.enabled, role = look.role, onValueChange = toggleOn),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.medium),
    ) {
        if (front) control()
        Column(Modifier.weight(1f)) {
            Text(text, style = look.textStyle)
            if (hint != null) Text(hint, style = MaterialTheme.typography.bodySmall,
                color = if (hintColor.isSpecified) hintColor else MaterialTheme.colorScheme.onSurfaceVariant)
        }
        if (!front) control()
    }
}
