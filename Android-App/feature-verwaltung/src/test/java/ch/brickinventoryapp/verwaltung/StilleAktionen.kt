package ch.brickinventoryapp.verwaltung

import ch.brickinventoryapp.verwaltung.ui.viewmodel.Jobstart
import ch.brickinventoryapp.verwaltung.ui.viewmodel.MonitoringAktionen

/** Aktionen, die nichts tun; ein Test überschreibt nur, was er zählt. */
open class StilleAktionen : MonitoringAktionen {
    override fun aktualisiere() = Unit
    override fun zeigeWarteschlange() = Unit
    override fun waehleProtokoll(minuten: Int) = Unit
    override fun wiederhole(setNummer: String) = Unit
    override fun entferne(setNummer: String) = Unit
    override fun starte(job: Jobstart) = Unit
    override fun setzeZeitplan(name: String, zeit: String?, minuten: Int?) = Unit
    override fun auftragAbbrechen(id: String) = Unit
    override fun auftragWiederholen(id: String) = Unit
    override fun auftragsArtStarten(art: String, name: String) = Unit
    override fun auftragsArtLeeren(art: String) = Unit
}
