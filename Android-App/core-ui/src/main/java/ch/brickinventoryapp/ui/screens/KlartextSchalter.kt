package ch.brickinventoryapp.ui.screens

import ch.brickinventoryapp.ui.theme.Formen
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.res.stringResource
import ch.brickinventoryapp.ressourcen.R
import androidx.compose.foundation.selection.toggleable
import androidx.compose.ui.semantics.Role
import ch.brickinventoryapp.ui.theme.Abstaende

/**
 * Der Expertenschalter für Klartext, in der Einrichtung und in den Einstellungen
 * derselbe: deutlich als Experte gekennzeichnet, mit dem Preis daneben.
 */
@Composable
fun KlartextSchalter(an: Boolean, onAendern: (Boolean) -> Unit, modifier: Modifier = Modifier) {
    Surface(
        modifier = modifier.fillMaxWidth().padding(top = Abstaende.mittel),
        shape = Formen.leiste,
        color = MaterialTheme.colorScheme.errorContainer.copy(alpha = if (an) 1f else 0.4f),
    ) {
        Row(
            Modifier.fillMaxWidth().heightIn(min = 48.dp)
                .toggleable(value = an, role = Role.Switch, onValueChange = onAendern)
                .padding(Abstaende.mittel),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Column(Modifier.weight(1f)) {
                Text(stringResource(R.string.klartext_experte_titel), style = MaterialTheme.typography.labelLarge,
                    fontWeight = FontWeight.Bold, color = MaterialTheme.colorScheme.onErrorContainer)
                Text(stringResource(R.string.klartext_experte_warnung), style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onErrorContainer)
            }
            Spacer(Modifier.width(Abstaende.klein))
            Switch(checked = an, onCheckedChange = null)
        }
    }
}
