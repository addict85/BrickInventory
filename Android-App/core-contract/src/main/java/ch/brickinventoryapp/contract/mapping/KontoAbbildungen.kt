package ch.brickinventoryapp.contract.mapping

import ch.brickinventoryapp.model.util.zeitpunkt
import ch.brickinventoryapp.contract.CsvImportErgebnis
import ch.brickinventoryapp.contract.CsvImportStatus
import ch.brickinventoryapp.contract.GetrenntesKonto
import ch.brickinventoryapp.contract.HouseholdStatusResponse
import ch.brickinventoryapp.contract.LoginResponse
import ch.brickinventoryapp.contract.Profil
import ch.brickinventoryapp.contract.ProtokollZeile
import ch.brickinventoryapp.model.domain.TOKEN_SCOPE_FULL
import ch.brickinventoryapp.contract.elternkonten
import ch.brickinventoryapp.contract.newCreated
import ch.brickinventoryapp.model.domain.CsvResultView
import ch.brickinventoryapp.model.domain.CsvImportStatusView
import ch.brickinventoryapp.model.domain.SeparateAccountView
import ch.brickinventoryapp.model.domain.HouseholdStatusView
import ch.brickinventoryapp.model.domain.ProfileView
import ch.brickinventoryapp.model.domain.LogRowView

/** Verwalterrecht wirkt nur mit vollem Token: Mit "app" antwortet der Server auf Verwalteradressen 403. */
val LoginResponse.verwalter: Boolean get() = user?.isAdmin == true && tokenInfo?.scope == TOKEN_SCOPE_FULL

fun Profil.alsAnsicht() =
    ProfileView(id, username, email, firstName, lastName, emailConfirmed = emailVerified, emailNew = newEmail?.ifBlank { null })

fun GetrenntesKonto.alsAnsicht() = SeparateAccountView(id, username, via)

fun HouseholdStatusResponse.alsAnsicht() = HouseholdStatusView(
    isMain = isMain,
    isSub = isSub,
    currency = currency,
    elternkonten = elternkonten.map { it.alsAnsicht() },
    subAccounts = subAccounts.map { it.alsAnsicht() },
    openInvites = openInvites,
    formerLinks = formerLinks.map { it.alsAnsicht() },
)

fun ProtokollZeile.alsAnsicht() = LogRowView(id, level, message, zeitpunkt(loggedAt))

fun CsvImportErgebnis.alsAnsicht() = CsvResultView(total, newCreated, updated, errors)

fun CsvImportStatus.alsAnsicht() = CsvImportStatusView(
    status = status,
    total = total,
    done = done,
    current = current,
    ok = ok,
    warn = warn,
    err = err,
)
