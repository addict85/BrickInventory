package ch.brickinventoryapp.collection.ui.screens

import androidx.core.net.toUri
import ch.brickinventoryapp.ui.theme.Formen
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Clear
import androidx.compose.material.icons.filled.OpenInBrowser
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import ch.brickinventoryapp.ui.util.NumericInput
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.unit.dp
import ch.brickinventoryapp.resources.R
import ch.brickinventoryapp.ui.theme.Abstaende
import ch.brickinventoryapp.ui.components.HintText
import ch.brickinventoryapp.ui.components.MitTooltip
import ch.brickinventoryapp.ui.components.ScanButton
import ch.brickinventoryapp.ui.components.StateHint
import ch.brickinventoryapp.ui.components.withFont
import ch.brickinventoryapp.network.util.externeAddress
import ch.brickinventoryapp.ui.util.openExtern

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
            searchText.isNotBlank() -> searchText.trim()
            scannedBarcode != null  -> scannedBarcode
            else                    -> null
        }
    }

    // The input encoded as a query value: a `#` or `&` in it would otherwise change the address.
    val noAppText = stringResource(R.string.common_no_app_to_open)
    // Snackbar instead of Toast as on the detail pages: stays readable until TalkBack is done.
    val meldungen = remember { SnackbarHostState() }
    suspend fun openInBrowser(query: String) {
        val url = "https://www.toppreise.ch/produktsuche".toUri().buildUpon().appendQueryParameter("q", query).build()
        if (!openExtern(context, externeAddress(url.toString()))) meldungen.showSnackbar(noAppText)
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

    Box(Modifier.fillMaxSize()) {
    Column(Modifier.fillMaxSize()) {
        // Toolbar card
        Surface(
            color = MaterialTheme.colorScheme.surface,
            tonalElevation = 2.dp
        ) {
            Column(
                Modifier.fillMaxWidth().padding(horizontal = 14.dp, vertical = 10.dp),
                verticalArrangement = Arrangement.spacedBy(Abstaende.klein)
            ) {
                // Search field with scanning next to it, as in gallery and watchlist: a pattern
                // for scan buttons instead of its own tonal button with an English "Scan".
                Row(verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(Abstaende.klein)) {
                OutlinedTextField(
                    value = searchText,
                    // This is where you type set numbers and barcodes, not names — hence the
                    // numeric keyboard. The filter belongs with it: a connected keyboard, the
                    // clipboard and some on-screen keyboards deliver letters regardless.
                    onValueChange = {
                        searchText = NumericInput.setNumber(it)
                        if (searchText.isNotBlank()) scannedBarcode = null
                    },
                    placeholder = { Text(stringResource(R.string.comparison_search_placeholder)) },
                    leadingIcon = { Icon(Icons.Default.Search, null, Modifier.size(withFont(20.dp))) },
                    trailingIcon = {
                        // `cd_search_clear` instead of `comparison_clear`: the latter means "delete" /
                        // "clear", and TalkBack said the word for "destroy
                        // inventory" at the clear-search button. This field isn't a `Suchfeld`, because it
                        // needs the keyboard's search key, and therefore takes the text by hand.
                        if (searchText.isNotEmpty()) MitTooltip(stringResource(R.string.cd_search_clear)) {
                            IconButton(onClick = { searchText = "" }) { Icon(Icons.Default.Clear, stringResource(R.string.cd_search_clear)) }
                        }
                    },
                    modifier = Modifier.weight(1f),
                    singleLine = true,
                    shape = Formen.karte,
                    keyboardOptions = NumericInput.ganzzahlTastatur(ImeAction.Search),
                    keyboardActions = KeyboardActions(onSearch = { triggerSearch() })
                )
                ScanButton({ showScanner = true })
                }

                Button(
                    onClick = { triggerSearch() },
                    modifier = Modifier.fillMaxWidth(),
                    enabled = searchText.isNotBlank() || scannedBarcode != null
                ) {
                    Icon(Icons.Default.OpenInBrowser, null, Modifier.size(withFont(16.dp)))
                    Spacer(Modifier.width(6.dp))
                    Text(stringResource(R.string.comparison_search), fontWeight = FontWeight.SemiBold)
                }

                // Scanned barcode hint
                if (scannedBarcode != null && searchText.isBlank()) {
                    Surface(
                        shape = Formen.etikett,
                        color = MaterialTheme.colorScheme.primaryContainer.copy(alpha = 0.5f)
                    ) {
                        Text(
                            stringResource(R.string.comparison_barcode_label, scannedBarcode ?: ""),
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onPrimaryContainer,
                            modifier = Modifier.padding(horizontal = 10.dp, vertical = Abstaende.tiny)
                        )
                    }
                }
            }
        }

        // The same hint as every empty state in the app (icon on a round surface).
        StateHint {
            HintText(Icons.Default.Search,
                stringResource(R.string.comparison_title), stringResource(R.string.comparison_hint))
        }
    }
    SnackbarHost(meldungen, Modifier.align(Alignment.BottomCenter))
    }
}
