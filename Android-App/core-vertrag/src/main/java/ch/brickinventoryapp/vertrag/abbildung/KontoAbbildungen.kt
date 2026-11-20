package ch.brickinventoryapp.vertrag.abbildung

import ch.brickinventoryapp.model.util.zeitpunkt
import ch.brickinventoryapp.vertrag.CsvImportErgebnis
import ch.brickinventoryapp.vertrag.CsvImportStatus
import ch.brickinventoryapp.vertrag.GetrenntesKonto
import ch.brickinventoryapp.vertrag.HouseholdStatusResponse
import ch.brickinventoryapp.vertrag.LoginResponse
import ch.brickinventoryapp.vertrag.Profil
import ch.brickinventoryapp.vertrag.ProtokollZeile
import ch.brickinventoryapp.model.fach.TOKEN_SCOPE_FULL
import ch.brickinventoryapp.vertrag.elternkonten
import ch.brickinventoryapp.vertrag.newCreated
import ch.brickinventoryapp.model.fach.CsvResultView
import ch.brickinventoryapp.model.fach.CsvImportStatusView
import ch.brickinventoryapp.model.fach.SeparateAccountView
import ch.brickinventoryapp.model.fach.HouseholdStatusView
import ch.brickinventoryapp.model.fach.ProfileView
import ch.brickinventoryapp.model.fach.LogRowView

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
