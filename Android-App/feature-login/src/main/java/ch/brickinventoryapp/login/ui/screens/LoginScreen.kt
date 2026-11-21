package ch.brickinventoryapp.login.ui.screens

import androidx.compose.foundation.BorderStroke
import ch.brickinventoryapp.ui.theme.fensterFlaeche
import androidx.compose.foundation.verticalScroll
import ch.brickinventoryapp.ui.theme.centeredUntil
import androidx.compose.foundation.rememberScrollState
import ch.brickinventoryapp.ui.theme.Formen
import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.ui.semantics.Role
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.paneTitle
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.*
import androidx.compose.ui.unit.dp
import ch.brickinventoryapp.resources.R
import ch.brickinventoryapp.login.ui.AnmeldeFormular
import ch.brickinventoryapp.login.ui.QrAccount
import ch.brickinventoryapp.ui.components.announce
import ch.brickinventoryapp.ui.components.outsideTheSystemBars
import ch.brickinventoryapp.ui.theme.Abstaende
import ch.brickinventoryapp.ui.components.LoginCard
import ch.brickinventoryapp.ui.components.BrandsHeader
import ch.brickinventoryapp.ui.components.KeyboardWithoutLearn
import ch.brickinventoryapp.ui.components.Ueberdeckungsschutz
import ch.brickinventoryapp.ui.components.withFont
import ch.brickinventoryapp.ui.theme.Lesebreite

/**
 * Sign in, create an account, request a reset link — like the web app. Three
 * forms in one screen, so that the back button means "back to sign-in".
 * The web UI sets the new password: intercepting the link would need
 * an intent filter on an address that everyone sets themselves.
 */
@Composable
fun LoginScreen(
    serverUrl: String,
    isLoading: Boolean,
    error: String?,
    codeNoetig: Boolean,
    formular: AnmeldeFormular,
    registrierungOffen: Boolean?,
    kontoLaeuft: Boolean,
    kontoMeldung: String?,
    kontoFehler: String?,
    onLogin: (String, String, String?) -> Unit,
    onFormular: (AnmeldeFormular) -> Unit,
    onRegistrieren: (String, String, String, String, String) -> Unit,
    onPasswortVergessen: (String) -> Unit,
    onChangeServer: () -> Unit,
    vollerZugriff: Boolean = false,
    onVollerZugriff: (Boolean) -> Unit = {},
    /** null: no passkey button (for instance in preview and test). */
    onPasskey: (() -> Unit)? = null,
    passkeyStattCode: Boolean = false,
    onPasskeyStattCode: (String, String) -> Unit = { _, _ -> },
    /** After a QR scan: the code one types into the browser. */
    qrBestaetigung: String? = null,
) {
    var username by rememberSaveable { mutableStateOf("") }
    // remember, not rememberSaveable: saved state ends up in the bundle and on a
    // process death on disk (ActivityManager) — no place for passwords and codes.
    var password by remember { mutableStateOf("") }
    var code     by remember { mutableStateOf("") }
    val focusMgr = LocalFocusManager.current
    // A planted tap can sign in here or confirm a passkey. The
    // visual protection for a revealed password is brought along by the PasswordField itself.
    Ueberdeckungsschutz()

    // The keyboard does not learn password, code or address.
    KeyboardWithoutLearn {
    val kopf: @Composable ColumnScope.() -> Unit = {
            // The same header as during setup, which comes right before this.
            BrandsHeader()
            Spacer(Modifier.height(Abstaende.mittel))

            // The chip switches the server: TalkBack names that along with the address (the surface
            // combines the description with its role „Schaltfläche“). The address wraps
            // instead of being truncated: it is exactly what one checks before signing in.
            val changeServer = stringResource(R.string.login_server_aendern, serverUrl)
            Surface(
                onClick = onChangeServer,
                // Surface(onClick) sets no role: TalkBack would otherwise only read the address.
                modifier = Modifier.semantics {
                    role = Role.Button
                    contentDescription = changeServer
                },
                shape = Formen.chip,
                color = MaterialTheme.colorScheme.surface,
                // outline: the border is the chip's only boundary and needs 3:1.
                border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline),
            ) {
                Row(Modifier.heightIn(min = 32.dp).padding(horizontal = Abstaende.klein, vertical = Abstaende.tiny),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(Abstaende.klein)) {
                    Icon(Icons.Default.Cloud, null, Modifier.size(withFont(16.dp)),
                        tint = MaterialTheme.colorScheme.primary)
                    Text(serverUrl, Modifier.weight(1f, fill = false),
                        style = MaterialTheme.typography.labelMedium)
                    Icon(Icons.Default.Edit, null, Modifier.size(withFont(16.dp)),
                        tint = MaterialTheme.colorScheme.primary)
                }
            }
            if (qrBestaetigung != null) {
                Spacer(Modifier.height(Abstaende.mittel))
                Text(stringResource(R.string.login_qr_bestaetigen_hinweis), style = MaterialTheme.typography.bodyMedium)
                Text(qrBestaetigung.chunked(3).joinToString(" "), Modifier.semantics { liveRegion = LiveRegionMode.Polite },
                    style = MaterialTheme.typography.headlineMedium)
            }
    }
    val karte: @Composable (breit: Boolean) -> Unit = { breit ->
            LoginCard {
                when (formular) {
                    AnmeldeFormular.ANMELDEN -> AnmeldeFelder(
                        username = username, onUsername = { username = it },
                        password = password, onPassword = { password = it },
                        codeNoetig = codeNoetig, code = code, onCode = { code = it },
                        isLoading = isLoading, error = error,
                        registrierungOffen = registrierungOffen,
                        focusMgr = focusMgr,
                        onLogin = onLogin, onFormular = onFormular,
                        vollerZugriff = vollerZugriff, onVollerZugriff = onVollerZugriff,
                        onPasskey = onPasskey,
                        onPasskeyStattCode = onPasskeyStattCode.takeIf { passkeyStattCode && onPasskey != null })

                    AnmeldeFormular.REGISTER -> RegistrierFields(
                        laeuft = kontoLaeuft, meldung = kontoMeldung, fehler = kontoFehler,
                        focusMgr = focusMgr, namesSideBySide = breit,
                        onRegistrieren = onRegistrieren, onFormular = onFormular)

                    AnmeldeFormular.PASSWORD_FORGOTTEN -> ForgottenFields(
                        laeuft = kontoLaeuft, meldung = kontoMeldung, fehler = kontoFehler,
                        sendOn = onPasswortVergessen, onFormular = onFormular)
                }
            }
    }
    // Scrollable and centered as long as it fits: with a keyboard or large font, the
    // main button would otherwise sit unreachably below the fold. In landscape, brand and form
    // sit side by side as during setup, otherwise „Registrieren“ was below the fold.
    BoxWithConstraints(Modifier.fillMaxSize().outsideTheSystemBars()) {
        val hoehe = maxHeight
        if (maxWidth > hoehe && maxWidth >= ACROSS_TWO_COLUMN) {
            Row(
                Modifier.fillMaxSize().centeredUntil(Lesebreite.formular * 2)
                    .padding(horizontal = Abstaende.huge),
                horizontalArrangement = Arrangement.spacedBy(Abstaende.huge),
            ) {
                Column(Modifier.weight(1f).verticalScroll(rememberScrollState()).heightIn(min = hoehe)
                    .padding(vertical = Abstaende.gross),
                    horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center,
                    content = kopf)
                Column(Modifier.weight(1f).verticalScroll(rememberScrollState()).heightIn(min = hoehe)
                    .padding(vertical = Abstaende.gross),
                    horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center) {
                    karte(true)
                }
            }
        } else Column(
            modifier = Modifier.verticalScroll(rememberScrollState()).heightIn(min = hoehe)
                .centeredUntil(Lesebreite.formular)
                .padding(horizontal = 28.dp, vertical = Abstaende.gross),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.Center,
        ) {
            kopf()
            Spacer(Modifier.height(28.dp))
            karte(false)
        }
    }
}
}

/**
 * Which account on which server the code signs in to, before the app
 * takes over the access: a planted code would otherwise silently sign in to someone
 * else's account, and everything entered would end up there. Tapping away means no.
 */
@Composable
internal fun QrAccountQuestion(konto: QrAccount, onQrAccount: (uebernehmen: Boolean) -> Unit) {
    val titel = stringResource(R.string.login_qr_konto_titel)
    AlertDialog(
        containerColor = fensterFlaeche(),
        onDismissRequest = { onQrAccount(false) },
        modifier = Modifier.semantics { paneTitle = titel },
        title = { Text(titel, Modifier.semantics { heading() }) },
        text = {
            Ueberdeckungsschutz()
            Text(stringResource(R.string.login_qr_konto_text, konto.benutzer, konto.server))
        },
        confirmButton = {
            TextButton(onClick = { onQrAccount(true) }) { Text(stringResource(R.string.login_qr_konto_ja)) }
        },
        dismissButton = {
            TextButton(onClick = { onQrAccount(false) }) { Text(stringResource(R.string.common_cancel)) }
        },
    )
}

/** From this width on, in landscape, brand and form sit side by side (like SetupScreen). */
private val ACROSS_TWO_COLUMN = 840.dp

/**
 * A persistent message in the form — error red, confirmation calm. One version
 * for sign-in, register and forgot, so that spacing and border shape stay the
 * same everywhere.
 */
@Composable
internal fun FormMessage(text: String, fehler: Boolean) {
    Surface(
        shape = Formen.kachel,
        color = if (fehler) MaterialTheme.colorScheme.errorContainer
                else MaterialTheme.colorScheme.secondaryContainer
    ) {
        Row(
            Modifier.fillMaxWidth().padding(10.dp),
            horizontalArrangement = Arrangement.spacedBy(Abstaende.klein),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Icon(
                if (fehler) Icons.Default.Warning else Icons.Default.CheckCircle, null,
                Modifier.size(16.dp),
                tint = if (fehler) MaterialTheme.colorScheme.onErrorContainer
                       else MaterialTheme.colorScheme.onSecondaryContainer
            )
            Text(
                text,
                // Announced: after „Anmelden“ a blind person otherwise heard nothing.
                modifier = Modifier.announce(),
                color = if (fehler) MaterialTheme.colorScheme.onErrorContainer
                        else MaterialTheme.colorScheme.onSecondaryContainer,
                style = MaterialTheme.typography.bodySmall
            )
        }
    }
}

/** A button that loads: a spinner instead of a label while something is running. */
@Composable
internal fun LoadButton(text: String, laeuft: Boolean, aktiv: Boolean, fehlt: String? = null, onClick: () -> Unit) {
    // Ein gesperrter Hauptknopf sagt, was fehlt: Blass allein liess raten, warum.
    if (!aktiv && !laeuft && fehlt != null) Text(fehlt, style = MaterialTheme.typography.bodySmall,
        color = MaterialTheme.colorScheme.onSurfaceVariant)
    Button(
        onClick = onClick,
        modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp),
        enabled = !laeuft && aktiv
    ) {
        if (laeuft) {
            CircularProgressIndicator(Modifier.size(18.dp),
                color = MaterialTheme.colorScheme.onPrimary, strokeWidth = 2.dp)
        } else {
            Text(text, fontWeight = FontWeight.SemiBold, style = MaterialTheme.typography.titleMedium)
        }
    }
}
