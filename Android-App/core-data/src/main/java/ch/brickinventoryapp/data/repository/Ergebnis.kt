package ch.brickinventoryapp.data.repository

import ch.brickinventoryapp.model.data.model.*

/**
 * Ergebnis eines Serveraufrufs — genau zwei Fälle, damit jedes `when` erschöpfend
 * ist und eine neue Variante an jeder Stelle bricht, die sie behandeln muss. Bitte
 * keinen `else`-Zweig nachrüsten: Er verschluckte künftige Fälle still.
 */
sealed class Ergebnis<out T> {
    /**
     * [stand] ist gesetzt, wenn die Daten aus der lokalen Ablage kommen
     * (Millisekunden seit 1970, Zeitpunkt der Ablage) — sonst sähe ein alter Stand aus
     * wie ein frischer. [gepuffert]: Die Änderung liegt im Ausgang und geht raus,
     * sobald der Server erreichbar ist; [data] ist dann ein Ersatz, keine Serverantwort.
     */
    data class Success<T>(val data: T, val stand: Long? = null, val gepuffert: Boolean = false) : Ergebnis<T>() {
        val veraltet: Boolean get() = stand != null
    }
    /**
     * Was schiefging, als geschlossene Hierarchie statt freier Felder: Wer nach der Art
     * verzweigt, schreibt ein erschöpfendes `when`, und ein neuer Fall bricht dort den
     * Build. Den Satz bildet die Anzeige (AppTexte.meldung()), die Datenschicht hat
     * keinen Context und kann nicht übersetzen.
     */
    sealed class Error : Ergebnis<Nothing>() {
        /** Der Satz des Servers zum Durchreichen, leer ohne einen; er kennt seine Fälle genauer. */
        open val message: String get() = ""

        /** Der Fehlercode des Servers: Nach ihm wird verzweigt, der Satz wechselt mit der Sprache. */
        open val code: Fehlercode? get() = null

        /** Text der Ursache, nur fürs Log: Bibliothekstexte sind englisch und kein Satz an Menschen. */
        open val technisch: String? get() = null

        /** Der Server war nicht erreichbar: Ein zweiter Versuch kann gelingen, der Plattenspeicher einspringen. */
        val transient: Boolean get() = when (this) {
            is Netz, Zeitueberschreitung -> true
            Abgebrochen, is LeereAntwort, is Abgewiesen, is Server, Klartext, is Unbekannt -> false
        }

        /** Host nicht auflösbar, Verbindung abgelehnt oder unterwegs abgerissen. */
        data class Netz(override val technisch: String? = null) : Error()

        data object Zeitueberschreitung : Error()

        /** Abriss mitten im Ereignisstrom: Ob der Server schon schrieb, ist offen — darum nicht vorübergehend. */
        data object Abgebrochen : Error()

        /** HTTP 2xx ohne Rumpf. */
        data class LeereAntwort(override val technisch: String? = null) : Error()

        /** HTTP 401: Der Token gilt nicht (mehr). Kein Netzproblem, das ein Wiederholen behebt. */
        data class Abgewiesen(override val message: String = "", override val code: Fehlercode? = null) : Error()

        /** Jeder andere HTTP-Fehlerstatus, mit Satz und Code des Servers, wenn er welche schickte. */
        data class Server(
            val status: Int,
            override val message: String = "",
            override val code: Fehlercode? = null,
        ) : Error()

        /** Die Server-Adresse ist http; die App sendet nur über https (util/KlartextAbgelehnt). */
        data object Klartext : Error()

        /** Jede andere Ausnahme, ohne nähere Einordnung. */
        data class Unbekannt(override val technisch: String? = null) : Error()
    }
}

/**
 * Seitengrösse der Galerie, wie in der Webapp (public/js/02-gallery.js): Zwei
 * Grössen ergäben zwei Scroll-Erlebnisse für denselben Bestand.
 */
const val GALLERY_PAGE_SIZE = 60

/**
 * Seitengrösse des Katalogs. Muss zur Rechnung des Servers passen: Der
 * Jahres-Sprung liefert `page` für genau diese Grösse, und aus `offset` leitet
 * die Ansicht die Seite selbst ab.
 */
const val CATALOG_PAGE_SIZE = 60
