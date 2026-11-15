package ch.brickinventoryapp.vertrag.abbildung

import ch.brickinventoryapp.model.util.zeitpunkt
import ch.brickinventoryapp.vertrag.CsvImportErgebnis
import ch.brickinventoryapp.vertrag.CsvImportStatus
import ch.brickinventoryapp.vertrag.GetrenntesKonto
import ch.brickinventoryapp.vertrag.HouseholdStatusResponse
import ch.brickinventoryapp.vertrag.LoginResponse
import ch.brickinventoryapp.vertrag.Profil
import ch.brickinventoryapp.vertrag.ProtokollZeile
import ch.brickinventoryapp.model.fach.TOKEN_SCOPE_VOLL
import ch.brickinventoryapp.vertrag.elternkonten
import ch.brickinventoryapp.vertrag.neuAngelegt
import ch.brickinventoryapp.model.fach.CsvErgebnisAnsicht
import ch.brickinventoryapp.model.fach.CsvImportStandAnsicht
import ch.brickinventoryapp.model.fach.GetrenntesKontoAnsicht
import ch.brickinventoryapp.model.fach.HaushaltStatusAnsicht
import ch.brickinventoryapp.model.fach.ProfilAnsicht
import ch.brickinventoryapp.model.fach.ProtokollZeileAnsicht

/** Verwalterrecht wirkt nur mit vollem Token: Mit "app" antwortet der Server auf Verwalteradressen 403. */
val LoginResponse.verwalter: Boolean get() = user?.isAdmin == true && tokenInfo?.scope == TOKEN_SCOPE_VOLL

fun Profil.alsAnsicht() =
    ProfilAnsicht(id, username, email, firstName, lastName, emailBestaetigt = emailVerified, emailNeu = emailNeu?.ifBlank { null })

fun GetrenntesKonto.alsAnsicht() = GetrenntesKontoAnsicht(id, username, via)

fun HouseholdStatusResponse.alsAnsicht() = HaushaltStatusAnsicht(
    isMain = isMain,
    isSub = isSub,
    currency = currency,
    elternkonten = elternkonten.map { it.alsAnsicht() },
    subAccounts = subAccounts.map { it.alsAnsicht() },
    openInvites = openInvites,
    formerLinks = formerLinks.map { it.alsAnsicht() },
)

fun ProtokollZeile.alsAnsicht() = ProtokollZeileAnsicht(id, level, message, zeitpunkt(loggedAt))

fun CsvImportErgebnis.alsAnsicht() = CsvErgebnisAnsicht(total, neuAngelegt, updated, errors)

fun CsvImportStatus.alsAnsicht() = CsvImportStandAnsicht(
    status = status,
    total = total,
    done = done,
    current = current,
    ok = ok,
    warn = warn,
    err = err,
)
