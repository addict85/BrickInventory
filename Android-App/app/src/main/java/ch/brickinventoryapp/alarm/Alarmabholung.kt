package ch.brickinventoryapp.alarm

import ch.brickinventoryapp.data.model.PendingAlertsResponse
import ch.brickinventoryapp.data.model.Preisalarm
import ch.brickinventoryapp.data.repository.Result

/**
 * Was beim Abholen der ausgeloesten Preisalarme ENTSCHIEDEN wird.
 *
 * ── Warum das nicht im Worker steht ─────────────────────────────────────────
 *
 * Ein ListenableWorker laesst sich nur mit laufendem Android pruefen. Alles,
 * was hier entschieden wird — ab wann gefragt wird, welche Marke danach gilt,
 * was passiert, wenn der Server nicht antwortet — waere damit nur im Betrieb
 * beobachtbar. Der Worker ist deshalb duenn: Er beschafft den Kontext, ruft
 * hier an und zeigt an, was zurueckkommt.
 *
 * ── Die Marke kommt vom SERVER, nicht von der Uhr des Telefons ──────────────
 *
 * Der naechste Aufruf fragt „was hat seit `marke` ausgeloest?". Naehme die App
 * dafuer ihre eigene Uhr, entschiede die Gangabweichung zwischen Telefon und
 * Server darueber, ob eine Meldung doppelt kommt (Telefonuhr geht nach) oder
 * verloren geht (sie geht vor). Beides faellt niemandem als Uhrenproblem auf —
 * man sieht nur eine Meldung zu viel oder keine.
 *
 * Deshalb reicht der Server in jeder Antwort seinen eigenen Zeitpunkt mit, und
 * genau der wird zur naechsten Marke.
 */
/**
 * Die Abfrage selbst — ein Typalias, damit die Signatur von
 * [Alarmabholung.hole] lesbar bleibt. Top-Level, weil Kotlin Typalias nur
 * dort erlaubt.
 */
typealias Frage = suspend (String?) -> Result<PendingAlertsResponse>

object Alarmabholung {

    /** Was ein Durchgang ergeben hat. */
    sealed interface Ergebnis {
        /**
         * Geholt. `meldungen` kann leer sein — das ist der Normalfall.
         *
         * `neueMarke` ist IMMER zu speichern, auch ohne Meldung: Sonst
         * wuerde der naechste Durchgang wieder ab dem alten Zeitpunkt fragen
         * und dieselbe Meldung ein zweites Mal bringen.
         */
        data class Geholt(val meldungen: List<Preisalarm>, val neueMarke: String) : Ergebnis

        /**
         * Erster Durchgang — es gab noch keine Marke.
         *
         * Hier wird bewusst NICHTS gemeldet: Eine frisch eingerichtete App
         * soll nicht mit Schwellen aufschlagen, die vor Wochen gerissen sind.
         * Der Server liefert dafuer ohne `since` eine leere Liste; diese
         * Unterscheidung steht trotzdem hier, damit sie im Code sichtbar ist
         * und nicht nur als Nebenwirkung einer Serverantwort existiert.
         */
        data class Markiert(val neueMarke: String) : Ergebnis

        /** Nicht erreichbar oder abgelehnt — die Marke bleibt, wie sie war. */
        data object Fehlgeschlagen : Ergebnis
    }

    /**
     * Einen Durchgang machen.
     *
     * ── Warum die Abfrage ein PARAMETER ist ─────────────────────────────────
     *
     * Der erste Entwurf nahm das BrickRepository entgegen. Das ist eine
     * Klasse mit @Inject-Konstruktor, die ueber SetsRepository an Retrofit
     * und den Plattencache haengt — in einem gewoehnlichen Unit-Test nicht
     * herstellbar. Damit waere ausgerechnet das, was hier ENTSCHIEDEN wird,
     * nur im Betrieb beobachtbar gewesen, und die ganze Auslagerung aus dem
     * Worker haette ihren Zweck verfehlt.
     *
     * Dasselbe Muster wie beim Mailversand auf der Serverseite
     * (utils/preisalarm.ts): Wer WANN entscheidet, bekommt das WIE gereicht.
     *
     * @param marke der Zeitpunkt des letzten erfolgreichen Durchgangs, leer
     *        beim allerersten
     */
    suspend fun hole(marke: String?, frage: Frage): Ergebnis {
        val r = frage(marke?.takeIf { it.isNotBlank() })
        val antwort = (r as? Result.Success)?.data?.takeIf { it.success }
            ?: return Ergebnis.Fehlgeschlagen
        // Ohne `now` keine neue Marke — und ohne neue Marke lieber gar nichts
        // speichern, als eine falsche. Ein Server, der das Feld nicht kennt,
        // ist eine aeltere Fassung; dann bleibt es beim Mailversand.
        val neueMarke = antwort.now?.takeIf { it.isNotBlank() } ?: return Ergebnis.Fehlgeschlagen
        if (marke.isNullOrBlank()) return Ergebnis.Markiert(neueMarke)
        return Ergebnis.Geholt(antwort.alerts, neueMarke)
    }

    /**
     * Der Text EINER Meldung — hier und nicht im Worker, damit er sich ohne
     * Android pruefen laesst.
     *
     * Die Zahlen stehen mit zwei Nachkommastellen und der Waehrung des Alarms,
     * nicht der aktuellen Kontowaehrung: Die Schwelle wurde in jener Waehrung
     * gesetzt, und 200 CHF sind nicht 200 EUR.
     */
    fun text(a: Preisalarm, unter: String, ueber: String): String {
        val richtung = if (a.richtung == "unter") unter else ueber
        val preis = a.zuletztPreis
        val schwelle = String.format(java.util.Locale.US, "%.2f", a.schwelle)
        return if (preis == null)
            "${a.setNumber}: $richtung ${a.currencyCode} $schwelle"
        else
            "${a.setNumber}: ${a.currencyCode} ${String.format(java.util.Locale.US, "%.2f", preis)} " +
                "($richtung ${a.currencyCode} $schwelle)"
    }
}
