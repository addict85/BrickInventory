package ch.brickinventoryapp.ui.screens

import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.runtime.getValue
import androidx.compose.runtime.setValue
import ch.brickinventoryapp.ui.theme.Abstaende

@Composable
fun CatalogDetailRow(label: String, value: String) {
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
        Text(label, color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodyMedium)
        Text(value, fontWeight = FontWeight.SemiBold, style = MaterialTheme.typography.bodyMedium,
            modifier = Modifier.padding(start = Abstaende.gross))
    }
}
