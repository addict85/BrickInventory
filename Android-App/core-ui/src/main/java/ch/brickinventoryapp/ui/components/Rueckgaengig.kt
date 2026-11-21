package ch.brickinventoryapp.ui.components

import androidx.compose.material3.SnackbarDuration
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.SnackbarResult
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.ui.res.stringResource
import ch.brickinventoryapp.resources.R

/**
 * „deleted“ with „undo“ for a pending deletion. It is deleted when the
 * snackbar ends without „undo“, even if it disappears because the page is
 * left. Every snackbar answers only for its own entry.
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
