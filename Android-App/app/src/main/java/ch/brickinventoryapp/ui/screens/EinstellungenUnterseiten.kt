package ch.brickinventoryapp.ui.screens

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import ch.brickinventoryapp.R
import ch.brickinventoryapp.data.model.Preisalarm
import coil3.ImageLoader
import ch.brickinventoryapp.ui.AppViewModel
import ch.brickinventoryapp.ui.viewmodel.EinstellungenViewModel
import ch.brickinventoryapp.ui.viewmodel.HaushaltViewModel
import ch.brickinventoryapp.ui.viewmodel.aktivitaetsViewModel
import ch.brickinventoryapp.ui.*
import ch.brickinventoryapp.ui.theme.Abstaende
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel

/**
 * Die Unterseiten der Einstellungen.
 *
 * ── Marcos Befund vom 16.10. ────────────────────────────────────────────────
 *
 *   „Die Abstände in der Android-App in den Einstellungen sind teilweise nicht
 *    vorhanden. Die Elemente sind zu nahe an einander. Generell wirkt dieser
 *    Dialog überladen und nicht liebevoll gestaltet. Kannst du dies besser
 *    machen? Evtl. Auch Elemente aus den Einstellungen in eine eigene Sicht
 *    verschieben?"
 *
 * Er hatte recht, und zwar zweifach. Die Einstellungen trugen VIERZEHN Karten
 * untereinander — Gutscheine, Währung, Erfassungs-Zustand, Preisgrundlage,
 * Sprache, Melde-Schalter, Preisalarme, Lagerorte, Haushalt, Konto,
 * CSV-Import, Geräte, Server, Aktualisierung — und jede davon ist für sich ein
 * kleiner Bildschirm. Untereinandergelegt ergeben sie eine Rolle von mehreren
 * Metern, auf der das Seltene (einmal die Währung setzen) genauso viel Platz
 * einnimmt wie das Häufige.
 *
 * Jetzt steht in den Einstellungen eine LISTE, und was dahinter liegt, hat
 * seine eigene Seite mit eigenem Titel und Zurück-Pfeil. Das ist nicht bloss
 * Aufräumen: Eine Seite, die eine Sache zeigt, kann ihr auch Platz geben.
 *
 * ── Warum die Karten UMGEZOGEN und nicht neu gebaut sind ────────────────────
 *
 * Die Karten liegen je Rubrik in Einstellungen*.kt (Alarme, Lagerorte,
 * Haushalt, Konto, Csv) und stehen zeichengleich so da, wie sie in
 * SettingsScreen.kt standen. Sie tragen Jahre von Marcos Nachbesserungen in
 * ihren Kommentaren; sie „bei der Gelegenheit" neu zu schreiben hiesse, diese
 * Entscheidungen noch einmal treffen zu müssen — und diesmal ohne den Anlass
 * zu kennen. Geändert hat sich ihr ORT, nicht ihr Inhalt.
 */

/**
 * Der Rahmen jeder Unterseite.
 *
 * Titel, Zurück-Pfeil, und darunter der Inhalt mit Luft: ein Abstand zwischen
 * den Karten statt der 10 dp, die vorher zwischen vierzehn Karten standen.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun Unterseite(
    titel: String,
    snackbarHostState: SnackbarHostState,
    onZurueck: () -> Unit,
    inhalt: @Composable ColumnScope.() -> Unit,
) {
    Scaffold(
        // ── Warum die Unterseite ihren eigenen Snackbar-Halter braucht ──────
        //
        // Die Meldungen der App laufen ueber EINEN Fluss (vm.snackbar), und
        // AppNavigation zeigt sie auf dem `snackbarHostState`. Der HALTER
        // dafuer steht aber im Reiter-Geruest — und das ist hier nicht in der
        // Komposition. Ohne diese Zeile gingen „Gutschein gespeichert",
        // „250 CHF" und jede Absage der Guthaben-Abfrage still verloren.
        // GEMESSEN am Aufbau, nicht vermutet: SetDetailScreen und die anderen
        // Detailseiten zeigen gar keine Snackbars, deshalb ist es dort nie
        // aufgefallen.
        snackbarHost = { SnackbarHost(snackbarHostState) },
        topBar = {
            TopAppBar(
                title = { Text(titel, maxLines = 1) },
                navigationIcon = {
                    IconButton(onClick = onZurueck) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack,
                             stringResource(R.string.common_back))
                    }
                },
            )
        },
    ) { innen ->
        Column(
            Modifier
                .fillMaxSize()
                .padding(innen)
                .verticalScroll(rememberScrollState())
                .padding(horizontal = Abstaende.gross, vertical = Abstaende.gross),
            verticalArrangement = Arrangement.spacedBy(Abstaende.gross),
        ) { inhalt() }
    }
}

/**
 * Gutscheine.
 *
 * Marcos Vorgabe von damals — „möglichst einfach erreichbar" — ist durch den
 * Umzug nicht verletzt, sondern eingelöst: Die Karte stand bisher GANZ OBEN in
 * einer sehr langen Rolle, weil sie im Laden gebraucht wird. Jetzt ist sie der
 * erste Eintrag der Liste und einen Fingertipp entfernt, ohne dass man an ihr
 * vorbeirollen muss, wenn man etwas anderes sucht.
 */
@Composable
fun GutscheineUnterseite(
    gvm: ch.brickinventoryapp.ui.viewmodel.GutscheinViewModel,
    snackbarHostState: SnackbarHostState,
    onZurueck: () -> Unit,
) {
    // `gutscheinZustand` und nicht `zustand`: UiStateFieldsTest bestimmt den
    // Typ eines Namens je DATEI, und in dieser steht weiter unten
    // GeraeteCard(zustand: GeraeteUiState). Mit dem kurzen Namen hielt die
    // Pruefung jedes `zustand.geraete` dort fuer einen Feldzugriff auf
    // GutscheinUiState und meldete fuenf Felder, die es „nicht gibt".
    // GEMESSEN, nicht vermutet: genau daran war der erste CI-Lauf dieses
    // Umbaus rot (534 Tests, einer rot).
    val gutscheinZustand by gvm.state.collectAsStateWithLifecycle()
    // Die Zwischenablage kommt aus Compose und nicht aus dem ViewModel: Sie
    // ist an die Komposition gebunden. Die Rueckmeldung laeuft ueber den
    // Snackbar des ViewModels, damit sie dort steht, wo alle anderen Meldungen
    // stehen.
    val zwischenablage = androidx.compose.ui.platform.LocalClipboardManager.current
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
                zwischenablage.setText(androidx.compose.ui.text.AnnotatedString(wert))
                gvm.meldeGutscheinKopiert(istNummer)
            },
            onGuthaben = { gvm.frageGuthabenAb(it) },
            onExportieren = { gvm.oeffneGutscheinExport() },
            onGuthabenAlle = { gvm.frageAlleGuthabenAb() },
            onGuthabenAbbrechen = { gvm.guthabenLaufAbbrechen() },
        )
    }
}

/**
 * Preisalarme — die Uebersicht UND der Melde-Schalter.
 *
 * Die beiden standen als zwei Karten untereinander und hiessen „Preisalarm"
 * und „🔔 Preisalarme". Auf einem Bildschirmfoto sind das zwei Rubriken mit
 * praktisch demselben Namen; hier ist es eine Seite mit zwei Abschnitten, und
 * der Schalter steht dort, wo man ihn sucht: bei den Alarmen.
 */
@Composable
fun PreisalarmeUnterseite(
    vm: EinstellungenViewModel,
    imageLoader: ImageLoader,
    serverUrl: String,
    snackbarHostState: SnackbarHostState,
    onSetClick: (String) -> Unit,
    onZurueck: () -> Unit,
) {
    Unterseite(stringResource(R.string.alerts_group), snackbarHostState, onZurueck) {
        PreisalarmCard(aktivitaetsViewModel())
        PreisalarmeCard(vm, imageLoader, serverUrl, onSetClick)
    }
}

/** Lagerorte. */
@Composable
fun LagerorteUnterseite(
    vm: EinstellungenViewModel,
    snackbarHostState: SnackbarHostState,
    onZurueck: () -> Unit,
) {
    Unterseite(stringResource(R.string.storage_manage), snackbarHostState, onZurueck) {
        LagerorteCard(vm)
    }
}

/** Haushalt — Konten verknuepfen. */
@Composable
fun HaushaltUnterseite(
    vm: HaushaltViewModel,
    snackbarHostState: SnackbarHostState,
    onZurueck: () -> Unit,
) {
    val haushalt by vm.householdState.collectAsStateWithLifecycle()
    LaunchedEffect(Unit) { vm.loadHouseholdStatus() }
    Unterseite(stringResource(R.string.household_title), snackbarHostState, onZurueck) {
        HouseholdCard(
            state = haushalt,
            onCreateInvite = { vm.createHouseholdInvite() },
            onRedeemInvite = { code, passwort -> vm.redeemHouseholdInvite(code, passwort) },
            onUnlink = { id -> vm.unlinkHousehold(subUserId = id) },
            onUnlinkParent = { id -> vm.unlinkHousehold(mainUserId = id) },
            onVerwerfen = { id -> vm.verwerfeGetrenntesKonto(id) },
        )
    }
}

/** Konto und angemeldete Geraete — beides betrifft den Zugang. */
@Composable
fun KontoUnterseite(
    vm: AppViewModel,
    snackbarHostState: SnackbarHostState,
    // An das Ziel gebunden: Profil, Geräte und ein halb eingerichteter
    // zweiter Faktor leben nur, solange die Seite offen ist.
    konto: ch.brickinventoryapp.ui.viewmodel.KontoViewModel = hiltViewModel(),
    onZurueck: () -> Unit,
) {
    val kontoZustand by konto.kontoState.collectAsStateWithLifecycle()
    val geraeteZustand by konto.geraeteState.collectAsStateWithLifecycle()
    val zfZustand by konto.zweiterFaktorState.collectAsStateWithLifecycle()
    LaunchedEffect(Unit) { konto.ladeProfil() }
    LaunchedEffect(Unit) { konto.ladeGeraete() }
    LaunchedEffect(Unit) { konto.ladeZweitenFaktor() }
    Unterseite(stringResource(R.string.konto_title), snackbarHostState, onZurueck) {
        KontoCard(
            kontoZustand = kontoZustand,
            onSpeichern = { b, e, v, n, p -> konto.speichereProfil(b, e, v, n, p) },
            onPasswort = { alt, neu -> konto.aenderePasswort(alt, neu) { vm.logout() } },
            onMeldungWeg = { konto.kontoMeldungWeg() },
        )
        ZweiterFaktorCard(
            zfZustand = zfZustand,
            onEinrichten = { konto.richteZweitenFaktorEin(it) },
            onBestaetigen = { konto.bestaetigeZweitenFaktor(it) },
            onNeueCodes = { konto.erneuereZweiterFaktorCodes(it) },
            onAbschalten = { pw, code -> konto.schalteZweitenFaktorAb(pw, code) },
            onZurueck = { konto.zweiterFaktorZurueck() },
        )
        GeraeteCard(
            zustand = geraeteZustand,
            onReload = { konto.ladeGeraete() },
            onRevoke = { konto.entwerteGeraet(it) },
            onRevokeOthers = { konto.entwerteAndereGeraete() },
        )
    }
}

/** CSV importieren. */
@Composable
fun CsvImportUnterseite(
    vm: EinstellungenViewModel,
    snackbarHostState: SnackbarHostState,
    onZurueck: () -> Unit,
) {
    val csvZustand by vm.csvHochladenState.collectAsStateWithLifecycle()
    Unterseite(stringResource(R.string.csv_upload_title), snackbarHostState, onZurueck) {
        CsvImportCard(
            csvZustand = csvZustand,
            onDatei = { art, uri -> vm.ladeCsvHoch(art, uri) },
            onSchliessen = { vm.csvHochladenWeg() },
        )
    }
}
