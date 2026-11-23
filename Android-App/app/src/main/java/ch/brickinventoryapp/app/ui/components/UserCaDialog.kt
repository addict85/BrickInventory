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
import androidx.compose.ui.semantics.paneTitle
import androidx.compose.ui.semantics.semantics
import ch.brickinventoryapp.resources.R
import ch.brickinventoryapp.ui.components.OverlayGuard
import ch.brickinventoryapp.ui.theme.windowSurface

/**
 * The confirmation before turning on user CAs. Cancel is the default
 * (also tapping away); the yes is in the error color because it takes a risk.
 */
@Composable
fun UserCaDialog(onYes: () -> Unit, onCancel: () -> Unit) {
    val title = stringResource(R.string.user_ca_question_title)
    AlertDialog(
        containerColor = windowSurface(),
        onDismissRequest = onCancel,
        modifier = Modifier.semantics { paneTitle = title },
        title = { Text(title, modifier = Modifier.semantics { heading() }) },
        text = {
            OverlayGuard()
            Text(stringResource(R.string.user_ca_question_text), modifier = Modifier.verticalScroll(rememberScrollState()))
        },
        confirmButton = {
            TextButton(
                onClick = onYes,
                colors = ButtonDefaults.textButtonColors(contentColor = MaterialTheme.colorScheme.error),
            ) { Text(stringResource(R.string.user_ca_question_yes)) }
        },
        dismissButton = { TextButton(onClick = onCancel) { Text(stringResource(R.string.common_cancel)) } },
    )
}
