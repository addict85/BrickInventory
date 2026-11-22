package ch.brickinventoryapp.finances.ui.viewmodel

import ch.brickinventoryapp.model.data.ScopeFilter

/** What the finances tab triggers; the screen knows only this interface. */
internal interface FinanzAktionen {
    fun loadValuation()
    fun loadPortfolioHistory(period: String)
    fun toggleFinanceCategory(kategorie: String)
    fun resetFinanceCategories()
    fun setScope(view: ScopeFilter.View, value: String)
}
