package ch.brickinventoryapp.ui.components

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.size
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
import ch.brickinventoryapp.ressourcen.R
import ch.brickinventoryapp.ui.theme.Abstaende

/**
 * Der Kopf von Einrichten und Anmelden: Logo in gerahmter Kachel, Name, darunter
 * auf Wunsch ein Satz. Beide Bildschirme folgen direkt aufeinander und sahen
 * verschieden aus (Logo ohne Rahmen, Name zweizeilig).
 * Die Kachel liegt auf surface: Auf manchem primary verschwand der rote Stein.
 */
@Composable
fun MarkenKopf(untertitel: String? = null, modifier: Modifier = Modifier) {
    Column(modifier, horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(Abstaende.winzig)) {
        Surface(shape = MaterialTheme.shapes.large, color = MaterialTheme.colorScheme.surface,
            border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
            modifier = Modifier.size(80.dp)) {
            Box(contentAlignment = Alignment.Center) {
                Image(painterResource(R.drawable.ic_logo), contentDescription = null, modifier = Modifier.size(64.dp))
            }
        }
        Spacer(Modifier.height(Abstaende.mittel))
        Text(stringResource(R.string.app_name), fontWeight = FontWeight.ExtraBold,
            style = MaterialTheme.typography.headlineSmall, textAlign = TextAlign.Center,
            modifier = Modifier.semantics { heading() })
        if (untertitel != null) Text(untertitel, style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant, textAlign = TextAlign.Center)
    }
}
