package ch.brickinventoryapp.ui.screens

import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
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
 * Die Unterseiten der Einstellungen: je Rubrik eine Seite mit Titel und
 * Zurück-Pfeil, damit das Seltene nicht so viel Platz bekommt wie das Häufige. Die
 * Karten liegen je Rubrik in Einstellungen*.kt.
 */

/**
 * Der Rahmen jeder Unterseite: Titel, Zurück-Pfeil, darunter der Inhalt mit einem
 * Abstand zwischen den Karten.
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
        // ── Eigener Snackbar-Halter ──
        //
        // Die Meldungen laufen über einen Fluss (vm.snackbar), und AppNavigation zeigt sie
        // auf `snackbarHostState`; der Halter dafür steht im Reiter-Gerüst, das hier nicht
        // in der Komposition ist. Ohne diese Zeile gingen „Gutschein gespeichert“, „250
        // CHF“ und jede Absage der Guthaben-Abfrage still verloren.
        snackbarHost = { SnackbarHost(snackbarHostState) },
        topBar = {
            TopAppBar(
                // Überschrift der Unterseite: Vorleseprogramme springen dorthin.
                title = { Text(titel, maxLines = 1, modifier = Modifier.semantics { heading() }) },
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
            onErneut = { gvm.ladeGutscheine() },
        )
    }
}

/**
 * Preisalarme — die Übersicht und der Melde-Schalter auf einer Seite: zwei Karten
 * mit fast demselben Namen wären zwei Rubriken, und der Schalter steht dort, wo
 * man ihn sucht.
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
    LaunchedEffect(Unit) { konto.ladeDesign() }
    Unterseite(stringResource(R.string.konto_title), snackbarHostState, onZurueck) {
        KontoCard(
            kontoZustand = kontoZustand,
            onSpeichern = { b, e, v, n, p -> konto.speichereProfil(b, e, v, n, p) },
            onPasswort = { alt, neu -> konto.aenderePasswort(alt, neu) { vm.logout() } },
            onMeldungWeg = { konto.kontoMeldungWeg() },
        )
        DesignCard(design = kontoZustand.design, onWahl = { konto.waehleDesign(it) })
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
