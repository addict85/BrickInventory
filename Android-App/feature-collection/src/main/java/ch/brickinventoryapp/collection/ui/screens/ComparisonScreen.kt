package ch.brickinventoryapp.collection.ui.screens

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Clear
import androidx.compose.material.icons.filled.OpenInBrowser
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.unit.dp
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import ch.brickinventoryapp.collection.ui.viewmodel.ComparisonActions
import ch.brickinventoryapp.collection.ui.viewmodel.ComparisonUiState
import ch.brickinventoryapp.collection.ui.viewmodel.ComparisonViewModel
import ch.brickinventoryapp.collection.ui.viewmodel.comparisonUrl
import ch.brickinventoryapp.network.util.externalAddress
import ch.brickinventoryapp.resources.R
import ch.brickinventoryapp.ui.components.HintText
import ch.brickinventoryapp.ui.components.ScanButton
import ch.brickinventoryapp.ui.components.StateHint
import ch.brickinventoryapp.ui.components.WithTooltip
import ch.brickinventoryapp.ui.components.withFont
import ch.brickinventoryapp.ui.theme.Shapes
import ch.brickinventoryapp.ui.theme.Spacing
import ch.brickinventoryapp.ui.util.NumericInput
import ch.brickinventoryapp.ui.util.openExtern
import kotlinx.coroutines.launch

/** The page at its destination: state and actions from its ViewModel. */
@Composable
internal fun ComparisonRoute(vm: ComparisonViewModel = hiltViewModel()) {
    val state by vm.state.collectAsStateWithLifecycle()
    ComparisonScreen(state, vm)
}

@Composable
fun ComparisonScreen(state: ComparisonUiState, actions: ComparisonActions) {
    val context = LocalContext.current
    val noAppText = stringResource(R.string.common_no_app_to_open)
    // Snackbar instead of Toast as on the detail pages: stays readable until TalkBack is done.
    val messages = remember { SnackbarHostState() }
    val scope = rememberCoroutineScope()
    LaunchedEffect(state.pendingQuery) {
        val query = state.pendingQuery ?: return@LaunchedEffect
        val opened = openExtern(context, externalAddress(comparisonUrl(query)))
        // Acknowledging ends this effect; the hint runs on in the page's own scope.
        actions.queryOpened()
        if (!opened) scope.launch { messages.showSnackbar(noAppText) }
    }

    if (state.showScanner) {
        BarcodeScannerScreen(onResult = actions::scanned, onDismiss = actions::closeScanner)
        return
    }

    Box(Modifier.fillMaxSize()) {
        Column(Modifier.fillMaxSize()) {
            ComparisonToolbar(state, actions)
            // The same hint as every empty state in the app (icon on a round surface).
            StateHint {
                HintText(Icons.Default.Search,
                    stringResource(R.string.comparison_title), stringResource(R.string.comparison_hint))
            }
        }
        SnackbarHost(messages, Modifier.align(Alignment.BottomCenter))
    }
}

@Composable
private fun ComparisonToolbar(state: ComparisonUiState, actions: ComparisonActions) {
    val keyboard = LocalSoftwareKeyboardController.current
    val search = { keyboard?.hide(); actions.search() }
    Surface(color = MaterialTheme.colorScheme.surface, tonalElevation = 2.dp) {
        Column(
            Modifier.fillMaxWidth().padding(horizontal = 14.dp, vertical = 10.dp),
            verticalArrangement = Arrangement.spacedBy(Spacing.small)
        ) {
            // Search field with scanning next to it, as in gallery and watchlist: a pattern
            // for scan buttons instead of its own tonal button with an English "Scan".
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Spacing.small)) {
                ComparisonSearchField(state.searchText, actions, search, Modifier.weight(1f))
                ScanButton(actions::openScanner)
            }
            Button(onClick = search, modifier = Modifier.fillMaxWidth(), enabled = state.canSearch) {
                Icon(Icons.Default.OpenInBrowser, null, Modifier.size(withFont(16.dp)))
                Spacer(Modifier.width(6.dp))
                Text(stringResource(R.string.comparison_search), fontWeight = FontWeight.SemiBold)
            }
            if (state.showsBarcode) ScannedBarcode(state.scannedBarcode.orEmpty())
        }
    }
}

@Composable
private fun ComparisonSearchField(text: String, actions: ComparisonActions, search: () -> Unit, modifier: Modifier) {
    OutlinedTextField(
        value = text,
        // This is where you type set numbers and barcodes, not names — hence the
        // numeric keyboard. The filter belongs with it: a connected keyboard, the
        // clipboard and some on-screen keyboards deliver letters regardless.
        onValueChange = actions::setSearch,
        placeholder = { Text(stringResource(R.string.comparison_search_placeholder)) },
        leadingIcon = { Icon(Icons.Default.Search, null, Modifier.size(withFont(20.dp))) },
        trailingIcon = {
            // `cd_search_clear`, not `comparison_clear`: TalkBack read the latter as "destroy". Not a
            // `SearchField`, because it needs the keyboard's search key.
            if (text.isNotEmpty()) WithTooltip(stringResource(R.string.cd_search_clear)) {
                IconButton(onClick = actions::clearSearch) { Icon(Icons.Default.Clear, stringResource(R.string.cd_search_clear)) }
            }
        },
        modifier = modifier,
        singleLine = true,
        shape = Shapes.card,
        keyboardOptions = NumericInput.integerKeyboard(ImeAction.Search),
        keyboardActions = KeyboardActions(onSearch = { search() })
    )
}

@Composable
private fun ScannedBarcode(barcode: String) {
    Surface(shape = Shapes.tag, color = MaterialTheme.colorScheme.primaryContainer.copy(alpha = 0.5f)) {
        Text(
            stringResource(R.string.comparison_barcode_label, barcode),
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onPrimaryContainer,
            modifier = Modifier.padding(horizontal = 10.dp, vertical = Spacing.tiny)
        )
    }
}
