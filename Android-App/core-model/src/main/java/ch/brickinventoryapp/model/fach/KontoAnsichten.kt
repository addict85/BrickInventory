package ch.brickinventoryapp.model.fach

import java.time.Instant

// Konto, Haushalt, Server-Protokoll und CSV in den Einstellungen.

/** Das eigene Profil; [emailConfirmed] statt der 0/1 des Servers. */
data class ProfileView(
    val id: Int,
    val username: String,
    val email: String?,
    val firstName: String?,
    val lastName: String?,
    val emailConfirmed: Boolean,
    /** Die beantragte neue Adresse, solange ihr Link nicht geöffnet ist. */
    val emailNew: String? = null,
)

/** Ein früher verknüpftes Konto, dessen Trennung noch bestätigt werden kann. */
data class SeparateAccountView(val id: Int, val username: String, val via: String?)

/** Der Haushalt aus Sicht dieses Kontos; [elternkonten] vereint `parents` und `linked_to`. */
data class HouseholdStatusView(
    val isMain: Boolean,
    val isSub: Boolean,
    val currency: Waehrung,
    val elternkonten: List<AccountView>,
    val subAccounts: List<MemberView>,
    val openInvites: Int,
    val formerLinks: List<SeparateAccountView>,
)

/** Eine Zeile des Server-Protokolls. */
data class LogRowView(val id: Int?, val level: String?, val message: String?, val loggedAt: Instant?)

/** Was ein CSV-Hochladen ergab; [newCreated] gilt für beide Antwortformen des Servers. */
data class CsvResultView(val total: Int, val newCreated: Int, val updated: Int, val errors: Int)

/** Ein Stand des laufenden CSV-Imports; fehlende Zahlen sind 0. */
data class CsvImportStatusView(
    val status: Laufstatus?,
    val total: Int = 0,
    val done: Int = 0,
    val current: String? = null,
    val ok: Int = 0,
    val warn: Int = 0,
    val err: Int = 0,
)
