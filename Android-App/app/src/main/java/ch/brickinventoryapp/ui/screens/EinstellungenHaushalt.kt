package ch.brickinventoryapp.ui.screens

import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import ch.brickinventoryapp.R
import ch.brickinventoryapp.ui.*
import ch.brickinventoryapp.ui.theme.Abstaende
import kotlinx.coroutines.launch

/**
 * Haushalts-Karte: verknüpfen, Einladungscode erzeugen, Verknüpfung lösen.
 *
 * Zeigt je nach Rolle nur EINEN der beiden Kästen. Wer schon Unterkonto ist,
 * sieht keinen Einladungsknopf (Konten lassen sich nur über eine Stufe
 * verknüpfen), und wer Unterkonten hat, sieht kein Eingabefeld. Beides würde
 * der Server ohnehin ablehnen — aber ein Knopf, der immer eine Fehlermeldung
 * erzeugt, ist schlimmer als keiner.
 */
@Composable
internal fun HouseholdCard(
    state: ch.brickinventoryapp.ui.HouseholdUiState,
    onCreateInvite: () -> Unit,
    onRedeemInvite: (code: String, passwort: String) -> Unit,
    onUnlink: (Int) -> Unit,
    onUnlinkParent: (Int) -> Unit,
    onVerwerfen: (Int) -> Unit,
) {
    val st = state.status
    var code by rememberSaveable { mutableStateOf("") }
    var passwort by rememberSaveable { mutableStateOf("") }
    LaunchedEffect(state.eingeloest) { if (state.eingeloest > 0) code = "" }
    // LocalClipboardManager ist veraltet („Use LocalClipboard instead which
    // supports suspend functions"). Der Nachfolger ist kein reiner
    // Namenstausch: `Clipboard.setClipEntry` ist SUSPEND, braucht also einen
    // Bereich, und der Eintrag wird aus einem ClipData gebaut.
    //
    // GELESEN in der Quelle von androidx (Google-Maven ist aus dieser
    // Umgebung gesperrt, raw.githubusercontent.com nicht):
    //
    //   public val LocalClipboard: ProvidableCompositionLocal<Clipboard>
    //   public suspend fun setClipEntry(clipEntry: ClipEntry?)
    //   public actual class ClipEntry(public val clipData: ClipData)
    val clipboard = androidx.compose.ui.platform.LocalClipboard.current
    val kopierBereich = rememberCoroutineScope()
    // Das Etikett eines ClipData ist auf manchen Android-Oberflaechen SICHTBAR
    // — es gehoert darum in die Sprachdateien und nicht in den Quelltext.
    //
    // Hier stand erst `"invite"`, und StringResourceParityTest hat es zu Recht
    // beanstandet: `newPlainText(` endet auf `Text(` und faellt damit unter
    // dieselbe Regel wie ein Compose-`Text("…")`. Das ist kein Fehlalarm des
    // Tests, sondern genau sein Zweck.
    //
    // Geholt wird die Zeichenkette HIER, nicht im onClick: stringResource ist
    // @Composable, der Klick-Rumpf ist es nicht.
    val einladungEtikett = stringResource(R.string.household_invite_label)

    SettingsCard(title = stringResource(R.string.household_title), icon = Icons.Default.Group) {
        Text(stringResource(R.string.household_intro),
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant)

        // Zwei unabhängige Abschnitte: Ein Konto kann zugleich Unterkonto
        // (auch mehrerer Hauptkonten) und Hauptkonto eigener Unterkonten sein.
        val eltern = st?.elternkonten.orEmpty()
        if (eltern.isNotEmpty()) {
            Text(stringResource(R.string.household_state_parents),
                style = MaterialTheme.typography.labelLarge)
            eltern.forEach { m ->
                Row(verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(Abstaende.klein)) {
                    Text(m.username, modifier = Modifier.weight(1f),
                        fontWeight = FontWeight.SemiBold)
                    TextButton(onClick = { onUnlinkParent(m.id) }) {
                        Text(stringResource(R.string.household_unlink))
                    }
                }
            }
        }
        if (st != null && st.subAccounts.isNotEmpty()) {
            Text(stringResource(R.string.household_state_main),
                style = MaterialTheme.typography.labelLarge)
            st.subAccounts.forEach { m ->
                Row(verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(Abstaende.klein)) {
                    Text(m.username, modifier = Modifier.weight(1f),
                        fontWeight = FontWeight.SemiBold)
                    TextButton(onClick = { onUnlink(m.id) }) {
                        Text(stringResource(R.string.household_remove))
                    }
                }
            }
        }
        if (st != null && eltern.isEmpty() && st.subAccounts.isEmpty()) {
            Text(stringResource(R.string.household_state_none),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        if (st != null && st.formerLinks.isNotEmpty()) {
            Surface(color = MaterialTheme.colorScheme.secondaryContainer,
                    shape = MaterialTheme.shapes.small) {
                Column(Modifier.padding(Abstaende.mittel),
                       verticalArrangement = Arrangement.spacedBy(Abstaende.klein)) {
                    Text(stringResource(R.string.household_former_intro),
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSecondaryContainer)
                    st.formerLinks.forEach { f ->
                        Row(verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(Abstaende.klein)) {
                            Column(Modifier.weight(1f)) {
                                Text(f.username, fontWeight = FontWeight.SemiBold,
                                    color = MaterialTheme.colorScheme.onSecondaryContainer)
                                f.via?.let {
                                    Text(stringResource(R.string.household_former_via, it),
                                        style = MaterialTheme.typography.bodySmall,
                                        color = MaterialTheme.colorScheme.onSecondaryContainer)
                                }
                            }
                            TextButton(onClick = { onVerwerfen(f.id) }) {
                                Text(stringResource(R.string.household_former_dismiss))
                            }
                        }
                    }
                }
            }
        }

        // Einladen darf JEDES Konto — auch eines, das selbst Unterkonto ist.
        if (st != null) {
            HorizontalDivider()
            Text(stringResource(R.string.household_invite_hint),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant)
            Button(onClick = onCreateInvite, enabled = !state.isLoading) {
                Text(stringResource(R.string.household_invite_create))
            }
            state.inviteCode?.let { c ->
                OutlinedTextField(
                    value = c, onValueChange = {}, readOnly = true, singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                    trailingIcon = {
                        IconButton(onClick = {
                            kopierBereich.launch {
                                clipboard.setClipEntry(
                                    androidx.compose.ui.platform.ClipEntry(
                                        android.content.ClipData.newPlainText(
                                            einladungEtikett, c)))
                            }
                        }) { Icon(Icons.Default.ContentCopy, stringResource(R.string.household_invite_copy)) }
                    }
                )
            }
        }

        // Einlösen kann jedes Konto: Jedes weitere Hauptkonto braucht seine
        // eigene, angenommene Einladung.
        if (st != null) {
            HorizontalDivider()
            Text(stringResource(R.string.household_redeem_hint),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant)
            OutlinedTextField(
                value = code, onValueChange = { code = it }, singleLine = true,
                label = { Text(stringResource(R.string.household_redeem_title)) },
                modifier = Modifier.fillMaxWidth()
            )
            // Nach einem Fehlversuch ist das Feld leer und rot, bis wieder getippt wird.
            val passwortFalsch = state.passwortFalsch && passwort.isEmpty()
            OutlinedTextField(
                value = passwort, onValueChange = { passwort = it }, singleLine = true,
                label = { Text(stringResource(R.string.household_redeem_password)) },
                visualTransformation = PasswordVisualTransformation(),
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password),
                isError = passwortFalsch,
                supportingText = if (passwortFalsch) {
                    { Text(stringResource(R.string.household_redeem_password_wrong)) }
                } else null,
                modifier = Modifier.fillMaxWidth()
            )
            Button(onClick = { onRedeemInvite(code, passwort); passwort = "" },
                   enabled = code.isNotBlank() && passwort.isNotEmpty() && !state.isLoading) {
                Text(stringResource(R.string.household_redeem_submit))
            }
        }

        // Meldung des Servers — Währung weicht ab, Konten schon oder
        // umgekehrt verknüpft. Wortlaut unverändert übernommen.
        state.message?.takeUnless { state.passwortFalsch }?.let {
            Text(it, style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.error)
        }
    }
}
