package ch.brickinventoryapp.app.ui.components

import androidx.compose.foundation.layout.Arrangement
import ch.brickinventoryapp.ui.theme.fensterFlaeche
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.paneTitle
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontFamily
import ch.brickinventoryapp.resources.R
import ch.brickinventoryapp.ui.theme.Abstaende
import ch.brickinventoryapp.security.CertificateUnresolved
import ch.brickinventoryapp.security.fingerprintStart
import ch.brickinventoryapp.security.fingerprintReadable
import ch.brickinventoryapp.ui.components.Ueberdeckungsschutz
import ch.brickinventoryapp.ui.components.Fingerabdruckfeld
import ch.brickinventoryapp.security.Transcript
import androidx.compose.ui.window.DialogProperties

/**
 * Die Frage nach einem Zertifikat, das die App nicht von selbst annimmt. Der Fingerabdruck
 * steht in derselben Schreibweise da wie in der Webapp, damit man ihn vergleichen kann.
 */
@Composable
fun CertificateDialog(
    frage: CertificateUnresolved,
    userCaAn: Boolean,
    trustOn: (eingabe: String?) -> Boolean,
    onNutzerCa: () -> Unit,
    onAbbrechen: () -> Unit,
) {
    if (frage.art == CertificateUnresolved.Art.CODE_ABWEICHUNG) CodeDeviationDialog(frage, onAbbrechen)
    else CertificateQuestionDialog(frage, userCaAn, trustOn, onNutzerCa, onAbbrechen)
}

/** Alles ausser CODE_ABWEICHUNG: Vertrauen nach Vergleich oder Abtippen. */
@Composable
private fun CertificateQuestionDialog(
    frage: CertificateUnresolved,
    userCaAn: Boolean,
    trustOn: (eingabe: String?) -> Boolean,
    onNutzerCa: () -> Unit,
    onAbbrechen: () -> Unit,
) {
    var eingabe by rememberSaveable(frage.fingerabdruck) { mutableStateOf("") }
    var finding by remember(frage.fingerabdruck) { mutableStateOf<Transcript?>(null) }
    // Beim Erstkontakt mit CT-Pflicht freiwillig: Wer abtippt, sieht wie sonst nur den Anfang.
    var typeInSelected by rememberSaveable(frage.fingerabdruck) { mutableStateOf(false) }
    val host = frage.schluessel.substringBeforeLast(':')
    val (titel, text) = titleAndText(frage)
    val geaendert = frage.art == CertificateUnresolved.Art.GEAENDERT || frage.art == CertificateUnresolved.Art.SCHLUESSEL_NEU
    val firstContact = frage.art == CertificateUnresolved.Art.ERSTKONTAKT
    val oeffentlich = firstContact || frage.art == CertificateUnresolved.Art.SCHLUESSEL_NEU
    val writeOff = frage.transcriptNeeded || firstContact && typeInSelected
    val fenster = stringResource(titel)
    AlertDialog(
        containerColor = fensterFlaeche(),
        onDismissRequest = onAbbrechen,
        properties = closable(eingabe),
        modifier = Modifier.semantics { paneTitle = fenster },
        title = { Text(fenster, modifier = Modifier.semantics { heading() }) },
        text = {
            Ueberdeckungsschutz()
            Column(Modifier.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(Abstaende.klein)) {
                Text(stringResource(text, host))
                FingerprintDisplay(frage, writeOff, geaendert)
                if (firstContact && !writeOff) {
                    TextButton(onClick = { typeInSelected = true }) { Text(stringResource(R.string.zert_erstkontakt_abtippen)) }
                }
                if (writeOff) {
                    Fingerabdruckfeld(
                        eingabe = eingabe,
                        onInput = { eingabe = it; finding = null },
                        noetig = Transcript.NEEDED,
                        help = stringResource(inputHelp(frage.art)),
                        fehler = { gezaehlt -> transcriptError(finding, gezaehlt) },
                    )
                    // Unter einer öffentlichen CA trägt der Code keinen Fingerabdruck; dort hilft er nicht.
                    if (!oeffentlich) Text(stringResource(R.string.zert_geaendert_qr), style = MaterialTheme.typography.bodySmall)
                }
                // Die einzige Stelle, an der nach Nutzer-CAs gefragt wird: beim Fehler,
                // mit Erklärung. Danach fragt der Dialog erneut (NUTZER_CA), wieder zum Abtippen.
                if (frage.art == CertificateUnresolved.Art.UNBEKANNTE_CA && !userCaAn) {
                    TextButton(onClick = onNutzerCa) { Text(stringResource(R.string.zert_nutzer_ca)) }
                }
            }
        },
        confirmButton = {
            TrustButton(geaendert, aktiv = !writeOff || eingabe.isNotBlank()) {
                finding = findingAfter(trustOn(eingabe.takeIf { writeOff }), eingabe, frage.fingerabdruck)
            }
        },
        dismissButton = { TextButton(onClick = onAbbrechen) { Text(stringResource(R.string.common_cancel)) } },
    )
}

/** Ein geänderter Schlüssel färbt den Knopf als Warnung; sonst der gewohnte Knopf. */
@Composable
private fun TrustButton(geaendert: Boolean, aktiv: Boolean, onClick: () -> Unit) {
    TextButton(
        onClick = onClick,
        enabled = aktiv,
        colors = if (geaendert) ButtonDefaults.textButtonColors(contentColor = MaterialTheme.colorScheme.error)
                 else ButtonDefaults.textButtonColors(),
    ) { Text(stringResource(if (geaendert) R.string.zert_vertrauen_neu else R.string.zert_vertrauen)) }
}

/** Lehnt die App ab, obwohl die Abschrift passt, steht trotzdem „passt nicht“ da — sonst bliebe der Dialog stumm. */
private fun findingAfter(angenommen: Boolean, eingabe: String, fingerabdruck: String): Transcript? =
    if (angenommen) null
    else Transcript.von(eingabe, fingerabdruck).takeIf { it != Transcript.PASST } ?: Transcript.FITS_NOT

/** Bisheriger und neuer Fingerabdruck; beim Abtippen nur der Anfang. */
@Composable
private fun FingerprintDisplay(frage: CertificateUnresolved, writeOff: Boolean, geaendert: Boolean) {
    frage.erwartet?.let {
        Text(stringResource(R.string.zert_bisher), style = MaterialTheme.typography.labelMedium)
        Text(fingerprintReadable(it), fontFamily = FontFamily.Monospace,
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
    // Was abzutippen ist, steht nicht da: Sonst schriebe man es vom Bildschirm
    // eines Angreifers ab statt aus der Webapp. Der Anfang zeigt nur, welche Zeile.
    Text(stringResource(if (writeOff) R.string.zert_beginnt_mit else R.string.zert_fingerabdruck),
        style = MaterialTheme.typography.labelMedium)
    Text(if (writeOff) fingerprintStart(frage.fingerabdruck) else fingerprintReadable(frage.fingerabdruck),
        fontFamily = FontFamily.Monospace,
        // Ohne Abtippen ist der Vergleich die ganze Prüfung: gross genug zum Lesen.
        style = if (writeOff) MaterialTheme.typography.bodySmall else MaterialTheme.typography.titleMedium,
        color = if (geaendert) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurface)
}

/**
 * Server und gescannter Code nennen verschiedene Schlüssel: nichts zu bestätigen, nur
 * zu erklären. Beide Werte stehen ganz da, abgetippt wird hier nichts.
 */
@Composable
private fun CodeDeviationDialog(frage: CertificateUnresolved, onSchliessen: () -> Unit) {
    val titel = stringResource(R.string.zert_titel_code_abweichung)
    AlertDialog(
        containerColor = fensterFlaeche(),
        onDismissRequest = onSchliessen,
        modifier = Modifier.semantics { paneTitle = titel },
        title = { Text(titel, modifier = Modifier.semantics { heading() }) },
        text = {
            Column(Modifier.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(Abstaende.klein)) {
                Text(stringResource(R.string.zert_text_code_abweichung, frage.schluessel.substringBeforeLast(':')))
                frage.erwartet?.let {
                    Text(stringResource(R.string.zert_laut_code), style = MaterialTheme.typography.labelMedium)
                    Text(fingerprintReadable(it), fontFamily = FontFamily.Monospace, style = MaterialTheme.typography.bodySmall)
                }
                Text(stringResource(R.string.zert_vom_server), style = MaterialTheme.typography.labelMedium)
                Text(fingerprintReadable(frage.fingerabdruck), fontFamily = FontFamily.Monospace,
                    style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.error)
            }
        },
        confirmButton = { TextButton(onClick = onSchliessen) { Text(stringResource(R.string.common_ok)) } },
    )
}

/**
 * Ein Tipp neben den Dialog verwarf das halb Abgetippte. Zurück schliesst nur, solange
 * nichts getippt ist; daneben tippen nie — Abbrechen bleibt der ausdrückliche Weg.
 */
internal fun closable(eingabe: String) =
    DialogProperties(dismissOnBackPress = eingabe.isEmpty(), dismissOnClickOutside = false)

/** „Zu kurz“ sagt, wie viel fehlt; „passt nicht“ heisst, die Zeichen stimmen nicht. */
@Composable
private fun transcriptError(finding: Transcript?, gezaehlt: Int): String? = when (finding) {
    null, Transcript.PASST -> null
    Transcript.LEER, Transcript.TO_SHORT -> stringResource(R.string.zert_eingabe_zu_kurz, gezaehlt, Transcript.NEEDED)
    Transcript.FITS_NOT -> stringResource(R.string.zert_eingabe_falsch)
}

/** Woher die Abschrift kommt: Schlüssel einer öffentlichen CA kennt die Webapp nicht, nur der Browser. */
private fun inputHelp(art: CertificateUnresolved.Art): Int = when (art) {
    CertificateUnresolved.Art.SCHLUESSEL_NEU -> R.string.zert_schluessel_neu_eingabe
    CertificateUnresolved.Art.ERSTKONTAKT -> R.string.zert_erstkontakt_eingabe
    CertificateUnresolved.Art.GEAENDERT -> R.string.zert_geaendert_eingabe
    else -> R.string.zert_unbekannt_eingabe
}

/** Überschrift und Erklärung je Art der Frage; ohne CT-Pflicht erklärt der Erstkontakt das Abtippen. */
private fun titleAndText(frage: CertificateUnresolved): Pair<Int, Int> = when (frage.art) {
    CertificateUnresolved.Art.ERSTKONTAKT -> R.string.zert_titel_erstkontakt to
        if (frage.transcriptNeeded) R.string.zert_text_erstkontakt_abtippen else R.string.zert_text_erstkontakt
    CertificateUnresolved.Art.UNBEKANNTE_CA -> R.string.zert_titel_unbekannt to R.string.zert_text_unbekannt
    CertificateUnresolved.Art.NUTZER_CA -> R.string.zert_titel_nutzer_ca to R.string.zert_text_nutzer_ca
    CertificateUnresolved.Art.GEAENDERT -> R.string.zert_titel_geaendert to R.string.zert_text_geaendert
    CertificateUnresolved.Art.CODE_ABWEICHUNG -> R.string.zert_titel_code_abweichung to R.string.zert_text_code_abweichung
    CertificateUnresolved.Art.SCHLUESSEL_NEU -> R.string.zert_titel_schluessel_neu to R.string.zert_text_schluessel_neu
}
