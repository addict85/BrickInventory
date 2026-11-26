package ch.brickinventoryapp.account.ui.screens

import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.res.stringResource
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import ch.brickinventoryapp.account.ui.viewmodel.AccountViewModel
import ch.brickinventoryapp.account.ui.viewmodel.HouseholdViewModel
import ch.brickinventoryapp.account.ui.viewmodel.SettingsViewModel
import ch.brickinventoryapp.model.file.FileRef
import ch.brickinventoryapp.resources.R
import ch.brickinventoryapp.state.ui.viewmodel.DevicesSettingsViewModel
import ch.brickinventoryapp.ui.components.OverlayGuard
import ch.brickinventoryapp.ui.components.Subpage
import ch.brickinventoryapp.ui.components.UndoMessage
import ch.brickinventoryapp.ui.theme.ReadingWidth
import coil3.ImageLoader

/**
 * The settings' subpages: one page per category with a title and
 * back arrow, so the rare doesn't take as much space as the frequent. The
 * cards for each category live in Einstellungen*.kt.
 */

/** The notification switch wired up with the device settings. */
@Composable
internal fun PriceAlertToggleRoute(device: DevicesSettingsViewModel = hiltViewModel()) {
    val an by device.alarmMessagesEnabled.collectAsStateWithLifecycle()
    PriceAlertCard(an, device::alarmMessages)
}

/**
 * Price alerts — the overview and the notification switch on one page: two cards
 * with almost the same name would be two categories, and the switch sits where
 * one looks for it.
 */
@Composable
fun PriceAlarmsRoute(
    vm: SettingsViewModel,
    imageLoader: ImageLoader,
    serverUrl: String,
    snackbarHostState: SnackbarHostState,
    onSetClick: (String) -> Unit,
    onBack: () -> Unit,
    /** The notification switch; as a slot, because it fetches its own ViewModel. */
    reportToggle: @Composable () -> Unit = { PriceAlertToggleRoute() },
) {
    val overview by vm.alarmOverview.collectAsStateWithLifecycle()
    Subpage(stringResource(R.string.alerts_group), snackbarHostState, onBack,
        width = ReadingWidth.form) {
        reportToggle()
        PriceAlarmsCard(overview, vm, imageLoader, serverUrl, onSetClick)
    }
}

/** Storage locations. */
@Composable
fun LocationsRoute(
    vm: SettingsViewModel,
    snackbarHostState: SnackbarHostState,
    onBack: () -> Unit,
) {
    val storage by vm.storageState.collectAsStateWithLifecycle()
    val gone = vm.locationRoute.value.collectAsStateWithLifecycle().value
    UndoMessage(gone, stringResource(R.string.vm_set_deleted, gone?.name.orEmpty()), snackbarHostState,
        vm.locationRoute::undo, vm.locationRoute::execute)
    Subpage(stringResource(R.string.storage_manage), snackbarHostState, onBack) {
        LocationsCard(storage, vm)
    }
}

/** Household: link accounts. */
@Composable
fun HouseholdRoute(
    vm: HouseholdViewModel,
    snackbarHostState: SnackbarHostState,
    onBack: () -> Unit,
) {
    val household by vm.householdState.collectAsStateWithLifecycle()
    // Redeem invitation and unlink accounts: no tap through an overlay.
    OverlayGuard()
    Subpage(stringResource(R.string.household_title), snackbarHostState, onBack) {
        HouseholdCard(
            state = household,
            onCreateInvite = { vm.createHouseholdInvite() },
            onRedeemInvite = { code -> vm.redeemHouseholdInvite(code) },
            onUnlink = { id -> vm.unlinkHousehold(subUserId = id) },
            onUnlinkParent = { id -> vm.unlinkHousehold(mainUserId = id) },
            onDiscard = { id -> vm.discardSeparateAccount(id) },
        )
    }
}

/** Account and signed-in devices — both concern access. */
@Composable
fun AccountRoute(
    snackbarHostState: SnackbarHostState,
    // Tied to the destination: profile, devices and a half-set-up
    // second factor only live as long as the page is open.
    account: AccountViewModel = hiltViewModel(),
    onBack: () -> Unit,
) {
    val accountUiState by account.accountPage.collectAsStateWithLifecycle()
    val devicesUiState by account.devicesState.collectAsStateWithLifecycle()
    val secondFactorUiState by account.secondFactorState.collectAsStateWithLifecycle()
    // Profile, design, devices and second factor load while observing their state (AccountViewModel).
    // Password, second factor, devices: a slipped-in tap turned off protection here.
    OverlayGuard()
    Subpage(stringResource(R.string.account_title), snackbarHostState, onBack,
        width = ReadingWidth.form) {
        AccountCard(
            accountUiState = accountUiState,
            onSave = { b, e, v, n -> account.saveProfile(b, e, v, n) },
            onPassword = { newValue -> account.changePassword(current = "", newValue = newValue) },
            onMessageRoute = { account.accountMessageRoute() },
        )
        DesignCard(design = accountUiState.design, onChoice = { account.chooseDesign(it) })
        SecondFactorCard(
            secondFactorUiState = secondFactorUiState,
            onSetUp = { account.setUpSecondFactorOne() },
            onConfirm = { account.confirmSecondFactor(it) },
            onNewCodes = { account.renewSecondFactorCodes() },
            onTurnOff = { account.disableSecondFactor() },
            onBack = { account.secondFactorBack() },
        )
        DevicesCard(
            condition = devicesUiState,
            onReload = { account.loadDevices() },
            onQuestion = { account.redeemQuestion(it) },
            onConfirm = { account.redeemConfirm() },
            onCancel = { account.cancelRedeem() },
        )
    }
}

/** CSV import. */
@Composable
fun CsvImportRoute(
    vm: SettingsViewModel,
    snackbarHostState: SnackbarHostState,
    onBack: () -> Unit,
) {
    val csvState by vm.csvUploadState.collectAsStateWithLifecycle()
    Subpage(stringResource(R.string.csv_upload_title), snackbarHostState, onBack) {
        CsvImportCard(
            csvState = csvState,
            onFile = { kind, uri -> vm.loadCsvHigh(kind, FileRef(uri.toString())) },
            onClose = { vm.csvUploadRoute() },
        )
    }
}
