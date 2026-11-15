package ch.brickinventoryapp.model.fach

/**
 * Wessen Bestand eine Anfrage meint, wenn nicht alle Konten des Blickfelds. Ein
 * Typ statt des Werts für `accounts=`, damit kein Aufrufer „own“ oder eine Zahl
 * als Text zusammensetzt; übersetzt wird nur auf dem Server (scopeIds).
 */

sealed interface Kontoauswahl {
    /** Der Wert für `accounts=`. */
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
        /** Der gespeicherte Filterwert; null für „alle“, leer oder Unlesbares — dann filtert nichts. */
        fun aus(wert: String?): Kontoauswahl? = when (val w = wert?.trim().orEmpty()) {
            Eigene.anfrage -> Eigene
            Unterkonten.anfrage -> Unterkonten
            else -> w.toIntOrNull()?.let(::Konto)
        }
    }
}
