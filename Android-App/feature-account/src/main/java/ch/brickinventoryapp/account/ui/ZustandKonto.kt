package ch.brickinventoryapp.account.ui

import ch.brickinventoryapp.model.ui.Vorgang
import ch.brickinventoryapp.model.ui.Laden
import ch.brickinventoryapp.model.ui.Meldung
import ch.brickinventoryapp.model.ui.theme.Design
import ch.brickinventoryapp.model.domain.CsvResultView
import ch.brickinventoryapp.model.domain.CsvImportKind
import ch.brickinventoryapp.model.domain.DeviceView
import ch.brickinventoryapp.model.domain.HouseholdStatusView
import ch.brickinventoryapp.model.domain.PriceAlertView
import ch.brickinventoryapp.model.domain.ProfileView
import ch.brickinventoryapp.update.util.UpdateBeschreibung
import ch.brickinventoryapp.update.util.UpdateFresh

/**
 * One's own account in the settings — its own state, because only one screen
 * reads profile and password change. No field "signed out": a password change
 * signs out, logout() resets all flows; the explanation goes into the
 * snackbar, which survives that.
 */
data class AccountUiState(
    /** The profile fetch; the profile itself stays visible while it's being refetched. */
    val abruf: Laden<Unit> = Laden.Daten(Unit),
    val profile: ProfileView? = null,
    /** Save profile, password or design; if it fails, the reason is here. */
    val speichern: Vorgang = Vorgang.Fertig,
    /** What saving achieved. */
    val meldung: Meldung? = null,
    /** The server requires the second factor (zweiter_faktor_noetig): show the code field. */
    val codeNoetig: Boolean = false,
    /** Null as long as it isn't loaded, or the server knows no per-account design. */
    val design: DesignChoice? = null,
)

/** The account's design: effective, the admin's default, and the own choice (null = default). */
data class DesignChoice(val wirksam: Design, val vorgabe: Design, val eigenes: Design?)

/** Second factor on the account: state, ongoing setup, fresh codes. */
data class ZweiterFaktorUiState(
    /** The last step: running, succeeded, or failed with a reason. */
    val abruf: Laden<Unit> = Laden.Daten(Unit),
    /** null = not yet loaded. */
    val aktiv: Boolean? = null,
    val codesUebrig: Int = 0,
    /** Set during setup, until the first code is confirmed. */
    val geheimnis: String? = null,
    val otpauth: String? = null,
    /** The recovery codes — only right after creation. */
    val codes: List<String> = emptyList(),
)

/**
 * This account's issued access tokens ("signed-in devices") — its own flow:
 * only needed in settings, with its own intermediate states, which would otherwise
 * redraw every tab.
 */
internal data class DevicesUiState(
    /** The list fetch; an error stands in place of the list. */
    val abruf: Laden<Unit> = Laden.Daten(Unit),
    val geraete: List<DeviceView> = emptyList(),
    /** The open password prompt before sign-out; null = none. */
    val prompt: DevicesPrompt? = null,
)

/**
 * The server signs out a foreign device only with password (and code): a
 * stolen access token must not lock out the owner. [tokenId] null means
 * "all others".
 */
internal data class DevicesPrompt(
    val tokenId: String?,
    val codeNoetig: Boolean = false,
    val operation: Vorgang = Vorgang.Fertig,
)

/** State of the household card in settings. */
data class HouseholdUiState(
    /** Load, invite, redeem, remove: running, succeeded, or failed with the server's reason. */
    val abruf: Laden<Unit> = Laden.Daten(Unit),
    val status: HouseholdStatusView? = null,
    /** Last created invite code — only until leaving the view. */
    val inviteCode: String? = null,
    /** Until when the code is valid (milliseconds since 1970); null if the server doesn't say. */
    val inviteValidUntil: Long? = null,
    /** The password was wrong when redeeming; the field shows it. */
    val passwordWrong: Boolean = false,
    /** Counts successful redemptions — the view clears its fields on that. */
    val eingeloest: Int = 0,
    /** The second factor is active (or the server required its code): show the code field. */
    val factorNeeded: Boolean = false,
    /** The second factor's code was wrong; the field shows it. */
    val factorWrong: Boolean = false,
)

/**
 * Upload a CSV file — separate from the import progress (CsvImportUiState):
 * the upload takes seconds and ends with a number, the import then keeps
 * running on the server and reports back over its own channel. Two operations with
 * different lifetimes don't share a progress state.
 */
data class CsvUploadUiState(
    val hochladen: Vorgang = Vorgang.Fertig,
    /** Which kind is currently uploading — for showing it on the right button. */
    val art: CsvImportKind? = null,
    val ergebnis: CsvResultView? = null,
)

/**
 * Self-update from the GitHub release (util/AppUpdate.kt). "Found" and
 * "loaded" are two fields, because on start it only checks and never loads
 * on its own. `geprueft` distinguishes "not checked yet" from "nothing
 * new", so the button gives feedback.
 */
data class UpdateUiState(
    val check: Vorgang = Vorgang.Fertig,
    /** Has this session already checked? */
    val geprueft: Boolean = false,
    /** The newer version, or null: there is none. */
    val newerVersion: UpdateBeschreibung? = null,
    /** 0..100 while loading, null = nothing is loading. */
    val fortschritt: Int? = null,
    /** The loaded APK is waiting for the user's consent. */
    val readyToInstallation: Boolean = false,
    /** Is the system permission "install apps from unknown sources" missing? */
    val permissionAbsent: Boolean = false,
    /**
     * Has the user dismissed the notice on start? Applies for this app run:
     * don't ask again on every tab switch, but ask again on the next start. The
     * dot on the account icon stays.
     */
    val dialogRejected: Boolean = false,
    /** A sentence in building blocks; the UI assembles it in its own language. */
    val fehler: Meldung? = null,
    /**
     * How fresh the last-checked description was; null before the first check.
     * Also set after the silent check: a withholding should be visible in the
     * settings without first pressing the button.
     */
    val frische: UpdateFresh? = null,
    /** Switch "Check for updates on start" (per device). */
    val startpruefung: Boolean = true,
)

/**
 * All of the account's price alerts — the overview in settings. `geladen`
 * instead of just an empty list: otherwise the section would briefly claim on
 * building that there are no alerts.
 */
data class AlarmUebersichtUiState(
    val alerts: List<PriceAlertView> = emptyList(),
    val geladen: Boolean = false,
)
