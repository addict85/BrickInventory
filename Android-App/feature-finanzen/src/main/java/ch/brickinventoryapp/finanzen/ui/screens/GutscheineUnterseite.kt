package ch.brickinventoryapp.finanzen.ui.screens

import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.res.stringResource
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import ch.brickinventoryapp.ressourcen.R
import ch.brickinventoryapp.finanzen.ui.*
import ch.brickinventoryapp.model.ui.*
import ch.brickinventoryapp.ui.*
import ch.brickinventoryapp.zustand.ui.*
import ch.brickinventoryapp.ui.components.Sichtschutz
import ch.brickinventoryapp.ui.components.Ueberdeckungsschutz
import ch.brickinventoryapp.finanzen.ui.viewmodel.GutscheinViewModel
import ch.brickinventoryapp.sicherheit.GeheimeZwischenablage
import ch.brickinventoryapp.zustand.ui.viewmodel.DateiRef
import ch.brickinventoryapp.ui.components.Unterseite

/**
 * Gutscheine — der erste Eintrag der Liste, weil sie im Laden gebraucht werden:
 * einen Fingertipp entfernt, ohne dass man an ihnen vorbeirollt, wenn man etwas
 * anderes sucht.
 */
@Composable
fun GutscheineRoute(
    gvm: GutscheinViewModel,
    snackbarHostState: SnackbarHostState,
    onZurueck: () -> Unit,
) {
    val gutscheinZustand by gvm.state.collectAsStateWithLifecycle()
    Sichtschutz()
    // PIN kopieren und Gutscheine löschen: kein Tipp durch eine Überlagerung.
    Ueberdeckungsschutz()
    // Kopiert wird über GeheimeZwischenablage (nach einer Minute wieder leer); die
    // Rückmeldung läuft über den Snackbar des ViewModels wie alle anderen Meldungen.
    val kontext = androidx.compose.ui.platform.LocalContext.current
    val etikett = stringResource(R.string.vouchers_title)
    // Beim Oeffnen DIESER Seite laden und nicht mehr beim Oeffnen der
    // Einstellungen: Wer die Sprache umstellt, braucht keine Gutscheinliste.
    LaunchedEffect(Unit) { gvm.ladeGutscheine() }
    // Der Klartext lebt nur, solange die Seite vorne steht.
    DisposableEffect(Unit) { onDispose { gvm.verlasseGutscheine() } }
    androidx.lifecycle.compose.LifecycleEventEffect(androidx.lifecycle.Lifecycle.Event.ON_STOP) { gvm.vergissKlartext() }
    // Nummer und PIN zusammen sind Geld: als Geheimnis markiert, nach einer Minute weg.
    val auftrag = gutscheinZustand.zuKopieren
    LaunchedEffect(auftrag) {
        if (auftrag == null) return@LaunchedEffect
        GeheimeZwischenablage.kopiere(kontext, etikett, auftrag.wert)
        gvm.meldeGutscheinKopiert(auftrag.istNummer)
        gvm.kopierenQuittieren()
    }
    Unterseite(stringResource(R.string.vouchers_title), snackbarHostState, onZurueck) {
        GutscheineCard(
            zustand = gutscheinZustand,
            onFeld = { n, p, b, w -> gvm.setzeGutscheinFeld(n, p, b, w) },
            onPinSchalten = { gvm.schalteGutscheinPin(it) },
            onBearbeiten = { gvm.bearbeiteGutschein(it) },
            onAbbrechen = { gvm.leereGutscheinFormular() },
            onSpeichern = { gvm.speichereGutschein(it?.let { u -> DateiRef(u.toString()) }) },
            onLoeschen = { gvm.loescheGutschein(it) },
            onPdfOeffnen = { gvm.oeffneGutscheinPdf(it) },
            onKopieren = { id, istNummer -> gvm.kopiereGutschein(id, istNummer) },
            onGuthaben = { gvm.frageGuthabenAb(it) },
            onExportieren = { gvm.oeffneGutscheinExport() },
            onGuthabenAlle = { gvm.frageAlleGuthabenAb() },
            onGuthabenAbbrechen = { gvm.guthabenLaufAbbrechen() },
            onErneut = { gvm.ladeGutscheine() },
            onBestaetigen = { passwort, code -> gvm.bestaetige(passwort, code) },
            onBestaetigungAbbrechen = { gvm.bestaetigungAbbrechen() },
        )
    }
}
