package ch.brickinventoryapp.sammlung.ui

import ch.brickinventoryapp.model.fach.Setsortierung
import ch.brickinventoryapp.model.ui.model.KaufAnsicht
import ch.brickinventoryapp.model.ui.model.KaufSummenAnsicht
import ch.brickinventoryapp.model.ui.model.KennzahlenAnsicht
import ch.brickinventoryapp.model.ui.model.PreisalarmAnsicht
import ch.brickinventoryapp.model.ui.model.PreisverlaufAnsicht
import ch.brickinventoryapp.model.ui.model.SetAnsicht
import ch.brickinventoryapp.model.ui.model.SetPreisAnsicht
import ch.brickinventoryapp.model.ui.Fehlerklasse

/**
 * Galerie: Liste, Filter, Blätterstand und Kennzahlen. Eigener Fluss, weil sich
 * die Galerie am häufigsten ändert und nur wenige Bildschirme sie lesen; in
 * AppUiState zeichneten bei jedem Blättern alle anderen mit.
 */
data class GalleryUiState(
    val sets: List<SetAnsicht> = emptyList(),
    /** Galerie-Filter, wie eingestellt; die Quelle (Ablage oder Kontosicht) wertet ihn aus. */
    val galleryQuery: String = "",
    val galleryTheme: String = "",
    val gallerySort: Setsortierung = Setsortierung.VORGABE,
    /** Themen des ganzen Bestands, aus der ungefilterten Liste. */
    val galleryThemes: List<String> = emptyList(),
    val galleryTotal: Int = 0,
    /** Die Quelle wird gefüllt; die Liste steht schon da, soweit sie abgelegt ist. */
    val galleryLoading: Boolean = false,
    /**
     * Warum die erste Seite nicht kam, als Satz für die Anzeige; null nach
     * Erfolg. Ohne das sah ein Ladefehler aus wie eine leere Sammlung.
     */
    val galleryFehler: String? = null,
    /** Wofür der Fehler steht — Symbol und Rat im Fehlerzustand. */
    val galleryFehlerKlasse: Fehlerklasse? = null,
    /** Liste aus dem Plattenspeicher statt vom Server: Zeitpunkt der Ablage, sonst null. */
    val offlineStand: Long? = null,
    val stats: KennzahlenAnsicht? = null,
)

/**
 * Set-Detail — eigener Fluss: Preis- und Verlaufsabrufe zeichneten sonst alles
 * neu, was AppUiState liest, obwohl nur SetDetailScreen sie braucht.
 */
data class SetDetailUiState(
    val setDetail: SetAnsicht? = null,
    val setDetailLoading: Boolean = false,
    /** Ohne Detail und ohne Vorschau aus der Galerie bliebe sonst der Kringel stehen. */
    val setDetailFehler: String? = null,
    val setDetailFehlerKlasse: Fehlerklasse? = null,
    val setPrice: SetPreisAnsicht? = null,
    val setPriceLoading: Boolean = false,
    /** Preis und Verlauf scheitern für sich; die Karte sagt es statt leer zu bleiben. */
    val preisFehler: String? = null,
    val preisFehlerKlasse: Fehlerklasse? = null,
    // Die ganze Antwort statt einzelner Felder: Sie trägt seit der
    // Server-Umstellung beide Verlaufsreihen, die fertigen Diagrammdaten, die
    // aktuellen Preise und die Bewertung je Zustand. Einzeln herausgezogen
    // müsste jedes neue Feld hier UND in ladeVerlauf nachgeführt
    // werden — die Antwort ist bereits das Modell.
    val priceHistory: PreisverlaufAnsicht? = null,
    val priceHistoryLoading: Boolean = false,
    val verlaufFehler: String? = null,
    /**
     * Preisalarme dieses Sets, höchstens zwei (neu und gebraucht). Getrennt vom Set
     * geladen, weil sie zum Konto gehören: Zwei Personen mit demselben Set haben
     * verschiedene Alarme.
     */
    val preisalarme: List<PreisalarmAnsicht> = emptyList(),
    val acquisitions: List<KaufAnsicht> = emptyList(),
    /**
     * Summenzeile der Erfassungen — vom Server gerechnet, nicht hier.
     * Die Ansicht zeigt sie nur an; die Regel steht in utils/acquisitions.ts.
     */
    val acquisitionTotals: KaufSummenAnsicht = KaufSummenAnsicht(),
    val acquisitionsLoading: Boolean = false,
)
