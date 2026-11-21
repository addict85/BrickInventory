package ch.brickinventoryapp.app.ui.components

import androidx.compose.foundation.rememberScrollState
import ch.brickinventoryapp.ui.theme.fensterFlaeche
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.paneTitle
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import ch.brickinventoryapp.resources.R
import ch.brickinventoryapp.ui.components.Ueberdeckungsschutz

/**
 * The confirmation before turning on user CAs. Cancel is the default
 * (also tapping away); the yes is in the error color because it takes a risk.
 */
@Composable
fun UserCaDialog(onJa: () -> Unit, onAbbrechen: () -> Unit) {
    val titel = stringResource(R.string.nutzer_ca_frage_titel)
    AlertDialog(
        containerColor = fensterFlaeche(),
        onDismissRequest = onAbbrechen,
        modifier = Modifier.semantics { paneTitle = titel },
        title = { Text(titel, modifier = Modifier.semantics { heading() }) },
        text = {
            Ueberdeckungsschutz()
            Text(stringResource(R.string.nutzer_ca_frage_text), modifier = Modifier.verticalScroll(rememberScrollState()))
        },
        confirmButton = {
            TextButton(
                onClick = onJa,
                colors = ButtonDefaults.textButtonColors(contentColor = MaterialTheme.colorScheme.error),
            ) { Text(stringResource(R.string.nutzer_ca_frage_ja)) }
        },
        dismissButton = { TextButton(onClick = onAbbrechen) { Text(stringResource(R.string.common_cancel)) } },
    )
}
