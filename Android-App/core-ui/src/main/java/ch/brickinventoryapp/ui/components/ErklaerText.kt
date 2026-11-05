package ch.brickinventoryapp.ui.components

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.unit.dp
import ch.brickinventoryapp.ressourcen.R
import ch.brickinventoryapp.ui.theme.Abstaende

/**
 * Ein Satz vorn, der Rest hinter „Mehr erfahren“: Mehrzeilige Erklärungen vor dem
 * Inhalt las niemand, und bei 200 % Schrift schoben sie ihn um einen halben Bildschirm.
 */
@Composable
fun ErklaerText(
    kurz: String,
    mehr: String,
    stil: TextStyle = MaterialTheme.typography.bodyMedium,
    farbe: Color = MaterialTheme.colorScheme.onSurfaceVariant,
) {
    var offen by rememberSaveable { mutableStateOf(false) }
    Column(verticalArrangement = Arrangement.spacedBy(Abstaende.winzig)) {
        Text(kurz, style = stil, color = farbe)
        if (offen) Text(mehr, style = MaterialTheme.typography.bodySmall, color = farbe)
        else TextButton(onClick = { offen = true }, contentPadding = PaddingValues(horizontal = 0.dp)) {
            Text(stringResource(R.string.common_learn_more))
        }
    }
}
