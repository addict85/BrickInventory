package ch.brickinventoryapp.ui.screens

import ch.brickinventoryapp.ui.theme.Formen
import android.content.Intent
import android.net.Uri
import android.util.Log
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Clear
import androidx.compose.material.icons.filled.OpenInBrowser
import androidx.compose.material.icons.filled.QrCodeScanner
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import ch.brickinventoryapp.R

@Composable
fun ComparisonScreen() {
    val context        = LocalContext.current
    var scannedBarcode by remember { mutableStateOf<String?>(null) }
    var searchText     by rememberSaveable { mutableStateOf("") }
    var activeQuery    by remember { mutableStateOf<String?>(null) }
    var showScanner    by rememberSaveable { mutableStateOf(false) }
    val keyboard       = LocalSoftwareKeyboardController.current

    fun triggerSearch() {
        keyboard?.hide()
        activeQuery = when {
            searchText.isNotBlank() -> searchText.trim().replace(" ", "+")
            scannedBarcode != null  -> scannedBarcode
            else                    -> null
        }
    }

    fun openInBrowser(query: String) {
        val url = "https://www.toppreise.ch/produktsuche?q=$query"
        Log.d("ComparisonScreen", "Opening in browser: $url")
        context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)))
    }

    LaunchedEffect(activeQuery) {
        activeQuery?.let { openInBrowser(it) }
    }

    if (showScanner) {
        BarcodeScannerScreen(
            onResult = { barcode ->
                scannedBarcode = barcode
                searchText = ""
                showScanner = false
                activeQuery = barcode
            },
            onDismiss = { showScanner = false }
        )
        return
    }

    Column(Modifier.fillMaxSize()) {
        // Toolbar card
        Surface(
            color = MaterialTheme.colorScheme.surface,
            tonalElevation = 2.dp
        ) {
            Column(
                Modifier.fillMaxWidth().padding(horizontal = 14.dp, vertical = 10.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                // Search field
                OutlinedTextField(
                    value = searchText,
                    onValueChange = {
                        searchText = it
                        if (it.isNotBlank()) scannedBarcode = null
                    },
                    placeholder = { Text(stringResource(R.string.comparison_search_placeholder)) },
                    leadingIcon = { Icon(Icons.Default.Search, null, Modifier.size(20.dp)) },
                    trailingIcon = {
                        if (searchText.isNotEmpty())
                            IconButton(onClick = { searchText = "" }) { Icon(Icons.Default.Clear, stringResource(R.string.comparison_clear)) }
                    },
                    modifier = Modifier.fillMaxWidth(),
                    singleLine = true,
                    shape = Formen.karte,
                    colors = OutlinedTextFieldDefaults.colors(
                        unfocusedBorderColor = MaterialTheme.colorScheme.outline.copy(alpha = 0.4f)
                    ),
                    keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search),
                    keyboardActions = KeyboardActions(onSearch = { triggerSearch() })
                )

                // Action row
                Row(
                    Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Button(
                        onClick = { triggerSearch() },
                        modifier = Modifier.weight(1f),
                        enabled = searchText.isNotBlank() || scannedBarcode != null,
                        shape = Formen.knopf
                    ) {
                        Icon(Icons.Default.OpenInBrowser, null, Modifier.size(16.dp))
                        Spacer(Modifier.width(6.dp))
                        Text(stringResource(R.string.comparison_search), fontWeight = FontWeight.SemiBold)
                    }
                    FilledTonalButton(
                        onClick = { showScanner = true },
                        shape = Formen.knopf,
                        contentPadding = PaddingValues(horizontal = 16.dp, vertical = 8.dp)
                    ) {
                        Icon(Icons.Default.QrCodeScanner, null, Modifier.size(16.dp))
                        Spacer(Modifier.width(6.dp))
                        Text(if (scannedBarcode != null) stringResource(R.string.comparison_scan_new) else stringResource(R.string.comparison_scan))
                    }
                }

                // Scanned barcode hint
                if (scannedBarcode != null && searchText.isBlank()) {
                    Surface(
                        shape = Formen.etikett,
                        color = MaterialTheme.colorScheme.primaryContainer.copy(alpha = 0.5f)
                    ) {
                        Text(
                            stringResource(R.string.comparison_barcode_label, scannedBarcode ?: ""),
                            style = MaterialTheme.typography.labelSmall,
                            color = MaterialTheme.colorScheme.onPrimaryContainer,
                            modifier = Modifier.padding(horizontal = 10.dp, vertical = 4.dp)
                        )
                    }
                }
            }
        }

        // Placeholder
        Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
            Column(
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(14.dp),
                modifier = Modifier.padding(32.dp)
            ) {
                Surface(
                    shape = Formen.chip,
                    color = MaterialTheme.colorScheme.primaryContainer.copy(alpha = 0.4f),
                    modifier = Modifier.size(80.dp)
                ) {
                    Box(Modifier.fillMaxSize(), Alignment.Center) {
                        Icon(Icons.Default.Search, null, Modifier.size(36.dp),
                            tint = MaterialTheme.colorScheme.primary.copy(alpha = 0.6f))
                    }
                }
                Text(stringResource(R.string.comparison_title),
                    fontWeight = FontWeight.SemiBold, fontSize = 16.sp)
                Text(
                    stringResource(R.string.comparison_hint),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    textAlign = TextAlign.Center
                )
            }
        }
    }
}
