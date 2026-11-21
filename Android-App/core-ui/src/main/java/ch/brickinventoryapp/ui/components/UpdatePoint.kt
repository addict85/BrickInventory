package ch.brickinventoryapp.ui.components

import androidx.compose.material3.Badge
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import ch.brickinventoryapp.resources.R

/**
 * The dot for a new version waiting — on „More“ and on
 * settings. A badge without text says nothing to voice output; the
 * description names what it stands for.
 */
@Composable
fun UpdatePoint(modifier: Modifier = Modifier) {
    val text = stringResource(R.string.update_badge)
    Badge(modifier.semantics { contentDescription = text })
}
