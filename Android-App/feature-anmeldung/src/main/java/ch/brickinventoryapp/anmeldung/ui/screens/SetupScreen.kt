package ch.brickinventoryapp.anmeldung.ui.screens

import ch.brickinventoryapp.ui.theme.Formen
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
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
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.camera.core.*
import androidx.compose.foundation.border
import androidx.compose.ui.res.stringResource
import ch.brickinventoryapp.ressourcen.R
import ch.brickinventoryapp.netz.util.NetworkPolicy
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import ch.brickinventoryapp.ui.theme.mittigBis
import ch.brickinventoryapp.anmeldung.ui.QrLoginPayload
import ch.brickinventoryapp.anmeldung.ui.parseQrPayload
import ch.brickinventoryapp.ui.theme.Abstaende
import ch.brickinventoryapp.ui.theme.AppKarte
import ch.brickinventoryapp.ui.components.ausserhalbDerSystemleisten
import ch.brickinventoryapp.ui.components.ansagen
import ch.brickinventoryapp.ui.components.LocalAppFassung
import ch.brickinventoryapp.ui.components.MarkenKopf
import ch.brickinventoryapp.ui.components.mitSchrift
import ch.brickinventoryapp.ui.theme.Lesebreite

/**
 * Server einrichten: per QR-Code oder von Hand, nur mit https. Steht noch eine
 * http-Adresse aus einer älteren Fassung da, erklärt eine Karte oben den Weg.
 */
@Composable
fun SetupScreen(
    currentUrl: String,
    onSave: (url: String) -> Unit,
    /** Zweiter Wert: der abgeschriebene Fingerabdruck, wenn [mussAbtippen] ihn verlangt, sonst null. */
    onQrScanned: ((QrLoginPayload, String?) -> Unit)? = null,
    entwicklung: Boolean = NetworkPolicy.entwicklung,
    /** Der gemerkte Pin für Adresse und Fingerabdruck des Codes, wenn er abweicht. */
    bisherigerPin: (url: String, fingerabdruck: String?) -> String? = { _, _ -> null },
    /** Ob der Fingerabdruck des Codes abzutippen ist (AnmeldungViewModel.mussAbtippen); im Zweifel ja. */
    mussAbtippen: (url: String, fingerabdruck: String?) -> Boolean = { _, fp -> fp != null },
) {
    var url          by rememberSaveable { mutableStateOf(currentUrl) }
    var showScanner  by rememberSaveable { mutableStateOf(false) }
    // Saveable: Nach einer Drehung stünde der Scan sonst kommentarlos wieder bei null.
    var scanUngueltig by rememberSaveable { mutableStateOf(false) }
    // Ein QR-Code kann von jedem stammen: Die Adresse wird erst nach einem Ja übernommen.
    // Nicht saveable: Der Code trägt ein Anmeldetoken, und gesicherter Zustand landet bei
    // Prozesstod auf der Platte (wie Passwort und Code in LoginScreen). Nach einer
    // Drehung scannt man ihn noch einmal.
    var qrVorschlag  by remember { mutableStateOf<QrLoginPayload?>(null) }
    val keyboard     = LocalSoftwareKeyboardController.current
    val altbestand   = NetworkPolicy.klartextAltbestand(currentUrl, entwicklung)
    val fehler       = if (url.isBlank()) null else NetworkPolicy.adressfehler(url, entwicklung)
    val adresseBereit = url.isNotBlank() && fehler == null

    fun save() {
        if (url.isBlank() || fehler != null) return
        keyboard?.hide(); onSave(NetworkPolicy.normalisiere(url))
    }

    if (showScanner) {
        // Temporarily expand scanner to support QR codes too
        QrSetupScannerScreen(
            onResult = { raw ->
                showScanner = false
                val payload = parseQrPayload(raw)
                if (payload != null) {
                    qrVorschlag = payload
                } else {
                    scanUngueltig = true
                }
            },
            onDismiss = { showScanner = false }
        )
        return
    }

    qrVorschlag?.let { vorschlag ->
        QrVorschlagDialog(
            vorschlag = vorschlag,
            currentUrl = currentUrl,
            entwicklung = entwicklung,
            bisherigerPin = bisherigerPin,
            mussAbtippen = mussAbtippen,
            onAbbrechen = { qrVorschlag = null },
            onUebernehmen = { abgetippt ->
                qrVorschlag = null
                url = vorschlag.url
                onQrScanned?.invoke(vorschlag, abgetippt)
            },
        )
    }

    // Kopf (Marke, Hinweis zum Altbestand) und Handlung (QR, Adresse, Weiter) als zwei
    // Teile: Im Querformat stehen sie nebeneinander, sonst lag „Weiter“ unter dem Falz.
    val kopfTeil: @Composable ColumnScope.() -> Unit = {
        MarkenKopf(untertitel = stringResource(R.string.setup_subtitle))

        if (altbestand) {
            Spacer(Modifier.height(Abstaende.gross))
            // Ein Hinweis mit Anleitung, kein Fehler: neutrale Fläche mit Rahmen und Schloss,
            // denn es geht um Verschlüsselung. primaryContainer war in Noppe rosa und sah
            // mit dem Infosymbol nach Störung aus. Die Schritte als Liste statt Fliesstext.
            Card(
                modifier = Modifier.fillMaxWidth(),
                colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface,
                    contentColor = MaterialTheme.colorScheme.onSurface),
                border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
            ) {
                Row(Modifier.padding(Abstaende.gross), horizontalArrangement = Arrangement.spacedBy(Abstaende.mittel)) {
                    Icon(Icons.Default.Lock, null, Modifier.size(mitSchrift(24.dp)),
                        tint = MaterialTheme.colorScheme.primary)
                    Column(verticalArrangement = Arrangement.spacedBy(Abstaende.klein)) {
                        Text(stringResource(R.string.setup_altbestand_titel), fontWeight = FontWeight.Bold)
                        Text(stringResource(R.string.setup_altbestand_text, currentUrl),
                            style = MaterialTheme.typography.bodyMedium)
                        listOf(R.string.setup_altbestand_schritt_qr, R.string.setup_altbestand_schritt_adresse)
                            .forEachIndexed { i, schritt ->
                                Row(horizontalArrangement = Arrangement.spacedBy(Abstaende.klein)) {
                                    // Feste Ziffernspalte mit Tabellenziffern: „1.“ ist schmaler als
                                    // „2.“, und die Schritte begannen verschieden weit rechts.
                                    Text("${i + 1}.", Modifier.width(mitSchrift(20.dp)),
                                        style = MaterialTheme.typography.bodyMedium.copy(fontFeatureSettings = "tnum"),
                                        fontWeight = FontWeight.SemiBold)
                                    Text(stringResource(schritt), style = MaterialTheme.typography.bodyMedium)
                                }
                            }
                        Text(stringResource(R.string.setup_altbestand_danach), style = MaterialTheme.typography.bodyMedium,
                            color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                }
            }
        }
    }
    val handlungsTeil: @Composable ColumnScope.() -> Unit = {
        Spacer(Modifier.height(Abstaende.riesig))

        // Der QR-Code ist der empfohlene Weg (Adresse und Zertifikat in einem Schritt) und
        // deshalb gefüllt, bis eine Adresse von Hand dasteht: Dann ist „Weiter“ der Weg.
        Hauptknopf(
            haupt = !adresseBereit,
            onClick = { scanUngueltig = false; showScanner = true },
            modifier = Modifier.fillMaxWidth().heightIn(min = 56.dp)
        ) {
            Icon(Icons.Default.QrCodeScanner, null, Modifier.size(mitSchrift(20.dp)))
            Spacer(Modifier.width(Abstaende.klein))
            Text(stringResource(R.string.setup_scan_qr), fontWeight = FontWeight.SemiBold)
        }

        if (scanUngueltig) {
            Spacer(Modifier.height(Abstaende.klein))
            Text(stringResource(R.string.setup_invalid_qr), Modifier.ansagen(), color = MaterialTheme.colorScheme.error,
                style = MaterialTheme.typography.bodySmall)
        }

        Spacer(Modifier.height(Abstaende.gross))

        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            HorizontalDivider(Modifier.weight(1f))
            // Der Abstand kommt aus dem Padding, nicht aus Leerzeichen im Text; sonst stiessen die Linien an.
            Text(stringResource(R.string.setup_or_manual), style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(horizontal = Abstaende.mittel))
            HorizontalDivider(Modifier.weight(1f))
        }

        Spacer(Modifier.height(Abstaende.gross))

        // Die gemeinsame Karte (AppKarte) statt einer eigenen: surface mit Erhebung wie jede
        // Karte der App, Innenabstand aus der Skala.
        AppKarte {
            Column(Modifier.padding(Abstaende.gross)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Icon(Icons.Default.Cloud, null, tint = MaterialTheme.colorScheme.primary)
                    Spacer(Modifier.width(Abstaende.klein))
                    Text(stringResource(R.string.setup_server_url), fontWeight = FontWeight.SemiBold)
                }
                Spacer(Modifier.height(Abstaende.mittel))
                OutlinedTextField(
                    shape = Formen.feld,
                    value = url,
                    onValueChange = { url = it },
                    label = { Text(stringResource(R.string.setup_url_label)) },
                    placeholder = { Text(stringResource(R.string.setup_url_placeholder)) },
                    modifier = Modifier.fillMaxWidth(),
                    singleLine = true,
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri, imeAction = ImeAction.Done),
                    keyboardActions = KeyboardActions(onDone = { save() }),
                    supportingText = {
                        when (fehler) {
                            NetworkPolicy.Adressfehler.KLARTEXT ->
                                Text(stringResource(R.string.setup_klartext_abgelehnt), color = MaterialTheme.colorScheme.error)
                            NetworkPolicy.Adressfehler.UNLESBAR ->
                                Text(stringResource(R.string.setup_url_unlesbar), color = MaterialTheme.colorScheme.error)
                            NetworkPolicy.Adressfehler.BENUTZERANGABE ->
                                Text(stringResource(R.string.setup_url_benutzerangabe), color = MaterialTheme.colorScheme.error)
                            NetworkPolicy.Adressfehler.ZUSATZ ->
                                Text(stringResource(R.string.setup_url_zusatz), color = MaterialTheme.colorScheme.error)
                            null -> Text(stringResource(R.string.setup_url_supporting))
                        }
                    },
                    isError = fehler != null,
                )
                Spacer(Modifier.height(Abstaende.gross))
                // Gefüllt: Tonal lag er auf der Karte fast unsichtbar (1,02:1) und sah aktiv
                // aus wie gesperrt. Gesperrt bleibt er blass, bis die Adresse taugt.
                Button(
                    onClick = ::save, modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp),
                    enabled = adresseBereit,
                ) { Text(stringResource(R.string.setup_continue), fontWeight = FontWeight.Bold) }
            }
        }
        // Aus der App-Fassung statt als Literal: versionName entsteht bei jedem Build
        // (app/build.gradle.kts). Ohne Namen (Vorschau, Test) bliebe nur „Build “ stehen.
        val fassung = LocalAppFassung.current.name
        if (fassung.isNotBlank()) {
            Spacer(Modifier.height(Abstaende.gross))
            Text(
                stringResource(R.string.setup_build, fassung),
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.align(Alignment.CenterHorizontally)
            )
        }
    }

    // Rollbar wie die Anmeldung (bei 200 % Schrift reichte die Höhe nicht), mittig
    // solange es passt, und auf dem Tablet nicht breiter als ein Formular.
    BoxWithConstraints(Modifier.fillMaxSize().ausserhalbDerSystemleisten()) {
        // In Row- und Column-Lambdas ist der Empfänger von BoxWithConstraints gesperrt (DslMarker).
        val hoehe = maxHeight
        if (maxWidth > hoehe && maxWidth >= QUER_ZWEISPALTIG) {
            Row(
                Modifier.fillMaxSize().mittigBis(Lesebreite.formular * 2)
                    .padding(horizontal = Abstaende.riesig),
                horizontalArrangement = Arrangement.spacedBy(Abstaende.riesig),
            ) {
                listOf(kopfTeil, handlungsTeil).forEach { teil ->
                    Column(
                        Modifier.weight(1f).verticalScroll(rememberScrollState()).heightIn(min = hoehe)
                            .padding(vertical = Abstaende.riesig),
                        horizontalAlignment = Alignment.CenterHorizontally,
                        verticalArrangement = Arrangement.Center,
                        content = teil,
                    )
                }
            }
        } else Column(
            modifier = Modifier.verticalScroll(rememberScrollState()).heightIn(min = hoehe)
                .mittigBis(Lesebreite.formular).padding(Abstaende.riesig),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.Center
        ) {
            kopfTeil()
            handlungsTeil()
        }
    }
}

/** Gefüllt als Hauptaktion, sonst tonal: Es gibt immer nur EINE gefüllte Aktion. */
@Composable
private fun Hauptknopf(haupt: Boolean, onClick: () -> Unit, modifier: Modifier, inhalt: @Composable RowScope.() -> Unit) {
    if (haupt) Button(onClick = onClick, modifier = modifier, content = inhalt)
    else FilledTonalButton(onClick = onClick, modifier = modifier, content = inhalt)
}

/** Ab dieser Breite stehen Kopf und Handlung im Querformat nebeneinander. */
private val QUER_ZWEISPALTIG = 840.dp
