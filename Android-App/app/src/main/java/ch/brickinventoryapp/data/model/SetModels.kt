package ch.brickinventoryapp.data.model

import kotlinx.serialization.EncodeDefault
import kotlinx.serialization.ExperimentalSerializationApi
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

/**
 * Sets: Bestand, Details, Anlegen und Aendern.
 *
 * ── Warum diese Datei existiert (Nachtrag 155) ──────────────────────────────
 *
 * Alle 92 Datenklassen der App standen in EINER Datei, Models.kt, mit 1158
 * Zeilen. Jede Aenderung an irgendeinem Modell beruehrte dieselbe Datei — bei
 * parallelen Aenderungen ein sicherer Konflikt, und beim Suchen war der Weg
 * immer derselbe: eine Datei oeffnen und scrollen.
 *
 * Aufgeteilt wurde entlang der Sachgebiete. Die Klassen selbst sind WORTGLEICH
 * uebernommen: Es wurde nichts umbenannt, nichts zusammengefasst und kein Feld
 * angefasst. Sie liegen weiter im Paket ch.brickinventoryapp.data.model, also
 * aendert sich fuer keinen Aufrufer etwas — Kotlin bindet an das Paket, nicht
 * an die Datei.
 */

@Serializable
data class CsvImportStatus(
    val success: Boolean = false,
    val status: String? = null,   // "running", "done", "cancelled"
    val total: Int? = null,
    val done: Int? = null,
    val current: String? = null,
    val ok: Int? = null,
    val warn: Int? = null,
    val err: Int? = null,
    val error: String? = null     // set when success=false
)

@Serializable
data class SetItem(
    @SerialName("set_number") val setNumber: String,
    val name: String? = null,
    val year: Int? = null,
    val theme: String? = null,
    val pieces: Int? = null,
    val minifigs: Int? = null,
    val quantity: Int = 1,
    @SerialName("image_url") val imageUrl: String? = null,
    @SerialName("image_local") val imageLocal: String? = null,
    @SerialName("added_at") val addedAt: String? = null,
    @SerialName("purchase_price") val purchasePrice: Double? = null,
    val condition: String? = null, // "N" = New/Neu, "U" = Used/Gebraucht
    /**
     * ALLE erfassten Zustände — je einer bekommt auf der Kachel eine Plakette.
     *
     * `condition` oben ist ein Aggregat und liefert genau einen Wert
     * („gebraucht, sobald eine Erfassung gebraucht ist"). Wer ein Exemplar neu
     * und eines gebraucht gekauft hat, sah damit nur „Gebraucht" — obwohl die
     * Neu-Erfassung mit ihrem eigenen Preis in die Bewertung eingeht.
     *
     * Der Server entscheidet, was drinsteht (conditionsFromAcquisitions in
     * utils/handlers.ts); hier wird nichts nachgerechnet.
     */
    val conditions: List<String> = emptyList(),
    /**
     * Besitzer im Haushalt — nur gesetzt, wenn mehrere Konten im Blickfeld
     * sind. Im Einzelkonto stünde an jeder Kachel „gehört mir", und das ist
     * Rauschen; im Haushalt ist es die wichtigste Angabe der Kachel, denn ohne
     * sie verschiebt man das falsche Exemplar.
     */
    val owners: List<HouseholdMember> = emptyList(),
    @SerialName("max_purchase_price") val maxPurchasePrice: Double? = null,
    /** Mengengewichteter Kaufpreis über die Erfassungen (Server rechnet ihn). */
    @SerialName("avg_purchase_price") val avgPurchasePrice: Double? = null,
    @SerialName("used_count") val usedCount: Int? = null,
    val instructions: List<Instruction> = emptyList()
) {
    /**
     * Der Kaufpreis, der ANGEZEIGT wird — mengengewichtet (Nachtrag 76).
     *
     * Marcos Befund: „In der Android-App wird der Kaufpreis des gebrauchten
     * Sets angezeigt, in der Webapp der gewichtete Durchschnittspreis."
     *
     * `purchasePrice` ist nur der in die sets-Zeile GESPIEGELTE Wert der
     * neuesten Erfassung. Bei mehreren Käufen (2×7.41 gebraucht, 1×9.48 neu)
     * ist das nicht der Preis der Sammlung, sondern der des letzten Kaufs — und
     * er passt auch nicht zur Prozentangabe daneben, die gegen den
     * Durchschnitt rechnet.
     *
     * Die Webapp nutzt `avg_purchase_price` seit jeher (mit demselben Rückfall).
     * Der Server rechnet den Wert; beide Clients lesen jetzt DASSELBE Feld —
     * die Regel steht hier EINMAL statt in jeder Ansicht.
     */
    val anzeigeKaufpreis: Double?
        get() = avgPurchasePrice ?: purchasePrice
}

@Serializable
data class Instruction(
    val id: Int? = null,
    val url: String,
    val description: String? = null,
    @SerialName("local_path") val localPath: String? = null
)

@Serializable
data class SetDetailResponse(val success: Boolean, val set: SetItem? = null)

@Serializable
data class SetResponse(
    val success: Boolean,
    val set: SetItem? = null,
    val error: String? = null
)

@Serializable
data class SetsResponse(
    val success: Boolean,
    val count: Int = 0,
    val sets: List<SetItem> = emptyList(),
    /** Gesamtzahl über ALLE Seiten — nur bei seitenweisem Abruf gesetzt. */
    val total: Int = 0,
    /**
     * Themen des ganzen Bestands, nicht der geladenen Seite. Der Server
     * schickt sie nur mit der ERSTEN Seite; Folgeseiten sparen die Abfrage.
     */
    val themes: List<String> = emptyList(),
    val error: String? = null
)

@Serializable
data class AddSetRequest(
    @SerialName("set_number") val setNumber: String,
    val quantity: Int = 1,
    @SerialName("purchase_price") val purchasePrice: Double? = null,
    val condition: String? = null, // "N" = New/Neu, "U" = Used/Gebraucht
    /**
     * Zielkonto im Haushalt — null = eigenes Konto (Verhalten wie bisher).
     * Ob es erlaubt ist, prüft der Server (canWriteFor), nicht die App.
     */
    @SerialName("owner_user_id") val ownerUserId: Int? = null
)

@Serializable
data class AddSetResponse(
    val success: Boolean,
    val action: String? = null,
    @SerialName("set_number") val setNumber: String? = null,
    val name: String? = null,
    val error: String? = null
)

@Serializable
data class UpdateManualItemRequest(
    val quantity: Int,
    @SerialName("unit_price") val unitPrice: Double? = null,
    @SerialName("bl_fig_number") val blFigNumber: String? = null,
    val condition: String? = null // "N" = New/Neu, "U" = Used/Gebraucht
)

@Serializable
// Der globale Json-Serializer nutzt encodeDefaults=true — ohne die
// EncodeDefault(NEVER)-Annotationen würde eine reine Mengenänderung
// zusätzlich "purchase_price": null und "condition": null senden. Auf dem
// Server löste "condition": null eine Coercion auf "N" aus (setzte den
// Zustand zurück) und ein mitgeschickter Kaufpreis überschrieb die soeben
// angelegte Erfassung. Beide Felder werden jetzt nur noch übertragen, wenn
// sie tatsächlich gesetzt sind.
@OptIn(ExperimentalSerializationApi::class)
data class UpdateQuantityRequest(
    val quantity: Int,
    @EncodeDefault(EncodeDefault.Mode.NEVER)
    @SerialName("purchase_price") val purchasePrice: Double? = null,
    @EncodeDefault(EncodeDefault.Mode.NEVER)
    val condition: String? = null // "N" = New/Neu, "U" = Used/Gebraucht
)

/**
 * Kennzahlen des Minifiguren-Reiters — vom SERVER gezählt.
 *
 * Vorher rechnete der Schirm sie aus der geladenen Liste. Die ist aber
 * gefiltert (`source != "manual"`), also zählte die Kachel „manuell erfasst"
 * zwangsläufig immer 0, und Arten/Stückzahl liessen die manuellen Einträge
 * aus — die Webapp zählte sie mit. Zwei Apps, zwei Zahlen für dieselbe
 * Sammlung. Gezählt wird jetzt in utils/handlers.ts über dieselbe Gruppierung
 * wie die Liste selbst.
 */
/**
 * Antwort auf „gibt es dieses Set schon?" (GET /api/v1/sets/exists/:nummer).
 *
 * Vorher fragte die App `getSetDetail()` und las aus dem FEHLER, ob das Set
 * existiert — das vermischt „nicht vorhanden" mit „Server nicht erreichbar"
 * und zwang zu einer eigenen Auswertung im Client. Jetzt sagt es der Server
 * ausdrücklich, mit derselben Regel, die auch beim Erfassen greift
 * (utils/setAdd.ts).
 */
@Serializable
data class SetExistsResponse(
    val success: Boolean = false,
    val exists: Boolean = false,
    @SerialName("set_number") val setNumber: String = "",
    @SerialName("owner_user_id") val ownerUserId: Int? = null,
    @SerialName("is_self") val isSelf: Boolean = false
)

@Serializable
data class BarcodeResponse(
    val success: Boolean,
    @SerialName("set_number") val setNumber: String = "",
    val name: String? = null,
    val year: Int? = null,
    val pieces: Int? = null,
    val theme: String? = null,
    val minifigs: Int? = null,
    @SerialName("image_url")   val imageUrl: String? = null,
    @SerialName("image_local") val imageLocal: String? = null,
    val source: String? = null,
    /**
     * Die Antwort ist GERATEN, nicht abgeglichen — bitte hinsehen.
     *
     * Der Server hat sieben Wege zu einer Setnummer; fünf gleichen eine
     * Kennung ab, zwei raten (utils/barcodeQuelle.ts). Bis hierher waren beide
     * nicht zu unterscheiden: Auch der Ratepfad antwortete mit `success: true`
     * und einer konkreten Nummer, und die App zeigte den Bestätigungsdialog,
     * als wäre das Set erkannt worden.
     *
     * Marcos Meldung war genau das: „Es werden regelmässig falsche Nummern
     * erkannt."
     *
     * Vorgabe false: Ein älterer Server kennt das Feld nicht, und dessen
     * Antworten sind nicht schlechter als vorher — der Hinweis fehlt dann
     * bloss.
     */
    val unsicher: Boolean = false,
    val error: String? = null
)

@Serializable
data class GenericResponse(
    val success: Boolean,
    val error: String? = null,
    /**
     * Neu berechnetes Zustands-Aggregat des Sets, wenn die Antwort von einem
     * Schreibvorgang auf set_acquisitions kommt.
     *
     * Der Server liefert es mit, damit der Client die Regel „eine U-Erfassung
     * macht das Set gebraucht" nicht nachbauen muss. Ohne das behielt die
     * Galerie-Kachel nach einer Zustandsänderung im Kaufpreis-Dialog das alte
     * Label, bis die Liste neu geladen wurde.
     */
    val set: SetAggregate? = null,
    /**
     * Was beim Verschieben eines Kaufpreises in ein anderes Konto mitgewandert
     * ist. Der Server liefert die Zahlen seit jeher mit (moveSetBetweenAccounts
     * in utils/setMove.ts) — die App las sie nur nie und zeigte deshalb in der
     * Erfolgsmeldung immer „0 Teile und 0 Minifiguren".
     *
     * Null bedeutet: Die Antwort kam nicht von einem Verschiebe-Vorgang.
     */
    val parts: Int? = null,
    val minifigs: Int? = null,
    @SerialName("source_emptied") val sourceEmptied: Boolean = false,
    /**
     * Die Gesamtmenge des Blickfelds NACH einer Mengenänderung.
     *
     * Angezeigt wird die Menge aller Konten, geschrieben wird die Differenz auf
     * das eigene (Nachtrag 85). Beim VERRINGERN deckelt der Server bei den
     * eigenen Exemplaren — fremde lassen sich nicht wegnehmen —, und dann ist
     * das Ergebnis eine ANDERE Zahl als die gesendete. Der Regler hatte seine
     * lokale Zahl aber schon hochgezählt und stünde bis zum nächsten Laden
     * daneben.
     *
     * Null bedeutet: Die Antwort kam nicht von einer Mengenänderung.
     */
    val quantity: Int? = null,
)

@Serializable
data class SetAggregate(
    @SerialName("set_number") val setNumber: String = "",
    val condition: String? = null,
    @SerialName("acq_count") val acqCount: Int? = null,
    @SerialName("used_count") val usedCount: Int? = null,
    // Ohne diese beiden Felder verlöre die Kachel nach dem Speichern die
    // zweite Plakette und den gewichteten Kaufpreis bis zum nächsten
    // vollständigen Laden — genau der Grund, aus dem es das Aggregat gibt.
    val conditions: List<String> = emptyList(),
    @SerialName("max_purchase_price") val maxPurchasePrice: Double? = null,
    @SerialName("avg_purchase_price") val avgPurchasePrice: Double? = null
)

@Serializable
data class DeleteWithQuantityResponse(
    val success: Boolean,
    @SerialName("new_quantity") val newQuantity: Int = 0
)
