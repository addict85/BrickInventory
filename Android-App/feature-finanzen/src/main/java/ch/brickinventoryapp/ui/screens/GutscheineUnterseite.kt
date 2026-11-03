package ch.brickinventoryapp.ui.screens

import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.res.stringResource
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import ch.brickinventoryapp.ressourcen.R
import ch.brickinventoryapp.ui.*

/**
 * Gutscheine — der erste Eintrag der Liste, weil sie im Laden gebraucht werden:
 * einen Fingertipp entfernt, ohne dass man an ihnen vorbeirollt, wenn man etwas
 * anderes sucht.
 */
@Composable
fun GutscheineUnterseite(
    gvm: ch.brickinventoryapp.ui.viewmodel.GutscheinViewModel,
    snackbarHostState: SnackbarHostState,
    onZurueck: () -> Unit,
) {
    // `gutscheinZustand` und nicht `zustand`: UiStateFieldsTest bestimmt den Typ eines
    // Namens je Datei, und weiter unten steht GeraeteCard(zustand: GeraeteUiState).
    // Mit dem kurzen Namen hielte die Prüfung jedes `zustand.geraete` für einen
    // Feldzugriff auf GutscheinUiState.
    val gutscheinZustand by gvm.state.collectAsStateWithLifecycle()
    ch.brickinventoryapp.ui.components.Sichtschutz()
    // PIN kopieren und Gutscheine löschen: kein Tipp durch eine Überlagerung.
    ch.brickinventoryapp.ui.components.Ueberdeckungsschutz()
    // Kopiert wird über GeheimeZwischenablage (nach einer Minute wieder leer); die
    // Rückmeldung läuft über den Snackbar des ViewModels wie alle anderen Meldungen.
    val kontext = androidx.compose.ui.platform.LocalContext.current
    val etikett = stringResource(R.string.vouchers_title)
    // Beim Oeffnen DIESER Seite laden und nicht mehr beim Oeffnen der
    // Einstellungen: Wer die Sprache umstellt, braucht keine Gutscheinliste.
    LaunchedEffect(Unit) { gvm.ladeGutscheine() }
    Unterseite(stringResource(R.string.vouchers_title), snackbarHostState, onZurueck) {
        GutscheineCard(
            zustand = gutscheinZustand,
            onFeld = { n, p, b, w -> gvm.setzeGutscheinFeld(n, p, b, w) },
            onPinSchalten = { gvm.schalteGutscheinPin(it) },
            onBearbeiten = { gvm.bearbeiteGutschein(it) },
            onAbbrechen = { gvm.leereGutscheinFormular() },
            onSpeichern = { gvm.speichereGutschein(it) },
            onLoeschen = { gvm.loescheGutschein(it) },
            onPdfOeffnen = { gvm.oeffneGutscheinPdf(it) },
            onKopieren = { wert, istNummer ->
                // Nummer und PIN zusammen sind Geld: als Geheimnis markiert.
                ch.brickinventoryapp.util.GeheimeZwischenablage.kopiere(kontext, etikett, wert)
                gvm.meldeGutscheinKopiert(istNummer)
            },
            onGuthaben = { gvm.frageGuthabenAb(it) },
            onExportieren = { gvm.oeffneGutscheinExport() },
            onGuthabenAlle = { gvm.frageAlleGuthabenAb() },
            onGuthabenAbbrechen = { gvm.guthabenLaufAbbrechen() },
            onErneut = { gvm.ladeGutscheine() },
        )
    }
}
