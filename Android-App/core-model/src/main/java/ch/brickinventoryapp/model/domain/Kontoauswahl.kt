package ch.brickinventoryapp.model.domain

/**
 * Whose stock a request means, if not all accounts in view. A
 * type instead of the value for `accounts=`, so that no caller assembles „own“ or a number
 * as text; translation happens only on the server (scopeIds).
 */

sealed interface Kontoauswahl {
    /** The value for `accounts=`. */
    val anfrage: String

    data object Eigene : Kontoauswahl {
        override val anfrage get() = "own"
    }

    data object Unterkonten : Kontoauswahl {
        override val anfrage get() = "subs"
    }

    data class Konto(val id: Int) : Kontoauswahl {
        override val anfrage get() = id.toString()
    }

    companion object {
        /** The saved filter value; null for „all“, empty or unreadable — then nothing filters. */
        fun aus(wert: String?): Kontoauswahl? = when (val w = wert?.trim().orEmpty()) {
            Eigene.anfrage -> Eigene
            Unterkonten.anfrage -> Unterkonten
            else -> w.toIntOrNull()?.let(::Konto)
        }
    }
}
