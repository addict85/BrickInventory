package ch.brickinventoryapp.ui

import ch.brickinventoryapp.data.ScopeFilter
import ch.brickinventoryapp.data.repository.GALLERY_DEFAULT_SORT
import ch.brickinventoryapp.ui.model.LagerortAnsicht
import ch.brickinventoryapp.ui.model.MitgliedAnsicht
import ch.brickinventoryapp.ui.model.kontoOptionen

/**
 * Wie viele Filter gerade wirken — die Zahl am Knopf „Filter“. Gezählt wird
 * nur, was die Liste wirklich einschränkt oder umsortiert: Ein gemerktes
 * Konto, das nicht mehr zum Haushalt gehört, und ein Ort, in dem nichts mehr
 * liegt, zeigen ohnehin alles (dieselbe Regel wie im Blatt).
 */
object Filterzahl {

    fun konto(members: List<MitgliedAnsicht>, wert: String): Int {
        val moeglich = kontoOptionen(members, labelAll = "", labelOwn = "").map { it.first }
        return if (wert != ScopeFilter.ALL && wert in moeglich) 1 else 0
    }

    fun lager(orte: List<LagerortAnsicht>, wert: String): Int =
        if (wert.isNotBlank() && orte.any { it.ort == wert }) 1 else 0

    fun galerie(members: List<MitgliedAnsicht>, konto: String, orte: List<LagerortAnsicht>, lager: String,
                thema: String, sortierung: String): Int =
        konto(members, konto) + lager(orte, lager) +
            (if (thema.isNotBlank()) 1 else 0) + (if (sortierung != GALLERY_DEFAULT_SORT) 1 else 0)

    /** [ersatz]: "" alle, "0" ohne, "1" nur Ersatzteile. */
    fun teile(members: List<MitgliedAnsicht>, konto: String, orte: List<LagerortAnsicht>, lager: String,
              ersatz: String, farbe: String, kategorie: String): Int =
        konto(members, konto) + lager(orte, lager) + listOf(ersatz, farbe, kategorie).count { it.isNotBlank() }
}
