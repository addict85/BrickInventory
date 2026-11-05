package ch.brickinventoryapp.ui.screens

import ch.brickinventoryapp.ui.viewmodel.EinstellungenAktionen
import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.res.stringResource
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import ch.brickinventoryapp.ressourcen.R
import coil3.ImageLoader
import ch.brickinventoryapp.ui.viewmodel.EinstellungenViewModel
import ch.brickinventoryapp.ui.viewmodel.HaushaltViewModel
import ch.brickinventoryapp.ui.viewmodel.GeraeteEinstellungenViewModel
import ch.brickinventoryapp.ui.*
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import ch.brickinventoryapp.ui.components.Ueberdeckungsschutz
import ch.brickinventoryapp.ui.theme.Lesebreite
import ch.brickinventoryapp.ui.viewmodel.KontoViewModel

/**
 * Die Unterseiten der Einstellungen: je Rubrik eine Seite mit Titel und
 * Zurück-Pfeil, damit das Seltene nicht so viel Platz bekommt wie das Häufige. Die
 * Karten liegen je Rubrik in Einstellungen*.kt.
 */

/** Der Melde-Schalter mit den Geräte-Einstellungen verdrahtet. */
@Composable
fun PreisalarmSchalterRoute(geraet: GeraeteEinstellungenViewModel = hiltViewModel()) {
    val an by geraet.alarmMeldungenAn.collectAsStateWithLifecycle()
    PreisalarmCard(an, geraet::alarmMeldungen)
}

/**
 * Preisalarme — die Übersicht und der Melde-Schalter auf einer Seite: zwei Karten
 * mit fast demselben Namen wären zwei Rubriken, und der Schalter steht dort, wo
 * man ihn sucht.
 */
@Composable
fun PreisalarmeRoute(
    vm: EinstellungenViewModel,
    imageLoader: ImageLoader,
    serverUrl: String,
    snackbarHostState: SnackbarHostState,
    onSetClick: (String) -> Unit,
    onZurueck: () -> Unit,
    /** Der Melde-Schalter; als Platz, weil er sein eigenes ViewModel holt. */
    meldeSchalter: @Composable () -> Unit = { PreisalarmSchalterRoute() },
) {
    val uebersicht by vm.alarmUebersicht.collectAsStateWithLifecycle()
    LaunchedEffect(Unit) { vm.ladeAlarmUebersicht() }
    PreisalarmeUnterseite(uebersicht, vm, imageLoader, serverUrl, snackbarHostState, onSetClick, onZurueck, meldeSchalter)
}

@Composable
fun PreisalarmeUnterseite(
    uebersicht: AlarmUebersichtUiState,
    aktionen: EinstellungenAktionen,
    imageLoader: ImageLoader,
    serverUrl: String,
    snackbarHostState: SnackbarHostState,
    onSetClick: (String) -> Unit,
    onZurueck: () -> Unit,
    meldeSchalter: @Composable () -> Unit,
) {
    Unterseite(stringResource(R.string.alerts_group), snackbarHostState, onZurueck,
        breite = Lesebreite.formular) {
        meldeSchalter()
        PreisalarmeCard(uebersicht, aktionen, imageLoader, serverUrl, onSetClick)
    }
}

/** Lagerorte. */
@Composable
fun LagerorteRoute(
    vm: EinstellungenViewModel,
    snackbarHostState: SnackbarHostState,
    onZurueck: () -> Unit,
) {
    val lager by vm.lagerState.collectAsStateWithLifecycle()
    LaunchedEffect(Unit) { vm.ladeEigeneLagerorte() }
    Unterseite(stringResource(R.string.storage_manage), snackbarHostState, onZurueck) {
        LagerorteCard(lager, vm)
    }
}

/** Haushalt — Konten verknuepfen. */
@Composable
fun HaushaltRoute(
    vm: HaushaltViewModel,
    snackbarHostState: SnackbarHostState,
    onZurueck: () -> Unit,
) {
    val haushalt by vm.householdState.collectAsStateWithLifecycle()
    LaunchedEffect(Unit) { vm.loadHouseholdStatus() }
    // Einladung einlösen und Konten trennen: kein Tipp durch eine Überlagerung.
    Ueberdeckungsschutz()
    Unterseite(stringResource(R.string.household_title), snackbarHostState, onZurueck) {
        HouseholdCard(
            state = haushalt,
            onCreateInvite = { vm.createHouseholdInvite() },
            onRedeemInvite = { code, passwort, faktorCode -> vm.redeemHouseholdInvite(code, passwort, faktorCode) },
            onUnlink = { id -> vm.unlinkHousehold(subUserId = id) },
            onUnlinkParent = { id -> vm.unlinkHousehold(mainUserId = id) },
            onVerwerfen = { id -> vm.verwerfeGetrenntesKonto(id) },
        )
    }
}

/** Konto und angemeldete Geraete — beides betrifft den Zugang. */
@Composable
fun KontoRoute(
    /** Nach einem geänderten Passwort abmelden — der Rest der Sitzung gilt dann nicht mehr. */
    onAbmelden: () -> Unit,
    snackbarHostState: SnackbarHostState,
    // An das Ziel gebunden: Profil, Geräte und ein halb eingerichteter
    // zweiter Faktor leben nur, solange die Seite offen ist.
    konto: KontoViewModel = hiltViewModel(),
    onZurueck: () -> Unit,
) {
    val kontoZustand by konto.kontoState.collectAsStateWithLifecycle()
    val geraeteZustand by konto.geraeteState.collectAsStateWithLifecycle()
    val zfZustand by konto.zweiterFaktorState.collectAsStateWithLifecycle()
    LaunchedEffect(Unit) { konto.ladeProfil() }
    LaunchedEffect(Unit) { konto.ladeGeraete() }
    LaunchedEffect(Unit) { konto.ladeZweitenFaktor() }
    LaunchedEffect(Unit) { konto.ladeDesign() }
    // Passwort, zweiter Faktor, Geräte: Ein untergeschobener Tipp schaltete hier Schutz ab.
    Ueberdeckungsschutz()
    Unterseite(stringResource(R.string.konto_title), snackbarHostState, onZurueck,
        breite = Lesebreite.formular) {
        KontoCard(
            kontoZustand = kontoZustand,
            onSpeichern = { b, e, v, n, p, c -> konto.speichereProfil(b, e, v, n, p, c) },
            onPasswort = { alt, neu, c -> konto.aenderePasswort(alt, neu, c) { onAbmelden() } },
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
fun CsvImportRoute(
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
