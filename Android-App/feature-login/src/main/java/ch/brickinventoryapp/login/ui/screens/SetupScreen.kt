package ch.brickinventoryapp.login.ui.screens

import androidx.camera.core.*
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Cloud
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material.icons.filled.QrCodeScanner
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import ch.brickinventoryapp.login.ui.QrLoginPayload
import ch.brickinventoryapp.login.ui.parseQrPayload
import ch.brickinventoryapp.network.util.NetworkPolicy
import ch.brickinventoryapp.resources.R
import ch.brickinventoryapp.ui.components.AppLockChoice
import ch.brickinventoryapp.ui.components.BrandsHeader
import ch.brickinventoryapp.ui.components.LocalAppLock
import ch.brickinventoryapp.ui.components.LocalAppVersion
import ch.brickinventoryapp.ui.components.announce
import ch.brickinventoryapp.ui.components.outsideTheSystemBars
import ch.brickinventoryapp.ui.components.withFont
import ch.brickinventoryapp.ui.theme.AppCard
import ch.brickinventoryapp.ui.theme.ReadingWidth
import ch.brickinventoryapp.ui.theme.Shapes
import ch.brickinventoryapp.ui.theme.Spacing
import ch.brickinventoryapp.ui.theme.centeredUntil

/**
 * Set up a server: via QR code or by hand, https only. If an
 * http address from an older version is still there, a card at the top explains the path.
 */
@Composable
fun SetupScreen(
    currentUrl: String,
    onSave: (url: String) -> Unit,
    /** Second value: the typed-off fingerprint, if [mustTypeIn] demands it, otherwise null. */
    onQrScanned: ((QrLoginPayload, String?) -> Unit)? = null,
    development: Boolean = NetworkPolicy.development,
    /** The remembered pin for the code's address and fingerprint, if it deviates. */
    previousPin: (url: String, fingerprint: String?) -> String? = { _, _ -> null },
    /** Whether the code's fingerprint needs to be typed off (LoginViewModel.mustTypeIn); when in doubt, yes. */
    mustTypeIn: (url: String, fingerprint: String?) -> Boolean = { _, fp -> fp != null },
) {
    var url          by rememberSaveable { mutableStateOf(currentUrl) }
    var showScanner  by rememberSaveable { mutableStateOf(false) }
    // Saveable: after a rotation the scan would otherwise silently be back at null.
    var scanInvalid by rememberSaveable { mutableStateOf(false) }
    // A QR code can come from anyone: the address is only taken over after a yes.
    // Not saveable: the code carries a sign-in token, and saved state lands on
    // disk on a process death (like the password and code in LoginScreen). After a
    // rotation, one simply scans it again.
    var qrSuggestion  by remember { mutableStateOf<QrLoginPayload?>(null) }
    val keyboard     = LocalSoftwareKeyboardController.current
    val legacyStock   = NetworkPolicy.plaintextLegacyStock(currentUrl, development)
    val error       = if (url.isBlank()) null else NetworkPolicy.addressError(url, development)
    val addressReady = url.isNotBlank() && error == null

    fun save() {
        if (url.isBlank() || error != null) return
        keyboard?.hide(); onSave(NetworkPolicy.normalize(url))
    }

    if (showScanner) {
        // Temporarily expand scanner to support QR codes too
        QrSetupScannerScreen(
            onResult = { raw ->
                showScanner = false
                val payload = parseQrPayload(raw)
                if (payload != null) {
                    qrSuggestion = payload
                } else {
                    scanInvalid = true
                }
            },
            onDismiss = { showScanner = false }
        )
        return
    }

    qrSuggestion?.let { suggestion ->
        QrSuggestionDialog(
            suggestion = suggestion,
            currentUrl = currentUrl,
            development = development,
            previousPin = previousPin,
            mustTypeIn = mustTypeIn,
            onCancel = { qrSuggestion = null },
            onAdopt = { typed ->
                qrSuggestion = null
                url = suggestion.url
                onQrScanned?.invoke(suggestion, typed)
            },
        )
    }

    // Header (brand, hint about an old entry) and action (QR, address, next) as two
    // parts: in landscape they sit side by side, otherwise „Weiter“ was below the fold.
    val headerPart: @Composable ColumnScope.() -> Unit = {
        BrandsHeader(subtitle = stringResource(R.string.setup_subtitle))

        if (legacyStock) {
            Spacer(Modifier.height(Spacing.large))
            // A hint with instructions, not an error: a neutral surface with a border and lock,
            // because it is about encryption. primaryContainer was pink in Noppe and looked
            // like a malfunction with the info icon. The steps as a list instead of flowing text.
            Card(
                modifier = Modifier.fillMaxWidth(),
                colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface,
                    contentColor = MaterialTheme.colorScheme.onSurface),
                border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
            ) {
                Row(Modifier.padding(Spacing.large), horizontalArrangement = Arrangement.spacedBy(Spacing.medium)) {
                    Icon(Icons.Default.Lock, null, Modifier.size(withFont(24.dp)),
                        tint = MaterialTheme.colorScheme.primary)
                    Column(verticalArrangement = Arrangement.spacedBy(Spacing.small)) {
                        Text(stringResource(R.string.setup_legacy_stock_title), fontWeight = FontWeight.Bold)
                        Text(stringResource(R.string.setup_legacy_stock_text, currentUrl),
                            style = MaterialTheme.typography.bodyMedium)
                        listOf(R.string.setup_legacy_stock_step_qr, R.string.setup_legacy_stock_step_address)
                            .forEachIndexed { i, step ->
                                Row(horizontalArrangement = Arrangement.spacedBy(Spacing.small)) {
                                    // A fixed digit column with tabular figures: "1." is narrower than
                                    // "2.", and the steps started at different distances from the left.
                                    Text("${i + 1}.", Modifier.width(withFont(20.dp)),
                                        style = MaterialTheme.typography.bodyMedium.copy(fontFeatureSettings = "tnum"),
                                        fontWeight = FontWeight.SemiBold)
                                    Text(stringResource(step), style = MaterialTheme.typography.bodyMedium)
                                }
                            }
                        Text(stringResource(R.string.setup_legacy_stock_after), style = MaterialTheme.typography.bodyMedium,
                            color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                }
            }
        }
    }
    val actionPart: @Composable ColumnScope.() -> Unit = {
        Spacer(Modifier.height(Spacing.huge))

        // The QR code is the recommended path (address and certificate in one step) and
        // is therefore filled, until an address stands there by hand: then „Weiter“ is the path.
        MainButton(
            main = !addressReady,
            onClick = { scanInvalid = false; showScanner = true },
            modifier = Modifier.fillMaxWidth().heightIn(min = 56.dp)
        ) {
            Icon(Icons.Default.QrCodeScanner, null, Modifier.size(withFont(20.dp)))
            Spacer(Modifier.width(Spacing.small))
            Text(stringResource(R.string.setup_scan_qr), fontWeight = FontWeight.SemiBold)
        }

        if (scanInvalid) {
            Spacer(Modifier.height(Spacing.small))
            Text(stringResource(R.string.setup_invalid_qr), Modifier.announce(), color = MaterialTheme.colorScheme.error,
                style = MaterialTheme.typography.bodySmall)
        }

        Spacer(Modifier.height(Spacing.large))

        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            HorizontalDivider(Modifier.weight(1f))
            // The spacing comes from the padding, not from spaces in the text; otherwise the lines would touch.
            Text(stringResource(R.string.setup_or_manual), style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(horizontal = Spacing.medium))
            HorizontalDivider(Modifier.weight(1f))
        }

        Spacer(Modifier.height(Spacing.large))

        // The shared card (AppCard) instead of one of its own: a surface with elevation like every
        // card in the app, inner spacing from the scale.
        AppCard {
            Column(Modifier.padding(Spacing.large)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Icon(Icons.Default.Cloud, null, tint = MaterialTheme.colorScheme.primary)
                    Spacer(Modifier.width(Spacing.small))
                    Text(stringResource(R.string.setup_server_url), fontWeight = FontWeight.SemiBold)
                }
                Spacer(Modifier.height(Spacing.medium))
                OutlinedTextField(
                    shape = Shapes.field,
                    value = url,
                    onValueChange = { url = it },
                    label = { Text(stringResource(R.string.setup_url_label)) },
                    placeholder = { Text(stringResource(R.string.setup_url_placeholder)) },
                    modifier = Modifier.fillMaxWidth(),
                    singleLine = true,
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri, imeAction = ImeAction.Done),
                    keyboardActions = KeyboardActions(onDone = { save() }),
                    supportingText = {
                        when (error) {
                            NetworkPolicy.AddressError.PLAINTEXT ->
                                Text(stringResource(R.string.setup_plaintext_declined), color = MaterialTheme.colorScheme.error)
                            NetworkPolicy.AddressError.UNREADABLE ->
                                Text(stringResource(R.string.setup_url_unreadable), color = MaterialTheme.colorScheme.error)
                            NetworkPolicy.AddressError.USER_INPUT ->
                                Text(stringResource(R.string.setup_url_user_input), color = MaterialTheme.colorScheme.error)
                            NetworkPolicy.AddressError.EXTRA ->
                                Text(stringResource(R.string.setup_url_extra), color = MaterialTheme.colorScheme.error)
                            null -> Text(stringResource(R.string.setup_url_supporting))
                        }
                    },
                    isError = error != null,
                )
                Spacer(Modifier.height(Spacing.large))
                // Filled: tonal, it sat almost invisible on the card (1.02:1) and looked active
                // when it was actually disabled. Disabled, it stays pale until the address is valid.
                Button(
                    onClick = ::save, modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp),
                    enabled = addressReady,
                ) { Text(stringResource(R.string.setup_continue), fontWeight = FontWeight.Bold) }
            }
        }
        // Offered here because hardly anyone searches the settings after setup.
        // Without a provider (preview, test) the card is missing, as in the settings.
        LocalAppLock.current?.let { lock ->
            Spacer(Modifier.height(Spacing.large))
            AppCard {
                Column(Modifier.padding(Spacing.large), verticalArrangement = Arrangement.spacedBy(Spacing.small)) {
                    AppLockChoice(lock)
                    Text(stringResource(R.string.app_lock_set_up), style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
        }
        // From the app's build info instead of as a literal: versionName is generated on every build
        // (app/build.gradle.kts). Without a name (preview, test) only "Build " would be left standing.
        val version = LocalAppVersion.current.name
        if (version.isNotBlank()) {
            Spacer(Modifier.height(Spacing.large))
            Text(
                stringResource(R.string.setup_build, version),
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.align(Alignment.CenterHorizontally)
            )
        }
    }

    // Scrollable like sign-in (at 200 % font the height was not enough), centered
    // as long as it fits, and on the tablet no wider than a form.
    BoxWithConstraints(Modifier.fillMaxSize().outsideTheSystemBars()) {
        // In Row and Column lambdas, BoxWithConstraints's receiver is locked (DslMarker).
        val height = maxHeight
        if (maxWidth > height && maxWidth >= ACROSS_TWO_COLUMN) {
            Row(
                Modifier.fillMaxSize().centeredUntil(ReadingWidth.form * 2)
                    .padding(horizontal = Spacing.huge),
                horizontalArrangement = Arrangement.spacedBy(Spacing.huge),
            ) {
                listOf(headerPart, actionPart).forEach { part ->
                    Column(
                        Modifier.weight(1f).verticalScroll(rememberScrollState()).heightIn(min = height)
                            .padding(vertical = Spacing.huge),
                        horizontalAlignment = Alignment.CenterHorizontally,
                        verticalArrangement = Arrangement.Center,
                        content = part,
                    )
                }
            }
        } else Column(
            modifier = Modifier.verticalScroll(rememberScrollState()).heightIn(min = height)
                .centeredUntil(ReadingWidth.form).padding(Spacing.huge),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.Center
        ) {
            headerPart()
            actionPart()
        }
    }
}

/** Filled as the main action, otherwise tonal: there is always only ONE filled action. */
@Composable
private fun MainButton(main: Boolean, onClick: () -> Unit, modifier: Modifier, content: @Composable RowScope.() -> Unit) {
    if (main) Button(onClick = onClick, modifier = modifier, content = content)
    else FilledTonalButton(onClick = onClick, modifier = modifier, content = content)
}

/** From this width on, header and action sit side by side in landscape. */
private val ACROSS_TWO_COLUMN = 840.dp
