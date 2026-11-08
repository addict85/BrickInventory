package ch.brickinventoryapp.app.ui.components

import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import ch.brickinventoryapp.ressourcen.R
import ch.brickinventoryapp.ui.components.Ueberdeckungsschutz

/**
 * Die Rückfrage vor dem Einschalten der Nutzer-CAs. Abbrechen ist die Vorgabe
 * (auch Wegtippen); das Ja steht in der Fehlerfarbe, weil es ein Risiko eingeht.
 */
@Composable
fun NutzerCaDialog(onJa: () -> Unit, onAbbrechen: () -> Unit) {
    AlertDialog(
        onDismissRequest = onAbbrechen,
        title = { Text(stringResource(R.string.nutzer_ca_frage_titel), modifier = Modifier.semantics { heading() }) },
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
