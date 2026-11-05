package ch.brickinventoryapp.ui.viewmodel

/** Was Update-Hinweis und Update-Karte auslösen. */
interface UpdateAktionen {
    fun pruefeAufUpdate(still: Boolean = false)
    /** Die stille Prüfung beim Start, nur wenn der Schalter des Geräts an ist. */
    fun pruefeBeimStart()
    fun setzeStartpruefung(an: Boolean)
    fun updateHinweisSchliessen()
    fun ladeUpdate()
    fun starteInstallation()
}
