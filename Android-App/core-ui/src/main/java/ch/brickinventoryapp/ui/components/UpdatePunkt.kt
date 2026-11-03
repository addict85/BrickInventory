package ch.brickinventoryapp.ui.components

import androidx.compose.material3.Badge
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import ch.brickinventoryapp.ressourcen.R

/**
 * Der Punkt für eine bereitliegende neue Version — an „Mehr“ und an den
 * Einstellungen. Ein Badge ohne Text sagt der Sprachausgabe nichts; die
 * Beschreibung nennt, wofür er steht.
 */
@Composable
fun UpdatePunkt(modifier: Modifier = Modifier) {
    val text = stringResource(R.string.update_badge)
    Badge(modifier.semantics { contentDescription = text })
}
