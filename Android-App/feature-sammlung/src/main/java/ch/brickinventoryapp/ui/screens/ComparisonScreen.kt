package ch.brickinventoryapp.ui.screens

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
import ch.brickinventoryapp.util.NumericInput
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.unit.dp
import okhttp3.HttpUrl.Companion.toHttpUrl
import ch.brickinventoryapp.ressourcen.R
import ch.brickinventoryapp.ui.theme.Abstaende

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

    // Die Eingabe als Abfragewert kodiert: Ein `#` oder `&` darin veränderte sonst die Adresse.
    val keineAppText = stringResource(R.string.common_no_app_to_open)
    // Snackbar statt Toast wie in den Detailseiten: bleibt lesbar, bis TalkBack fertig ist.
    val meldungen = remember { SnackbarHostState() }
    suspend fun openInBrowser(query: String) {
        val url = "https://www.toppreise.ch/produktsuche".toHttpUrl().newBuilder().addQueryParameter("q", query).build()
        if (!ch.brickinventoryapp.util.oeffneExtern(context, url.toString())) meldungen.showSnackbar(keineAppText)
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
                // Suchfeld mit Scannen daneben, wie in Galerie und Merkliste: ein Muster für
                // Scan-Knöpfe statt eines eigenen Tonal-Knopfs mit englischem „Scan“.
                Row(verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(Abstaende.klein)) {
                OutlinedTextField(
                    value = searchText,
                    // Hier tippt man Setnummern und Barcodes, keine Namen — deshalb die
                    // Zahlentastatur. Der Filter gehört dazu: Eine angeschlossene Tastatur, die
                    // Zwischenablage und manche Bildschirmtastaturen liefern trotzdem Buchstaben.
                    // Ausführlich: docs/begruendungen/feature-sammlung/ui/screens/ComparisonScreen.kt.md#z87
                    onValueChange = {
                        searchText = NumericInput.setNumber(it)
                        if (searchText.isNotBlank()) scannedBarcode = null
                    },
                    placeholder = { Text(stringResource(R.string.comparison_search_placeholder)) },
                    leadingIcon = { Icon(Icons.Default.Search, null, Modifier.size(ch.brickinventoryapp.ui.components.mitSchrift(20.dp))) },
                    trailingIcon = {
                        // `cd_search_clear` statt `comparison_clear`: Letzteres heisst „Löschen“ /
                        // „Clear“, und TalkBack sagte am Suche-leeren-Knopf das Wort für „Bestand
                        // vernichten“. Dieses Feld ist kein `Suchfeld`, weil es die Suchtaste der
                        // Tastatur braucht, und nimmt den Text deshalb von Hand.
                        if (searchText.isNotEmpty()) ch.brickinventoryapp.ui.components.MitTooltip(stringResource(R.string.cd_search_clear)) {
                            IconButton(onClick = { searchText = "" }) { Icon(Icons.Default.Clear, stringResource(R.string.cd_search_clear)) }
                        }
                    },
                    modifier = Modifier.weight(1f),
                    singleLine = true,
                    shape = Formen.karte,
                    keyboardOptions = NumericInput.ganzzahlTastatur(ImeAction.Search),
                    keyboardActions = KeyboardActions(onSearch = { triggerSearch() })
                )
                ch.brickinventoryapp.ui.components.ScanKnopf({ showScanner = true })
                }

                Button(
                    onClick = { triggerSearch() },
                    modifier = Modifier.fillMaxWidth(),
                    enabled = searchText.isNotBlank() || scannedBarcode != null
                ) {
                    Icon(Icons.Default.OpenInBrowser, null, Modifier.size(ch.brickinventoryapp.ui.components.mitSchrift(16.dp)))
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
                            style = MaterialTheme.typography.labelSmall,
                            color = MaterialTheme.colorScheme.onPrimaryContainer,
                            modifier = Modifier.padding(horizontal = 10.dp, vertical = Abstaende.winzig)
                        )
                    }
                }
            }
        }

        // Derselbe Hinweis wie jeder Leerzustand der App (Symbol auf runder Fläche).
        ch.brickinventoryapp.ui.components.ZustandsHinweis {
            ch.brickinventoryapp.ui.components.HinweisText(Icons.Default.Search,
                stringResource(R.string.comparison_title), stringResource(R.string.comparison_hint))
        }
    }
    SnackbarHost(meldungen, Modifier.align(Alignment.BottomCenter))
    }
}
