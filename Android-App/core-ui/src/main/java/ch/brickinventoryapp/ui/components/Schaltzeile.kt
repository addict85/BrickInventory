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
 * Schalter mit Beschriftung als EIN Bedienelement: Die ganze Zeile schaltet, und
 * TalkBack liest Name, Rolle und Zustand zusammen. Das Steuerelement selbst zeigt nur
 * an (`onCheckedChange = null`); daneben ein eigener Rückruf hiesse „Aus, Schalter“.
 */
@Composable
fun SchalterZeile(
    text: String, an: Boolean, onUmschalten: (Boolean) -> Unit, modifier: Modifier = Modifier,
    hinweis: String? = null, hinweisFarbe: Color = Color.Unspecified, enabled: Boolean = true,
) = Schaltzeile(text, an, onUmschalten, Role.Switch, modifier, hinweis, hinweisFarbe, enabled,
    textStil = MaterialTheme.typography.bodyMedium, vorn = false) {
    Switch(checked = an, onCheckedChange = null, enabled = enabled)
}

/** Wie [SchalterZeile], mit dem Kästchen vor dem Text. */
@Composable
fun KaestchenZeile(
    text: String, an: Boolean, onUmschalten: (Boolean) -> Unit, modifier: Modifier = Modifier,
    hinweis: String? = null, textStil: TextStyle = MaterialTheme.typography.bodyMedium, enabled: Boolean = true,
) = Schaltzeile(text, an, onUmschalten, Role.Checkbox, modifier, hinweis, Color.Unspecified, enabled, textStil, vorn = true) {
    Checkbox(checked = an, onCheckedChange = null, enabled = enabled)
}

@Composable
private fun Schaltzeile(
    text: String, an: Boolean, onUmschalten: (Boolean) -> Unit, rolle: Role, modifier: Modifier,
    hinweis: String?, hinweisFarbe: Color, enabled: Boolean, textStil: TextStyle, vorn: Boolean,
    steuerelement: @Composable RowScope.() -> Unit,
) {
    Row(
        modifier.fillMaxWidth().heightIn(min = 48.dp)
            .toggleable(value = an, enabled = enabled, role = rolle, onValueChange = onUmschalten),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Abstaende.mittel),
    ) {
        if (vorn) steuerelement()
        Column(Modifier.weight(1f)) {
            Text(text, style = textStil)
            if (hinweis != null) Text(hinweis, style = MaterialTheme.typography.bodySmall,
                color = if (hinweisFarbe.isSpecified) hinweisFarbe else MaterialTheme.colorScheme.onSurfaceVariant)
        }
        if (!vorn) steuerelement()
    }
}
