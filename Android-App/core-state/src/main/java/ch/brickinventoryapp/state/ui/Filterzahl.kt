package ch.brickinventoryapp.state.ui

import ch.brickinventoryapp.model.domain.Kategoriewahl
import ch.brickinventoryapp.model.domain.ColorPicker
import ch.brickinventoryapp.model.data.ScopeFilter
import ch.brickinventoryapp.model.domain.LocationView
import ch.brickinventoryapp.model.domain.MemberView
import ch.brickinventoryapp.model.domain.accountOptions
import ch.brickinventoryapp.model.data.Ersatzteilwahl

/**
 * How many filters currently apply — the number on the „Filter“ button. Only what
 * really narrows the list is counted; sorting has its own menu
 * with its own item (SortierMenu). A remembered
 * account that no longer belongs to the household, and a location that no longer holds
 * anything, show everything anyway (the same rule as on the sheet).
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
