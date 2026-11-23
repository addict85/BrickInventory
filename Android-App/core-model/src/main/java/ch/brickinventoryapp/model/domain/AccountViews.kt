package ch.brickinventoryapp.model.domain

import java.time.Instant

// Account, household, server log and CSV in the settings.

/** The own profile; [emailConfirmed] instead of the server's 0/1. */
data class ProfileView(
    val id: Int,
    val username: String,
    val email: String?,
    val firstName: String?,
    val lastName: String?,
    val emailConfirmed: Boolean,
    /** The requested new address, as long as its link has not been opened. */
    val emailNew: String? = null,
)

/** A formerly linked account whose separation can still be confirmed. */
data class SeparateAccountView(val id: Int, val username: String, val via: String?)

/** The household from this account's view; [parentAccounts] unites `parents` and `linked_to`. */
data class HouseholdStatusView(
    val isMain: Boolean,
    val isSub: Boolean,
    val currency: CurrencyCode,
    val parentAccounts: List<AccountView>,
    val subAccounts: List<MemberView>,
    val openInvites: Int,
    val formerLinks: List<SeparateAccountView>,
)

/** A row of the server log. */
data class LogRowView(val id: Int?, val level: String?, val message: String?, val loggedAt: Instant?)

/** What a CSV upload resulted in; [newCreated] applies to both response forms of the server. */
data class CsvResultView(val total: Int, val newCreated: Int, val updated: Int, val errors: Int)

/** A state of the running CSV import; missing numbers are 0. */
data class CsvImportStatusView(
    val status: RunStatus?,
    val total: Int = 0,
    val done: Int = 0,
    val current: String? = null,
    val ok: Int = 0,
    val warn: Int = 0,
    val err: Int = 0,
)
