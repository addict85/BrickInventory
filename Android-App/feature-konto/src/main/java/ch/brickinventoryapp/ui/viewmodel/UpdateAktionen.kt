package ch.brickinventoryapp.ui.viewmodel

/** Was Update-Hinweis und Update-Karte auslösen. */
interface UpdateAktionen {
    fun pruefeAufUpdate(still: Boolean = false)
    fun updateHinweisSchliessen()
    fun ladeUpdate()
    fun ladeAbbrechen()
    fun starteInstallation()
}
