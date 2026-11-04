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
import androidx.compose.ui.unit.dp
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.autofill.ContentType
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.contentType
import androidx.compose.ui.semantics.semantics
import ch.brickinventoryapp.ressourcen.R
import ch.brickinventoryapp.ui.*
import ch.brickinventoryapp.ui.components.Abschnitt
import ch.brickinventoryapp.ui.components.PasswortFeld
import ch.brickinventoryapp.ui.components.Rueckfrage
import ch.brickinventoryapp.ui.components.ansagen
import ch.brickinventoryapp.ui.theme.Abstaende
import ch.brickinventoryapp.ui.theme.Formen

/**
 * Haushalt: verknüpfte Konten, Konto einladen, Einladung annehmen — drei Abschnitte
 * mit Überschrift. In einer Karte standen beide Abläufe ungegliedert untereinander,
 * und niemand sah, welcher für welches Konto gedacht ist.
 *
 * Einladen und Annehmen darf jedes Konto (auch Unterkonten und Hauptkonten
 * mehrerer Unterkonten); was der Server nicht erlaubt, sagt seine Meldung.
 */
@Composable
internal fun HouseholdCard(
    state: ch.brickinventoryapp.ui.HouseholdUiState,
    onCreateInvite: () -> Unit,
    onRedeemInvite: (code: String, passwort: String, faktorCode: String?) -> Unit,
    onUnlink: (Int) -> Unit,
    onUnlinkParent: (Int) -> Unit,
    onVerwerfen: (Int) -> Unit,
) {
    val st = state.status
    // remember, nicht rememberSaveable: Gesicherter Zustand landet im Bundle und bei
    // Prozesstod auf der Platte (ActivityManager) — kein Ort für Passwörter und Codes.
    var code by remember { mutableStateOf("") }
    var passwort by remember { mutableStateOf("") }
    var faktorCode by remember { mutableStateOf("") }
    LaunchedEffect(state.eingeloest) { if (state.eingeloest > 0) code = "" }
    // Über GeheimeZwischenablage statt LocalClipboard: Sie nimmt den Code nach
    // einer Minute wieder heraus, auch wenn die Seite dann schon zu ist.
    val kontext = androidx.compose.ui.platform.LocalContext.current
    // Das Etikett eines ClipData ist auf manchen Android-Oberflächen sichtbar und
    // gehört darum in die Sprachdateien. Geholt hier, weil der Klick-Rumpf nicht
    // @Composable ist.
    val einladungEtikett = stringResource(R.string.household_invite_label)
    // Trennen nimmt einem Hauptkonto die Sicht auf fremde Daten; zurück geht es nur
    // über eine neue Einladung. Darum fragt es nach, mit dem Namen des Kontos.
    // Gemerkt wird Konto-ID und ob es ein Hauptkonto ist.
    var trennen by rememberSaveable { mutableStateOf<Int?>(null) }
    var trenntEltern by rememberSaveable { mutableStateOf(false) }

    // Zwei Sätze vorn, der Rest auf Wunsch: Sechs Zeilen Erklärung vor dem ersten
    // Knopf las niemand.
    ch.brickinventoryapp.ui.components.ErklaerText(stringResource(R.string.household_intro),
        stringResource(R.string.household_intro_more))

    // Ein Konto kann zugleich Unterkonto (auch mehrerer Hauptkonten) und
    // Hauptkonto eigener Unterkonten sein: beide Listen unabhängig.
    val eltern = st?.elternkonten.orEmpty()
    // Nur Unterkonten: Die Karte heisst gleich so, statt „Verknüpfte Konten“ und
    // darunter „Unterkonten“ als zweite Überschrift zu zeigen.
    val nurUnterkonten = eltern.isEmpty() && st?.subAccounts?.isNotEmpty() == true
    if (st != null) Abschnitt(stringResource(if (nurUnterkonten) R.string.household_state_main else R.string.household_linked)) {
        if (eltern.isNotEmpty()) {
            Text(stringResource(R.string.household_state_parents),
                style = MaterialTheme.typography.labelLarge)
            eltern.forEach { m ->
                KontoZeile(m.username, stringResource(R.string.household_unlink)) {
                    trennen = m.id; trenntEltern = true
                }
            }
        }
        if (st.subAccounts.isNotEmpty()) {
            if (!nurUnterkonten) Text(stringResource(R.string.household_state_main),
                style = MaterialTheme.typography.labelLarge)
            st.subAccounts.forEach { m ->
                KontoZeile(m.username, stringResource(R.string.household_remove)) {
                    trennen = m.id; trenntEltern = false
                }
            }
        }
        if (eltern.isEmpty() && st.subAccounts.isEmpty()) {
            Text(stringResource(R.string.household_state_none),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        if (st.formerLinks.isNotEmpty()) {
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
    }

    if (st != null) Abschnitt(stringResource(R.string.household_invite_section)) {
        Text(stringResource(R.string.household_invite_hint),
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant)
        Button(onClick = onCreateInvite, enabled = !state.isLoading, modifier = Modifier.fillMaxWidth()) {
            Text(stringResource(R.string.household_invite_create))
        }
        state.inviteCode?.let { c ->
            OutlinedTextField(
                value = c, onValueChange = {}, readOnly = true, singleLine = true,
                label = { Text(stringResource(R.string.household_invite_label)) },
                modifier = Modifier.fillMaxWidth(), shape = Formen.feld,
                trailingIcon = {
                    ch.brickinventoryapp.ui.components.MitTooltip(stringResource(R.string.household_invite_copy)) {
                        IconButton(onClick = {
                            ch.brickinventoryapp.util.GeheimeZwischenablage.kopiere(kontext, einladungEtikett, c)
                        }) { Icon(Icons.Default.ContentCopy, stringResource(R.string.household_invite_copy)) }
                    }
                }
            )
        }
    }

    if (st != null) Abschnitt(stringResource(R.string.household_redeem_title)) {
        Text(stringResource(R.string.household_redeem_hint),
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant)
        // Beschriftet mit dem, was hineingehört; „Einladung annehmen“ ist die Überschrift.
        OutlinedTextField(
            value = code, onValueChange = { code = it }, singleLine = true,
            label = { Text(stringResource(R.string.household_invite_label)) },
            modifier = Modifier.fillMaxWidth(), shape = Formen.feld,
        )
        // Nach einem Fehlversuch ist das Feld leer und rot, bis wieder getippt wird.
        val passwortFalsch = state.passwortFalsch && passwort.isEmpty()
        PasswortFeld(passwort, { passwort = it }, stringResource(R.string.household_redeem_password),
            Modifier.fillMaxWidth(),
            hinweis = if (passwortFalsch) stringResource(R.string.household_redeem_password_wrong) else null,
            fehlerhaft = passwortFalsch)
        // Bei aktivem zweitem Faktor verlangt der Server dessen Code (oder einen Wiederherstellungscode).
        if (state.faktorNoetig) {
            val faktorFalsch = state.faktorFalsch && faktorCode.isEmpty()
            OutlinedTextField(
                value = faktorCode, onValueChange = { faktorCode = it.take(24) }, singleLine = true,
                label = { Text(stringResource(R.string.household_redeem_code)) },
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Ascii),
                isError = faktorFalsch,
                supportingText = if (faktorFalsch) {
                    { Text(stringResource(R.string.household_redeem_code_wrong)) }
                } else null,
                modifier = Modifier.fillMaxWidth().semantics { contentType = ContentType.SmsOtpCode },
                shape = Formen.feld,
            )
        }
        Button(onClick = { onRedeemInvite(code, passwort, faktorCode.takeIf { state.faktorNoetig }); passwort = ""; faktorCode = "" },
               enabled = code.isNotBlank() && passwort.isNotEmpty() && (!state.faktorNoetig || faktorCode.isNotBlank()) &&
                   !state.isLoading, modifier = Modifier.fillMaxWidth()) {
            Text(stringResource(R.string.household_redeem_submit))
        }
    }

    // Meldung des Servers — Währung weicht ab, Konten schon oder
    // umgekehrt verknüpft. Wortlaut unverändert übernommen.
    state.message?.takeUnless { state.passwortFalsch || state.faktorFalsch }?.let {
        Text(it, Modifier.ansagen(), style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.error)
    }

    trennen?.let { id ->
        val name = (if (trenntEltern) eltern.firstOrNull { it.id == id }?.username
                    else st?.subAccounts.orEmpty().firstOrNull { it.id == id }?.username) ?: "—"
        Rueckfrage(
            titel = stringResource(if (trenntEltern) R.string.household_unlink_title else R.string.household_remove_title),
            text = stringResource(if (trenntEltern) R.string.household_unlink_text else R.string.household_remove_text, name),
            bestaetigen = stringResource(if (trenntEltern) R.string.household_unlink else R.string.household_remove),
            onBestaetigen = {
                trennen = null
                if (trenntEltern) onUnlinkParent(id) else onUnlink(id)
            },
            onAbbrechen = { trennen = null },
            symbol = Icons.Default.LinkOff,
        )
    }
}

/** Ein verknüpftes Konto mit seiner einen Aktion; TalkBack hört „Entfernen: lena“, nicht nur „Entfernen“. */
@Composable
private fun KontoZeile(name: String, aktion: String, onAktion: () -> Unit) {
    val beschreibung = stringResource(R.string.aktion_fuer, aktion, name)
    Row(verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Abstaende.klein)) {
        Icon(Icons.Default.AccountCircle, null, tint = MaterialTheme.colorScheme.onSurfaceVariant)
        Text(name, modifier = Modifier.weight(1f), fontWeight = FontWeight.SemiBold)
        TextButton(onClick = onAktion, modifier = Modifier.semantics { contentDescription = beschreibung }) {
            Text(aktion, color = MaterialTheme.colorScheme.error)
        }
    }
}
