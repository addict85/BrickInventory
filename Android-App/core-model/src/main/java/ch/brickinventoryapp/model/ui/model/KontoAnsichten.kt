package ch.brickinventoryapp.model.ui.model

import ch.brickinventoryapp.model.fach.Laufstatus
import ch.brickinventoryapp.model.fach.Waehrung
import ch.brickinventoryapp.model.data.model.CsvImportErgebnis
import ch.brickinventoryapp.model.data.model.CsvImportStatus
import ch.brickinventoryapp.model.data.model.GetrenntesKonto
import ch.brickinventoryapp.model.data.model.HouseholdStatusResponse
import ch.brickinventoryapp.model.data.model.Profil
import ch.brickinventoryapp.model.data.model.ProtokollZeile

// Konto, Haushalt, Server-Protokoll und CSV in den Einstellungen.

/** Das eigene Profil; [emailBestaetigt] statt der 0/1 des Servers. */
data class ProfilAnsicht(
    val id: Int,
    val username: String,
    val email: String?,
    val firstName: String?,
    val lastName: String?,
    val emailBestaetigt: Boolean,
    /** Die beantragte neue Adresse, solange ihr Link nicht geöffnet ist. */
    val emailNeu: String? = null,
)

fun Profil.alsAnsicht() =
    ProfilAnsicht(id, username, email, firstName, lastName, emailBestaetigt = emailVerified, emailNeu = emailNeu?.ifBlank { null })

/** Ein früher verknüpftes Konto, dessen Trennung noch bestätigt werden kann. */
data class GetrenntesKontoAnsicht(val id: Int, val username: String, val via: String?)

fun GetrenntesKonto.alsAnsicht() = GetrenntesKontoAnsicht(id, username, via)

/** Der Haushalt aus Sicht dieses Kontos; [elternkonten] vereint `parents` und `linked_to`. */
data class HaushaltStatusAnsicht(
    val isMain: Boolean,
    val isSub: Boolean,
    val currency: Waehrung,
    val elternkonten: List<KontoAnsicht>,
    val subAccounts: List<MitgliedAnsicht>,
    val openInvites: Int,
    val formerLinks: List<GetrenntesKontoAnsicht>,
)

fun HouseholdStatusResponse.alsAnsicht() = HaushaltStatusAnsicht(
    isMain = isMain,
    isSub = isSub,
    currency = currency,
    elternkonten = elternkonten.map { it.alsAnsicht() },
    subAccounts = subAccounts.map { it.alsAnsicht() },
    openInvites = openInvites,
    formerLinks = formerLinks.map { it.alsAnsicht() },
)

/** Eine Zeile des Server-Protokolls. */
data class ProtokollZeileAnsicht(val id: Int?, val level: String?, val message: String?, val loggedAt: String?)

fun ProtokollZeile.alsAnsicht() = ProtokollZeileAnsicht(id, level, message, loggedAt)

/** Was ein CSV-Hochladen ergab; [neuAngelegt] gilt für beide Antwortformen des Servers. */
data class CsvErgebnisAnsicht(val total: Int, val neuAngelegt: Int, val updated: Int, val errors: Int)

fun CsvImportErgebnis.alsAnsicht() = CsvErgebnisAnsicht(total, neuAngelegt, updated, errors)

/** Ein Stand des laufenden CSV-Imports; fehlende Zahlen sind 0. */
data class CsvImportStandAnsicht(
    val status: Laufstatus?,
    val total: Int,
    val done: Int,
    val current: String?,
    val ok: Int,
    val warn: Int,
    val err: Int,
)

fun CsvImportStatus.alsAnsicht() = CsvImportStandAnsicht(
    status = status,
    total = total ?: 0,
    done = done ?: 0,
    current = current,
    ok = ok ?: 0,
    warn = warn ?: 0,
    err = err ?: 0,
)
