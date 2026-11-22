package ch.brickinventoryapp.account.ui.viewmodel

import ch.brickinventoryapp.account.ui.UpdateUiState
import kotlinx.coroutines.flow.StateFlow

/** What the update notice and update card trigger. */
interface UpdateActions {
    fun checkOnUpdate(still: Boolean = false)
    /** The silent check on start, only if the device's switch is on. */
    fun checkOnStart()
    fun setStartCheck(an: Boolean)
    fun closeUpdateHint()
    fun loadUpdate()
    fun cancelLoad()
    fun startInstallation()

    /** Actions plus state, as the notice reads them; this is how a test shows it without a download. */
    interface WithState : UpdateActions {
        val uiState: StateFlow<UpdateUiState>
    }
}
