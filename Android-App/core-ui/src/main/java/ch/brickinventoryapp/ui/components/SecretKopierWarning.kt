package ch.brickinventoryapp.ui.components

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import ch.brickinventoryapp.ressourcen.R
import ch.brickinventoryapp.ui.util.LocalSdkLevel
import ch.brickinventoryapp.ui.util.secretCopyable

/**
 * Unter Android 13 sehen Tastatur und Kopier-Vorschau, was kopiert wird. Wo Kopieren
 * trotzdem bleibt (Gutscheine: Nummer und PIN wandern in ein Bezahlfeld), steht diese
 * Warnung dabei; ab Android 13 nichts.
 */
@Composable
fun SecretKopierWarning(modifier: Modifier = Modifier) {
    if (secretCopyable(LocalSdkLevel.current)) return
    Text(stringResource(R.string.geheim_kopieren_warnung), modifier,
        style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
}
