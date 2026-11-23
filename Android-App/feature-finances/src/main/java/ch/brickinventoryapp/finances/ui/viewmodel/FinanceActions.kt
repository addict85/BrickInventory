package ch.brickinventoryapp.finances.ui.viewmodel

import ch.brickinventoryapp.model.data.ScopeFilter

/** What the finances tab triggers; the screen knows only this interface. */
internal interface FinanceActions {
    fun loadValuation()
    fun loadPortfolioHistory(period: String)
    fun toggleFinanceCategory(category: String)
    fun resetFinanceCategories()
    fun setScope(view: ScopeFilter.View, value: String)
}
