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
 * The settings' subpages: one page per category with a title and
 * back arrow, so the rare doesn't take as much space as the frequent. The
 * cards for each category live in Einstellungen*.kt.
 */

/** The notification switch wired up with the device settings. */
@Composable
internal fun PriceAlertToggleRoute(geraet: GeraeteEinstellungenViewModel = hiltViewModel()) {
    val an by geraet.alarmMessagesAn.collectAsStateWithLifecycle()
    PriceAlertCard(an, geraet::alarmMessages)
}

/**
 * Price alerts — the overview and the notification switch on one page: two cards
 * with almost the same name would be two categories, and the switch sits where
 * one looks for it.
 */
@Composable
fun PreisalarmeRoute(
    vm: SettingsViewModel,
    imageLoader: ImageLoader,
    serverUrl: String,
    snackbarHostState: SnackbarHostState,
    onSetClick: (String) -> Unit,
    onZurueck: () -> Unit,
    /** The notification switch; as a slot, because it fetches its own ViewModel. */
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
    // Redeem invitation and unlink accounts: no tap through an overlay.
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

/** Account and signed-in devices — both concern access. */
@Composable
fun AccountRoute(
    snackbarHostState: SnackbarHostState,
    // Tied to the destination: profile, devices and a half-set-up
    // second factor only live as long as the page is open.
    konto: AccountViewModel = hiltViewModel(),
    onZurueck: () -> Unit,
) {
    val kontoZustand by konto.accountPage.collectAsStateWithLifecycle()
    val geraeteZustand by konto.geraeteState.collectAsStateWithLifecycle()
    val zfZustand by konto.secondFactorState.collectAsStateWithLifecycle()
    // Profile, design, devices and second factor load while observing their state (AccountViewModel).
    // Password, second factor, devices: a slipped-in tap turned off protection here.
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
