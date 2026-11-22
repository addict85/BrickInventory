package ch.brickinventoryapp.model.domain

/**
 * Whose stock a request means, if not all accounts in view. A
 * type instead of the value for `accounts=`, so that no caller assembles „own“ or a number
 * as text; translation happens only on the server (scopeIds).
 */

sealed interface AccountSelection {
    /** The value for `accounts=`. */
    val request: String

    data object Own : AccountSelection {
        override val request get() = "own"
    }

    data object SubAccounts : AccountSelection {
        override val request get() = "subs"
    }

    data class Account(val id: Int) : AccountSelection {
        override val request get() = id.toString()
    }

    companion object {
        /** The saved filter value; null for „all“, empty or unreadable — then nothing filters. */
        fun from(value: String?): AccountSelection? = when (val w = value?.trim().orEmpty()) {
            Own.request -> Own
            SubAccounts.request -> SubAccounts
            else -> w.toIntOrNull()?.let(::Account)
        }
    }
}
