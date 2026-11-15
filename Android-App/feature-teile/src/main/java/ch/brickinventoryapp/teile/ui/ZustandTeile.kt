package ch.brickinventoryapp.teile.ui

import ch.brickinventoryapp.model.fach.Kategoriewahl
import ch.brickinventoryapp.model.fach.Farbwahl
import ch.brickinventoryapp.model.ui.Meldung
import ch.brickinventoryapp.model.ui.Laden
import ch.brickinventoryapp.model.ui.Vorgang
import ch.brickinventoryapp.model.fach.Waehrung
import ch.brickinventoryapp.model.fach.Postenart
import ch.brickinventoryapp.model.fach.Zustand
import ch.brickinventoryapp.model.fach.BestandteilKopfAnsicht
import ch.brickinventoryapp.model.fach.FarbeAnsicht
import ch.brickinventoryapp.model.fach.FigurAnsicht
import ch.brickinventoryapp.model.fach.FigurenKennzahlenAnsicht
import ch.brickinventoryapp.model.fach.FilterFarbeAnsicht
import ch.brickinventoryapp.model.fach.KategorieAnsicht
import ch.brickinventoryapp.model.fach.ManuelleFigurAnsicht
import ch.brickinventoryapp.model.fach.ManuellesTeilAnsicht
import ch.brickinventoryapp.model.fach.OHNE_FARBE
import ch.brickinventoryapp.model.fach.TeilAnsicht
import ch.brickinventoryapp.model.fach.TeileKennzahlenAnsicht
import ch.brickinventoryapp.model.fach.VerwendendesSetAnsicht
import ch.brickinventoryapp.model.data.Ersatzteilwahl
import ch.brickinventoryapp.model.ui.Listenansicht
import java.io.Serializable

/**
 * Was die Teileliste filtert und wie sie sie zeigt — ein Wert, der als Ganzes im
 * SavedStateHandle liegt und nach dem Prozesstod wiederkommt. Jeder Lader liest ihn aus
 * dem Zustand, nie als Parameter: Sonst hängte `onLoadMore` eine ungefilterte Seite an.
 * Konto und Lagerort gehören nicht dazu; sie bleiben nur im Speicher (Blickfeld).
 */
data class Teilefilter(
    val suche: String = "",
    /** Wie parts-spare der Webapp. */
    val ersatz: Ersatzteilwahl = Ersatzteilwahl.ALLE,
    /** Karten oder Tabelle; die Tabelle holt „In Sets“ mit (`with_sets=1`), darum im Filter. */
    val ansicht: Listenansicht = Listenansicht.KARTEN,
    /** Sortiert wird in der Ansicht, die Liste liegt ganz vor. */
    val ordnung: Ordnung = Ordnung.FARBE,
    /** Der Farbname reist als `color=` mit. */
    val farbe: Farbwahl = Farbwahl.Alle,
    /** Der Wert (`category_name`), nicht die Beschriftung: Der Server filtert danach. */
    val kategorie: Kategoriewahl = Kategoriewahl.Alle,
) : Serializable {
    /** Die drei Reihenfolgen der Webapp; die Regeln stehen in sortiert() (TeileOrdnung.kt). */
    enum class Ordnung { FARBE, NAME, MENGE }

    private companion object {
        // Fest, sonst rechnet die JVM die Kennung aus der Klassenform, und jede neue Fassung
        // der App verwürfe den gemerkten Filter.
        private const val serialVersionUID: Long = 2L
    }
}

/** Der Teile-Reiter: Liste, Filter mit ihren Auswahllisten, Kennzahlen. */
data class TeileUiState(
    val parts: List<TeilAnsicht> = emptyList(),
    /**
     * Die manuell erfassten Teile (/parts/manual). null heisst „noch nicht geladen“, leer
     * „keine vorhanden“: Die Rollposition wartet auf die Liste, auch wenn sie leer ist.
     */
    val manualParts: List<ManuellesTeilAnsicht>? = null,
    val partsTotal: Int = 0,
    val partsPage: Int = 1,
    val filter: Teilefilter = Teilefilter(),
    /** Die Auswahl der beiden Filter mit Anzahl (/parts/colors und /parts/categories). */
    val partsFilterColors: List<FilterFarbeAnsicht> = emptyList(),
    val partsCategories: List<KategorieAnsicht> = emptyList(),
    /** Der letzte Abruf; die Liste kommt aus der Ablage und bleibt stehen. */
    val teileAbruf: Laden<Unit> = Laden.Daten(Unit),
    /** Teileliste aus dem Plattenspeicher: Zeitpunkt der Ablage, sonst null. */
    val teileOfflineStand: Long? = null,
    val partsStats: TeileKennzahlenAnsicht? = null,
    /** Alle Farben für den Erfassungsdialog. */
    val partsColors: List<FarbeAnsicht> = emptyList(),
)

/** Der Figuren-Reiter: eigener Zustand, damit Blättern in den Teilen ihn nicht neu zeichnet. */
data class FigurenUiState(
    val minifigs: List<FigurAnsicht> = emptyList(),
    /** Die manuell erfassten Figuren, null wie bei [TeileUiState.manualParts]. */
    val manualFigs: List<ManuelleFigurAnsicht>? = null,
    /** Kennzahlen der Kacheln — vom Server, nicht aus der (gefilterten) Liste. */
    val minifigStats: FigurenKennzahlenAnsicht = FigurenKennzahlenAnsicht(),
    val figurenAbruf: Laden<Unit> = Laden.Daten(Unit),
    val figurenOfflineStand: Long? = null,
    /** Gesucht wird auf dem Server vor der Gruppierung; eine zweite Suche im Bildschirm träfe anderes. */
    val minifigsQuery: String = "",
    val minifigsView: Listenansicht = Listenansicht.KARTEN,
)

/**
 * Der Detail-Dialog für ein Teil oder eine Figur aus einem Set: Zoom, Menge nur
 * zum Lesen, und in welchen Sets es steckt. Eigener Fluss, weil der Dialog
 * Zwischenstände erzeugt, die jeden Reiter angingen; `offen == null` heisst: kein
 * Dialog. Ein Zustand für beides, weil der Server dieselbe Form liefert.
 */
data class SetItemUiState(
    /** null heisst: der Dialog ist zu. */
    val art: Postenart? = null,
    val nummer: String = "",
    val colorId: Int = OHNE_FARBE,
    val abruf: Laden<Unit> = Laden.Daten(Unit),
    val kopf: BestandteilKopfAnsicht? = null,
    val sets: List<VerwendendesSetAnsicht> = emptyList(),
) {
    val offen: Boolean get() = art != null
}

/**
 * Die Bauliste im ViewModel: Eine Drehung baut den Bildschirm neu, die erzeugte Liste
 * und ein laufender Abruf bleiben. Die Setnummern überleben auch das Prozessende
 * (SavedStateHandle), die Teile nicht — tausend Zeilen sprengten das Bundle.
 */
data class TeilelisteUiState(
    val sets: List<PlSet> = emptyList(),
    val parts: List<PlPart> = emptyList(),
    val generated: Boolean = false,
    /** Das Erzeugen der Liste; Fehler einzelner Sets nennt [status]. */
    val erzeugen: Laden<Unit> = Laden.Daten(Unit),
    /** Fortschritt, Ergebnis oder Fehler der letzten Handlung; null heisst nichts zu sagen. */
    val status: Meldung? = null,
    val nurLose: Boolean = false,
    val mitUnterkonten: Boolean = false,
    /** Der Abgleich mit dem eigenen Bestand; sein Ergebnis nennt [status]. */
    val bestand: Vorgang = Vorgang.Fertig,
    val pdf: Vorgang = Vorgang.Fertig,
    /** Fertiges PDF, das der Bildschirm einmal zum Öffnen anbietet. */
    val pdfDatei: java.io.File? = null,
)

/**
 * Was Teile und Figuren aus der Sitzung lesen: Server für die Bilder, Währung und
 * der vorgewählte Zustand beim Erfassen. Nicht die ganze Sitzung, damit eine
 * Änderung an Anmeldung oder Design die Listen nicht neu zeichnet.
 */
internal data class TeileSitzungUiState(
    val serverUrl: String = "",
    val currency: Waehrung = Waehrung.EUR,
    val userDefaultCondition: Zustand? = null,
)
