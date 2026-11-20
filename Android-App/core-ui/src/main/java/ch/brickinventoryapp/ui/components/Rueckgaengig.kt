package ch.brickinventoryapp.ui.components

import androidx.compose.material3.SnackbarDuration
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.SnackbarResult
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.ui.res.stringResource
import ch.brickinventoryapp.ressourcen.R

/**
 * „gelöscht“ mit „Rückgängig“ zu einem vorgemerkten Löschen. Gelöscht wird, wenn die
 * Snackbar ohne „Rückgängig“ endet, auch wenn sie verschwindet, weil man die Seite
 * verlässt. Jede Snackbar antwortet nur für ihren Eintrag.
 */
@Composable
fun <T : Any> UndoMessage(
    vorgemerkt: T?,
    text: String,
    host: SnackbarHostState,
    onUndo: (T) -> Unit,
    executeOn: (T) -> Unit,
) {
    val rueckgaengig = stringResource(R.string.common_undo)
    val satz by rememberUpdatedState(text)
    LaunchedEffect(vorgemerkt) {
        val v = vorgemerkt ?: return@LaunchedEffect
        var zurueck = false
        try {
            zurueck = host.showSnackbar(satz, rueckgaengig, duration = SnackbarDuration.Long) ==
                SnackbarResult.ActionPerformed
        } finally {
            if (zurueck) onUndo(v) else executeOn(v)
        }
    }
}
