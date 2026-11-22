package ch.brickinventoryapp.contract.mapping

import ch.brickinventoryapp.contract.CsvImportErgebnis
import ch.brickinventoryapp.contract.CsvImportStatus
import ch.brickinventoryapp.contract.GetrenntesKonto
import ch.brickinventoryapp.contract.HouseholdStatusResponse
import ch.brickinventoryapp.contract.LoginResponse
import ch.brickinventoryapp.contract.Profil
import ch.brickinventoryapp.contract.ProtokollZeile
import ch.brickinventoryapp.contract.newCreated
import ch.brickinventoryapp.contract.parentAccounts
import ch.brickinventoryapp.model.domain.CsvImportStatusView
import ch.brickinventoryapp.model.domain.CsvResultView
import ch.brickinventoryapp.model.domain.HouseholdStatusView
import ch.brickinventoryapp.model.domain.LogRowView
import ch.brickinventoryapp.model.domain.ProfileView
import ch.brickinventoryapp.model.domain.SeparateAccountView
import ch.brickinventoryapp.model.domain.TOKEN_SCOPE_FULL
import ch.brickinventoryapp.model.util.parseInstant

/** Admin rights only take effect with a full token: with "app" the server answers admin addresses with 403. */
val LoginResponse.admin: Boolean get() = user?.isAdmin == true && tokenInfo?.scope == TOKEN_SCOPE_FULL

fun Profil.asView() =
    ProfileView(id, username, email, firstName, lastName, emailConfirmed = emailVerified, emailNew = newEmail?.ifBlank { null })

fun GetrenntesKonto.asView() = SeparateAccountView(id, username, via)

fun HouseholdStatusResponse.asView() = HouseholdStatusView(
    isMain = isMain,
    isSub = isSub,
    currency = currency,
    parentAccounts = parentAccounts.map { it.asView() },
    subAccounts = subAccounts.map { it.asView() },
    openInvites = openInvites,
    formerLinks = formerLinks.map { it.asView() },
)

fun ProtokollZeile.asView() = LogRowView(id, level, message, parseInstant(loggedAt))

fun CsvImportErgebnis.asView() = CsvResultView(total, newCreated, updated, errors)

fun CsvImportStatus.asView() = CsvImportStatusView(
    status = status,
    total = total,
    done = done,
    current = current,
    ok = ok,
    warn = warn,
    err = err,
)
