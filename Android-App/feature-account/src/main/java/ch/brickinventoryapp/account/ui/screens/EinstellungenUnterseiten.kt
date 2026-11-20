package ch.brickinventoryapp.account.ui.screens

import ch.brickinventoryapp.ui.components.UndoMessage
import ch.brickinventoryapp.account.ui.viewmodel.EinstellungenAktionen
import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.res.stringResource
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import ch.brickinventoryapp.resources.R
import coil3.ImageLoader
import ch.brickinventoryapp.account.ui.viewmodel.SettingsViewModel
import ch.brickinventoryapp.account.ui.viewmodel.HouseholdViewModel
import ch.brickinventoryapp.state.ui.viewmodel.GeraeteEinstellungenViewModel
import ch.brickinventoryapp.account.ui.AlarmUebersichtUiState
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import ch.brickinventoryapp.ui.components.Ueberdeckungsschutz
import ch.brickinventoryapp.ui.theme.Lesebreite
import ch.brickinventoryapp.account.ui.viewmodel.AccountViewModel
import ch.brickinventoryapp.model.file.FileRef
import ch.brickinventoryapp.ui.components.Subpage

/**
 * Die Unterseiten der Einstellungen: je Rubrik eine Seite mit Titel und
 * Zurück-Pfeil, damit das Seltene nicht so viel Platz bekommt wie das Häufige. Die
 * Karten liegen je Rubrik in Einstellungen*.kt.
 */

/** Der Melde-Schalter mit den Geräte-Einstellungen verdrahtet. */
@Composable
internal fun PriceAlertToggleRoute(geraet: GeraeteEinstellungenViewModel = hiltViewModel()) {
    val an by geraet.alarmMessagesAn.collectAsStateWithLifecycle()
    PriceAlertCard(an, geraet::alarmMessages)
}

/**
 * Preisalarme — die Übersicht und der Melde-Schalter auf einer Seite: zwei Karten
 * mit fast demselben Namen wären zwei Rubriken, und der Schalter steht dort, wo
 * man ihn sucht.
 */
@Composable
fun PreisalarmeRoute(
    vm: SettingsViewModel,
    imageLoader: ImageLoader,
    serverUrl: String,
    snackbarHostState: SnackbarHostState,
    onSetClick: (String) -> Unit,
    onZurueck: () -> Unit,
    /** Der Melde-Schalter; als Platz, weil er sein eigenes ViewModel holt. */
    reportToggle: @Composable () -> Unit = { PriceAlertToggleRoute() },
) {
    val uebersicht by vm.alarmOverview.collectAsStateWithLifecycle()
    PriceAlertsSubpage(uebersicht, vm, imageLoader, serverUrl, snackbarHostState, onSetClick, onZurueck, reportToggle)
}

@Composable
internal fun PriceAlertsSubpage(
    uebersicht: AlarmUebersichtUiState,
    aktionen: EinstellungenAktionen,
    imageLoader: ImageLoader,
    serverUrl: String,
    snackbarHostState: SnackbarHostState,
    onSetClick: (String) -> Unit,
    onZurueck: () -> Unit,
    reportToggle: @Composable () -> Unit,
) {
    Subpage(stringResource(R.string.alerts_group), snackbarHostState, onZurueck,
        breite = Lesebreite.formular) {
        reportToggle()
        PreisalarmeCard(uebersicht, aktionen, imageLoader, serverUrl, onSetClick)
    }
}

/** Lagerorte. */
@Composable
fun LocationsRoute(
    vm: SettingsViewModel,
    snackbarHostState: SnackbarHostState,
    onZurueck: () -> Unit,
) {
    val lager by vm.storageState.collectAsStateWithLifecycle()
    val weg = vm.locationRoute.wert.collectAsStateWithLifecycle().value
    UndoMessage(weg, stringResource(R.string.vm_set_deleted, weg?.name.orEmpty()), snackbarHostState,
        vm.locationRoute::rueckgaengig, vm.locationRoute::ausfuehren)
    Subpage(stringResource(R.string.storage_manage), snackbarHostState, onZurueck) {
        LocationsCard(lager, vm)
    }
}

/** Haushalt — Konten verknuepfen. */
@Composable
fun HouseholdRoute(
    vm: HouseholdViewModel,
    snackbarHostState: SnackbarHostState,
    onZurueck: () -> Unit,
) {
    val haushalt by vm.householdState.collectAsStateWithLifecycle()
    // Einladung einlösen und Konten trennen: kein Tipp durch eine Überlagerung.
    Ueberdeckungsschutz()
    Subpage(stringResource(R.string.household_title), snackbarHostState, onZurueck) {
        HouseholdCard(
            state = haushalt,
            onCreateInvite = { vm.createHouseholdInvite() },
            onRedeemInvite = { code, passwort, faktorCode -> vm.redeemHouseholdInvite(code, passwort, faktorCode) },
            onUnlink = { id -> vm.unlinkHousehold(subUserId = id) },
            onUnlinkParent = { id -> vm.unlinkHousehold(mainUserId = id) },
            onVerwerfen = { id -> vm.discardSeparateAccount(id) },
        )
    }
}

/** Konto und angemeldete Geraete — beides betrifft den Zugang. */
@Composable
fun AccountRoute(
    snackbarHostState: SnackbarHostState,
    // An das Ziel gebunden: Profil, Geräte und ein halb eingerichteter
    // zweiter Faktor leben nur, solange die Seite offen ist.
    konto: AccountViewModel = hiltViewModel(),
    onZurueck: () -> Unit,
) {
    val kontoZustand by konto.accountPage.collectAsStateWithLifecycle()
    val geraeteZustand by konto.geraeteState.collectAsStateWithLifecycle()
    val zfZustand by konto.secondFactorState.collectAsStateWithLifecycle()
    // Profil, Design, Geräte und zweiter Faktor laden beim Beobachten ihres Zustands (AccountViewModel).
    // Passwort, zweiter Faktor, Geräte: Ein untergeschobener Tipp schaltete hier Schutz ab.
    Ueberdeckungsschutz()
    Subpage(stringResource(R.string.konto_title), snackbarHostState, onZurueck,
        breite = Lesebreite.formular) {
        AccountCard(
            kontoZustand = kontoZustand,
            onSpeichern = { b, e, v, n, p, c -> konto.saveProfile(b, e, v, n, p, c) },
            onPassword = { alt, neu, c -> konto.aenderePasswort(alt, neu, c) },
            onMessageRoute = { konto.accountMessageRoute() },
        )
        DesignCard(design = kontoZustand.design, onWahl = { konto.chooseDesign(it) })
        ZweiterFaktorCard(
            zfZustand = zfZustand,
            onEinrichten = { konto.setUpSecondFactorOne(it) },
            onBestaetigen = { konto.bestaetigeZweitenFaktor(it) },
            onNeueCodes = { konto.renewSecondFactorCodes(it) },
            onAbschalten = { pw, code -> konto.switchSecondFactorAb(pw, code) },
            onZurueck = { konto.secondFactorBack() },
        )
        DevicesCard(
            zustand = geraeteZustand,
            onReload = { konto.loadDevices() },
            onQuestion = { konto.redeemQuestion(it) },
            onBestaetigen = { pw, code -> konto.redeemConfirm(pw, code) },
            onAbbrechen = { konto.cancelRedeem() },
        )
    }
}

/** CSV importieren. */
@Composable
fun CsvImportRoute(
    vm: SettingsViewModel,
    snackbarHostState: SnackbarHostState,
    onZurueck: () -> Unit,
) {
    val csvState by vm.csvUploadState.collectAsStateWithLifecycle()
    Subpage(stringResource(R.string.csv_upload_title), snackbarHostState, onZurueck) {
        CsvImportCard(
            csvState = csvState,
            onFile = { art, uri -> vm.loadCsvHigh(art, FileRef(uri.toString())) },
            onSchliessen = { vm.csvUploadRoute() },
        )
    }
}
