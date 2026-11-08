package ch.brickinventoryapp.verwaltung.ui.viewmodel

/**
 * Was die Verwaltungsseite auslöst. Die suspendierenden Aufrufe liefern das
 * Ergebnis für die Meldung, die der Bildschirm in seiner Sprache formuliert.
 */
interface MonitoringAktionen {
    suspend fun ladeJobs()
    suspend fun ladeWarteschlange()
    suspend fun ladeProtokoll(minuten: Int)
    suspend fun wiederholeEintrag(setNummer: String): Boolean
    suspend fun entferneEintrag(setNummer: String): Boolean
    suspend fun leseAnleitungenNeuEin(): Int?
    suspend fun starteCsvAbgleich(): Boolean
    suspend fun startePreislauf(): Boolean
    suspend fun ladeFehlendeBilderNach(): Boolean
    suspend fun reiheKatalogbilderEin(): Boolean
    suspend fun setzeJobZeitplan(name: String, zeit: String? = null, minuten: Int? = null): Boolean
    fun auftragAbbrechen(id: String)
    fun auftragWiederholen(id: String)
    fun auftragsArtStarten(art: String, name: String)
    fun auftragsArtLeeren(art: String)
    /** Ein Satz für die Snackbar der App. */
    fun melde(satz: String)
}
