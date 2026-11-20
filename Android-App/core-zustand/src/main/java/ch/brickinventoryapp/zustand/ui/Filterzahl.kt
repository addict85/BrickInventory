package ch.brickinventoryapp.zustand.ui

import ch.brickinventoryapp.model.fach.Kategoriewahl
import ch.brickinventoryapp.model.fach.ColorPicker
import ch.brickinventoryapp.model.data.ScopeFilter
import ch.brickinventoryapp.model.fach.LocationView
import ch.brickinventoryapp.model.fach.MemberView
import ch.brickinventoryapp.model.fach.accountOptions
import ch.brickinventoryapp.model.data.Ersatzteilwahl

/**
 * Wie viele Filter gerade wirken — die Zahl am Knopf „Filter“. Gezählt wird
 * nur, was die Liste wirklich einschränkt; die Sortierung hat ihr eigenes Menü
 * mit eigenem Punkt (SortierMenu). Ein gemerktes
 * Konto, das nicht mehr zum Haushalt gehört, und ein Ort, in dem nichts mehr
 * liegt, zeigen ohnehin alles (dieselbe Regel wie im Blatt).
 */
object Filterzahl {

    fun konto(members: List<MemberView>, wert: String): Int {
        val possible = accountOptions(members, labelAll = "", labelOwn = "").map { it.first }
        return if (wert != ScopeFilter.ALL && wert in possible) 1 else 0
    }

    fun lager(orte: List<LocationView>, wert: String): Int =
        if (wert.isNotBlank() && orte.any { it.ort == wert }) 1 else 0

    fun galerie(members: List<MemberView>, konto: String, orte: List<LocationView>, lager: String,
                thema: String): Int =
        konto(members, konto) + lager(orte, lager) + (if (thema.isNotBlank()) 1 else 0)

    fun teile(members: List<MemberView>, konto: String, orte: List<LocationView>, lager: String,
              ersatz: Ersatzteilwahl, farbe: ColorPicker, kategorie: Kategoriewahl): Int =
        konto(members, konto) + lager(orte, lager) + (if (ersatz != Ersatzteilwahl.ALLE) 1 else 0) +
            listOf(farbe.wert, kategorie.wert).count { it != null }
}
