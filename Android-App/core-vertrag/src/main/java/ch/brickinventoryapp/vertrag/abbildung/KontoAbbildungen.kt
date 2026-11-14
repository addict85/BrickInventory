package ch.brickinventoryapp.vertrag.abbildung

import ch.brickinventoryapp.vertrag.CsvImportErgebnis
import ch.brickinventoryapp.vertrag.CsvImportStatus
import ch.brickinventoryapp.vertrag.GetrenntesKonto
import ch.brickinventoryapp.vertrag.HouseholdStatusResponse
import ch.brickinventoryapp.vertrag.Profil
import ch.brickinventoryapp.vertrag.ProtokollZeile
import ch.brickinventoryapp.model.ui.model.CsvErgebnisAnsicht
import ch.brickinventoryapp.model.ui.model.CsvImportStandAnsicht
import ch.brickinventoryapp.model.ui.model.GetrenntesKontoAnsicht
import ch.brickinventoryapp.model.ui.model.HaushaltStatusAnsicht
import ch.brickinventoryapp.model.ui.model.ProfilAnsicht
import ch.brickinventoryapp.model.ui.model.ProtokollZeileAnsicht

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

fun ProtokollZeile.alsAnsicht() = ProtokollZeileAnsicht(id, level, message, loggedAt)

fun CsvImportErgebnis.alsAnsicht() = CsvErgebnisAnsicht(total, neuAngelegt, updated, errors)

fun CsvImportStatus.alsAnsicht() = CsvImportStandAnsicht(
    status = status,
    total = total ?: 0,
    done = done ?: 0,
    current = current,
    ok = ok ?: 0,
    warn = warn ?: 0,
    err = err ?: 0,
)
