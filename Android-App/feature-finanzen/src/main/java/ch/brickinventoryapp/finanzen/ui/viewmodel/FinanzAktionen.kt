package ch.brickinventoryapp.finanzen.ui.viewmodel

import ch.brickinventoryapp.model.data.ScopeFilter

/** Was der Finanzen-Reiter auslöst; der Bildschirm kennt nur diese Schnittstelle. */
internal interface FinanzAktionen {
    fun loadValuation()
    fun loadPortfolioHistory(period: String)
    fun finanzKategorieUmschalten(kategorie: String)
    fun finanzKategorienZuruecksetzen()
    fun setScope(view: ScopeFilter.View, value: String)
}
