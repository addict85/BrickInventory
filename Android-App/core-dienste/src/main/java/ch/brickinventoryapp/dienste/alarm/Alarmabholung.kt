package ch.brickinventoryapp.dienste.alarm

import ch.brickinventoryapp.model.fach.Alarmrichtung
import ch.brickinventoryapp.model.data.model.PendingAlertsResponse
import ch.brickinventoryapp.model.data.model.Preisalarm
import ch.brickinventoryapp.data.repository.Ergebnis as Abrufergebnis
import java.text.NumberFormat
import java.util.Currency
import java.util.Locale

/**
 * Die Abfrage selbst — ein Typalias, damit die Signatur von [Alarmabholung.hole]
 * lesbar bleibt. Top-Level, weil Kotlin Typalias nur dort erlaubt.
 */
typealias Frage = suspend (String?) -> Abrufergebnis<PendingAlertsResponse>

/**
 * Was beim Abholen der ausgelösten Preisalarme entschieden wird — ausserhalb des
 * Workers, weil sich ein ListenableWorker nur mit laufendem Android prüfen lässt.
 * Der Worker beschafft den Kontext, ruft hier an und zeigt an, was zurückkommt.
 */
internal object Alarmabholung {

    /** Was ein Durchgang ergeben hat. */
    sealed interface Ergebnis {
        /**
         * Geholt. `meldungen` kann leer sein — das ist der Normalfall. `neueMarke` ist
         * immer zu speichern, auch ohne Meldung: Sonst fragte der nächste Durchgang ab dem
         * alten Zeitpunkt und brächte dieselbe Meldung ein zweites Mal.
         */
        data class Geholt(val meldungen: List<Preisalarm>, val neueMarke: String) : Ergebnis

        /**
         * Erster Durchgang — es gab noch keine Marke. Bewusst ohne Meldung: Eine frisch
         * eingerichtete App soll nicht mit Schwellen aufschlagen, die vor Wochen gerissen
         * sind. Der Server liefert ohne `since` ohnehin eine leere Liste; die
         * Unterscheidung steht hier, damit sie im Code sichtbar ist und nicht nur
         * Nebenwirkung einer Serverantwort.
         */
        data class Markiert(val neueMarke: String) : Ergebnis

        /** Nicht erreichbar oder abgelehnt — die Marke bleibt, wie sie war. */
        data object Fehlgeschlagen : Ergebnis
    }

    /**
     * Einen Durchgang machen. Die Abfrage ist ein Parameter, damit ein Unit-Test sie
     * ohne Retrofit und Plattencache reichen kann — sonst wäre gerade das Entschiedene nur im Betrieb beobachtbar. Wie beim
     * Mailversand des Servers (utils/preisalarm.ts): Wer entscheidet, bekommt das Wie
     * gereicht.
     *
     * @param marke der Zeitpunkt des letzten erfolgreichen Durchgangs, leer beim
     *         allerersten
     */
    suspend fun hole(marke: String?, frage: Frage): Ergebnis {
        val r = frage(marke?.takeIf { it.isNotBlank() })
        val antwort = (r as? Abrufergebnis.Success)?.data?.takeIf { it.success }
            ?: return Ergebnis.Fehlgeschlagen
        // Ohne `now` keine neue Marke — und ohne neue Marke lieber gar nichts
        // speichern, als eine falsche. Ein Server, der das Feld nicht kennt,
        // ist eine aeltere Fassung; dann bleibt es beim Mailversand.
        val neueMarke = antwort.now?.takeIf { it.isNotBlank() } ?: return Ergebnis.Fehlgeschlagen
        if (marke.isNullOrBlank()) return Ergebnis.Markiert(neueMarke)
        return Ergebnis.Geholt(antwort.alerts, neueMarke)
    }

    /**
     * Der Text einer Meldung — hier und nicht im Worker, damit er sich ohne Android
     * prüfen lässt. Zwei Nachkommastellen und die Währung des Alarms, nicht die
     * aktuelle Kontowährung: Die Schwelle wurde in jener Währung gesetzt, und 200 CHF
     * sind nicht 200 EUR. Der Betrag in der Form von [zahlen] („199,50 CHF“), wie überall
     * in der App und in der Web-Oberfläche.
     */
    fun text(a: Preisalarm, unter: String, ueber: String, zahlen: Locale): String {
        val richtung = if (a.richtung == Alarmrichtung.UNTER) unter else ueber
        val format = NumberFormat.getCurrencyInstance(zahlen).apply {
            runCatching { currency = Currency.getInstance(a.currencyCode.code) }
            minimumFractionDigits = 2
            maximumFractionDigits = 2
        }
        val preis = a.zuletztPreis
        val schwelle = format.format(a.schwelle)
        return if (preis == null)
            "${a.setNumber}: $richtung $schwelle"
        else
            "${a.setNumber}: ${format.format(preis)} ($richtung $schwelle)"
    }
}
