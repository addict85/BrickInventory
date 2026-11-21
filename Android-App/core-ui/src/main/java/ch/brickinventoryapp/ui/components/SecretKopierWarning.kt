package ch.brickinventoryapp.ui.components

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import ch.brickinventoryapp.resources.R
import ch.brickinventoryapp.ui.util.LocalSdkLevel
import ch.brickinventoryapp.ui.util.secretCopyable

/**
 * On Android 13, the keyboard and the copy preview see what's copied. Where copying
 * stays anyway (vouchers: number and PIN go into a payment field), this
 * warning sits next to it; from Android 13 onward, nothing.
 */
@Composable
fun SecretKopierWarning(modifier: Modifier = Modifier) {
    if (secretCopyable(LocalSdkLevel.current)) return
    Text(stringResource(R.string.geheim_kopieren_warnung), modifier,
        style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
}
